require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const FRONTEND_URL = process.env.CLIENT_URL || 'https://alphaedgetrading.site';
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Use webhook if URL is set, otherwise polling with conflict protection
const WEBHOOK_URL = process.env.WEBHOOK_URL; // e.g. https://alphaedge-backend-uu13.onrender.com/bot-webhook

let bot;
if (WEBHOOK_URL) {
  bot = new TelegramBot(TOKEN, { webHook: { port: 3003 } });
  bot.setWebHook(`${WEBHOOK_URL}/${TOKEN}`);
  console.log('[BOT] Running in webhook mode');
} else {
  // Delete any existing webhook first to avoid conflicts
  const tempBot = new TelegramBot(TOKEN, { polling: false });
  tempBot.deleteWebHook().then(() => {
    console.log('[BOT] Webhook cleared, starting polling...');
  }).catch(() => {});

  bot = new TelegramBot(TOKEN, {
    polling: {
      interval: 3000,
      autoStart: false,
      params: { timeout: 10, allowed_updates: ['message', 'callback_query'] }
    }
  });

  // Delay start to let old instance die
  setTimeout(() => {
    bot.startPolling();
    console.log('[BOT] Polling started');
  }, 8000);

  bot.on('polling_error', (error) => {
    if (error.message?.includes('409')) {
      console.log('[BOT] 409 conflict — stopping and retrying in 15s...');
      bot.stopPolling().catch(() => {});
      setTimeout(() => {
        bot.startPolling().catch(() => {});
      }, 15000);
    } else if (error.message?.includes('502') || error.message?.includes('504')) {
      // Ignore gateway errors
    } else {
      console.error('[BOT] Error:', error.message);
    }
  });
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function esc(text) {
  return String(text || '').replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

async function getUser(telegramId) {
  try {
    return await prisma.user.findFirst({ where: { telegramId: String(telegramId) } });
  } catch(e) { return null; }
}

// ─────────────────────────────────────────────
// KEYBOARDS
// ─────────────────────────────────────────────
const mainMenu = {
  reply_markup: {
    keyboard: [
      ['📡 Signals', '📊 Markets'],
      ['💰 Account', '🔗 Connect'],
      ['🪙 AEC Coin', '❓ Help']
    ],
    resize_keyboard: true
  }
};

const signalsMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📈 Stocks', callback_data: 'sig_stocks' }, { text: '💱 Forex', callback_data: 'sig_forex' }],
      [{ text: '₿ Crypto', callback_data: 'sig_crypto' }, { text: '⚙️ Options', callback_data: 'sig_options' }],
      [{ text: '🔙 Back', callback_data: 'main_menu' }]
    ]
  }
};

// ─────────────────────────────────────────────
// SIGNAL DATA
// ─────────────────────────────────────────────
const signals = {
  stocks: [
    { ticker: 'NVDA', action: 'BUY', entry: '$1,142.50', tp: '$1,190', sl: '$1,110' },
    { ticker: 'AAPL', action: 'BUY', entry: '$198.30', tp: '$207', sl: '$193' },
    { ticker: 'TSLA', action: 'SELL', entry: '$185.60', tp: '$172', sl: '$192' },
  ],
  forex: [
    { ticker: 'EUR/USD', action: 'SELL', entry: '1.08420', tp: '1.07900', sl: '1.08750' },
    { ticker: 'GBP/JPY', action: 'BUY', entry: '191.240', tp: '193.500', sl: '189.800' },
  ],
  crypto: [
    { ticker: 'BTC/USD', action: 'BUY', entry: '$67,420', tp: '$71,000', sl: '$65,800' },
    { ticker: 'ETH/USD', action: 'BUY', entry: '$3,812', tp: '$4,100', sl: '$3,650' },
    { ticker: 'SOL/USD', action: 'BUY', entry: '$168.40', tp: '$185', sl: '$158' },
  ],
  options: [
    { ticker: 'SPX 0DTE', action: 'BUY', entry: '$5,421', tp: '$5,480', sl: '$5,400' },
    { ticker: 'QQQ PUT', action: 'BUY', entry: '$418.90', tp: '$410', sl: '$422' },
  ]
};

function formatSignals(market) {
  const list = signals[market] || [];
  let msg = `*⚡ ${market.toUpperCase()} SIGNALS*\n\n`;
  list.forEach(s => {
    msg += `${s.action === 'BUY' ? '🟢' : '🔴'} *${esc(s.ticker)}* — ${s.action}\n`;
    msg += `Entry: \`${esc(s.entry)}\` · TP: \`${esc(s.tp)}\` · SL: \`${esc(s.sl)}\`\n\n`;
  });
  msg += `[View Dashboard](${FRONTEND_URL}/alphaedge-dashboard.html)`;
  return msg;
}

// ─────────────────────────────────────────────
// COMMANDS
// ─────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const name = esc(msg.from.first_name || 'Trader');
  const user = await getUser(msg.from.id);
  let text = `👋 *Welcome to AlphaEdge, ${name}\\!*\n\n`;
  if (user) {
    text += `✅ Connected — Plan: *${esc(user.plan?.toUpperCase() || 'FREE')}*\n\n`;
  } else {
    text += `🔗 Connect your account with /connect\n\n`;
  }
  text += `Use the menu below to get started\\.`;
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2', ...mainMenu });
});

bot.onText(/\/signals|📡 Signals/i, async (msg) => {
  const user = await getUser(msg.from.id);
  if (!user || user.plan === 'free') {
    return bot.sendMessage(msg.chat.id,
      `🔒 Signals require Pro or Elite\\.\n\n[Upgrade Now](${FRONTEND_URL}/alphaedge-checkout.html)`,
      { parse_mode: 'MarkdownV2' }
    );
  }
  bot.sendMessage(msg.chat.id, '📡 *Choose a market:*', { parse_mode: 'MarkdownV2', ...signalsMenu });
});

bot.onText(/\/markets|📊 Markets/i, (msg) => {
  const text = `📊 *Market Overview*\n\n` +
    `📈 S&P 500: 5,421 \\+0\\.84%\n` +
    `₿ BTC: $67,420 \\+3\\.6%\n` +
    `Ξ ETH: $3,812 \\+2\\.1%\n` +
    `💱 EUR\\/USD: 1\\.0842 \\-0\\.14%\n` +
    `◈ SOL: $168\\.40 \\+4\\.2%\n\n` +
    `[Open Terminal](${FRONTEND_URL}/alphaedge-trading-terminal.html)`;
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2' });
});

bot.onText(/\/connect|🔗 Connect/i, async (msg) => {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const text = `🔗 *Connect Your Account*\n\nYour code:\n\n\`${code}\`\n\n_Expires in 10 minutes_\n\nEnter this in your [Dashboard](${FRONTEND_URL}/alphaedge-dashboard.html) under Account\\.`;
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2' });
});

bot.onText(/\/account|💰 Account/i, async (msg) => {
  const user = await getUser(msg.from.id);
  if (!user) {
    return bot.sendMessage(msg.chat.id, '❌ No account connected\\. Use /connect to link your account\\.', { parse_mode: 'MarkdownV2' });
  }
  const text = `👤 *Your Account*\n\n` +
    `Name: ${esc(user.firstName)} ${esc(user.lastName)}\n` +
    `Plan: *${esc(user.plan?.toUpperCase() || 'FREE')}*\n\n` +
    `[Open Dashboard](${FRONTEND_URL}/alphaedge-dashboard.html)`;
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2' });
});

bot.onText(/\/coin|🪙 AEC Coin/i, (msg) => {
  const text = `🪙 *AlphaEdge Coin \\(AEC\\)*\n\nThe official AlphaEdge token on Solana\\.\n\n[View AEC Page](${FRONTEND_URL}/alphaedge-coin.html)\n[Buy on PumpFun](https://join.pump.fun/HSag/kgc2fiaa)`;
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2' });
});

bot.onText(/\/upgrade/, (msg) => {
  const text = `⚡ *Upgrade AlphaEdge*\n\n🆓 Free — 2 signals/day\n🔵 Pro — $49/mo\n👑 Elite — $149/mo\n\n[Choose Plan](${FRONTEND_URL}/alphaedge-checkout.html)`;
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2' });
});

bot.onText(/\/help|❓ Help/i, (msg) => {
  const text = `❓ *Commands*\n\n/start — Welcome\n/signals — Live signals\n/markets — Prices\n/connect — Link account\n/account — Your info\n/coin — AEC Coin\n/upgrade — Plans\n\n[Visit AlphaEdge](${FRONTEND_URL})`;
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2' });
});

// ─────────────────────────────────────────────
// CALLBACK QUERIES
// ─────────────────────────────────────────────
bot.on('callback_query', async (query) => {
  bot.answerCallbackQuery(query.id).catch(() => {});
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith('sig_')) {
    const market = data.replace('sig_', '');
    const user = await getUser(query.from.id);
    if (!user || user.plan === 'free') {
      return bot.sendMessage(chatId, `🔒 Upgrade to Pro: ${FRONTEND_URL}/alphaedge-checkout.html`);
    }
    bot.sendMessage(chatId, formatSignals(market), { parse_mode: 'MarkdownV2' });
  } else if (data === 'main_menu') {
    bot.sendMessage(chatId, '🏠 Main Menu', mainMenu);
  }
});

console.log('[BOT] AlphaEdgeProBot initialized');
module.exports = bot;
