"""
Yoda Virtual Mouse v2
=====================
Uses the real Windows cursor but:
1. Saves your cursor position before acting
2. Draws a green glowing arrow overlay so you can see Yoda's cursor
3. Restores YOUR cursor position after Yoda is done
4. Shows a small "YODA CTRL" pill in the corner while active

This means you can see exactly what Yoda is doing AND get your
cursor back in the same spot when he's finished.

Commands (stdin, one per line):
  MOVE x y [dur]       smooth animated move
  CLICK x y [button]   move then click (left/right/middle)
  RCLICK x y           right click
  DCLICK x y           double click
  DRAG x1 y1 x2 y2     click and drag
  TYPE text            type text at current position
  KEY keyname          press a key (enter/tab/esc/win/ctrl/alt...)
  HOTKEY k1 k2 ...     key combo e.g. HOTKEY ctrl c
  SCROLL x y n         scroll n clicks at position
  SCREENSHOT           screenshot to Desktop
  SHOW                 show overlay
  HIDE                 hide overlay
  STATE s              thinking|speaking|listening|clicking|idle
  POS                  print cursor position as JSON
  SIZE                 print screen size as JSON
  QUIT
"""

import sys, os, time, math, threading, json, subprocess, ctypes
import ctypes.wintypes as wt

# ── Auto-install ──────────────────────────────────────────────────────────
def ensure(pkg, pip=None):
    try: __import__(pkg)
    except ImportError:
        subprocess.check_call([sys.executable,"-m","pip","install",pip or pkg,"--quiet"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
ensure("pyautogui")
ensure("PIL","Pillow")

import pyautogui
pyautogui.FAILSAFE = False
pyautogui.PAUSE    = 0.0

# ── Win32 ─────────────────────────────────────────────────────────────────
user32  = ctypes.windll.user32
gdi32   = ctypes.windll.gdi32
kernel32= ctypes.windll.kernel32

WS_EX_LAYERED    = 0x00080000
WS_EX_TRANSPARENT= 0x00000020
WS_EX_TOPMOST    = 0x00000008
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_NOACTIVATE = 0x08000000  # fine — fits in 32-bit
WS_POPUP         = ctypes.c_int32(0x80000000).value  # signed cast fixes overflow
ULW_ALPHA=2; AC_SRC_OVER=0; AC_SRC_ALPHA=1; DIB_RGB_COLORS=0
SW_SHOW=5; SW_HIDE=0

CW,CH = 52,60   # cursor canvas

class BLEND(ctypes.Structure):
    _fields_=[("BlendOp",ctypes.c_byte),("BlendFlags",ctypes.c_byte),
              ("SourceConstantAlpha",ctypes.c_byte),("AlphaFormat",ctypes.c_byte)]

class BMPIH(ctypes.Structure):
    _fields_=[("biSize",ctypes.c_uint32),("biWidth",ctypes.c_int32),("biHeight",ctypes.c_int32),
              ("biPlanes",ctypes.c_uint16),("biBitCount",ctypes.c_uint16),("biCompression",ctypes.c_uint32),
              ("biSizeImage",ctypes.c_uint32),("biXPelsPerMeter",ctypes.c_int32),
              ("biYPelsPerMeter",ctypes.c_int32),("biClrUsed",ctypes.c_uint32),("biClrImportant",ctypes.c_uint32)]

class PT(ctypes.Structure):  _fields_=[("x",ctypes.c_long),("y",ctypes.c_long)]
class SZ(ctypes.Structure):  _fields_=[("cx",ctypes.c_long),("cy",ctypes.c_long)]


# ── Bitmap renderer ───────────────────────────────────────────────────────
def make_bmp(pulse=0.5, state="idle"):
    bi=BMPIH(); bi.biSize=ctypes.sizeof(BMPIH); bi.biWidth=CW; bi.biHeight=-CH
    bi.biPlanes=1; bi.biBitCount=32; bi.biCompression=0
    pb=ctypes.c_void_p(); hdc=user32.GetDC(None)
    hb=gdi32.CreateDIBSection(hdc,ctypes.byref(bi),DIB_RGB_COLORS,ctypes.byref(pb),None,0)
    user32.ReleaseDC(None,hdc)
    if not hb: return None,None
    buf=(ctypes.c_uint8*(CW*CH*4)).from_address(pb.value)
    ctypes.memset(pb,0,CW*CH*4)

    def px(x,y,r,g,b,a):
        if 0<=x<CW and 0<=y<CH:
            i=(y*CW+x)*4; f=a/255.0
            buf[i]=int(b*f); buf[i+1]=int(g*f); buf[i+2]=int(r*f); buf[i+3]=a

    # Glow size + alpha by state
    gparams = {
        "clicking":  (22, int(220+pulse*35)),
        "thinking":  (17, int(110+pulse*110)),
        "typing":    (11, int(95+pulse*75)),
        "listening": (15, int(85+pulse*95)),
        "idle":      (12, int(65+pulse*65)),
    }
    gr,ga = gparams.get(state, (13, int(75+pulse*75)))

    # Radial glow around tip (8,8)
    tx,ty = 8,8
    for dy in range(-gr,gr+1):
        for dx in range(-gr,gr+1):
            d=math.sqrt(dx*dx+dy*dy)
            if d<=gr:
                a=int(ga*((1-d/gr)**1.8)); xi,yi=tx+dx,ty+dy
                if 0<=xi<CW and 0<=yi<CH:
                    i=(yi*CW+xi)*4
                    if a>buf[i+3]:
                        f=a/255.0
                        buf[i]=int(65*f); buf[i+1]=int(255*f); buf[i+2]=0; buf[i+3]=a

    # Arrow outline (dark)
    arrow=[
        (8,8),(8,9),(8,10),(8,11),(8,12),(8,13),(8,14),(8,15),(8,16),(8,17),(8,18),(8,19),(8,20),(8,21),
        (9,9),(9,10),(9,11),(9,12),(9,13),(9,14),(9,15),(9,16),(9,17),(9,18),(9,19),(9,20),
        (10,10),(10,11),(10,12),(10,13),(10,14),(10,15),(10,16),(10,17),(10,18),(10,19),
        (11,11),(11,12),(11,13),(11,14),(11,15),(11,16),(11,17),(11,18),
        (12,12),(12,13),(12,14),(12,15),(12,16),(12,17),
        (13,13),(13,14),(13,15),(13,16),
        (14,14),(14,15),
        # right arm of arrow
        (12,18),(12,19),(12,20),(12,21),(12,22),(12,23),(12,24),
        (13,17),(13,18),(13,19),(13,20),(13,21),(13,22),(13,23),(13,24),
        (14,16),(14,17),(14,18),(14,19),(14,20),(14,21),(14,22),(14,23),
        (15,16),(15,17),(15,18),(15,19),(15,20),(15,21),(15,22),
        (16,17),(16,18),(16,19),(16,20),(16,21),
    ]
    for ax,ay in arrow:
        for ox,oy in [(-1,0),(1,0),(0,-1),(0,1)]:
            px(ax+ox,ay+oy,0,20,6,215)
    for ax,ay in arrow:
        px(ax,ay,0,255,65,255)
    # Bright tip
    for ox,oy in [(0,0),(1,0),(0,1),(1,1)]:
        px(8+ox,8+oy,200,255,200,255)

    return hb,pb


# ── Overlay window ────────────────────────────────────────────────────────
class Overlay:
    def __init__(self):
        self.hwnd=None; self.x=self.y=0; self.visible=False
        self.state="idle"; self.pulse=0.5; self.pd=1
        self._run=True; self._wcp=None

    def init(self):
        # Use c_ssize_t (LRESULT) for return + proper 64-bit param types
        LRESULT = ctypes.c_ssize_t
        WP = ctypes.WINFUNCTYPE(LRESULT, wt.HWND, ctypes.c_uint, wt.WPARAM, wt.LPARAM)
        user32.DefWindowProcW.restype  = LRESULT
        user32.DefWindowProcW.argtypes = [wt.HWND, ctypes.c_uint, wt.WPARAM, wt.LPARAM]
        def proc(h, msg, w2, l):
            return user32.DefWindowProcW(h, msg, w2, l)
        self._wcp = WP(proc)
        class WC(ctypes.Structure):
            _fields_=[("cbSize",ctypes.c_uint),("style",ctypes.c_uint),("lpfnWndProc",WP),
                      ("cbClsExtra",ctypes.c_int),("cbWndExtra",ctypes.c_int),("hInstance",wt.HINSTANCE),
                      ("hIcon",wt.HICON),("hCursor",wt.HANDLE),("hbrBackground",wt.HBRUSH),
                      ("lpszMenuName",wt.LPCWSTR),("lpszClassName",wt.LPCWSTR),("hIconSm",wt.HICON)]
        wc=WC(); wc.cbSize=ctypes.sizeof(WC); wc.lpfnWndProc=self._wcp
        wc.hInstance=kernel32.GetModuleHandleW(None); wc.lpszClassName="YodaMouseV2"
        user32.RegisterClassExW(ctypes.byref(wc))
        ex=WS_EX_LAYERED|WS_EX_TRANSPARENT|WS_EX_TOPMOST|WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE
        self.hwnd=user32.CreateWindowExW(ex,"YodaMouseV2","",WS_POPUP,0,0,CW,CH,
                                         None,None,kernel32.GetModuleHandleW(None),None)

    def _draw(self):
        if not self.hwnd: return
        hb,pb=make_bmp(self.pulse,self.state)
        if not hb: return
        hs=user32.GetDC(None); hm=gdi32.CreateCompatibleDC(hs)
        old=gdi32.SelectObject(hm,hb)
        bf=BLEND(AC_SRC_OVER,0,255,AC_SRC_ALPHA)
        ps=PT(0,0); pd=PT(self.x,self.y); sz=SZ(CW,CH)
        user32.UpdateLayeredWindow(self.hwnd,hs,ctypes.byref(pd),ctypes.byref(sz),
                                   hm,ctypes.byref(ps),0,ctypes.byref(bf),ULW_ALPHA)
        gdi32.SelectObject(hm,old); gdi32.DeleteDC(hm)
        gdi32.DeleteObject(hb); user32.ReleaseDC(None,hs)

    def move(self,x,y):
        self.x=int(x); self.y=int(y)
        if self.visible: self._draw()

    def show(self):
        if self.hwnd:
            user32.ShowWindow(self.hwnd,SW_SHOW)
            self.visible=True; self._draw()

    def hide(self):
        if self.hwnd:
            user32.ShowWindow(self.hwnd,SW_HIDE)
            self.visible=False

    def pulse_loop(self):
        while self._run:
            if self.visible:
                self.pulse=max(0.0,min(1.0,self.pulse+0.05*self.pd))
                if self.pulse>=1.0: self.pd=-1
                elif self.pulse<=0.0: self.pd=1
                self._draw()
            time.sleep(1/30)

    def pump(self):
        msg=wt.MSG()
        while self._run:
            while user32.PeekMessageW(ctypes.byref(msg),None,0,0,1):
                user32.TranslateMessage(ctypes.byref(msg))
                user32.DispatchMessageW(ctypes.byref(msg))
            time.sleep(0.012)


ov=Overlay()

# ── Save/restore user cursor position ────────────────────────────────────
_user_pos   = None   # saved position before Yoda takes over
_yoda_active = False  # True while Yoda is controlling the mouse

def save_user_pos():
    global _user_pos
    _user_pos = pyautogui.position()

def restore_user_pos():
    global _yoda_active
    _yoda_active = False
    if _user_pos is not None:
        # Move back smoothly to where user's cursor was
        pyautogui.moveTo(_user_pos[0], _user_pos[1], duration=0.25, _pause=False)
        ov.hide()

def begin_control():
    """Call before any mouse action"""
    global _yoda_active
    if not _yoda_active:
        save_user_pos()
        _yoda_active = True
    ov.show()

def end_control(delay=1.2):
    """Call after action completes — restores user cursor after delay"""
    def _restore():
        time.sleep(delay)
        restore_user_pos()
    threading.Thread(target=_restore, daemon=True).start()


# ── Mouse actions ─────────────────────────────────────────────────────────
def out(d): sys.stdout.write(json.dumps(d)+"\n"); sys.stdout.flush()

def smooth(tx, ty, dur=0.45):
    sx,sy=pyautogui.position(); tx,ty=int(tx),int(ty)
    if abs(sx-tx)<2 and abs(sy-ty)<2: return
    steps=max(25,int(dur*80))
    for i in range(1,steps+1):
        t=i/steps; t2=1-(1-t)**3
        nx=int(sx+(tx-sx)*t2); ny=int(sy+(ty-sy)*t2)
        pyautogui.moveTo(nx,ny,_pause=False)
        ov.move(nx,ny)
        time.sleep(dur/steps)
    pyautogui.moveTo(tx,ty,_pause=False); ov.move(tx,ty)

def do_click(x,y,btn="left",dbl=False):
    begin_control(); ov.state="clicking"
    smooth(x,y,0.38); time.sleep(0.08)
    if dbl:
        pyautogui.doubleClick(x,y)
    else:
        pyautogui.click(x,y,button=btn)
    time.sleep(0.12); ov.state="idle"
    out({"type":"done","action":"click","x":x,"y":y,"button":btn})
    end_control(1.5)

def do_drag(x1,y1,x2,y2):
    begin_control(); ov.state="clicking"
    smooth(x1,y1,0.3); pyautogui.mouseDown(x1,y1); time.sleep(0.06)
    smooth(x2,y2,0.55); pyautogui.mouseUp(x2,y2)
    ov.state="idle"; out({"type":"done","action":"drag"})
    end_control(1.0)

def do_type(text):
    begin_control(); ov.state="typing"
    pyautogui.typewrite(str(text),interval=0.045)
    ov.state="idle"; out({"type":"done","action":"type"})
    end_control(0.8)

def do_key(key):
    pyautogui.press(key)
    out({"type":"done","action":"key","key":key})

def do_hotkey(*keys):
    pyautogui.hotkey(*keys)
    out({"type":"done","action":"hotkey","keys":list(keys)})

def do_scroll(x,y,n):
    begin_control()
    smooth(x,y,0.28); pyautogui.scroll(int(n),x=int(x),y=int(y))
    out({"type":"done","action":"scroll"})
    end_control(0.8)

def do_screenshot():
    import datetime
    p=os.path.join(os.path.expanduser("~"),"Desktop",
                   f"Yoda_{datetime.datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}.png")
    pyautogui.screenshot(p); out({"type":"done","action":"screenshot","path":p})


# ── Command dispatcher ────────────────────────────────────────────────────
def dispatch(line):
    line=line.strip()
    if not line: return
    p=line.split(None,5); cmd=p[0].upper()
    T=threading.Thread
    try:
        if   cmd=="MOVE"       and len(p)>=3:
            dur=float(p[3]) if len(p)>=4 else 0.45
            T(target=lambda:smooth(int(p[1]),int(p[2]),dur),daemon=True).start()
        elif cmd=="CLICK"      and len(p)>=3:
            btn=p[3] if len(p)>=4 else "left"
            T(target=lambda:do_click(int(p[1]),int(p[2]),btn),daemon=True).start()
        elif cmd=="RCLICK"     and len(p)>=3:
            T(target=lambda:do_click(int(p[1]),int(p[2]),"right"),daemon=True).start()
        elif cmd=="DCLICK"     and len(p)>=3:
            T(target=lambda:do_click(int(p[1]),int(p[2]),dbl=True),daemon=True).start()
        elif cmd=="DRAG"       and len(p)>=5:
            T(target=lambda:do_drag(int(p[1]),int(p[2]),int(p[3]),int(p[4])),daemon=True).start()
        elif cmd=="TYPE"       and len(p)>=2:
            text=" ".join(p[1:])
            T(target=lambda:do_type(text),daemon=True).start()
        elif cmd=="KEY"        and len(p)>=2:
            T(target=lambda:do_key(p[1]),daemon=True).start()
        elif cmd=="HOTKEY"     and len(p)>=3:
            keys=p[1:]
            T(target=lambda:do_hotkey(*keys),daemon=True).start()
        elif cmd=="SCROLL"     and len(p)>=4:
            T(target=lambda:do_scroll(p[1],p[2],p[3]),daemon=True).start()
        elif cmd=="SCREENSHOT":
            T(target=do_screenshot,daemon=True).start()
        elif cmd=="SHOW":
            begin_control(); ov.show()
        elif cmd=="HIDE":
            restore_user_pos()
        elif cmd=="STATE"      and len(p)>=2:
            s=p[1].lower(); ov.state=s
            if s in("thinking","speaking","listening","clicking"):
                begin_control()
            elif s=="idle":
                end_control(0.6)
        elif cmd=="POS":
            x,y=pyautogui.position(); out({"type":"pos","x":x,"y":y})
        elif cmd=="SIZE":
            w,h=pyautogui.size(); out({"type":"size","w":w,"h":h})
        elif cmd=="QUIT":
            restore_user_pos(); ov._run=False; sys.exit(0)
    except Exception as e:
        out({"type":"error","msg":str(e)})


def stdin_loop():
    for line in sys.stdin: dispatch(line)
    restore_user_pos(); ov._run=False


if __name__=="__main__":
    ov.init()
    threading.Thread(target=ov.pulse_loop,daemon=True).start()
    threading.Thread(target=stdin_loop,daemon=True).start()
    out({"type":"ready"})
    ov.pump()
