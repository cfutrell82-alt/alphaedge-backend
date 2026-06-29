require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────

const SERVICES = [
  {
    name: 'Auth',
    script: 'alphaedge-auth.js',
    // Inherits PORT from Render's environment (do NOT override here)
    env: {},
    restartDelay: 2000,
  },
  {
    name: 'Stripe',
    script: 'alphaedge-stripe-server.js',
    env: { PORT: process.env.STRIPE_PORT || '3001' },
    restartDelay: 2000,
  },
  {
    name: 'Telegram',
    script: 'alphaedge-telegram-bot.js',
    // Delay startup so auth is ready first
    startDelay: 3000,
    env: {},
    restartDelay: 5000,
  },
];

// ─── Logger ───────────────────────────────────────────────────────────────────

function log(name, msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${name}] ${msg}`);
}

// ─── Spawner ──────────────────────────────────────────────────────────────────

function spawnService(service) {
  const scriptPath = path.join(__dirname, service.script);
  const env = { ...process.env, ...service.env };

  log(service.name, `Starting → ${service.script}`);

  const child = spawn('node', [scriptPath], {
    stdio: ['inherit', 'pipe', 'pipe'],
    env,
  });

  // Tag stdout lines with service name so logs are easy to grep
  child.stdout.on('data', (data) => {
    data.toString().trim().split('\n').forEach((line) => {
      log(service.name, line);
    });
  });

  // Tag stderr lines and mark them clearly as errors
  child.stderr.on('data', (data) => {
    data.toString().trim().split('\n').forEach((line) => {
      log(service.name, `ERROR: ${line}`);
    });
  });

  child.on('exit', (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    log(service.name, `Exited with ${reason}. Restarting in ${service.restartDelay}ms...`);

    // Auto-restart — never take down sibling services
    setTimeout(() => spawnService(service), service.restartDelay);
  });

  child.on('error', (err) => {
    log(service.name, `Failed to start: ${err.message}`);
    setTimeout(() => spawnService(service), service.restartDelay);
  });

  return child;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

console.log('Starting AlphaEdge backend...');

SERVICES.forEach((service) => {
  if (service.startDelay) {
    log(service.name, `Delayed start in ${service.startDelay}ms...`);
    setTimeout(() => spawnService(service), service.startDelay);
  } else {
    spawnService(service);
  }
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
// Render sends SIGTERM before killing the container — log it clearly

process.on('SIGTERM', () => {
  console.log('[Orchestrator] Received SIGTERM. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Orchestrator] Received SIGINT. Shutting down...');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('[Orchestrator] Uncaught exception:', err);
  // Don't exit — keep sibling processes alive
});
