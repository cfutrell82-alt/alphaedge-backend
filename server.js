require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

console.log('Starting AlphaEdge backend...');

// Auth server on PORT (Render expects this to be the main port)
const auth = spawn('node', [path.join(__dirname, 'alphaedge-auth.js')], {
  stdio: 'inherit', env: { ...process.env }
});
auth.on('exit', (code) => { console.log(`Auth server exited: ${code}`); process.exit(code); });
console.log(`Auth server → port ${process.env.PORT || 3000}`);

// Stripe server on 3001
const stripe = spawn('node', [path.join(__dirname, 'alphaedge-stripe-server.js')], {
  stdio: 'inherit', env: { ...process.env, PORT: 3001 }
});
stripe.on('exit', (code) => console.log(`Stripe server exited: ${code}`));
console.log('Stripe server → port 3001');

// Bot in webhook mode — just initialize, no polling
setTimeout(() => {
  try {
    require('./alphaedge-telegram-bot');
    console.log('Telegram bot → webhook mode (no polling)');
  } catch(err) {
    console.error('Bot init error:', err.message);
  }
}, 3000);
