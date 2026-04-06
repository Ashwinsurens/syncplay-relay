const WebSocket = require('ws');
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

const rooms = {};
const roomTimeouts = {};

wss.on('connection', (ws) => {
    ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data); } catch (e) { return; }

        // 1. Create Room (Changed 'create' to 'create_room')
        if (msg.type === 'create_room') {
            const code = msg.room || Math.random().toString(36).substring(2, 7).toUpperCase();
            rooms[code] = [ws];
            ws.roomCode = code;
            ws.send(JSON.stringify({ type: 'created', code }));
            console.log(`Room ${code} created`);
            return; // Stop here so we don't broadcast the creation message
        }

        // 2. Join Room (Changed 'join' to 'join_room')
        if (msg.type === 'join_room') {
            const code = msg.room || msg.code;
            if (rooms[code]) {
                if (roomTimeouts[code]) clearTimeout(roomTimeouts[code]); // Stop cleanup if someone joins
                rooms[code].push(ws);
                ws.roomCode = code;
                
                // Notify EVERYONE in the room
                rooms[code].forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'partner_joined' }));
                    }
                });
                console.log(`User joined room ${code}`);
            } else {
                ws.send(JSON.stringify({ type: 'error', reason: 'Room not found' }));
            }
            return;
        }

        // 3. Ping/Pong (Handled instantly)
        if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', sentAt: msg.sentAt }));
            return;
        }

        // 4. Relay all other events (play, pause, seek, heartbeat, resync)
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
                roomTimeouts[code] = setTimeout(() => {
                    delete rooms[code];
                    console.log(`Room ${code} cleaned up`);
                }, 30000);
            }
        }
    });
});
console.log(`Server live on port ${port}`);