const WebSocket = require('ws');
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

const rooms = {};
const roomTimeouts = {};

wss.on('connection', (ws) => {
    ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data); } catch (e) { return; }

        // 1. Create Room
        if (msg.type === 'create') {
            const code = Math.random().toString(36).substring(2, 7).toUpperCase();
            rooms[code] = [ws];
            ws.roomCode = code;
            ws.send(JSON.stringify({ type: 'created', code }));
            console.log(`Room ${code} created`);
        }

        // 2. Join Room
        if (msg.type === 'join') {
            const code = msg.code;
            if (rooms[code]) {
                rooms[code].push(ws);
                ws.roomCode = code;
                ws.send(JSON.stringify({ type: 'joined', code }));
                
                // Notify both that partner is here
                rooms[code].forEach(client => {
                    client.send(JSON.stringify({ type: 'partner_joined', from: ws.myId }));
                });
            } else {
                ws.send(JSON.stringify({ type: 'error', reason: 'Room not found' }));
            }
        }

        // 3. Ping/Pong (RTT Measurement)
        if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', sentAt: msg.sentAt }));
        }

        // 4. Broadcast all other events (play, pause, seek, heartbeat)
        if (ws.roomCode && rooms[ws.roomCode]) {
            rooms[ws.roomCode].forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(msg));
                }
            });
        }
    });

    ws.on('close', () => {
        const code = ws.roomCode;
        if (code && rooms[code]) {
            rooms[code] = rooms[code].filter(c => c !== ws);
            if (rooms[code].length > 0) {
                rooms[code].forEach(c => c.send(JSON.stringify({ type: 'partner_disconnected' })));
            } else {
                // 30-second grace period for host to reconnect
                roomTimeouts[code] = setTimeout(() => {
                    delete rooms[code];
                    console.log(`Room ${code} cleaned up`);
                }, 30000);
            }
        }
    });
});