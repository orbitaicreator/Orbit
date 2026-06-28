<div align="center">

<img src="https://img.shields.io/badge/ORBIT-Operating%20Intelligence-00E5FF?style=for-the-badge&labelColor=010206" />

# ORBIT Operating Intelligence

**An autonomous AI desktop companion that lives inside your computer.**

*Observes. Understands. Reasons. Acts. Learns.*

[![Release](https://img.shields.io/github/v/release/orbitaicreator/Orbit?style=flat-square&color=00E5FF&labelColor=010206)](https://github.com/orbitaicreator/Orbit/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows-blue?style=flat-square&labelColor=010206)](https://github.com/orbitaicreator/Orbit/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square&labelColor=010206)](LICENSE)

</div>

---

## ⬇️ Download

**[→ Download Latest Release](https://github.com/orbitaicreator/Orbit/releases/latest)**

1. Download `Orbit-Setup-x.x.x.exe`
2. Run the installer
3. Launch Orbit from your desktop

---

## What is Orbit?

Orbit is not a chatbot. It is an **Operating Intelligence** — an AI that runs persistently on your Windows PC, quietly observing, understanding, and assisting without getting in the way.

It combines:
- A **JARVIS-style HUD** with standby, active, camera, and map modes
- A **live perception engine** that understands what apps you have open
- A **semantic memory graph** that learns your projects and habits over time
- **40 intelligent subsystems** working together as one organism

---

## Features

### 🧠 Intelligence
- Claude AI (Haiku) for natural conversation and reasoning
- Multi-step goal execution with planning and verification
- Episodic memory — remembers sessions, projects, and work history
- Goal tracking, workspace memory, proactive suggestions
- Local search across memory before hitting the network

### 👁️ Perception
- Live desktop awareness — knows what apps are open and what you're doing
- Real CPU, RAM, and disk monitoring
- Active window and workflow detection
- Visual AI — say "what's on my screen" for instant analysis
- Camera and map panels with HUD overlay

### 🤖 Automation
- Smart workspace templates — "prepare my stream", "coding mode"
- Multi-step task execution with retry and rollback
- OpenClaw integration for browser, files, email, GitHub, Hue, Slack, Spotify
- Remote phone control via Discord/WhatsApp/Telegram
- Workflow discovery — detects repeated patterns and suggests automations

### 🎨 Interface
- Three HUD modes: Standby (clock + orb), Active (telemetry corners), Camera/Map
- Ambient presence — orb breathes, reacts, changes color with time of day
- 9 energy states with distinct animations
- Night mode, themes (Green/Blue/Red/Purple/Amber/White/Custom)

### 🔒 Privacy
- Runs entirely locally on your PC
- API key stored locally, never sent anywhere except Anthropic
- All memory stored in local files
- Optional offline voice recognition (Vosk)

---

## Requirements

- Windows 10 or 11
- Node.js 18+ (for building from source)
- Python 3.9+ (for voice features)
- Anthropic API key (for AI responses)

---

## Setup from Source

```bash
git clone https://github.com/orbitaicreator/Orbit.git
cd Orbit
setup.bat
run.bat
```

---

## Voice Commands (Examples)

| Say | Orbit does |
|-----|-----------|
| `what's on my screen` | Visual AI analysis |
| `prepare my stream` | Launches OBS, checks internet + disk |
| `coding mode` | Opens VS Code, checks git status |
| `show memory` | Top memories from knowledge graph |
| `add goal finish the feature` | Adds to goal tracker |
| `navigate to Oslo` | Opens tactical map |
| `open camera` | Live camera with HUD overlay |
| `developer mode` | Full system diagnostic |
| `digital twin` | Live unified state summary |

---

## Architecture

Orbit is built on 40 interconnected subsystems:

```
Perception Engine    → Desktop awareness, active window, CPU/RAM
Memory Graph         → Weighted semantic knowledge network
Energy States        → 9 orb states (idle→dreaming→executing)
World Model          → Unified digital twin of your computer
Event Bus            → Structured events across all systems
Confidence System    → Earned autonomy (auto/suggest/ask)
Planning Engine      → Multi-step reasoning before execution
Digital Twin         → Live snapshot of everything Orbit knows
Executive Planner    → Task lifecycle with self-evaluation
Episodic Memory      → Session history and work patterns
Goal Tracker         → Active goals influencing AI responses
Proactive Engine     → Battery, git, schedule suggestions
```

---

## Built by

**Kristian Relbe-Moe** — Holmestrand, Norway

---

<div align="center">

*"The goal is not to answer questions faster.*
*The goal is to eliminate unnecessary work."*

</div>
