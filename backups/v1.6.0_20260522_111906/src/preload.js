'use strict'
const { contextBridge, ipcRenderer } = require('electron')

// ── Yoda bridge ───────────────────────────────────────
contextBridge.exposeInMainWorld('yoda', {
  loadKey:    ()       => ipcRenderer.invoke('load-key'),
  saveKey:    k        => ipcRenderer.invoke('save-key', k),
  loadConfig: ()       => ipcRenderer.invoke('load-config'),
  saveConfig: data     => ipcRenderer.invoke('save-config', data),
  loadMemory: ()       => ipcRenderer.invoke('load-memory'),
  saveMemory: data     => ipcRenderer.invoke('save-memory', data),
  loadNotes:  ()       => ipcRenderer.invoke('load-notes'),
  saveNotes:  text     => ipcRenderer.invoke('save-notes', text),
  logCrash:   msg      => ipcRenderer.invoke('log-crash', msg),
  show:       ()       => ipcRenderer.invoke('show-window'),
  hide:       ()       => ipcRenderer.invoke('hide-window'),
  minimize:   ()       => ipcRenderer.invoke('minimize'),
  quit:       ()       => ipcRenderer.invoke('quit'),
  system:     cmd      => ipcRenderer.invoke('system', cmd),
  speak:      (t,v)    => ipcRenderer.invoke('speak', t, v),
  startMic:   (w,l)    => ipcRenderer.invoke('start-mic', w, l),
  stopMic:    ()       => ipcRenderer.invoke('stop-mic'),
  on: (event, cb) => {
    const fn = (_, ...args) => cb(...args)
    ipcRenderer.on(event, fn)
    return () => ipcRenderer.removeListener(event, fn)
  }
})

// ── Git bridge ────────────────────────────────────────
contextBridge.exposeInMainWorld('git', {
  status:    ()          => ipcRenderer.invoke('git-status'),
  save:      msg         => ipcRenderer.invoke('git-save', msg),
  publish:   msg         => ipcRenderer.invoke('git-publish', msg),
  pull:      ()          => ipcRenderer.invoke('git-pull'),
  history:   ()          => ipcRenderer.invoke('git-history'),
  init:      url         => ipcRenderer.invoke('git-init', url),
  setRemote: (url, tok)  => ipcRenderer.invoke('git-set-remote', url, tok),
  update:    ()          => ipcRenderer.invoke('git-update'),
  onEvent:   cb          => ipcRenderer.on('git-event', (_, data) => cb(data)),
  onUpdateAvailable: cb  => ipcRenderer.on('update-available', (_, data) => cb(data)),
})

// ── Virtual Mouse bridge ──────────────────────────────
contextBridge.exposeInMainWorld('vm', {
  send:    cmd       => ipcRenderer.send('mouse-cmd', cmd),
  do:      cmd       => ipcRenderer.invoke('mouse-send', cmd),
  onClick: cb        => ipcRenderer.on('mouse-response', (_, d) => d.action==='click' && cb(d)),
  onDone:  cb        => ipcRenderer.on('mouse-response', (_, d) => cb(d)),
})

// ── Updater bridge ────────────────────────────────────
contextBridge.exposeInMainWorld('updater', {
  onUpdateAvailable:    cb => ipcRenderer.on('update-available',    (_, i) => cb(i)),
  onUpdateProgress:     cb => ipcRenderer.on('update-progress',     (_, p) => cb(p)),
  onUpdateDownloaded:   cb => ipcRenderer.on('update-downloaded',   (_, i) => cb(i)),
  onUpdateError:        cb => ipcRenderer.on('update-error',        (_, i) => cb(i)),
  onUpdateNotAvailable: cb => ipcRenderer.on('update-not-available',()     => cb()),
  installUpdate:        ()  => ipcRenderer.send('install-update'),
  checkForUpdates:      ()  => ipcRenderer.send('check-for-updates'),
})
