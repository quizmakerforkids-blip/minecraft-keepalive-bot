const http = require('http')
const net = require('net')
const fs = require('fs')
const path = require('path')
require('dotenv').config()
const mineflayer = require('mineflayer')
const mc = require('minecraft-protocol')
const Aternos = require('aternos-unofficial-api')

const COOKIES_PATH = path.resolve(process.cwd(), 'aternos-cookies.json')

const CONFIG = {
  host: process.env.MC_HOST || 'SSVMBOYS.aternos.me',
  port: parseInt(process.env.MC_PORT || '54684', 10),
  username: process.env.MC_USERNAME || 'KeepBot',
  auth: 'offline',
  startTimeout: 10 * 60 * 1000,
  checkInterval: 2 * 60 * 1000,
  offlineRetry: 5 * 60 * 1000
}

const BEHAVIOR = {
  idleMin: 4000,
  idleMax: 15000,
  moveMin: 2500,
  moveMax: 7000,
  chatMin: 8 * 60 * 1000,
  chatMax: 12 * 60 * 1000,
  smallTalk: [
    'yo',
    'heya',
    'nice place you got here',
    'anyone around?',
    'just chilling',
    'good build',
    'brb one sec',
    'anyone need anything?',
    'this server is fun',
    'afk for a bit',
    'lemme get some wood',
    'hi hi'
  ],
  replies: [
    'that is me haha',
    'just hanging around',
    'I am here if you need anything',
    'yep that\'s me',
    'oh hey',
    'I am just a chill guy doing nothing'
  ]
}

const ATERNOS_USER = process.env.ATERNOS_USER
const ATERNOS_PASS = process.env.ATERNOS_PASS
const MC_SERVER_ID = process.env.MC_SERVER_ID || 'SSVMBOYS'

let bot = null
let connected = false
let running = true
let browserOk = true
let behaviorTimer = null
let chatTimer = null
let nextChatAt = Date.now() + 60000

const server = http.createServer((req, res) => {
  const payload = {
    status: connected ? 'online' : 'connecting',
    username: bot ? bot.username : null,
    server: `${CONFIG.host}:${CONFIG.port}`,
    uptime: Math.round(process.uptime()) + 's'
  }
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
})

server.listen(process.env.PORT || 3000, () => {
  console.log(`[${time()}] Health server listening on port ${server.address().port}`)
})

function mcReady(timeout = 5000) {
  return new Promise((resolve) => {
    mc.ping({ host: CONFIG.host, port: CONFIG.port, connectTimeout: timeout, timeout }, (err, response) => {
      const version = response && response.version && response.version.name
      if (err || !version || /offline/i.test(version)) {
        resolve(false)
        return
      }
      resolve(true)
    })
  })
}

function findServerId(servers) {
  const match = servers.find((s) =>
    (s.address || '').toLowerCase().startsWith(MC_SERVER_ID.toLowerCase()) ||
    (s.name || '').toLowerCase().includes(MC_SERVER_ID.toLowerCase())
  )
  return match ? match.id : servers[0] ? servers[0].id : null
}

function looksLikeAternosId(value) {
  return /^[A-Za-z0-9]{10,}$/.test(value)
}

async function startAternosServer() {
  if (!hasAternosSession() && (!ATERNOS_USER || !ATERNOS_PASS)) {
    console.log(`[${time()}] No Aternos session or credentials — server not started automatically.`)
    return false
  }
  if (!browserOk) {
    console.log(`[${time()}] Aternos browser API unavailable here — will wait for the server to be started elsewhere.`)
    return false
  }
  let cookies = readCookies()
  if (!cookies) {
    console.log(`[${time()}] Logging into Aternos...`)
    try {
      cookies = await Aternos.loginToAternos(ATERNOS_USER, ATERNOS_PASS)
    } catch (err) {
      handleAternosError(err)
      return false
    }
  }
  try {
    let id = looksLikeAternosId(MC_SERVER_ID) ? MC_SERVER_ID : null
    if (!id) {
      const { servers } = await Aternos.getServerList(cookies)
      id = findServerId(servers)
    }
    if (!id) {
      console.log(`[${time()}] Could not find server '${MC_SERVER_ID}' in your Aternos account.`)
      return false
    }
    console.log(`[${time()}] Starting Aternos server (${id})...`)
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await Aternos.manageServer(cookies, id, 'start')
      console.log(`[${time()}] Aternos start attempt ${attempt} -> ${JSON.stringify(res)}`)
      if (res && res.success) return true
      await sleep(8000)
    }
    return false
  } catch (err) {
    handleAternosError(err)
    return false
  }
}

function handleAternosError(err) {
  const msg = (err && err.message) || String(err)
  if (/chrom|browser|executable|no display/i.test(msg)) {
    if (browserOk) {
      browserOk = false
      console.log(`[${time()}] No usable browser on this host — Aternos auto-start is disabled here (it still monitor/waits).`)
    }
  } else {
    console.log(`[${time()}] Aternos API error: ${msg}`)
  }
}

async function waitForServer(maxMs) {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    if (await mcReady()) return true
    await sleep(15000)
  }
  return false
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function ensureCookies() {
  if (fs.existsSync(COOKIES_PATH)) return true
  const raw = process.env.ATERNOS_COOKIES
  if (!raw) return false
  try {
    let data = raw
    if (!data.trim().startsWith('[')) {
      data = Buffer.from(data, 'base64').toString('utf8')
    }
    fs.writeFileSync(COOKIES_PATH, data)
    console.log(`[${time()}] Restored Aternos session cookies from env.`)
    return true
  } catch (err) {
    console.log(`[${time()}] Could not restore cookies: ${err.message}`)
    return false
  }
}

function readCookies() {
  if (!ensureCookies()) return null
  try {
    if (!fs.existsSync(COOKIES_PATH)) return null
    const parsed = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'))
    const hasSession = Array.isArray(parsed) && parsed.some((c) => c && c.name === 'ATERNOS_SESSION')
    if (!hasSession) {
      console.log(`[${time()}] Cookie file has no ATERNOS_SESSION.`)
      return null
    }
    return parsed
  } catch (err) {
    console.log(`[${time()}] Cookie file unreadable: ${err.message}`)
    return null
  }
}

function hasAternosSession() {
  return !!process.env.ATERNOS_COOKIES || fs.existsSync(COOKIES_PATH)
}

// ---------------- human-like behavior ----------------

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function clearControl(keys) {
  if (!bot) return
  keys.forEach((k) => bot.setControlState(k, false))
}

function startBehavior() {
  if (behaviorTimer) clearTimeout(behaviorTimer)
  if (chatTimer) clearTimeout(chatTimer)
  scheduleBehavior()
  scheduleChat()
}

function scheduleBehavior() {
  if (!bot || !bot.entity || !running) return
  behaviorTimer = setTimeout(doRandomAction, randInt(BEHAVIOR.idleMin, BEHAVIOR.idleMax))
}

function doRandomAction() {
  if (!bot || !bot.entity || !connected) {
    scheduleBehavior()
    return
  }
  const roll = Math.random()
  if (roll < 0.4) {
    const key = pick(['forward', 'back', 'left', 'right'])
    bot.setControlState(key, true)
    const duration = randInt(BEHAVIOR.moveMin, BEHAVIOR.moveMax)
    bot.look(
      bot.entity.yaw + (Math.random() * 1.6 - 0.8),
      clampPitch(bot.entity.pitch + (Math.random() - 0.5) * 0.4)
    )
    setTimeout(() => {
      clearControl([key])
      scheduleBehavior()
    }, duration)
  } else if (roll < 0.55) {
    bot.setControlState('jump', true)
    setTimeout(() => {
      bot.setControlState('jump', false)
      scheduleBehavior()
    }, 600)
  } else if (roll < 0.7) {
    bot.look(Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.8)
    setTimeout(scheduleBehavior, 900)
  } else {
    scheduleBehavior()
  }
}

function clampPitch(p) {
  return Math.max(-Math.PI / 2, Math.min(Math.PI / 2, p))
}

function scheduleChat() {
  if (!bot || !running) return
  const delay = Math.max(BEHAVIOR.chatMin, nextChatAt - Date.now())
  chatTimer = setTimeout(() => {
    if (!bot || !bot.entity || !connected) {
      scheduleChat()
      return
    }
    bot.chat(pick(BEHAVIOR.smallTalk))
    nextChatAt = Date.now() + randInt(BEHAVIOR.chatMin, BEHAVIOR.chatMax)
    scheduleChat()
  }, delay)
}

function respond(text) {
  const lower = text.toLowerCase()
  if (lower.startsWith('!ping') || /(!|\?)bot\b|keepbot|\bkeep\b/i.test(lower) || lower.includes(CONFIG.username.toLowerCase())) {
    if (Math.random() < 0.7) {
      bot.chat(pick(BEHAVIOR.replies))
    }
  }
}

// ---------------- minecraft client ----------------

function createBot() {
  if (!running) return
  console.log(`[${time()}] Connecting to ${CONFIG.host}:${CONFIG.port}...`)
  bot = mineflayer.createBot({
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    auth: CONFIG.auth,
    hideErrors: false
  })

  bot.on('login', () => {
    console.log(`[${time()}] Logged in as ${bot.username}`)
    connected = true
    startBehavior()
  })

  bot.on('spawn', () => {
    console.log(`[${time()}] Spawned at ${bot.entity.position}`)
  })

  bot.on('message', (msg) => {
    const text = msg.toString().replace(/§./g, '')
    console.log(`[chat] ${text}`)
    respond(text)
  })

  bot.on('health', () => {
    if (bot && bot.health <= 0) {
      console.log(`[${time()}] Died — respawning.`)
      bot.respawn()
    }
  })

  bot.on('kicked', (reason) => {
    const msg = typeof reason === 'string' ? reason : JSON.stringify(reason)
    console.log(`[${time()}] Kicked: ${msg}`)
    connected = false
    bot.end()
  })

  bot.on('error', (err) => {
    console.log(`[${time()}] Error: ${err.message}`)
  })

  bot.on('end', () => {
    console.log(`[${time()}] Bot disconnected.`)
    bot = null
    connected = false
    if (behaviorTimer) {
      clearTimeout(behaviorTimer)
      behaviorTimer = null
    }
    if (chatTimer) {
      clearTimeout(chatTimer)
      chatTimer = null
    }
  })
}

// ---------------- supervisor ----------------

async function supervisor() {
  while (running) {
    if (bot && connected) {
      await sleep(CONFIG.checkInterval)
      continue
    }

    const isOnline = await mcReady()
    if (isOnline) {
      if (!bot) createBot()
      await sleep(10000)
      continue
    }

    if (!hasAternosSession() && (!ATERNOS_USER || !ATERNOS_PASS)) {
      console.log(`[${time()}] Server is offline. Add ATERNOS_USER/ATERNOS_PASS (or ATERNOS_COOKIES) to auto-start it.`)
      await sleep(CONFIG.offlineRetry)
      continue
    }

    if (!browserOk) {
      console.log(`[${time()}] Server offline & auto-start unavailable (no browser here) — waiting for it to come up.`)
      await sleep(CONFIG.offlineRetry)
      continue
    }

    console.log(`[${time()}] Server is offline. Starting it...`)
    await startAternosServer()
    const up = await waitForServer(CONFIG.startTimeout)
    if (!up) {
      console.log(`[${time()}] Server still not ready; trying again in 2 minutes.`)
      await sleep(120000)
      continue
    }

    if (!bot) createBot()
    await sleep(10000)
  }
}

function time() {
  return new Date().toLocaleTimeString()
}

supervisor()

process.on('SIGTERM', () => {
  console.log('[bot] Shutting down...')
  running = false
  if (behaviorTimer) clearTimeout(behaviorTimer)
  if (chatTimer) clearTimeout(chatTimer)
  if (bot) bot.end()
  process.exit(0)
})

process.on('SIGINT', () => {
  process.emit('SIGTERM')
})