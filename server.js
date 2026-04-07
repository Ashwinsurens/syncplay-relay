const WebSocket = require('ws');
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

const rooms = {};
const roomTimeouts = {};

// Word list for highly readable, dictatable room codes
const words = ['WOLF', 'BEAR', 'HAWK', 'LION', 'STAG', 'ORCA', 'LYNX', 'NOVA'];

wss.on('connection', (ws) => {
    
    // Initialize heartbeat tracker for this socket
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });

    ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data); } catch (e) { return; }

        // 1. Create Room
        if (msg.type === 'create_room') {
            let code = msg.room;
            if (!code) {
                const word = words[Math.floor(Math.random() * words.length)];
                const num = Math.floor(1000 + Math.random() * 9000);
                code = `${word}-${num}`;
            }
            rooms[code] = [ws];
            ws.roomCode = code;
            ws.send(JSON.stringify({ type: 'created', code }));
            console.log(`Room ${code} created`);
            return;
        }

        // 2. Join / Rejoin Room
        if (msg.type === 'join_room' || msg.type === 'rejoin') {
            const code = msg.room || msg.code;
            if (rooms[code]) {
                if (roomTimeouts[code]) clearTimeout(roomTimeouts[code]);
                if (!rooms[code].includes(ws)) rooms[code].push(ws);
                ws.roomCode = code;
                
                rooms[code].forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        if (client === ws) {
                            client.send(JSON.stringify({ type: 'joined', code }));
                        } else {
                            client.send(JSON.stringify({ 
                                type: msg.type === 'rejoin' ? 'partner_rejoined' : 'partner_joined' 
                            }));
                        }
                    }
                });
                console.log(`User ${msg.type}ed room ${code}`);
            } else {
                ws.send(JSON.stringify({ type: 'error', reason: 'Room not found' }));
            }
            return;
        }

        // 3. Intentional Leave (Bypass 60s crash timeout)
        if (msg.type === 'leave_room') {
            ws.intentionalLeave = true; 
            const code = ws.roomCode;
            if (code && rooms[code]) {
                rooms[code] = rooms[code].filter(c => c !== ws);
                rooms[code].forEach(c => c.send(JSON.stringify({ type: 'partner_left' })));
                console.log(`User intentionally left room ${code}. Room remains open.`);
            }
            return;
        }

        // 4. Ping/Pong (Client RTT Sync)
        if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', sentAt: msg.sentAt }));
            return;
        }

        // 5. Keepalive Trap (Do not relay)
        if (msg.type === 'keepalive') return;

        // 6. Relay all other events (play, pause, seek, etc)
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
            // ONLY execute crash logic if this wasn't an intentional leave
            if (!ws.intentionalLeave) {
                rooms[code] = rooms[code].filter(c => c !== ws);
                if (rooms[code].length > 0) {
                    rooms[code].forEach(c => c.send(JSON.stringify({ type: 'partner_disconnected' })));
                } else {
                    roomTimeouts[code] = setTimeout(() => {
                        if (!rooms[code] || rooms[code].length === 0) {
                            delete rooms[code];
                            console.log(`Room ${code} cleaned up after crash.`);
                        }
                    }, 60000); 
                }
            }
        }
    });
});

// Global Ghost Connection Sweeper
setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.alive) { 
            console.log('Terminating dead/ghost connection...');
            return ws.terminate(); 
        }
        ws.alive = false;
        ws.ping(); 
    });
}, 10000);

console.log(`Server live on port ${port}`);