const http = require('http')
const net = require('net')
require('dotenv').config()
const mineflayer = require('mineflayer')
const mc = require('minecraft-protocol')
const Aternos = require('aternos-unofficial-api')

const CONFIG = {
  host: process.env.MC_HOST || 'SSVMBOYS.aternos.me',
  port: parseInt(process.env.MC_PORT || '54684', 10),
  username: process.env.MC_USERNAME || 'KeepBot',
  auth: 'offline',
  idleInterval: 45000,
  startTimeout: 10 * 60 * 1000,
  checkInterval: 2 * 60 * 1000,
  offlineRetry: 5 * 60 * 1000
}

const ATERNOS_USER = process.env.ATERNOS_USER
const ATERNOS_PASS = process.env.ATERNOS_PASS
const MC_SERVER_ID = process.env.MC_SERVER_ID || 'SSVMBOYS'

let bot = null
let idleTimer = null
let connected = false
let running = true

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

function pingPort(host = CONFIG.host, port = CONFIG.port, timeout = 5000) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port })
    sock.setTimeout(timeout)
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      sock.destroy()
      resolve(ok)
    }
    sock.once('connect', () => finish(true))
    sock.once('timeout', () => finish(false))
    sock.once('error', () => finish(false))
  })
}

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

async function startAternosServer() {
  if (!ATERNOS_USER || !ATERNOS_PASS) {
    console.log(`[${time()}] Aternos credentials missing — server not started automatically.`)
    return false
  }
  try {
    console.log(`[${time()}] Logging into Aternos...`)
    const cookies = await Aternos.loginToAternos(ATERNOS_USER, ATERNOS_PASS)
    const { servers } = await Aternos.getServerList(cookies)
    const id = findServerId(servers)
    if (!id) {
      console.log(`[${time()}] Could not find server '${MC_SERVER_ID}' in your Aternos account.`)
      return false
    }
    console.log(`[${time()}] Starting Aternos server (${id})...`)
    const res = await Aternos.manageServer(cookies, id, 'start')
    console.log(`[${time()}] Aternos start request -> ${JSON.stringify(res)}`)
    return true
  } catch (err) {
    console.log(`[${time()}] Aternos API error: ${err.message}`)
    return false
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
    startIdleMovement()
  })

  bot.on('spawn', () => {
    console.log(`[${time()}] Spawned at ${bot.entity.position}`)
  })

  bot.on('message', (msg) => {
    const text = msg.toString().replace(/§./g, '')
    console.log(`[chat] ${text}`)
    if (/whisper|msg|tell/.test(text.toLowerCase())) {
      bot.chat('I am here to keep the server alive!')
    }
    if (text.startsWith('!ping')) {
      bot.chat('Pong! I am awake.')
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
    if (idleTimer) {
      clearInterval(idleTimer)
      idleTimer = null
    }
  })
}

function startIdleMovement() {
  if (idleTimer) clearInterval(idleTimer)
  idleTimer = setInterval(wiggle, CONFIG.idleInterval)
}

function wiggle() {
  if (!bot || !bot.entity) return
  bot.setControlState('forward', true)
  bot.setControlState('jump', true)
  setTimeout(() => {
    bot.setControlState('forward', false)
    bot.setControlState('jump', false)
    console.log(`[${time()}] Wiggled to stay active.`)
  }, 1000)
}

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

    if (!ATERNOS_USER || !ATERNOS_PASS) {
      console.log(`[${time()}] Server is offline. Add ATERNOS_USER and ATERNOS_PASS to .env to auto-start it.`)
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
  if (idleTimer) clearInterval(idleTimer)
  if (bot) bot.end()
  process.exit(0)
})

process.on('SIGINT', () => {
  process.emit('SIGTERM')
})