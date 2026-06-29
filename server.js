require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

console.log('Starting AlphaEdge backend...');

// Start auth server (includes webhook endpoint for Telegram)
const auth = spawn('node', [path.join(__dirname, 'alphaedge-auth.js')], {
  stdio: 'inherit', env: { ...process.env, PORT: 3000 }
});
auth.on('exit', (code) => console.log(`Auth server exited: ${code}`));
console.log('Auth server → port 3000');

// Start stripe server
const stripe = spawn('node', [path.join(__dirname, 'alphaedge-stripe-server.js')], {
  stdio: 'inherit', env: { ...process.env, PORT: 3001 }
});
stripe.on('exit', (code) => console.log(`Stripe server exited: ${code}`));
console.log('Stripe server → port 3001');

// Initialize bot in webhook mode (no polling, no conflicts)
try {
  require('./alphaedge-telegram-bot');
  console.log('Telegram bot → webhook mode');
} catch(err) {
  console.error('Bot init error:', err.message);
}
