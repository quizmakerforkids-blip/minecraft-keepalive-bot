const http = require('http')
const mineflayer = require('mineflayer')

const CONFIG = {
  host: process.env.MC_HOST || 'SSVMBOYS.aternos.me',
  port: parseInt(process.env.MC_PORT || '54684', 10),
  username: process.env.MC_USERNAME || 'KeepBot',
  auth: 'offline',
  // How often (ms) to wiggle so the bot isn't idle-kicked
  idleInterval: 45000
}

let bot = null
let reconnectAttempts = 0
let idleTimer = null
let connected = false

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

function createBot() {
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
    reconnectAttempts = 0
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
    console.log(`[${time()}] Kicked: ${reason}`)
    connected = false
    reconnectAfterDelay('kick')
  })

  bot.on('error', (err) => {
    console.log(`[${time()}] Error: ${err.message}`)
  })

  bot.on('end', (reason) => {
    console.log(`[${time()}] Disconnected: ${reason}`)
    connected = false
    reconnectAfterDelay('end')
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

function reconnectAfterDelay(reason) {
  if (idleTimer) {
    clearInterval(idleTimer)
    idleTimer = null
  }
  if (reconnectAttempts > 10) {
    console.log(`[${time()}] Too many reconnect attempts, waiting 5 minutes...`)
    setTimeout(reconnectAfterDelay, 300000)
    return
  }
  reconnectAttempts += 1
  const delay = Math.min(30000, 5000 * reconnectAttempts)
  console.log(`[${time()}] Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts})`)
  setTimeout(() => {
    if (bot) {
      bot.removeAllListeners()
      bot = null
    }
    createBot()
  }, delay)
}

function time() {
  return new Date().toLocaleTimeString()
}

createBot()

process.on('SIGTERM', () => {
  console.log('[bot] Shutting down...')
  if (bot) bot.end()
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('[bot] Shutting down...')
  if (bot) bot.end()
  process.exit(0)
})