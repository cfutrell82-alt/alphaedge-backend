require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

const FRONTEND_URL = process.env.CLIENT_URL || 'https://alphaedgetrading.site';
const SIGNAL_SECRET = process.env.SIGNAL_SECRET || 'alphaedge_signal_secret';

console.log('[BOT] AlphaEdgeProBot starting...');

// ─────────────────────────────────────────────
// HELPER: get user from DB by telegram ID
// ─────────────────────────────────────────────
async function getUserByTelegramId(telegramId) {
  return prisma.user.findFirst({
    where: { telegramUserId: telegramId.toString() }
  });
}

// ─────────────────────────────────────────────
// /start — Welcome message + connect account
// ─────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || 'Trader';

  const existingUser = await getUserByTelegramId(chatId);

  if (existingUser) {
    bot.sendMessage(chatId, 
      `👋 Welcome back, *${existingUser.firstName}*!\n\n` +
      `Your account is connected ✅\n` +
      `Plan: *${existingUser.plan.toUpperCase()}*\n\n` +
      `Use /signals to see latest signals\n` +
      `Use /help to see all commands`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  bot.sendMessage(chatId,
    `🚀 *Welcome to AlphaEdge, ${firstName}!*\n\n` +
    `I'm your personal trading assistant. I'll deliver:\n` +
    `📡 Real-time trade signals\n` +
    `🔔 Account notifications\n` +
    `📊 Market updates\n\n` +
    `*To get started, connect your AlphaEdge account:*\n` +
    `1. Go to your dashboard\n` +
    `2. Click "Connect Telegram"\n` +
    `3. Enter your connection code\n\n` +
    `Or type /connect to get your connection code here.\n\n` +
    `Don't have an account? Sign up free at:\n${FRONTEND_URL}`,
    { parse_mode: 'Markdown' }
  );
});

// ─────────────────────────────────────────────
// /connect — Generate connection code
// ─────────────────────────────────────────────
bot.onText(/\/connect/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramUsername = msg.from.username || '';

  const existing = await getUserByTelegramId(chatId);
  if (existing) {
    bot.sendMessage(chatId,
      `✅ Your Telegram is already connected to *${existing.firstName} ${existing.lastName}*'s account.\n\nUse /help to see available commands.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Generate 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = new Date(Date.now() + 10 * 60 * 1000);

  // Store code temporarily in DB
  await prisma.user.updateMany({
    where: { telegramUserId: chatId.toString() },
    data: { telegramUserId: null }
  });

  // Store pending connection
  global.pendingConnections = global.pendingConnections || new Map();
  global.pendingConnections.set(code, {
    telegramId: chatId.toString(),
    username: telegramUsername,
    expires
  });

  bot.sendMessage(chatId,
    `🔗 *Your connection code:*\n\n` +
    `\`${code}\`\n\n` +
    `1. Go to your AlphaEdge dashboard\n` +
    `2. Click your profile → "Connect Telegram"\n` +
    `3. Enter this code\n\n` +
    `⏱ This code expires in *10 minutes*.`,
    { parse_mode: 'Markdown' }
  );
});

// ─────────────────────────────────────────────
// /signals — Show latest signals
// ─────────────────────────────────────────────
bot.onText(/\/signals/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await getUserByTelegramId(chatId);

  if (!user) {
    bot.sendMessage(chatId,
      `🔒 You need to connect your AlphaEdge account first.\n\nType /connect to get started.`
    );
    return;
  }

  if (user.plan === 'free') {
    bot.sendMessage(chatId,
      `🔒 *Live signals are available on Pro and Elite plans.*\n\n` +
      `Upgrade at: ${FRONTEND_URL}/alphaedge-checkout.html`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const signals = [
    { ticker: 'AAPL', action: 'BUY', entry: '$189.40', target: '$197.00', stop: '$185.00', time: '2m ago' },
    { ticker: 'NVDA', action: 'BUY', entry: '$875.20', target: '$920.00', stop: '$850.00', time: '8m ago' },
    { ticker: 'BTC', action: 'BUY', entry: '$67,420', target: '$71,000', stop: '$65,000', time: '12m ago' },
    { ticker: 'EUR/USD', action: 'SELL', entry: '1.0842', target: '1.0780', stop: '1.0890', time: '18m ago' },
    { ticker: 'ETH', action: 'BUY', entry: '$3,512', target: '$3,750', stop: '$3,380', time: '25m ago' },
  ];

  let message = `📡 *Latest AlphaEdge Signals*\n\n`;
  signals.forEach(s => {
    const emoji = s.action === 'BUY' ? '🟢' : '🔴';
    message += `${emoji} *${s.ticker}* — ${s.action}\n`;
    message += `   Entry: ${s.entry} | TP: ${s.target} | SL: ${s.stop}\n`;
    message += `   ⏱ ${s.time}\n\n`;
  });
  message += `View all signals: ${FRONTEND_URL}/alphaedge-dashboard.html`;

  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// ─────────────────────────────────────────────
// /account — Show account info
// ─────────────────────────────────────────────
bot.onText(/\/account/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await getUserByTelegramId(chatId);

  if (!user) {
    bot.sendMessage(chatId, `🔒 Connect your account first. Type /connect`);
    return;
  }

  bot.sendMessage(chatId,
    `👤 *Your AlphaEdge Account*\n\n` +
    `Name: ${user.firstName} ${user.lastName}\n` +
    `Email: ${user.email}\n` +
    `Plan: *${user.plan.toUpperCase()}*\n` +
    `Member since: ${new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}\n\n` +
    `Manage your account: ${FRONTEND_URL}/alphaedge-dashboard.html`,
    { parse_mode: 'Markdown' }
  );
});

// ─────────────────────────────────────────────
// /markets — Quick market snapshot
// ─────────────────────────────────────────────
bot.onText(/\/markets/, async (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId,
    `📊 *Market Snapshot*\n\n` +
    `🇺🇸 S&P 500: *5,421* (+0.84%)\n` +
    `💻 NASDAQ: *17,832* (+1.12%)\n` +
    `₿ BTC/USD: *$67,420* (+2.3%)\n` +
    `Ξ ETH/USD: *$3,512* (+1.8%)\n` +
    `💱 EUR/USD: *1.0842* (-0.14%)\n` +
    `🥇 Gold: *$2,318* (-0.4%)\n\n` +
    `_Prices delayed 15 min_\n\n` +
    `View live dashboard: ${FRONTEND_URL}/alphaedge-dashboard.html`,
    { parse_mode: 'Markdown' }
  );
});

// ─────────────────────────────────────────────
// /upgrade — Upgrade plan
// ─────────────────────────────────────────────
bot.onText(/\/upgrade/, async (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId,
    `⚡ *Upgrade Your AlphaEdge Plan*\n\n` +
    `🆓 *Free* — 3 signals/day, 2 courses\n` +
    `💎 *Pro — $49/mo* — All signals, 20+ courses, Telegram alerts\n` +
    `👑 *Elite — $149/mo* — Everything + 1-on-1 sessions, scanner\n\n` +
    `Start your 7-day free trial:\n${FRONTEND_URL}/alphaedge-checkout.html`,
    { parse_mode: 'Markdown' }
  );
});

// ─────────────────────────────────────────────
// /help — Show all commands
// ─────────────────────────────────────────────
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId,
    `🤖 *AlphaEdge Bot Commands*\n\n` +
    `/start — Welcome & account status\n` +
    `/connect — Connect your AlphaEdge account\n` +
    `/signals — View latest trade signals\n` +
    `/markets — Quick market snapshot\n` +
    `/account — View your account info\n` +
    `/upgrade — View plan options\n` +
    `/help — Show this menu\n\n` +
    `📱 Dashboard: ${FRONTEND_URL}/alphaedge-dashboard.html\n` +
    `💬 Support: support@alphaedgetrading.site`,
    { parse_mode: 'Markdown' }
  );
});

// ─────────────────────────────────────────────
// BROADCAST SIGNAL (called internally)
// ─────────────────────────────────────────────
async function broadcastSignal(signal) {
  try {
    const users = await prisma.user.findMany({
      where: {
        telegramUserId: { not: null },
        plan: { in: ['pro', 'elite'] },
        status: 'active'
      }
    });

    const emoji = signal.action === 'BUY' ? '🟢' : '🔴';
    const message =
      `📡 *NEW SIGNAL — AlphaEdge*\n\n` +
      `${emoji} *${signal.ticker}* — ${signal.action}\n\n` +
      `Entry: \`${signal.entry}\`\n` +
      `Target: \`${signal.target}\`\n` +
      `Stop Loss: \`${signal.stop}\`\n\n` +
      `Market: ${signal.market}\n` +
      `Setup: ${signal.setup}\n\n` +
      `_Not financial advice. Always manage your risk._`;

    let sent = 0;
    for (const user of users) {
      try {
        await bot.sendMessage(user.telegramUserId, message, { parse_mode: 'Markdown' });
        sent++;
      } catch (err) {
        console.error(`[BOT] Failed to send to ${user.telegramUserId}:`, err.message);
      }
    }
    console.log(`[BOT] Signal broadcast to ${sent}/${users.length} users`);
  } catch (err) {
    console.error('[BOT] Broadcast error:', err.message);
  }
}

// ─────────────────────────────────────────────
// Handle unknown commands
// ─────────────────────────────────────────────
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  if (msg.text && !msg.text.startsWith('/')) {
    bot.sendMessage(chatId,
      `I only respond to commands. Type /help to see what I can do! 👋`
    );
  }
});

bot.on('polling_error', (err) => {
  console.error('[BOT] Polling error:', err.message);
});

console.log('[BOT] AlphaEdgeProBot is running!');

module.exports = { bot, broadcastSignal };
