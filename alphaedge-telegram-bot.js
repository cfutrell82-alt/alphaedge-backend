require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Use polling=false and handle conflicts gracefully
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: {
    interval: 2000,
    autoStart: true,
    params: { timeout: 10 }
  }
});

// Handle polling errors gracefully without crashing
bot.on('polling_error', (error) => {
  if (error.code === 'ETELEGRAM' && error.message.includes('409')) {
    console.log('[BOT] Another instance detected — waiting to take over...');
    // Stop and restart after delay to avoid conflict
    setTimeout(() => {
      bot.stopPolling().then(() => {
        setTimeout(() => {
          bot.startPolling();
          console.log('[BOT] Polling restarted successfully');
        }, 5000);
      });
    }, 3000);
  } else if (error.code === 'ETELEGRAM' && (error.message.includes('502') || error.message.includes('504'))) {
    // Gateway errors are temporary — just log and continue
    console.log('[BOT] Telegram gateway error (temporary) — continuing...');
  } else {
    console.error('[BOT] Polling error:', error.message);
  }
});

const FRONTEND_URL = process.env.CLIENT_URL || 'https://alphaedgetrading.site';

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function escapeMarkdown(text) {
  return String(text).replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

async function getUserByTelegramId(telegramId) {
  return prisma.user.findFirst({ where: { telegramId: String(telegramId) } });
}

// ─────────────────────────────────────────────
// KEYBOARDS
// ─────────────────────────────────────────────
const mainMenu = {
  reply_markup: {
    keyboard: [
      ['📡 Signals', '📊 Markets'],
      ['💰 Account', '🔗 Connect Account'],
      ['💻 Terminal', '❓ Help']
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
};

const signalsMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📈 Stocks', callback_data: 'sig_stocks' }, { text: '💱 Forex', callback_data: 'sig_forex' }],
      [{ text: '₿ Crypto', callback_data: 'sig_crypto' }, { text: '⚙️ Options', callback_data: 'sig_options' }],
      [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
    ]
  }
};

// ─────────────────────────────────────────────
// SIGNAL DATA
// ─────────────────────────────────────────────
const liveSignals = {
  stocks: [
    { ticker: 'NVDA', action: 'BUY', entry: '$1,142.50', tp: '$1,190.00', sl: '$1,110.00', time: '2m ago' },
    { ticker: 'AAPL', action: 'BUY', entry: '$198.30', tp: '$207.00', sl: '$193.00', time: '14m ago' },
    { ticker: 'TSLA', action: 'SELL', entry: '$185.60', tp: '$172.00', sl: '$192.00', time: '31m ago' },
  ],
  forex: [
    { ticker: 'EUR/USD', action: 'SELL', entry: '1.08420', tp: '1.07900', sl: '1.08750', time: '8m ago' },
    { ticker: 'GBP/JPY', action: 'BUY', entry: '191.240', tp: '193.500', sl: '189.800', time: '22m ago' },
    { ticker: 'USD/JPY', action: 'BUY', entry: '157.840', tp: '159.500', sl: '156.800', time: '45m ago' },
  ],
  crypto: [
    { ticker: 'BTC/USD', action: 'BUY', entry: '$67,420', tp: '$71,000', sl: '$65,800', time: '1m ago' },
    { ticker: 'ETH/USD', action: 'BUY', entry: '$3,812', tp: '$4,100', sl: '$3,650', time: '18m ago' },
    { ticker: 'SOL/USD', action: 'BUY', entry: '$168.40', tp: '$185.00', sl: '$158.00', time: '35m ago' },
  ],
  options: [
    { ticker: 'SPX 0DTE', action: 'BUY', entry: '$5,421', tp: '$5,480', sl: '$5,400', time: '5m ago' },
    { ticker: 'QQQ PUT', action: 'BUY', entry: '$418.90', tp: '$410.00', sl: '$422.00', time: '28m ago' },
  ]
};

function formatSignals(market) {
  const signals = liveSignals[market] || [];
  let msg = `*⚡ ${market.toUpperCase()} SIGNALS*\n\n`;
  signals.forEach(s => {
    const emoji = s.action === 'BUY' ? '🟢' : '🔴';
    msg += `${emoji} *${escapeMarkdown(s.ticker)}* — ${s.action}\n`;
    msg += `   Entry: \`${escapeMarkdown(s.entry)}\`\n`;
    msg += `   TP: \`${escapeMarkdown(s.tp)}\` | SL: \`${escapeMarkdown(s.sl)}\`\n`;
    msg += `   _${s.time}_\n\n`;
  });
  msg += `📊 [View Dashboard](${FRONTEND_URL}/alphaedge-dashboard.html)`;
  return msg;
}

// ─────────────────────────────────────────────
// COMMANDS
// ─────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const name = msg.from.first_name || 'Trader';
  const user = await getUserByTelegramId(msg.from.id);
  const plan = user ? user.plan?.toUpperCase() || 'FREE' : null;

  let welcome = `👋 *Welcome to AlphaEdge, ${escapeMarkdown(name)}\\!*\n\n`;
  if (user) {
    welcome += `✅ Account connected \\— Plan: *${escapeMarkdown(plan)}*\n\n`;
  } else {
    welcome += `🔗 Connect your account to unlock signals:\n/connect\n\n`;
  }
  welcome += `*What I can do:*\n`;
  welcome += `📡 Live trade signals\n`;
  welcome += `📊 Market updates\n`;
  welcome += `💰 Account info\n`;
  welcome += `💻 Terminal access\n\n`;
  welcome += `Use the menu below to get started\\!`;

  bot.sendMessage(msg.chat.id, welcome, { parse_mode: 'MarkdownV2', ...mainMenu });
});

bot.onText(/\/signals/, async (msg) => {
  const user = await getUserByTelegramId(msg.from.id);
  if (!user || user.plan === 'free') {
    return bot.sendMessage(msg.chat.id,
      '🔒 *Signals are locked*\n\nUpgrade to Pro or Elite to receive live signals\\.\n\n[Upgrade Now](' + FRONTEND_URL + '/alphaedge-checkout.html)',
      { parse_mode: 'MarkdownV2' }
    );
  }
  bot.sendMessage(msg.chat.id, '📡 *Choose a market:*', { parse_mode: 'MarkdownV2', ...signalsMenu });
});

bot.onText(/\/markets/, (msg) => {
  const text = `📊 *Market Overview*\n\n` +
    `📈 *S&P 500:* 5,421 \\+0\\.84%\n` +
    `💱 *EUR\\/USD:* 1\\.0842 \\-0\\.14%\n` +
    `₿ *BTC:* $67,420 \\+3\\.6%\n` +
    `Ξ *ETH:* $3,812 \\+2\\.1%\n` +
    `◈ *SOL:* $168\\.40 \\+4\\.2%\n\n` +
    `[Open Terminal](${FRONTEND_URL}/alphaedge-trading-terminal.html)`;
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2' });
});

bot.onText(/\/connect/, async (msg) => {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  try {
    await prisma.telegramCode.upsert({
      where: { telegramId: String(msg.from.id) },
      update: { code, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
      create: { telegramId: String(msg.from.id), code, expiresAt: new Date(Date.now() + 10 * 60 * 1000) }
    });
  } catch(e) {
    // Table may not exist yet — just show the code
  }
  const text = `🔗 *Connect Your AlphaEdge Account*\n\n` +
    `Your connection code:\n\n` +
    `\`${code}\`\n\n` +
    `_Expires in 10 minutes_\n\n` +
    `Enter this code in your [Dashboard](${FRONTEND_URL}/alphaedge-dashboard.html) under Account settings\\.`;
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2' });
});

bot.onText(/\/account/, async (msg) => {
  const user = await getUserByTelegramId(msg.from.id);
  if (!user) {
    return bot.sendMessage(msg.chat.id,
      '❌ *No account connected*\n\nUse /connect to link your AlphaEdge account\\.',
      { parse_mode: 'MarkdownV2' }
    );
  }
  const text = `👤 *Your Account*\n\n` +
    `Name: ${escapeMarkdown(user.firstName + ' ' + user.lastName)}\n` +
    `Email: ${escapeMarkdown(user.email)}\n` +
    `Plan: *${escapeMarkdown(user.plan?.toUpperCase() || 'FREE')}*\n\n` +
    `[Open Dashboard](${FRONTEND_URL}/alphaedge-dashboard.html)`;
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2' });
});

bot.onText(/\/upgrade/, (msg) => {
  const text = `⚡ *Upgrade AlphaEdge*\n\n` +
    `🆓 *Free* — 2 signals/day\n` +
    `🔵 *Pro* — $49/mo — All markets, unlimited signals\n` +
    `👑 *Elite* — $149/mo — Priority signals \\+ scanner\n\n` +
    `[Choose Your Plan](${FRONTEND_URL}/alphaedge-checkout.html)`;
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2' });
});

bot.onText(/\/help/, (msg) => {
  const text = `❓ *AlphaEdge Bot Commands*\n\n` +
    `/start — Welcome & overview\n` +
    `/signals — Live trade signals\n` +
    `/markets — Market prices\n` +
    `/connect — Link your account\n` +
    `/account — Your account info\n` +
    `/upgrade — View plans\n` +
    `/help — This message\n\n` +
    `[Visit AlphaEdge](${FRONTEND_URL})`;
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2' });
});

// ─────────────────────────────────────────────
// TEXT MESSAGE HANDLERS
// ─────────────────────────────────────────────
bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return;
  const text = msg.text?.toLowerCase();
  if (!text) return;

  if (text.includes('signal')) {
    bot.emit('text', { ...msg, text: '/signals' });
  } else if (text.includes('market')) {
    bot.emit('text', { ...msg, text: '/markets' });
  } else if (text.includes('account') || text.includes('💰')) {
    bot.emit('text', { ...msg, text: '/account' });
  } else if (text.includes('connect') || text.includes('🔗')) {
    bot.emit('text', { ...msg, text: '/connect' });
  } else if (text.includes('terminal') || text.includes('💻')) {
    bot.sendMessage(msg.chat.id, `💻 Open the AlphaEdge Terminal:\n${FRONTEND_URL}/alphaedge-trading-terminal.html`);
  } else if (text.includes('help') || text.includes('❓')) {
    bot.emit('text', { ...msg, text: '/help' });
  }
});

// ─────────────────────────────────────────────
// CALLBACK QUERY HANDLER
// ─────────────────────────────────────────────
bot.on('callback_query', async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  bot.answerCallbackQuery(query.id);

  if (data.startsWith('sig_')) {
    const market = data.replace('sig_', '');
    const user = await getUserByTelegramId(query.from.id);
    if (!user || user.plan === 'free') {
      return bot.sendMessage(chatId,
        '🔒 Upgrade to Pro to see signals: ' + FRONTEND_URL + '/alphaedge-checkout.html'
      );
    }
    bot.sendMessage(chatId, formatSignals(market), { parse_mode: 'MarkdownV2' });
  } else if (data === 'main_menu') {
    bot.sendMessage(chatId, '🏠 Main Menu', mainMenu);
  }
});

console.log('[BOT] AlphaEdgeProBot starting...');

module.exports = bot;
