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
  path.join(HOME, 'orbit_api_key.txt'),
  path.join(HOME, 'jarvis_api_key.txt'),
]
const CONFIG_FILE = path.join(HOME, 'orbit_config.json')
const MEMORY_FILE = path.join(HOME, 'orbit_memory.json')
const NOTES_FILE  = path.join(HOME, 'orbit_notes.txt')
const CRASH_FILE  = path.join(HOME, 'orbit_crash.log')

const readFile  = (p, fb='')  => { try { return fs.existsSync(p) ? fs.readFileSync(p,'utf8') : fb } catch { return fb } }
const writeFile = (p, d)      => { try { fs.writeFileSync(p, d, 'utf8'); return true } catch { return false } }
const readJSON  = (p, fb={})  => { try { const t = readFile(p); return t ? JSON.parse(t) : fb } catch { return fb } }
const writeJSON = (p, d)      => writeFile(p, JSON.stringify(d, null, 2))
// FIX: quote-escaping broke on apostrophes/nested quotes and threw
// "TerminatorExpectedAtEndOfString". -EncodedCommand (base64 UTF-16LE)
// makes any command string safe — no escaping needed at all.
const _stripCLIXML = s => String(s || '').replace(/#<\s*CLIXML[\s\S]*?<\/Objs>/g, '').trim()
const ps        = cmd => new Promise(resolve => {
  // $ProgressPreference silences the "Preparing modules for first use" progress
  // records that PowerShell serializes as CLIXML garbage into the output.
  const enc = Buffer.from("$ProgressPreference='SilentlyContinue';" + cmd, 'utf16le').toString('base64')
  exec(`powershell -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${enc}`,
    { windowsHide:true, timeout:8000 }, (_, out) => resolve(_stripCLIXML(out)))
})
// Synchronous variant for the perception handlers — same crash-proof encoding
const psSync = (cmd, timeout=5000) => {
  const { execSync } = require('child_process')
  const enc = Buffer.from("$ProgressPreference='SilentlyContinue';" + cmd, 'utf16le').toString('base64')
  return _stripCLIXML(execSync(`powershell -NoProfile -NonInteractive -EncodedCommand ${enc}`,
    { encoding:'utf8', timeout, windowsHide:true }))
}

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
    'C:/Users/krist/Orbit/Python packages/' + name,
    'C:/Users/krist/Orbit/' + name,
    path.join(app.getPath('userData'), name),
    path.join(process.resourcesPath || '', name),
    path.join(path.dirname(process.execPath), name),
  ]
  const found = candidates.find(p => { try { return fs.existsSync(p) } catch(e) { return false } })
  console.log('[Script] ' + name + ' -> ' + (found || 'NOT FOUND'))
  return found || null
}

function startPythonMic(wakeWord = 'orbit', lang = 'en-US') {
  // Kill existing process first
  if (micProcess) {
    try { micProcess.kill() } catch {}
    micProcess = null
  }

  const script = findPythonScript('orbit_mic.py')
  if (!script) { console.log('[Mic] orbit_mic.py not found'); return }

  const pythons = ['python', 'py', 'python3']
  let tried = 0

  function tryNext() {
    if (tried >= pythons.length) { console.log('[Mic] No Python found'); return }
    const py = pythons[tried++]

    // Build full command string so spaces in paths are handled correctly
    const scriptDir = path.dirname(script)
    const cmd = py + ' "' + script + '" ' + wakeWord + ' ' + lang + ' "' + scriptDir + '"'
    const proc = cp.spawn(cmd, [], {
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
      // FIX: with shell:true a missing interpreter never fires ENOENT —
      // Windows exits with 9009 ("not recognized"), Unix with 127.
      // Try the next Python instead of restart-looping the same one forever.
      if (code === 9009 || code === 127) { tryNext(); return }
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


// ── Orbit Virtual Mouse ────────────────────────────────────────────────
let mouseProcess = null
let mouseReady   = false

function startVirtualMouse() {
  const script = findPythonScript('orbit_mouse.py')
  if (!script) { console.log('[Mouse] orbit_mouse.py not found'); return }

  const pythons = ['python', 'py', 'python3']
  let tried = 0

  function tryNext() {
    if (tried >= pythons.length) { console.log('[Mouse] No Python found'); return }
    const py = pythons[tried++]
    const mouseCmd = py + ' "' + script + '"'
    const proc = cp.spawn(mouseCmd, [], { windowsHide: true, shell: true })
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
      // FIX: same shell:true issue — try next Python if interpreter missing
      if (code === 9009 || code === 127) tryNext()
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

// FIX: sendCursor() never existed — this would throw a ReferenceError
// in the main process. Cursor commands now route to the virtual mouse.
ipcMain.on('cursor-cmd', (_, cmd) => sendMouse(cmd))

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
      setTimeout(() => startPythonMic('orbit', 'en-US'), 3000)  // Give renderer time to register IPC listeners
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
    https.get('https://raw.githubusercontent.com/orbitaicreator/orbit/main/package.json',
      { headers: { 'User-Agent': 'OrbitApp' } }, res => {
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
    { label:'Orbit', submenu:[
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
      { label:'View Releases', click:()=>shell.openExternal('https://github.com/orbitaicreator/orbit/releases') }
    ]}
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createTray() {
  try {
    tray = new Tray(makeTrayIcon())
    tray.setToolTip('Orbit')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label:'Open Orbit', click: showWin },
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
  startPythonMic(wakeWord || 'orbit', lang || 'en-US')
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

// ── AI API handler (bypasses CORS) ──────────────────────────────────────
// FIX: loadApiKey() was never defined — every ai-chat call threw
// "loadApiKey is not defined" and Orbit silently fell back to canned replies.
function loadApiKey() {
  for (const f of KEY_FILES) {
    const k = readFile(f).trim()
    if (k) return k
  }
  return null
}

ipcMain.handle('ai-chat', async (_, { messages, system, max_tokens }) => {
  try {
    const apiKey = loadApiKey()
    if (!apiKey) return { error: 'no_key' }

    const https = require('https')
    // FIX: renderer sends max_tokens (perf modes) but it was hardcoded to 200
    const tokens = Math.max(50, Math.min(1024, parseInt(max_tokens) || 300))
    const body  = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: tokens,
      system: system || '',
      messages: messages || []
    })

    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length':    Buffer.byteLength(body)
        }
      }, res => {
        let data = ''
        res.on('data', c => data += c)
        res.on('end', () => {
          try {
            const p = JSON.parse(data)
            if (p.content && p.content[0]) resolve({ text: p.content[0].text })
            else resolve({ error: p.error?.message || 'no content' })
          } catch(e) { resolve({ error: e.message }) }
        })
      })
      req.on('error', e => resolve({ error: e.message }))
      req.setTimeout(10000, () => { req.destroy(); resolve({ error: 'timeout' }) })
      req.write(body)
      req.end()
    })
  } catch(e) {
    return { error: e.message }
  }
})


// ── OpenClaw IPC ─────────────────────────────────────────────────────────
// OpenClaw gateway runs on ws://127.0.0.1:18789
// We communicate via openclaw CLI or HTTP REST API

ipcMain.handle('openclaw-request', async (_, { endpoint, body }) => {
  try {
    const http = require('http')
    const url  = new URL(endpoint.replace('ws://', 'http://').replace('wss://', 'https://'))

    const data = body ? JSON.stringify(body) : null

    return new Promise((resolve) => {
      const opts = {
        hostname: url.hostname,
        port:     url.port || 18790,
        path:     url.pathname + url.search,
        method:   data ? 'POST' : 'GET',
        headers: {
          'Content-Type':  'application/json',
          'Accept':        'application/json',
          'User-Agent':    'Orbit/1.0',
          ...(data ? {'Content-Length': Buffer.byteLength(data)} : {})
        }
      }

      const req = http.request(opts, res => {
        let raw = ''
        res.on('data', c => raw += c)
        res.on('end', () => {
          try {
            resolve({ ok: res.statusCode < 400, status: res.statusCode, data: JSON.parse(raw) })
          } catch(e) {
            resolve({ ok: res.statusCode < 400, status: res.statusCode, data: raw })
          }
        })
      })

      req.on('error', e => resolve({ ok: false, error: e.message }))
      req.setTimeout(15000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }) })
      if (data) req.write(data)
      req.end()
    })
  } catch(e) {
    return { ok: false, error: e.message }
  }
})

// Run openclaw CLI command directly — most reliable way to interact
ipcMain.handle('openclaw-cli', async (_, command) => {
  try {
    const result = await ps(command)
    return { ok: true, data: result }
  } catch(e) {
    return { ok: false, error: e.message }
  }
})


// ══ PERCEPTION ENGINE — Desktop awareness IPC handlers ════════════════════

// Active window + foreground process
ipcMain.handle('perception-active-window', async () => {
  try {
    // FIX: quote-escaping crashed with TerminatorExpectedAtEndOfString — EncodedCommand is immune
    const result = psSync(`$w = Get-Process | Where-Object {$_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne ''} | Sort-Object CPU -Descending | Select-Object -First 1; [PSCustomObject]@{Name=$w.ProcessName;Title=$w.MainWindowTitle;CPU=[math]::Round($w.CPU,1);Id=$w.Id} | ConvertTo-Json`, 3000)
    return { ok: true, data: JSON.parse(result) }
  } catch(e) { return { ok: false, error: e.message } }
})

// Full process list with window titles
ipcMain.handle('perception-processes', async () => {
  try {
    // FIX: quote-escaping crashed with TerminatorExpectedAtEndOfString — EncodedCommand is immune
    const result = psSync(`Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object ProcessName,MainWindowTitle,@{N='CPU';E={[math]::Round($_.CPU,1)}} | ConvertTo-Json -Compress`, 5000)
    return { ok: true, data: JSON.parse(result) }
  } catch(e) { return { ok: false, error: e.message } }
})

// System performance snapshot
ipcMain.handle('perception-system', async () => {
  try {
    // FIX: quote-escaping crashed with TerminatorExpectedAtEndOfString — EncodedCommand is immune
    const result = psSync(`$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average; $ram = Get-CimInstance Win32_OperatingSystem; $disk = Get-PSDrive C; [PSCustomObject]@{CPU=[math]::Round($cpu,0);RAMUsed=[math]::Round(($ram.TotalVisibleMemorySize-$ram.FreePhysicalMemory)/1MB,1);RAMTotal=[math]::Round($ram.TotalVisibleMemorySize/1MB,1);DiskFree=[math]::Round($disk.Free/1GB,1);DiskTotal=[math]::Round(($disk.Free+$disk.Used)/1GB,1)} | ConvertTo-Json`, 5000)
    return { ok: true, data: JSON.parse(result) }
  } catch(e) { return { ok: false, error: e.message } }
})

// Screenshot for visual AI analysis
ipcMain.handle('perception-screenshot', async () => {
  try {
    const { screen, desktopCapturer } = require('electron')
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 }
    })
    if (!sources.length) return { ok: false, error: 'no screen source' }
    const img = sources[0].thumbnail.toDataURL()
    return { ok: true, data: img }
  } catch(e) { return { ok: false, error: e.message } }
})

// Clipboard content
ipcMain.handle('perception-clipboard', async () => {
  try {
    const { clipboard } = require('electron')
    return { ok: true, data: { text: clipboard.readText(), hasImage: !clipboard.readImage().isEmpty() } }
  } catch(e) { return { ok: false, error: e.message } }
})

// Browser tabs via PowerShell window titles
ipcMain.handle('perception-browser-tabs', async () => {
  try {
    // FIX: quote-escaping crashed with TerminatorExpectedAtEndOfString — EncodedCommand is immune
    const result = psSync(`Get-Process | Where-Object {$_.ProcessName -match 'chrome|firefox|edge|zen|brave' -and $_.MainWindowTitle -ne ''} | Select-Object -ExpandProperty MainWindowTitle | ConvertTo-Json -Compress`, 3000)
    const tabs = JSON.parse(result)
    return { ok: true, data: Array.isArray(tabs) ? tabs : [tabs] }
  } catch(e) { return { ok: false, error: e.message } }
})

// ══ END PERCEPTION ENGINE ══════════════════════════════════════════════════
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
      case 'type-text': {
        // Types into whatever app is focused — used by compound commands
        // like "open notepad and write hello". SendKeys special chars escaped.
        const txt = String(cmd.value || '').slice(0, 500)
          .replace(/([+^%~(){}\[\]])/g, '{$1}')
        await ps(`Start-Sleep -Milliseconds 250; (New-Object -ComObject WScript.Shell).SendKeys('${txt.replace(/'/g, "''")}')`)
        return `Typed: ${String(cmd.value || '').slice(0, 60)}`
      }
      case 'key-hold': case 'key-release': {
        // Real key press/release (SendKeys can't HOLD a key). Uses Win32 keybd_event.
        const VK = { w:0x57,a:0x41,s:0x53,d:0x44,space:0x20,shift:0x10,ctrl:0x11,
          e:0x45,q:0x51,r:0x52,f:0x46,tab:0x09,enter:0x0D,up:0x26,down:0x28,left:0x25,right:0x27,
          '1':0x31,'2':0x32,'3':0x33,'4':0x34,'5':0x35 }
        const vk = VK[String(cmd.value||'').toLowerCase()]
        if (!vk) return 'Unknown key.'
        const flag = cmd.action === 'key-release' ? 0x0002 : 0x0000
        await ps(`Add-Type @"
using System;using System.Runtime.InteropServices;
public class K{[DllImport("user32.dll")]public static extern void keybd_event(byte b,byte s,uint f,int e);}
"@
[K]::keybd_event(${vk},0,${flag},0)`)
        return (cmd.action==='key-hold'?'Holding ':'Released ') + cmd.value
      }
      case 'click-at': {
        // Left-click at the current cursor position (auto-clicker). No move.
        await ps(`Add-Type @"
using System;using System.Runtime.InteropServices;
public class M{[DllImport(""user32.dll"")]public static extern void mouse_event(uint f,uint x,uint y,uint d,int e);}
"@
[M]::mouse_event(0x02,0,0,0,0);[M]::mouse_event(0x04,0,0,0,0)`)
        return 'clicked'
      }
      case 'press-key': {
        const keys = { enter:'{ENTER}', tab:'{TAB}', escape:'{ESC}', space:' ',
                       backspace:'{BACKSPACE}', delete:'{DELETE}',
                       up:'{UP}', down:'{DOWN}', left:'{LEFT}', right:'{RIGHT}' }
        const k = keys[String(cmd.value || '').toLowerCase()]
        if (!k) return 'Unknown key.'
        await ps(`Start-Sleep -Milliseconds 150; (New-Object -ComObject WScript.Shell).SendKeys('${k}')`)
        return `Pressed ${cmd.value}.`
      }
      case 'run-ps':   return await ps(cmd.value || 'echo ok')
      case 'check-internet':
        return await ps('Test-Connection -ComputerName 8.8.8.8 -Count 1 -Quiet')
          .then(r => r.toLowerCase().includes('true') ? 'true' : 'false').catch(() => 'false')
      case 'get-weather':
        return await new Promise(resolve => {
          https.get('https://wttr.in/?format=%t+%C', { headers:{ 'User-Agent':'OrbitApp' } },
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
      case 'focus-app': {
        const fr = await focusApp(cmd.value || '')
        return fr.startsWith('FOCUSED:') ? `${cmd.value} is on top now.` : `${cmd.value} isn't running.`
      }
      case 'close-app': {
        const cn = cleanAppName(cmd.value || '')
        const ch = (APP_EXES[cn] || cn).replace(/'/g, "''")
        const r = await ps(`$c=0; Get-Process -ErrorAction SilentlyContinue | Where-Object { ($_.ProcessName -like '*${ch}*' -or $_.MainWindowTitle -like '*${cn.replace(/'/g, "''")}*') -and $_.MainWindowHandle -ne 0 } | ForEach-Object { if ($_.CloseMainWindow()) { $c++ } }; Write-Output $c`)
        const n = parseInt(r) || 0
        return n > 0 ? `Closed ${cmd.value}.` : `${cmd.value} isn't running (or has no window to close).`
      }
      case 'force-close-app': {
        const kn = cleanAppName(cmd.value || '')
        const kh = (APP_EXES[kn] || kn).replace(/'/g, "''")
        await ps(`Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like '*${kh}*' } | Stop-Process -Force`)
        return `Force-closed ${cmd.value}.`
      }
      case 'open-app': {
        const appValRaw = (cmd.value || '').trim()
        // Already running? Bring it over everything else instead of relaunching.
        const focused = await focusApp(appValRaw)
        if (focused.startsWith('FOCUSED:')) return `${appValRaw} is already open — bringing it to the front.`
        const cleaned = cleanAppName(appValRaw)
        const appVal  = APP_EXES[cleaned] || appValRaw
        const name    = cleanAppName(appVal) || cleaned
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
          if (result.startsWith('OK:')) return `Opening ${appValRaw}.`
          // FIX: the old fallback shell-executed the raw display name, which
          // popped Windows "cannot find 'brave browser'" error dialogs. Retry
          // the search with the cleaned name instead, then give up politely.
          if (cleaned && cleaned !== appVal.toLowerCase()) {
            const retry = await ps(nameSearch.replace(`$n='${safeName}'`, `$n='${cleaned.replace(/'/g, "''")}'`))
            if (retry.startsWith('OK:')) return `Opening ${appValRaw}.`
          }
          return `Couldn't find "${appValRaw}" — is it installed?`
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

// ── App-name intelligence ────────────────────────────────────────────────
// "open brave browser" used to shell-execute the literal string "brave browser"
// and Windows popped an error dialog. Now we clean the name, map aliases,
// focus the app if it's already running, and only then search & launch.
const APP_EXES = {
  'brave':'brave', 'chrome':'chrome', 'google chrome':'chrome', 'edge':'msedge',
  'microsoft edge':'msedge', 'firefox':'firefox', 'opera':'opera', 'opera gx':'opera',
  'discord':'Discord', 'spotify':'Spotify', 'steam':'steam',
  'obs':'obs64', 'obs studio':'obs64', 'code':'Code', 'vscode':'Code',
  'visual studio code':'Code', 'epic games':'EpicGamesLauncher',
  'epic games launcher':'EpicGamesLauncher', 'word':'WINWORD', 'excel':'EXCEL',
  'powerpoint':'POWERPNT', 'outlook':'OUTLOOK', 'whatsapp':'WhatsApp',
  'telegram':'Telegram', 'minecraft':'Minecraft', 'minecraft launcher':'Minecraft',
  'fortnite':'FortniteClient-Win64-Shipping', 'roblox':'RobloxPlayerBeta',
}
const cleanAppName = v => String(v || '').toLowerCase().replace(/\.exe$/,'')
  .replace(/\b(the|app|application|program|browser|please)\b/g, ' ')
  .replace(/\s+/g, ' ').trim()

// Bring a running app's window to the foreground (restores if minimized)
async function focusApp(rawName) {
  const clean = cleanAppName(rawName)
  const hint  = APP_EXES[clean] || clean
  const cands = [...new Set([hint, clean, String(rawName).trim()])].filter(Boolean)
  const list  = cands.map(c => `'${c.replace(/'/g, "''")}'`).join(',')
  const script = `
Add-Type @"
using System;using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int n);
}
"@
foreach($n in @(${list})){
  $p = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    ($_.ProcessName -like "*$n*" -or $_.MainWindowTitle -like "*$n*") -and $_.MainWindowHandle -ne 0
  } | Select-Object -First 1
  if ($p) {
    [W]::ShowWindowAsync($p.MainWindowHandle, 9) | Out-Null
    [W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
    Write-Output "FOCUSED:$($p.ProcessName)"
    exit
  }
}
Write-Output "NOTRUNNING"`
  return await ps(script)
}

// ── Buddy overlay mode: small always-on-top companion window ────────────
let _savedBounds = null
ipcMain.handle('set-overlay', (_, on) => {
  if (!win) return false
  try {
    if (on) {
      _savedBounds = win.getBounds()
      const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
      win.setMinimumSize(280, 340)
      win.setBounds({ width: 330, height: 460, x: sw - 346, y: sh - 476 })
      win.setAlwaysOnTop(true, 'screen-saver')
    } else {
      win.setAlwaysOnTop(false)
      win.setMinimumSize(700, 600)
      if (_savedBounds) win.setBounds(_savedBounds)
    }
    return true
  } catch (e) { return false }
})

ipcMain.handle('speak', (_, text, voice, rate, pitch) => {
  return new Promise(resolve => {
    const script = findPythonScript('orbit_tts.py')
    if (!script) { resolve('error:missing'); return }
    const clean = text.replace(/"/g, "'").replace(/\n/g, ' ').slice(0, 500)
    const v     = voice || 'en-US-AndrewNeural'
    const rt    = /^[+-]\d{1,2}%$/.test(rate||'')  ? rate  : '+0%'
    const pt    = /^[+-]\d{1,2}Hz$/.test(pitch||'') ? pitch : '+0Hz'
    const pys   = ['python', 'py', 'python3']
    let t = 0
    const next = () => {
      if (t >= pys.length) { resolve('error:no_python'); return }
      const py = pys[t++]
      // notify the renderer the moment playback actually begins (PLAYING marker)
      const { spawn } = require('child_process')
      try {
        const proc = spawn(py, [script, clean, v, rt, pt], { windowsHide:true, shell:false })
        let notified = false
        const watch = d => {
          if (!notified && String(d).includes('PLAYING')) {
            notified = true
            try { if (win) win.webContents.send('tts-playing') } catch(e){}
          }
        }
        proc.stdout.on('data', watch); proc.stderr.on('data', watch)
        const killT = setTimeout(() => { try { proc.kill() } catch(e){}; resolve('error:timeout') }, 30000)
        proc.on('close', code => { clearTimeout(killT); resolve(code === 0 ? 'ok' : 'error:' + code) })
        proc.on('error', () => { clearTimeout(killT); next() })
        return
      } catch(e) { next(); return }
      exec(`${py} "${script}" "${clean}" "${v}" "${rt}" "${pt}"`,
        { windowsHide:true, timeout:30000, shell:true },
        err => {
          // FIX: Windows says "is not recognized" (code 9009), not "not found"
          if (err && (err.code==='ENOENT' || err.code===9009 || err.message.includes('not found') || err.message.includes('not recognized'))) { next(); return }
          resolve(err ? 'error:'+err.message : 'ok')
        })
    }
    next()
  })
})
