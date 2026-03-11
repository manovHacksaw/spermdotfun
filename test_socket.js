const { WebSocket } = require('ws');

const socketUrl = 'wss://spermdotfun-socket.onrender.com';
console.log(`Connecting to ${socketUrl}...`);

const ws = new WebSocket(socketUrl);

ws.on('open', () => {
    console.log('✅ Connected to WebSocket');
});

ws.on('message', (data) => {
    try {
        const msg = JSON.parse(data);
        if (msg.type === 'init') {
            console.log('📥 INIT:', msg.price > 0 ? `Price found: $${msg.price}` : 'Price is 0 (waiting for tick)');
        }
        if (msg.type === 'pointer') {
            console.log('📥 POINTER:', msg.price > 0 ? `Price found: $${msg.price}` : 'Price is 0');
            if (msg.price > 0) {
                console.log('\n✅ VERIFIED: Price is flowing through the socket!');
                process.exit(0);
            }
        }
    } catch (e) {
        // ignore malformed
    }
});

ws.on('error', (err) => {
    console.error('❌ WebSocket Error:', err.message);
    process.exit(1);
});

setTimeout(() => {
    console.log('❌ Timeout: No non-zero price received after 20 seconds.');
    process.exit(1);
}, 20000);
