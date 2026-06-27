/**
 * AlphaEdge — Main Server Entry Point
 */

const { spawn } = require('child_process');

const mainPort = process.env.PORT || '3000';
const stripePort = String(parseInt(mainPort) + 1);
const paymentsPort = String(parseInt(mainPort) + 2);

console.log(`Starting AlphaEdge backend...`);
console.log(`Auth server → port ${mainPort}`);
console.log(`Stripe server → port ${stripePort}`);
console.log(`Payments server → port ${paymentsPort}`);

// Auth server
const auth = spawn('node', ['alphaedge-auth.js'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: mainPort }
});
auth.on('close', code => console.log(`Auth server exited with code ${code}`));

// Stripe server
const stripe = spawn('node', ['alphaedge-stripe-server.js'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: stripePort }
});
stripe.on('close', code => console.log(`Stripe server exited with code ${code}`));

// NOWPayments server
const payments = spawn('node', ['alphaedge-payments.js'], {
  stdio: 'inherit',
  env: { ...process.env, PAYMENTS_PORT: paymentsPort }
});
payments.on('close', code => console.log(`Payments server exited with code ${code}`));

// Telegram bot
if (process.env.TELEGRAM_BOT_TOKEN) {
  const bot = spawn('node', ['alphaedge-telegram-bot.js'], {
    stdio: 'inherit',
    env: { ...process.env }
  });
  bot.on('close', code => console.log(`Telegram bot exited with code ${code}`));
  console.log(`Telegram bot → AlphaEdgeProBot starting...`);
} else {
  console.log(`Telegram bot skipped — TELEGRAM_BOT_TOKEN not set`);
}
