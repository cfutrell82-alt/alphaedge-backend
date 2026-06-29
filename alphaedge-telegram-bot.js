require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { PrismaClient } = require('@prisma/client');
const https = require('https');

const prisma = new PrismaClient();
const FRONTEND_URL = process.env.CLIENT_URL || 'https://alphaedgetrading.site';
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// First, delete any existing webhook to clear Telegram's queue
function deleteWebhook() {
  return new Promise((resolve) => {
    https.get(`https://api.telegram.org/bot${TOKEN}/deleteWebhook?drop_pending_updates=true`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('[BOT] Webhook cleared:', data);
        resolve();
      });
    }).on('error', () => resolve());
  });
}

async function startBot() {
  // Clear webhook first
  await deleteWebhook();
  
  // Wait for any other instances to stop
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  const bot = new TelegramBot(TOKEN, {
    polling: {
      interval: 4000,
      autoStart: true,
      params: {
        timeout: 30,
        allowed_updates: ['message', 'callback_query']
      }
    }
  });

  let isRestarting = false;

  bot.on('polling_error', async (error) => {
    if (error.message?.includes('409')) {
      if (isRestarting) return;
      isRestarting = true;
      console.log('[BOT] 409 — stopping polling for 20s...');
      await bot.stopPolling().catch(() => {});
      setTimeout(async () => {
        await deleteWebhook();
        await bot.startPolling().catch(() => {});
        isRestarting = false;
        console.log('[BOT] Polling restarted');
      }, 20000);
    } else if (!error.message?.includes('502') && !error.message?.includes('504')) {
      console.error('[BOT] Error:', error.message);
    }
  });

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
      ]
    }
  };

  const signalData = {
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
    const list = signalData[market] || [];
    let msg = `*⚡ ${market.toUpperCase()} SIGNALS*\n\n`;
    list.forEach(s => {
      msg += `${s.action === 'BUY' ? '🟢' : '🔴'} *${esc(s.ticker)}* — ${s.action}\n`;
      msg += `Entry: \`${esc(s.entry)}\` · TP: \`${esc(s.tp)}\` · SL: \`${esc(s.sl)}\`\n\n`;
    });
    msg += `[View Dashboard](${FRONTEND_URL}/alphaedge-dashboard.html)`;
    return msg;
  }

  bot.onText(/\/start/, async (msg) => {
    const name = esc(msg.from?.first_name || 'Trader');
    const user = await getUser(msg.from?.id);
    let text = `👋 *Welcome to AlphaEdge, ${name}\\!*\n\n`;
    text += user
      ? `✅ Connected — Plan: *${esc(user.plan?.toUpperCase() || 'FREE')}*\n\n`
      : `🔗 Connect your account with /connect\n\n`;
    text += `Use the menu below to get started\\.`;
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2', ...mainMenu });
  });

  bot.onText(/\/signals|📡 Signals/i, async (msg) => {
    const user = await getUser(msg.from?.id);
    if (!user || user.plan === 'free') {
      return bot.sendMessage(msg.chat.id,
        `🔒 Signals require Pro or Elite\\.\n[Upgrade Now](${FRONTEND_URL}/alphaedge-checkout.html)`,
        { parse_mode: 'MarkdownV2' }
      );
    }
    bot.sendMessage(msg.chat.id, '📡 *Choose a market:*', { parse_mode: 'MarkdownV2', ...signalsMenu });
  });

  bot.onText(/\/markets|📊 Markets/i, (msg) => {
    bot.sendMessage(msg.chat.id,
      `📊 *Market Overview*\n\n₿ BTC: $67,420 \\+3\\.6%\nΞ ETH: $3,812 \\+2\\.1%\n📈 SPY: $487 \\+0\\.8%\n💱 EUR\\/USD: 1\\.0842\n\n[Open Terminal](${FRONTEND_URL}/alphaedge-trading-terminal.html)`,
      { parse_mode: 'MarkdownV2' }
    );
  });

  bot.onText(/\/connect|🔗 Connect/i, (msg) => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    bot.sendMessage(msg.chat.id,
      `🔗 *Connect Your Account*\n\nYour code:\n\n\`${code}\`\n\n_Enter this in your [Dashboard](${FRONTEND_URL}/alphaedge-dashboard.html)_`,
      { parse_mode: 'MarkdownV2' }
    );
  });

  bot.onText(/\/account|💰 Account/i, async (msg) => {
    const user = await getUser(msg.from?.id);
    if (!user) return bot.sendMessage(msg.chat.id, '❌ No account connected\\. Use /connect', { parse_mode: 'MarkdownV2' });
    bot.sendMessage(msg.chat.id,
      `👤 *Your Account*\n\nName: ${esc(user.firstName)} ${esc(user.lastName)}\nPlan: *${esc(user.plan?.toUpperCase())}*\n\n[Dashboard](${FRONTEND_URL}/alphaedge-dashboard.html)`,
      { parse_mode: 'MarkdownV2' }
    );
  });

  bot.onText(/\/coin|🪙 AEC Coin/i, (msg) => {
    bot.sendMessage(msg.chat.id,
      `🪙 *AlphaEdge Coin \\(AEC\\)*\n\nLive on Solana via PumpFun\\.\n\n[AEC Page](${FRONTEND_URL}/alphaedge-coin.html) · [Buy AEC](https://join.pump.fun/HSag/kgc2fiaa)`,
      { parse_mode: 'MarkdownV2' }
    );
  });

  bot.onText(/\/help|❓ Help/i, (msg) => {
    bot.sendMessage(msg.chat.id,
      `❓ *Commands*\n\n/start /signals /markets\n/connect /account /coin /help\n\n[AlphaEdge](${FRONTEND_URL})`,
      { parse_mode: 'MarkdownV2' }
    );
  });

  bot.on('callback_query', async (query) => {
    bot.answerCallbackQuery(query.id).catch(() => {});
    const chatId = query.message.chat.id;
    if (query.data.startsWith('sig_')) {
      const market = query.data.replace('sig_', '');
      const user = await getUser(query.from?.id);
      if (!user || user.plan === 'free') {
        return bot.sendMessage(chatId, `🔒 Upgrade to Pro: ${FRONTEND_URL}/alphaedge-checkout.html`);
      }
      bot.sendMessage(chatId, formatSignals(market), { parse_mode: 'MarkdownV2' });
    }
  });

  console.log('[BOT] AlphaEdgeProBot is running!');
  return bot;
}

startBot().catch(err => console.error('[BOT] Fatal error:', err.message));
