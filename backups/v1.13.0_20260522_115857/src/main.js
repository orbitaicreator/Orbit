'use strict'

// ── Git Manager ───────────────────────────────────────
const GitManager = require('./git_manager')
let gitManager = null

// ── Auto-updater ──────────────────────────────────────
let autoUpdater = null
try {
  const { autoUpdater: au } = require('electron-updater')
  const log = require('electron-log')
  au.logger = log
  au.logger.transports.file.level = 'info'
  au.autoDownload = true
  au.autoInstallOnAppQuit = true
  autoUpdater = au
} catch(e) { console.log('[Updater] not available') }

const { app, BrowserWindow, ipcMain, globalShortcut,
        Tray, Menu, nativeImage, screen, shell } = require('electron')
const path  = require('path')
const fs    = require('fs')
const os    = require('os')
const https = require('https')
const http  = require('http')
const cp    = require('child_process')
const { exec } = cp

// ── Flags BEFORE app is ready ─────────────────────────
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('enable-speech-dispatcher')

// ── Paths ─────────────────────────────────────────────
const HOME        = os.homedir()
const KEY_FILES   = [
  path.join(HOME, 'yoda_api_key.txt'),
  path.join(HOME, 'jarvis_api_key.txt'),
]
const CONFIG_FILE = path.join(HOME, 'yoda_config.json')
const MEMORY_FILE = path.join(HOME, 'yoda_memory.json')
const NOTES_FILE  = path.join(HOME, 'yoda_notes.txt')
const CRASH_FILE  = path.join(HOME, 'yoda_crash.log')

const readFile  = (p, fb='')  => { try { return fs.existsSync(p) ? fs.readFileSync(p,'utf8') : fb } catch { return fb } }
const writeFile = (p, d)      => { try { fs.writeFileSync(p, d, 'utf8'); return true } catch { return false } }
const readJSON  = (p, fb={})  => { try { const t = readFile(p); return t ? JSON.parse(t) : fb } catch { return fb } }
const writeJSON = (p, d)      => writeFile(p, JSON.stringify(d, null, 2))
const ps        = cmd => new Promise(resolve =>
  exec(`powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "${cmd.replace(/"/g,'\\"')}"`,
    { windowsHide:true, timeout:8000 }, (_, out) => resolve(out ? out.trim() : '')))

// ── Local HTTP server ─────────────────────────────────
// Serve from localhost so fetch() to Anthropic API works
let localPort  = 7591
let localServer = null

function startLocalServer() {
  return new Promise(resolve => {
    const handler = (req, res) => {
      let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url)
      if (!filePath.startsWith(__dirname)) { res.writeHead(403); res.end(); return }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return }
        const ext  = path.extname(filePath)
        const mime = { '.html':'text/html', '.js':'application/javascript',
                       '.css':'text/css', '.png':'image/png' }[ext] || 'text/plain'
        res.writeHead(200, {
          'Content-Type': mime,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        })
        res.end(data)
      })
    }
    localServer = http.createServer(handler)
    localServer.on('error', e => {
      if (e.code === 'EADDRINUSE') { localPort++; localServer.listen(localPort, '127.0.0.1', resolve) }
    })
    localServer.listen(localPort, '127.0.0.1', () => {
      console.log(`[Server] http://127.0.0.1:${localPort}`)
      resolve()
    })
  })
}

// ── Python Mic ────────────────────────────────────────
let micProcess  = null
let micStarted  = false  // prevent double-start from did-finish-load firing twice

function findPythonScript(name) {
  const candidates = [
    path.join(__dirname, '..', name),
    path.join(__dirname, name),
    path.join(process.cwd(), name),
    path.join(__dirname, '..', 'Python packages', name),
    path.join(process.cwd(), 'Python packages', name),
    'C:/Users/krist/Yoda/Python packages/' + name,
    'C:/Users/krist/Yoda/' + name,
    path.join(app.getPath('userData'), name),
    path.join(process.resourcesPath || '', name),
    path.join(path.dirname(process.execPath), name),
  ]
  const found = candidates.find(p => { try { return fs.existsSync(p) } catch(e) { return false } })
  console.log('[Script] ' + name + ' -> ' + (found || 'NOT FOUND'))
  return found || null
}

function startPythonMic(wakeWord = 'yoda', lang = 'en-US') {
  // Kill existing process first
  if (micProcess) {
    try { micProcess.kill() } catch {}
    micProcess = null
  }

  const script = findPythonScript('yoda_mic.py')
  if (!script) { console.log('[Mic] yoda_mic.py not found'); return }

  const pythons = ['python', 'py', 'python3']
  let tried = 0

  function tryNext() {
    if (tried >= pythons.length) { console.log('[Mic] No Python found'); return }
    const py = pythons[tried++]

    // Use shell:true but quote the script path to handle spaces
    const quotedScript = '"' + script + '"'
    const proc = cp.spawn(py, [quotedScript, wakeWord, lang, '"'+path.dirname(script)+'"'], {
      windowsHide: true,
      shell: true,
    })

    proc.on('error', e => {
      if (e.code === 'ENOENT') { tryNext(); return }
      console.log('[Mic] spawn error:', e.message)
    })

    proc.stdout.on('data', data => {
      const lines = data.toString().split('\n')
      for (const raw of lines) {
        const msg = raw.trim()
        if (!msg || !win) continue
        console.log('[Mic stdout]', msg)  // Log all mic output for debugging
        if (msg === 'WAKE')              win.webContents.send('mic-wake')
        else if (msg === 'READY') {      win.webContents.send('mic-ready'); console.log('[Mic] Ready signal sent to renderer') }
        else if (msg.startsWith('CMD:')) { win.webContents.send('mic-command', msg.slice(4).trim()); console.log('[Mic] Command sent:', msg.slice(4).trim()) }
        else if (msg.startsWith('ERROR:')) console.log('[Mic] Error:', msg)
      }
    })

    proc.stderr.on('data', d => {
      // Show all mic stderr for debugging
      const s = d.toString().trim()
      if (s) console.log('[Mic]', s)
    })

    proc.on('exit', (code, signal) => {
      console.log(`[Mic] exited code=${code} signal=${signal}`)
      micProcess = null
      // Auto-restart after 3s ONLY if not deliberately killed
      if (signal !== 'SIGTERM' && signal !== 'SIGKILL') {
        setTimeout(() => { if (win && micProcess === null) startPythonMic(wakeWord, lang) }, 3000)
      }
    })

    micProcess = proc
    console.log(`[Mic] Started with ${py}`)
  }
  tryNext()
}


// ── Yoda Virtual Mouse ────────────────────────────────────────────────
let mouseProcess = null
let mouseReady   = false

function startVirtualMouse() {
  const script = findPythonScript('yoda_mouse.py')
  if (!script) { console.log('[Mouse] yoda_mouse.py not found'); return }

  const pythons = ['python', 'py', 'python3']
  let tried = 0

  function tryNext() {
    if (tried >= pythons.length) { console.log('[Mouse] No Python found'); return }
    const py = pythons[tried++]
    const quotedMouseScript = '"' + script + '"'
    const proc = cp.spawn(py + ' ' + quotedMouseScript, [], { windowsHide: true, shell: true })
    mouseProcess = proc

    proc.on('error', e => { if (e.code === 'ENOENT') tryNext() })

    proc.stdout.on('data', data => {
      const lines = data.toString().split('\n')
      for (const line of lines) {
        const msg = line.trim()
        if (!msg) continue
        if (msg === 'READY') {
          mouseReady = true
          console.log('[Mouse] Virtual mouse ready')
        } else {
          // Forward JSON responses to renderer
          try {
            const obj = JSON.parse(msg)
            if (win) win.webContents.send('mouse-response', obj)
          } catch {}
        }
      }
    })

    proc.stderr.on('data', d => {
      const s = d.toString().trim()
      if (s && !s.startsWith('LOG')) console.log('[Mouse]', s)
    })

    proc.on('exit', (code) => {
      mouseReady = false; mouseProcess = null
      console.log('[Mouse] exited code=' + code)
    })

    mouseProcess = proc
  }
  tryNext()
}

function sendMouse(cmd) {
  if (mouseProcess && mouseReady) {
    try { mouseProcess.stdin.write(cmd + '\n') } catch {}
  }
}

// IPC: renderer sends virtual mouse commands
ipcMain.on('mouse-cmd', (_, cmd) => sendMouse(cmd))
ipcMain.handle('mouse-send', (_, cmd) => {
  sendMouse(cmd)
  return mouseReady
})

ipcMain.on('cursor-cmd', (_, cmd) => sendCursor(cmd))

// ── Window ────────────────────────────────────────────
let win  = null
let tray = null

const makeTrayIcon = () => {
  const p = path.join(__dirname, '../assets/icon.png')
  if (fs.existsSync(p)) return nativeImage.createFromPath(p).resize({ width:16, height:16 })
  try { return nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAIklEQVQ4T2NkYGD4z8BQDwAAAP8A/gYAAAAASUVORK5CYII=') }
  catch { return nativeImage.createEmpty() }
}

function createWindow() {
  const { width:sw, height:sh } = screen.getPrimaryDisplay().workAreaSize
  const cfg = readJSON(CONFIG_FILE)

  win = new BrowserWindow({
    width:  900, height: 820,
    x: cfg.win_x ?? Math.floor((sw - 900) / 2),
    y: cfg.win_y ?? Math.floor((sh - 820) / 2),
    minWidth: 700, minHeight: 600,
    frame: false, backgroundColor: '#010a01', resizable: true,
    webPreferences: {
      preload:              path.resolve(__dirname, 'preload.js'),
      contextIsolation:     true,
      nodeIntegration:      false,
      sandbox:              false,
      spellcheck:           false,
      backgroundThrottling: false,
      webSecurity:          false,  // allows fetch to api.anthropic.com
    },
  })

  // Grant all media permissions
  win.webContents.session.setPermissionRequestHandler((wc, perm, cb) => {
    cb(['media','microphone','audioCapture','mediaKeySystem'].includes(perm))
  })
  win.webContents.session.setPermissionCheckHandler((wc, perm) => {
    return ['media','microphone','audioCapture','mediaKeySystem'].includes(perm)
  })

  win.loadURL(`http://127.0.0.1:${localPort}/`)

  win.on('moved', () => {
    const [x, y] = win.getPosition()
    const c = readJSON(CONFIG_FILE); c.win_x = x; c.win_y = y; writeJSON(CONFIG_FILE, c)
  })
  win.on('close', e => { e.preventDefault(); win.hide() })

  // Start mic once after page loads — guard against double fire
  win.webContents.on('did-finish-load', () => {
    if (!micStarted) {
      micStarted = true
      setTimeout(() => startPythonMic('yoda', 'en-US'), 3000)  // Give renderer time to register IPC listeners
      setTimeout(() => startVirtualMouse(), 2000)
    }
    // Git manager
    if (!gitManager) gitManager = new GitManager(win)
    // Update check
    setTimeout(() => {
      if (autoUpdater && app.isPackaged) {
        // Auto-update check removed from did-finish-load (caused spam)
      }
      checkVersionOnGitHub()
    }, 6000)
  })
}

function checkVersionOnGitHub() {
  try {
    const cur = require('../package.json').version
    https.get('https://raw.githubusercontent.com/yodaaicreator/yoda/main/package.json',
      { headers: { 'User-Agent': 'YodaApp' } }, res => {
        let d = ''
        res.on('data', c => d += c)
        res.on('end', () => {
          try {
            const r = JSON.parse(d)
            if (r.version && r.version !== cur && win)
              win.webContents.send('update-available', { current:cur, latest:r.version })
          } catch {}
        })
      }).on('error', () => {})
  } catch {}
}

function buildAppMenu() {
  const template = [
    { label:'Yoda', submenu:[
      { label:'Settings', accelerator:'CmdOrCtrl+,', click:()=>win&&win.webContents.send('nav','settings') },
      { type:'separator' },
      { label:'Quit', accelerator:'CmdOrCtrl+Q', click:()=>app.exit(0) }
    ]},
    { label:'View', submenu:[
      { label:'Toggle Sidebar', accelerator:'CmdOrCtrl+B', click:()=>win&&win.webContents.send('nav','toggle-sidebar') },
      { label:'New Conversation', accelerator:'CmdOrCtrl+N', click:()=>win&&win.webContents.send('nav','new-conversation') },
      { type:'separator' },
      { label:'Developer Tools', accelerator:'F12', click:()=>win&&win.webContents.toggleDevTools() },
      { label:'Reload', accelerator:'CmdOrCtrl+R', click:()=>win&&win.reload() }
    ]},
    { label:'GitHub', submenu:[
      { label:'Save', accelerator:'CmdOrCtrl+S', click:()=>win&&win.webContents.send('nav','git-save') },
      { label:'Publish Release', accelerator:'CmdOrCtrl+Shift+P', click:()=>win&&win.webContents.send('nav','git-publish') },
      { label:'Pull', click:()=>win&&win.webContents.send('nav','git-pull') },
      { type:'separator' },
      { label:'View Releases', click:()=>shell.openExternal('https://github.com/yodaaicreator/yoda/releases') }
    ]}
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createTray() {
  try {
    tray = new Tray(makeTrayIcon())
    tray.setToolTip('Yoda')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label:'Open Yoda', click: showWin },
      { label:'Settings',  click: () => { showWin(); win.webContents.send('nav','settings') } },
      { type:'separator' },
      { label:'Quit',      click: () => app.exit(0) },
    ]))
    tray.on('double-click', showWin)
  } catch(e) { console.log('[Tray]', e.message) }
}

const showWin = () => { if (win) { win.show(); win.focus() } }

function registerShortcut() {
  for (const k of ['Oem1', 'OEM_1', 'VK_OEM_1']) {
    try {
      if (globalShortcut.register(k, () => {
        if (win) { win.webContents.send('oe-press'); if (!win.isVisible()) showWin() }
      })) return
    } catch {}
  }
}

function setupUpdaterEvents() {
  if (!autoUpdater) return
  autoUpdater.on('update-available',    i => { try { if(win) win.webContents.send('update-available',{latest:i.version}) } catch {} })
  autoUpdater.on('update-not-available',() => { try { if(win) win.webContents.send('update-not-available') } catch {} })
  autoUpdater.on('download-progress',   p => { try { if(win) win.webContents.send('update-progress',{percent:Math.round(p.percent)}) } catch {} })
  autoUpdater.on('update-downloaded',   i => { try { if(win) win.webContents.send('update-downloaded',{version:i.version}) } catch {} })
  autoUpdater.on('error',               e => console.log('[Updater]', e.message))
}

// ── App lifecycle ─────────────────────────────────────
app.whenReady().then(async () => {
  await startLocalServer()
  createWindow()
  createTray()
  buildAppMenu()
  registerShortcut()
  setupUpdaterEvents()
  app.on('activate', showWin)
})
app.on('window-all-closed', () => {})
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  if (localServer) localServer.close()
  if (micProcess)  { try { micProcess.kill('SIGTERM') } catch {} }
  if (mouseProcess)  { try { sendMouse('QUIT'); mouseProcess.kill('SIGTERM') } catch {} }
})


// Navigation IPC — from app menu and tray
ipcMain.on('nav', (_, action) => {
  if (win) win.webContents.send('nav', action)
})

ipcMain.on('install-update',    () => { if(autoUpdater) try{autoUpdater.quitAndInstall()}catch{} })
ipcMain.on('check-for-updates', () => { if(autoUpdater) try{autoUpdater.checkForUpdatesAndNotify()}catch{} })

// ── IPC: File system ──────────────────────────────────
ipcMain.handle('load-key',    ()    => { for(const f of KEY_FILES){const k=readFile(f).trim();if(k)return k} return null })
ipcMain.handle('save-key',    (_,k) => writeFile(KEY_FILES[0], k.trim()))
ipcMain.handle('load-config', () => {
  const cfg = readJSON(CONFIG_FILE)
  // Inject current version so renderer can show it
  try { cfg.version = require('../package.json').version } catch{}
  return cfg
})
ipcMain.handle('save-config', (_,d) => { const c=readJSON(CONFIG_FILE); Object.assign(c,d); return writeJSON(CONFIG_FILE,c) })
ipcMain.handle('load-memory', ()    => readJSON(MEMORY_FILE, {facts:[],preferences:{},commands:[]}))
ipcMain.handle('save-memory', (_,d) => writeJSON(MEMORY_FILE, d))
ipcMain.handle('load-notes',  ()    => readFile(NOTES_FILE))
ipcMain.handle('save-notes',  (_,t) => writeFile(NOTES_FILE, t))
ipcMain.handle('log-crash',   (_,m) => { try{fs.appendFileSync(CRASH_FILE,`\n[${new Date().toISOString()}] ${m}\n`)}catch{} })
ipcMain.handle('show-window', ()    => showWin())
ipcMain.handle('hide-window', ()    => win && win.hide())
ipcMain.handle('minimize',    ()    => win && win.minimize())
ipcMain.handle('quit',        ()    => app.exit(0))

// ── IPC: Mic ──────────────────────────────────────────
ipcMain.handle('start-mic', (_, wakeWord, lang) => {
  startPythonMic(wakeWord || 'yoda', lang || 'en-US')
})
ipcMain.handle('stop-mic', () => {
  if (micProcess) { try { micProcess.kill('SIGTERM') } catch {} micProcess = null }
})

// ── IPC: Git ──────────────────────────────────────────
ipcMain.handle('git-status',     ()         => gitManager ? gitManager.getStatus()        : { initialized:false })
ipcMain.handle('git-save',       (_, msg)   => gitManager ? gitManager.save(msg)          : { success:false })
ipcMain.handle('git-publish',    (_, msg)   => gitManager ? gitManager.publish(msg)       : { success:false })
ipcMain.handle('git-pull',       ()         => gitManager ? gitManager.pull()             : { success:false })
ipcMain.handle('git-history',    ()         => gitManager ? gitManager.getHistory()       : [])
ipcMain.handle('git-init',       (_, url)   => gitManager ? gitManager.init(url)          : { success:false })
ipcMain.handle('git-set-remote', (_,url,tok)=> gitManager ? gitManager.setRemote(url,tok) : { success:false })
ipcMain.handle('git-update',     ()         => gitManager ? gitManager.update()           : { success:false })

// ── IPC: System commands ──────────────────────────────
ipcMain.handle('system', async (_, cmd) => {
  try {
    switch (cmd.action) {
      case 'lock':    exec('rundll32.exe user32.dll,LockWorkStation', {windowsHide:true}); return 'Locking.'
      case 'sleep':   exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0', {windowsHide:true}); return 'Sleeping.'
      case 'volume-up':    exec('powershell -WindowStyle Hidden -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]175)"', {windowsHide:true}); return 'Volume up.'
      case 'volume-down':  exec('powershell -WindowStyle Hidden -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]174)"', {windowsHide:true}); return 'Volume down.'
      case 'mute':         exec('powershell -WindowStyle Hidden -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"', {windowsHide:true}); return 'Muted.'
      case 'media-play-pause': exec('powershell -WindowStyle Hidden -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]179)"', {windowsHide:true}); return 'Play/Pause.'
      case 'media-next':   exec('powershell -WindowStyle Hidden -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]176)"', {windowsHide:true}); return 'Next.'
      case 'media-prev':   exec('powershell -WindowStyle Hidden -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]177)"', {windowsHide:true}); return 'Previous.'
      case 'open-url': {
        const url = cmd.value || 'https://google.com'
        const zenPaths = [
          'C:\\Program Files\\Zen Browser\\zen.exe',
          process.env.LOCALAPPDATA + '\\Programs\\Zen Browser\\zen.exe',
          process.env.LOCALAPPDATA + '\\Zen Browser\\zen.exe',
        ]
        const fs = require('fs')
        let opened = false
        for (const p of zenPaths) {
          if (fs.existsSync(p)) {
            require('child_process').exec(`"${p}" "${url}"`)
            opened = true; break
          }
        }
        if (!opened) require('electron').shell.openExternal(url)
        return 'Opening.'
      }
      case 'run-ps':   return await ps(cmd.value || 'echo ok')
      case 'check-internet':
        return await ps('Test-Connection -ComputerName 8.8.8.8 -Count 1 -Quiet')
          .then(r => r.toLowerCase().includes('true') ? 'true' : 'false').catch(() => 'false')
      case 'get-weather':
        return await new Promise(resolve => {
          https.get('https://wttr.in/?format=%t+%C', { headers:{ 'User-Agent':'YodaApp' } },
            res => { let b=''; res.on('data',d=>b+=d); res.on('end',()=>resolve(b.trim())) })
          .on('error', () => resolve(''))
        })
      case 'get-stats': {
        const out = await ps('$c=(Get-WmiObject Win32_Processor|Measure-Object -Property LoadPercentage -Average).Average;$m=Get-WmiObject Win32_OperatingSystem;$r=[math]::Round(($m.TotalVisibleMemorySize-$m.FreePhysicalMemory)/$m.TotalVisibleMemorySize*100);"$c,$r"')
        const [cpu, ram] = (out || '0,0').split(',')
        return JSON.stringify({ cpu: Math.round(parseFloat(cpu)||0), ram: Math.round(parseFloat(ram)||0) })
      }
      case 'screenshot': {
        const ts  = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)
        const out = path.join(HOME, 'Desktop', `screenshot_${ts}.png`)
        await ps(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing;$s=[System.Windows.Forms.Screen]::PrimaryScreen;$b=New-Object System.Drawing.Bitmap($s.Bounds.Width,$s.Bounds.Height);$g=[System.Drawing.Graphics]::FromImage($b);$g.CopyFromScreen($s.Bounds.Location,[System.Drawing.Point]::Empty,$s.Bounds.Size);$b.Save('${out.replace(/\\/g,'\\\\')}'  );$g.Dispose();$b.Dispose()`)
        return 'Screenshot saved to Desktop.'
      }
      case 'volume-set': {
        const v = Math.max(0, Math.min(100, parseInt(cmd.value) || 50))
        await ps(`$w=New-Object -ComObject WScript.Shell;for($i=0;$i-lt50;$i++){$w.SendKeys([char]174)};for($i=0;$i-lt${Math.floor(v/2)};$i++){$w.SendKeys([char]175)}`)
        return `Volume ${v}%.`
      }
      case 'open-app': {
        const appVal = (cmd.value || '').trim()
        const name   = appVal.replace(/\.exe$/i, '').toLowerCase()
        // Built-in Windows executables — run directly
        const builtins = {
          'notepad':'notepad','calc':'calc','calculator':'calc',
          'mspaint':'mspaint','paint':'mspaint','taskmgr':'taskmgr',
          'task manager':'taskmgr','explorer':'explorer','file explorer':'explorer',
          'cmd':'cmd','powershell':'powershell','terminal':'wt','control':'control',
          'snippingtool':'snippingtool','snipping tool':'snippingtool',
          'settings':'start ms-settings:','wordpad':'wordpad',
        }
        // Direct builtins — run immediately
        if (builtins[name]) {
          exec(builtins[name], { shell:true, windowsHide:false })
          return `Opening ${appVal}.`
        }
        // If it's not an .exe path — it's a display name like "Minecraft Launcher"
        // Search Start Menu by display name (much more reliable than exe paths)
        if (!appVal.endsWith('.exe') && !appVal.endsWith('.msc') && !appVal.startsWith('ms-')) {
          const safeName = appVal.replace(/'/g, "''")
          const nameSearch = `
$n='${safeName}';$found=$null
$dirs=@("$env:APPDATA\Microsoft\Windows\Start Menu\Programs","$env:ProgramData\Microsoft\Windows\Start Menu\Programs","$env:USERPROFILE\Desktop","$env:PUBLIC\Desktop")
foreach($d in $dirs){
  if(Test-Path $d){
    $r=Get-ChildItem -Path $d -Recurse -Include *.lnk -EA SilentlyContinue|?{$_.BaseName -like "*$n*"}|Select -First 1
    if($r){$found=$r.FullName;break}
  }
}
if($found){Start-Process $found;Write-Output "OK:$found"}
else{
  $steam=@("C:\Program Files (x86)\Steam\steamapps\common","D:\Steam\steamapps\common","E:\Steam\steamapps\common")
  foreach($d in $steam){
    if(Test-Path $d){
      $r=Get-ChildItem $d -Directory|?{$_.Name -like "*$n*"}|Select -First 1
      if($r){$e=Get-ChildItem $r.FullName -Filter *.exe -EA SilentlyContinue|?{$_.BaseName -notlike "*uninstall*"-and $_.BaseName -notlike "*crash*"}|Select -First 1;if($e){Start-Process $e.FullName;Write-Output "OK:$($e.FullName)";break}}
    }
  }
  Write-Output "NOTFOUND"
}`.trim()
          const result = await ps(nameSearch)
          if (result.startsWith('OK:')) return `Opening ${appVal}.`
          // Last resort — try shell execute with the display name
          exec(`start "" "${appVal}"`, {shell:true}, ()=>{})
          return `Searching for ${appVal}...`
        }
        // Search Start Menu, Desktop, Steam, AppData
        const safe = name.replace(/'/g, "''")
        const psSearch = `
$n='${safe}';$r=@()
$dirs=@("$env:APPDATA\\Microsoft\\Windows\\Start Menu","$env:ProgramData\\Microsoft\\Windows\\Start Menu","$env:USERPROFILE\\Desktop","$env:PUBLIC\\Desktop")
foreach($d in $dirs){if(Test-Path $d){Get-ChildItem -Path $d -Recurse -Include *.lnk -EA SilentlyContinue|?{$_.BaseName -like "*$n*"}|%{$r+=$_.FullName}}}
$steam=@("C:\\Program Files (x86)\\Steam\\steamapps\\common","D:\\Steam\\steamapps\\common","E:\\Steam\\steamapps\\common")
foreach($d in $steam){if(Test-Path $d){Get-ChildItem $d -Directory|?{$_.Name -like "*$n*"}|%{$e=Get-ChildItem $_.FullName -Filter *.exe -EA SilentlyContinue|?{$_.BaseName -notlike "*uninstall*" -and $_.BaseName -notlike "*crash*"}|Select -First 1;if($e){$r+=$e.FullName}}}}
$inst=@("$env:LOCALAPPDATA","$env:ProgramFiles"," + '%ProgramFiles(x86)%' + ")
foreach($d in $inst){if(Test-Path $d){Get-ChildItem $d -Recurse -Depth 3 -Include *.exe -EA SilentlyContinue|?{$_.BaseName -like "*$n*" -and $_.BaseName -notlike "*uninstall*" -and $_.BaseName -notlike "*setup*"}|%{$r+=$_.FullName}}}
if($r.Count -gt 0){Start-Process $r[0];Write-Output "FOUND:$($r[0])"}else{Start-Process $n -EA SilentlyContinue;Write-Output "NOTFOUND"}`
        const result = await ps(psSearch)
        return result.startsWith('FOUND:') ? `Opening ${appVal}.` : `Could not find ${appVal}.`
      }
      default: return `Unknown command: ${cmd.action}`
    }
  } catch(e) { return `Error: ${e.message}` }
})

// ── IPC: TTS ──────────────────────────────────────────
ipcMain.handle('speak', (_, text, voice) => {
  return new Promise(resolve => {
    const script = findPythonScript('yoda_tts.py')
    if (!script) { resolve('error:missing'); return }
    const clean = text.replace(/"/g, "'").replace(/\n/g, ' ').slice(0, 500)
    const v     = voice || 'en-GB-RyanNeural'
    const pys   = ['python', 'py', 'python3']
    let t = 0
    const next = () => {
      if (t >= pys.length) { resolve('error:no_python'); return }
      const py = pys[t++]
      exec(`${py} "${script}" "${clean}" "${v}"`,
        { windowsHide:true, timeout:30000, shell:true },
        err => {
          if (err && (err.code==='ENOENT' || err.message.includes('not found'))) { next(); return }
          resolve(err ? 'error:'+err.message : 'ok')
        })
    }
    next()
  })
})
