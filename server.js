require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

console.log('Starting AlphaEdge backend...');

// Auth server - uses PORT env var set by Render
const auth = spawn('node', [path.join(__dirname, 'alphaedge-auth.js')], {
  stdio: 'inherit', env: { ...process.env }
});
auth.on('exit', (code) => { console.log(`Auth server exited: ${code}`); process.exit(code || 0); });
console.log(`Auth server → port ${process.env.PORT || 3000}`);

// Stripe server on 3001
const stripe = spawn('node', [path.join(__dirname, 'alphaedge-stripe-server.js')], {
  stdio: 'inherit', env: { ...process.env, PORT: 3001 }
});
stripe.on('exit', (code) => console.log(`Stripe server exited: ${code}`));
console.log('Stripe server → port 3001');

// Telegram bot - starts after 12s delay to let old instances die
setTimeout(() => {
  console.log('Telegram bot → AlphaEdgeProBot starting...');
  require('./alphaedge-telegram-bot');
}, 12000);
