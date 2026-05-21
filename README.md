# Yoda — AI Desktop Assistant

A personal AI assistant for Windows with voice control, virtual mouse, and system automation.

## Download & Install

1. Go to [Releases](https://github.com/yodaaicreator/yoda/releases/latest)
2. Download **Yoda Setup x.x.x.exe**
3. Double-click to install
4. Launch **Yoda** from your desktop

> **Requires Python 3.x** — the installer will prompt you if it's not installed.

## Features

- 🎤 **Voice control** — say "Yoda" then your command
- 🖱️ **Virtual mouse** — Yoda can open apps and click things
- 🤖 **Independent AI** — built-in knowledge, no API needed
- 📝 **Notes & To-do** — manage tasks by voice
- 🌐 **Web search** — "search for..." opens browser
- ⚙️ **System control** — volume, screenshots, lock, sleep
- 🎵 **Media control** — play, pause, next track
- ⏱️ **Timers & alarms** — "set a timer for 5 minutes"
- 💾 **GitHub integration** — save and publish your projects

## Voice Commands

Say **"Yoda"** to wake, then:

| Command | Action |
|---------|--------|
| open Spotify | Opens Spotify |
| take a screenshot | Saves to Desktop |
| volume up / down | Adjusts volume |
| what time is it | Tells the time |
| weather | Current weather |
| set a timer for 10 minutes | Timer |
| take a note: ... | Saves a note |
| search for ... | Opens browser |
| lock the PC | Locks screen |
| tell me a joke | Joke |

## Requirements

- Windows 10/11 (64-bit)
- Python 3.8+ (for voice features)

## For Developers

```bash
git clone https://github.com/yodaaicreator/yoda.git
cd yoda
npm install
npm start
```

Build installer:
```bash
build.bat
```
