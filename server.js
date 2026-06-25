/**
 * AlphaEdge — Main Server Entry Point
 * Runs auth server on the main PORT exposed by Render
 * Stripe server runs on PORT+1
 * Signals server disabled until Telegram token is configured
 */

const { spawn } = require('child_process');

const mainPort = process.env.PORT || '3000';
const stripePort = String(parseInt(mainPort) + 1);

console.log(`Starting AlphaEdge backend...`);
console.log(`Auth server → port ${mainPort}`);
console.log(`Stripe server → port ${stripePort}`);

// Start auth server on main port (the one Render exposes)
const auth = spawn('node', ['alphaedge-auth.js'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: mainPort }
});
auth.on('close', code => console.log(`Auth server exited with code ${code}`));

// Start stripe server on secondary port
const stripe = spawn('node', ['alphaedge-stripe-server.js'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: stripePort }
});
stripe.on('close', code => console.log(`Stripe server exited with code ${code}`));

// Signals server requires TELEGRAM_BOT_TOKEN — skip if not set
if (process.env.TELEGRAM_BOT_TOKEN) {
  const signals = spawn('node', ['alphaedge-signals.js'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: String(parseInt(mainPort) + 2) }
  });
  signals.on('close', code => console.log(`Signals server exited with code ${code}`));
  console.log(`Signals server → port ${parseInt(mainPort) + 2}`);
} else {
  console.log(`Signals server skipped — TELEGRAM_BOT_TOKEN not set`);
}
