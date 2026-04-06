const WebSocket = require('ws')
const wss = new WebSocket.Server({ port: process.env.PORT || 443 })

const rooms = new Map() // roomCode -> [clientA, clientB]

function generateCode() {
  const words = ['WOLF','IRON','DUSK','NOVA','ARC','TIDE','PEAK','FLUX']
  const word = words[Math.floor(Math.random() * words.length)]
  const num = Math.floor(1000 + Math.random() * 9000)
  return `${word}-${num}`
}

wss.on('connection', (ws) => {
  ws.id = Math.random().toString(36).slice(2)
  ws.roomCode = null
  ws.alive = true

  ws.on('pong', () => { ws.alive = true })

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }

    switch (msg.type) {

      case 'create': {
        const code = generateCode()
        rooms.set(code, [ws])
        ws.roomCode = code
        ws.send(JSON.stringify({ type: 'created', code }))
        break
      }

      case 'join': {
        const room = rooms.get(msg.code)
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', reason: 'Room not found' }))
          return
        }
        if (room.length >= 2) {
          ws.send(JSON.stringify({ type: 'error', reason: 'Room full' }))
          return
        }
        room.push(ws)
        ws.roomCode = msg.code
        // Notify both
        ws.send(JSON.stringify({ type: 'joined', code: msg.code }))
        room[0].send(JSON.stringify({ type: 'partner_joined' }))
        break
      }

      default: {
        // Relay everything else to the partner
        if (!ws.roomCode) return
        const room = rooms.get(ws.roomCode)
        if (!room) return
        const partner = room.find(c => c !== ws)
        if (partner && partner.readyState === WebSocket.OPEN) {
          partner.send(JSON.stringify(msg))
        }
        break
      }
    }
  })

  ws.on('close', () => {
    if (!ws.roomCode) return
    const room = rooms.get(ws.roomCode)
    if (!room) return
    const partner = room.find(c => c !== ws)
    if (partner && partner.readyState === WebSocket.OPEN) {
      partner.send(JSON.stringify({ type: 'partner_disconnected' }))
    }
    rooms.delete(ws.roomCode)
  })
})

// Heartbeat ping to detect dead connections
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.alive) { ws.terminate(); return }
    ws.alive = false
    ws.ping()
  })
}, 10000)

console.log('Relay server running')
