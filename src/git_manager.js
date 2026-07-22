'use strict'
const { exec }  = require('child_process')
const https     = require('https')
const path      = require('path')
const fs        = require('fs')
const os        = require('os')

class GitManager {
  constructor(mainWindow) {
    this.mainWindow = mainWindow
    // Repo root = wherever package.json lives (flat layout or src/ layout)
    this.repoPath = fs.existsSync(path.join(__dirname, 'package.json'))
      ? __dirname
      : path.join(__dirname, '..')
  }

  // Always reload config fresh
  get cfg() {
    try { return JSON.parse(fs.readFileSync(path.join(os.homedir(),'orbit_config.json'),'utf8')) }
    catch { return {} }
  }

  get token() { return (this.cfg.git_token || process.env.GH_TOKEN || '').trim() }
  get owner()  { return (this.cfg.git_owner || 'orbitaicreator').trim() }
  get repo()   { return (this.cfg.git_repo  || 'orbit').trim() }

  send(type, data={}) {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed())
        this.mainWindow.webContents.send('git-event', {type, ...data})
    } catch {}
  }

  run(cmd, opts={}) {
    return new Promise((res, rej) =>
      exec(cmd, {cwd:this.repoPath, timeout:60000, ...opts}, (err, out, e2) =>
        err ? rej(new Error((e2||err.message||'').replace(/ghp_\S+/g,'[token]')))
            : res(out.trim())
      )
    )
  }

  // Get authenticated remote URL — always embed token
  async getAuthRemote() {
    const remote = await this.run('git remote get-url origin').catch(()=>'')
    if (!remote) throw new Error('No remote set — add your repo URL in Settings → GitHub')
    if (!this.token) throw new Error('No GitHub token — add it in Settings → GitHub')
    // Embed token if not already there
    if (remote.includes('@github.com')) {
      // Already has token — replace it with current
      return remote.replace(/https:\/\/[^@]+@/, `https://${this.token}@`)
    }
    if (remote.includes('github.com')) {
      const cleanRemote = remote.trim().replace(/\/+$/, '').replace(/\.git$/, '') + '.git'
      return cleanRemote.replace('https://', `https://${this.token}@`)
    }
    // SSH remote — return as-is (SSH handles auth differently)
    return remote
  }

  // GitHub REST API
  githubAPI(method, endpoint, body=null) {
    return new Promise((resolve, reject) => {
      if (!this.token) { reject(new Error('No GitHub token — add it in Settings')); return }
      const data = body ? JSON.stringify(body) : null
      const opts = {
        hostname: 'api.github.com',
        path:     `/repos/${this.owner}/${this.repo}${endpoint}`,
        method,
        headers: {
          'Authorization': `token ${this.token}`,
          'User-Agent':    'Orbit-Assistant/1.0',
          'Accept':        'application/vnd.github.v3+json',
          'Content-Type':  'application/json',
          ...(data ? {'Content-Length': Buffer.byteLength(data)} : {})
        }
      }
      const req = https.request(opts, res => {
        let raw = ''
        res.on('data', c => raw += c)
        res.on('end', () => {
          try {
            const p = JSON.parse(raw)
            res.statusCode >= 400
              ? reject(new Error(p.message || `HTTP ${res.statusCode}: ${raw.slice(0,200)}`))
              : resolve(p)
          } catch { resolve(raw) }
        })
      })
      req.on('error', reject)
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timed out')) })
      if (data) req.write(data)
      req.end()
    })
  }

  async getStatus() {
    try {
      if (!fs.existsSync(path.join(this.repoPath,'.git'))) return {initialized:false}
      const [st, br, lc] = await Promise.allSettled([
        this.run('git status --porcelain'),
        this.run('git branch --show-current'),
        this.run('git log -1 --format="%h %s"'),
      ])
      const status  = st.status==='fulfilled' ? st.value : ''
      const changed = status.split('\n').filter(l=>l.trim()).length
      return {
        initialized:  true,
        branch:       br.status==='fulfilled' ? br.value : 'main',
        lastCommit:   lc.status==='fulfilled' ? lc.value : null,
        changedFiles: changed,
        hasChanges:   changed > 0,
        configured:   !!(this.token && this.owner && this.repo)
      }
    } catch(e) { return {initialized:false, error:e.message} }
  }

  async save(message) {
    try {
      const msg = (message||`Update ${new Date().toLocaleString()}`).replace(/"/g,"'")
      this.send('progress', {message:'Staging files...'})
      await this.run('git add -A')
      const staged = await this.run('git diff --staged --name-only').catch(()=>'')
      if (!staged.trim()) {
        this.send('info', {message:'Nothing new to save'})
        return {success:true, message:'No changes to save'}
      }
      this.send('progress', {message:'Committing...'})
      await this.run(`git commit -m "${msg}"`)
      const hash = await this.run('git rev-parse --short HEAD').catch(()=>'')
      this.send('success', {message:`Saved (${hash})`})
      return {success:true, hash, message:`Saved (${hash})`}
    } catch(e) {
      this.send('error', {message:e.message})
      return {success:false, error:e.message}
    }
  }

  async push() {
    try {
      this.send('progress', {message:'Pushing to GitHub...'})
      const branch   = await this.run('git branch --show-current').catch(()=>'main')
      const authUrl  = await this.getAuthRemote()

      // Set authenticated remote URL
      await this.run(`git remote set-url origin "${authUrl}"`)

      // Push with upstream tracking
      const out = await this.run(`git push -u origin ${branch}`)
      this.send('success', {message: out || 'Pushed.'})
      return {success:true}
    } catch(e) {
      const msg = this._friendlyError(e.message)
      this.send('error', {message: msg})
      return {success:false, error:msg}
    }
  }

  async getCommitsSinceLastRelease() {
    try {
      const lastTag = await this.run('git describe --tags --abbrev=0').catch(()=>null)
      const log = await this.run(
        lastTag
          ? `git log ${lastTag}..HEAD --oneline --no-merges`
          : `git log --oneline --no-merges -20`
      )
      return log.split('\n').filter(l=>l.trim())
    } catch { return [] }
  }

  generateReleaseNotes(commits, version) {
    if (!commits||!commits.length) return `## Orbit ${version}\n\nGeneral updates and improvements.`
    const lines = commits.map(c => `- ${c.replace(/^[a-f0-9]+\s+/,'').trim()}`).join('\n')
    return `## Orbit ${version}\n\n### Changes\n${lines}`
  }

  _friendlyError(msg) {
    if (!msg) return 'Unknown error'
    if (msg.includes('401') || msg.includes('credentials') || msg.includes('Authentication'))
      return 'Auth failed — check your GitHub token in Settings'
    if (msg.includes('403'))
      return 'Permission denied — make sure your token has "repo" scope'
    if (msg.includes('404'))
      return 'Repo not found — check owner/repo name in Settings'
    if (msg.includes('already exists'))
      return 'Tag already exists — the version was already released'
    if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED'))
      return 'No internet connection'
    if (msg.includes('No remote'))
      return 'No repo URL set — add it in Settings → GitHub'
    if (msg.includes('No GitHub token'))
      return 'No token — add your GitHub token in Settings → GitHub'
    return msg.replace(/ghp_\S+/g, '[token]')  // never expose tokens in errors
  }

  async publish(customMessage) {
    try {
      if (!this.token) throw new Error("No GitHub token — add it in Settings")
      this.send("progress", {message:"1/5 Committing..."})
      const msg = (customMessage || ("Update " + new Date().toLocaleDateString())).replace(/"/g,"'")
      await this.run("git add -A")
      const staged = await this.run("git diff --staged --name-only").catch(()=>"")
      if (staged.trim()) await this.run('git commit -m "' + msg + '"')

      this.send("progress", {message:"2/5 Pushing..."})
      const branch  = await this.run("git branch --show-current").catch(()=>"main")
      const authUrl = await this.getAuthRemote()
      await this.run('git remote set-url origin "' + authUrl + '"')
      try {
        await this.run("git push -u origin " + branch)
      } catch(pe) {
        const em = pe.message||""
        if (!em.includes("up-to-date")) throw new Error("Push failed: " + this._friendlyError(em))
      }

      this.send("progress", {message:"3/5 Bumping version..."})
      const fs      = require("fs")
      const path    = require("path")
      const pkgPath = path.join(this.repoPath, "package.json")
      const pkg     = JSON.parse(fs.readFileSync(pkgPath,"utf8"))
      const parts   = pkg.version.split(".")
      parts[2]      = String(parseInt(parts[2]||0) + 1)
      const newVer  = parts.join(".")
      pkg.version   = newVer
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
      await this.run("git add package.json")
      await this.run('git commit -m "v' + newVer + '"')
      await this.run("git push origin " + branch)

      this.send("progress", {message:"4/5 Tagging v" + newVer + "..."})
      const tag = "v" + newVer
      await this.run("git tag -d " + tag).catch(()=>{})
      await this.run("git push origin :refs/tags/" + tag).catch(()=>{})
      await this.run('git tag -a ' + tag + ' -m "Release ' + tag + '"')
      await this.run("git push origin " + tag)

      this.send("progress", {message:"5/5 Creating GitHub Release..."})
      const release = await this.githubAPI("POST", "/releases", {
        tag_name:         tag,
        target_commitish: branch,
        name:             "Orbit " + tag,
        body:             "## Orbit " + tag + "\n\nDownload the installer below.",
        draft:            false,
        prerelease:       false
      })

      this.send("success", {message:"Released " + tag + " → " + release.html_url})
      return {success:true, version:newVer, tag, releaseUrl:release.html_url}
    } catch(e) {
      const msg = this._friendlyError(e.message)
      this.send("error", {message:msg})
      return {success:false, error:msg}
    }
  }

  async pull() {
    try {
      this.send('progress', {message:'Pulling from GitHub...'})
      const branch   = await this.run('git branch --show-current').catch(()=>'main')
      const authUrl  = await this.getAuthRemote()
      await this.run(`git remote set-url origin "${authUrl}"`)
      // Set upstream and pull
      await this.run(`git branch --set-upstream-to=origin/${branch} ${branch}`).catch(()=>{})
      const out = await this.run(`git pull origin ${branch}`)
      const msg = out.includes('Already up to date') ? 'Already up to date.' : 'Updated from GitHub.'
      this.send('success', {message: msg})
      return {success:true, message:msg}
    } catch(e) {
      const msg = this._friendlyError(e.message)
      this.send('error', {message: msg})
      return {success:false, error:msg}
    }
  }

  async getHistory(n=10) {
    try {
      const log = await this.run(`git log --oneline -${n} --format="%h|%s|%cr|%an"`)
      return log.split('\n').filter(l=>l).map(line => {
        const [hash,msg,time,author] = line.split('|')
        return {hash,msg,time,author}
      })
    } catch { return [] }
  }

  async setRemote(url, token) {
    try {
      // Clean URL: strip trailing slashes and .git, then re-add .git
      const cleanUrl = url.trim().replace(/\/+$/, '').replace(/\.git$/, '')
      let authUrl = cleanUrl + '.git'
      if (token && url.includes('github.com')) {
        authUrl = cleanUrl.replace('https://', `https://${token}@`) + '.git'
      }
      await this.run('git remote remove origin').catch(()=>{})
      await this.run(`git remote add origin "${authUrl}"`)
      this.send('success', {message:'GitHub connected.'})
      return {success:true}
    } catch(e) {
      this.send('error', {message:e.message})
      return {success:false, error:e.message}
    }
  }

  async checkForUpdates() {
    try {
      if (!this.token||!this.owner||!this.repo) return {hasUpdates:false}
      const releases = await this.githubAPI('GET','/releases?per_page=1')
      if (!releases||!releases.length) return {hasUpdates:false}
      const latest = releases[0]
      const pkg    = JSON.parse(fs.readFileSync(path.join(this.repoPath,'package.json'),'utf8'))
      return {
        hasUpdates:     latest.tag_name !== `v${pkg.version}`,
        latestVersion:  latest.tag_name,
        currentVersion: pkg.version,
        releaseUrl:     latest.html_url
      }
    } catch { return {hasUpdates:false} }
  }

  async update() {
    try {
      this.send('progress', {message:'Pulling latest...'})
      await this.pull()
      await new Promise((res,rej) =>
        exec('npm install', {cwd:this.repoPath, timeout:120000}, e => e ? rej(e) : res())
      )
      this.send('success', {message:'Updated — restart Orbit to apply'})
      return {success:true}
    } catch(e) {
      this.send('error', {message:e.message})
      return {success:false, error:e.message}
    }
  }

  async init(url) {
    try {
      await this.run('git init')
      await this.run('git branch -M main')
      const gitignore = [
        'node_modules/', 'dist/', 'backups/', '*.log',
        'orbit_app_cache.json', '__pycache__/', '*.pyc',
        'vosk-model-small-en-us/', '*.bak*'
      ].join('\n')
      fs.writeFileSync(path.join(this.repoPath,'.gitignore'), gitignore)
      if (url) await this.run(`git remote add origin "${url}"`)
      this.send('success', {message:'Repo initialized'})
      return {success:true}
    } catch(e) {
      this.send('error', {message:e.message})
      return {success:false, error:e.message}
    }
  }
}

module.exports = GitManager
