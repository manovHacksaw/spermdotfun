const { WebSocket } = require('ws');
// Single stream URL
const ws = new WebSocket('wss://stream.binance.com:9443/ws/avaxusdt@ticker');

ws.on('open', () => console.log('✅ Connected to Binance'));
ws.on('message', (data) => {
    const msg = JSON.parse(data);
    console.log('Received:', msg);
    if (msg.c) {
        console.log('✅ Price found:', msg.c);
        process.exit(0);
    }
});
ws.on('error', (err) => console.error('❌ Error:', err));
setTimeout(() => {
    console.log('❌ Timeout - no price');
    process.exit(1);
}, 10000);
