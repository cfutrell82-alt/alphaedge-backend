require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cors = require('cors');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();

app.use(cors({
  origin: ['https://alphaedgetrading.site', 'http://alphaedgetrading.site', 'https://cfutrell82-alt.github.io'],
  credentials: true
}));

app.use('/api/payments/ipn', express.raw({ type: 'application/json' }));
app.use(express.json());

const NOWPAYMENTS_API = 'https://api.nowpayments.io/v1';
const FRONTEND_URL = process.env.CLIENT_URL || 'https://alphaedgetrading.site';

// ─────────────────────────────────────────────
// EMAIL TRANSPORTER
// ─────────────────────────────────────────────
const port = parseInt(process.env.EMAIL_PORT) || 465;
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.resend.com',
  port: port,
  secure: port === 465,
  auth: {
    user: process.env.EMAIL_USER || 'resend',
    pass: process.env.EMAIL_PASS,
  },
});

// Verify transporter on startup
transporter.verify((error, success) => {
  if (error) {
    console.error('[EMAIL] SMTP connection failed:', error.message);
  } else {
    console.log('[EMAIL] SMTP ready to send emails');
  }
});

const FROM = process.env.EMAIL_FROM || 'support@alphaedgetrading.site';

async function sendEmail(to, subject, html) {
  if (!process.env.EMAIL_PASS) {
    console.log(`[EMAIL] Skipped (no EMAIL_PASS): ${subject} → ${to}`);
    return;
  }
  try {
    await transporter.sendMail({ from: `AlphaEdge <${FROM}>`, to, subject, html });
    console.log(`[EMAIL] Sent: ${subject} → ${to}`);
  } catch (err) {
    console.error(`[EMAIL] Failed: ${err.message}`);
  }
}

function welcomeEmail(firstName) {
  return `
  <!DOCTYPE html>
  <html>
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
  <body style="margin:0;padding:0;background:#050816;font-family:'Inter',sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
      <div style="text-align:center;margin-bottom:32px;">
        <img src="https://alphaedgetrading.site/alphaedge-coin.png" alt="AlphaEdge" style="width:60px;height:60px;border-radius:50%;box-shadow:0 0 20px rgba(247,201,72,0.8);">
        <h1 style="font-family:'Space Grotesk',sans-serif;color:#fdfdff;font-size:1.8rem;margin:16px 0 4px;">Welcome to <span style="background:linear-gradient(90deg,#f7c948,#00e5ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">AlphaEdge</span></h1>
        <p style="color:#b7c0e8;font-size:0.9rem;">Your trading edge starts now.</p>
      </div>
      <div style="background:#0b1630;border:1px solid #24335f;border-radius:16px;padding:32px;margin-bottom:24px;">
        <p style="color:#fdfdff;font-size:1rem;margin-bottom:16px;">Hey ${firstName} 👋</p>
        <p style="color:#b7c0e8;line-height:1.7;margin-bottom:20px;">Your AlphaEdge account is ready. You're now on the <strong style="color:#00e5ff;">Free plan</strong> — here's what you have access to:</p>
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:24px;">
          <div style="color:#b7c0e8;font-size:0.9rem;">✅ 2 daily signals (stocks & crypto)</div>
          <div style="color:#b7c0e8;font-size:0.9rem;">✅ Paper trading terminal with $100K</div>
          <div style="color:#b7c0e8;font-size:0.9rem;">✅ Crypto wallet</div>
          <div style="color:#b7c0e8;font-size:0.9rem;">✅ Community access</div>
        </div>
        <a href="${FRONTEND_URL}/alphaedge-dashboard.html" style="display:block;text-align:center;padding:14px 28px;background:linear-gradient(90deg,#f7c948,#00e5ff);color:#02040a;border-radius:10px;font-weight:700;font-size:1rem;text-decoration:none;">Open My Dashboard →</a>
      </div>
      <div style="background:#0b1630;border:1px solid rgba(247,201,72,0.25);border-radius:16px;padding:24px;margin-bottom:24px;text-align:center;">
        <p style="color:#f7c948;font-weight:700;margin-bottom:8px;">🪙 AlphaEdge Coin (AEC) is live!</p>
        <p style="color:#b7c0e8;font-size:0.85rem;margin-bottom:16px;">The official AlphaEdge token is now on Solana via PumpFun.</p>
        <a href="${FRONTEND_URL}/alphaedge-coin.html" style="padding:10px 22px;background:linear-gradient(90deg,#f7c948,#ff9f1c);color:#02040a;border-radius:8px;font-weight:700;font-size:0.85rem;text-decoration:none;">View AEC Coin →</a>
      </div>
      <div style="text-align:center;padding-top:20px;border-top:1px solid #24335f;">
        <p style="color:#3A4A6B;font-size:0.78rem;">Not financial advice. Trade responsibly.<br>© 2026 AlphaEdge · <a href="${FRONTEND_URL}/alphaedge-terms.html" style="color:#3A4A6B;">Terms</a> · <a href="${FRONTEND_URL}/alphaedge-privacy.html" style="color:#3A4A6B;">Privacy</a></p>
      </div>
    </div>
  </body>
  </html>`;
}

function resetEmail(firstName, resetLink) {
  return `
  <!DOCTYPE html>
  <html>
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
  <body style="margin:0;padding:0;background:#050816;font-family:'Inter',sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
      <div style="text-align:center;margin-bottom:32px;">
        <img src="https://alphaedgetrading.site/alphaedge-coin.png" alt="AlphaEdge" style="width:60px;height:60px;border-radius:50%;box-shadow:0 0 20px rgba(247,201,72,0.8);">
        <h1 style="font-family:'Space Grotesk',sans-serif;color:#fdfdff;font-size:1.6rem;margin:16px 0 4px;">Password Reset</h1>
      </div>
      <div style="background:#0b1630;border:1px solid #24335f;border-radius:16px;padding:32px;margin-bottom:24px;">
        <p style="color:#fdfdff;font-size:1rem;margin-bottom:16px;">Hey ${firstName},</p>
        <p style="color:#b7c0e8;line-height:1.7;margin-bottom:24px;">We received a request to reset your AlphaEdge password. Click the button below to set a new one. This link expires in <strong style="color:#f7c948;">30 minutes</strong>.</p>
        <a href="${resetLink}" style="display:block;text-align:center;padding:14px 28px;background:linear-gradient(90deg,#f7c948,#00e5ff);color:#02040a;border-radius:10px;font-weight:700;font-size:1rem;text-decoration:none;margin-bottom:20px;">Reset My Password →</a>
        <p style="color:#3A4A6B;font-size:0.8rem;text-align:center;">If you didn't request this, you can safely ignore this email. Your password won't change.</p>
      </div>
      <div style="text-align:center;padding-top:20px;border-top:1px solid #24335f;">
        <p style="color:#3A4A6B;font-size:0.78rem;">© 2026 AlphaEdge · <a href="${FRONTEND_URL}/alphaedge-terms.html" style="color:#3A4A6B;">Terms</a> · <a href="${FRONTEND_URL}/alphaedge-privacy.html" style="color:#3A4A6B;">Privacy</a></p>
      </div>
    </div>
  </body>
  </html>`;
}

function signalAlertEmail(firstName, signals) {
  const rows = signals.map(s => `
    <tr style="border-bottom:1px solid #24335f;">
      <td style="padding:12px 16px;color:#fdfdff;font-weight:700;">${s.ticker}</td>
      <td style="padding:12px 16px;"><span style="background:${s.action==='BUY'?'rgba(0,230,118,0.15)':'rgba(255,75,75,0.15)'};color:${s.action==='BUY'?'#00E676':'#FF4B4B'};padding:3px 10px;border-radius:5px;font-size:0.82rem;font-weight:700;">${s.action}</span></td>
      <td style="padding:12px 16px;color:#b7c0e8;font-family:monospace;">${s.entry}</td>
      <td style="padding:12px 16px;color:#00E676;font-family:monospace;">${s.tp}</td>
      <td style="padding:12px 16px;color:#FF4B4B;font-family:monospace;">${s.sl}</td>
    </tr>`).join('');
  return `
  <!DOCTYPE html>
  <html>
  <head><meta charset="UTF-8"></head>
  <body style="margin:0;padding:0;background:#050816;font-family:'Inter',sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
      <div style="text-align:center;margin-bottom:24px;">
        <img src="https://alphaedgetrading.site/alphaedge-coin.png" alt="AlphaEdge" style="width:48px;height:48px;border-radius:50%;">
        <h1 style="color:#fdfdff;font-size:1.4rem;margin:12px 0 4px;">⚡ New AlphaEdge Signals</h1>
        <p style="color:#b7c0e8;font-size:0.85rem;">Hey ${firstName} — fresh signals just dropped.</p>
      </div>
      <div style="background:#0b1630;border:1px solid #24335f;border-radius:16px;overflow:hidden;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="border-bottom:1px solid #24335f;"><th style="padding:10px 16px;text-align:left;color:#b7c0e8;font-size:0.72rem;text-transform:uppercase;">Asset</th><th style="padding:10px 16px;text-align:left;color:#b7c0e8;font-size:0.72rem;text-transform:uppercase;">Signal</th><th style="padding:10px 16px;text-align:left;color:#b7c0e8;font-size:0.72rem;text-transform:uppercase;">Entry</th><th style="padding:10px 16px;text-align:left;color:#b7c0e8;font-size:0.72rem;text-transform:uppercase;">Target</th><th style="padding:10px 16px;text-align:left;color:#b7c0e8;font-size:0.72rem;text-transform:uppercase;">Stop</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <a href="${FRONTEND_URL}/alphaedge-dashboard.html" style="display:block;text-align:center;padding:13px;background:linear-gradient(90deg,#f7c948,#00e5ff);color:#02040a;border-radius:10px;font-weight:700;text-decoration:none;margin-bottom:16px;">View All Signals →</a>
      <p style="color:#3A4A6B;font-size:0.75rem;text-align:center;">Not financial advice. Trade responsibly. © 2026 AlphaEdge</p>
    </div>
  </body>
  </html>`;
}

// ─────────────────────────────────────────────
// JWT HELPERS
// ─────────────────────────────────────────────
function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
}
function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    prisma.user.findUnique({ where: { id: decoded.userId } }).then(user => {
      if (!user) return res.status(401).json({ error: 'User not found.' });
      if (user.status === 'suspended') return res.status(403).json({ error: 'Account suspended.' });
      req.user = user;
      next();
    });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// ─────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;
    if (!firstName || !lastName) return res.status(400).json({ error: 'First and last name are required.' });
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email is required.' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const verifyToken = crypto.randomBytes(32).toString('hex');

    const user = await prisma.user.create({
      data: { firstName, lastName, email: email.toLowerCase(), passwordHash, plan: 'free', status: 'active', emailVerified: false, verifyToken }
    });
    await prisma.wallet.create({ data: { userId: user.id } });

    // Send welcome email
    await sendEmail(email, 'Welcome to AlphaEdge! 🚀', welcomeEmail(firstName));

    console.log(`[SIGNUP] New user: ${email}`);
    const token = signToken(user.id);
    res.status(201).json({ token, user: safeUser(user), message: 'Account created successfully!' });
  } catch (err) {
    console.error('[SIGNUP ERROR]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return res.status(401).json({ error: 'Incorrect email or password.' });
    if (user.status === 'suspended') return res.status(403).json({ error: 'This account has been suspended.' });

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) return res.status(401).json({ error: 'Incorrect email or password.' });

    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
    const token = signToken(user.id);
    res.json({ token, user: safeUser(user) });
  } catch (err) {
    console.error('[LOGIN ERROR]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: safeUser(req.user) });
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return res.json({ message: 'If an account exists, a reset link has been sent.' });

  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetExpires = new Date(Date.now() + 30 * 60 * 1000);
  await prisma.user.update({ where: { id: user.id }, data: { resetToken, resetExpires } });

  const resetLink = `${FRONTEND_URL}/alphaedge-reset-password.html?token=${resetToken}`;
  await sendEmail(email, 'Reset your AlphaEdge password', resetEmail(user.firstName, resetLink));

  console.log(`[PASSWORD RESET] Sent to ${email}`);
  res.json({ message: 'If an account exists, a reset link has been sent.' });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and new password are required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const user = await prisma.user.findFirst({ where: { resetToken: token } });
  if (!user) return res.status(400).json({ error: 'Reset link is invalid or has already been used.' });
  if (new Date() > new Date(user.resetExpires)) return res.status(400).json({ error: 'Reset link has expired.' });

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash, resetToken: null, resetExpires: null } });
  res.json({ message: 'Password updated successfully. You can now log in.' });
});

app.post('/api/user/update-plan', async (req, res) => {
  const { userId, plan } = req.body;
  if (!userId || !plan) return res.status(400).json({ error: 'userId and plan are required.' });
  await prisma.user.update({ where: { id: userId }, data: { plan } });
  res.json({ message: 'Plan updated.' });
});

// Google OAuth routes defined below

// ─────────────────────────────────────────────
// WALLET ROUTES
// ─────────────────────────────────────────────
app.get('/api/wallet', requireAuth, async (req, res) => {
  try {
    let wallet = await prisma.wallet.findUnique({ where: { userId: req.user.id } });
    if (!wallet) wallet = await prisma.wallet.create({ data: { userId: req.user.id } });
    const transactions = await prisma.transaction.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    res.json({ wallet, transactions });
  } catch (err) {
    console.error('[WALLET ERROR]', err);
    res.status(500).json({ error: 'Could not load wallet.' });
  }
});

// ─────────────────────────────────────────────
// PAYMENTS ROUTES
// ─────────────────────────────────────────────
app.post('/api/payments/create', requireAuth, async (req, res) => {
  try {
    const { currency, amount, description } = req.body;
    if (!currency || !amount) return res.status(400).json({ error: 'currency and amount are required.' });

    const response = await axios.post(`${NOWPAYMENTS_API}/payment`, {
      price_amount: amount,
      price_currency: 'usd',
      pay_currency: currency.toLowerCase(),
      order_id: `ae_${req.user.id}_${Date.now()}`,
      order_description: description || `AlphaEdge deposit — ${req.user.email}`,
      ipn_callback_url: `https://alphaedge-backend-production.up.railway.app/api/payments/ipn`,
      success_url: `${FRONTEND_URL}/alphaedge-wallet.html?deposit=success`,
      cancel_url: `${FRONTEND_URL}/alphaedge-wallet.html?deposit=cancelled`,
    }, {
      headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY, 'Content-Type': 'application/json' }
    });

    const payment = response.data;
    await prisma.transaction.create({
      data: {
        userId: req.user.id,
        type: 'deposit',
        currency: currency.toUpperCase(),
        amount: parseFloat(payment.pay_amount || 0),
        usdValue: parseFloat(amount),
        status: 'pending',
        txHash: payment.payment_id?.toString(),
      }
    });

    res.json({
      paymentId: payment.payment_id,
      payAddress: payment.pay_address,
      payAmount: payment.pay_amount,
      payCurrency: payment.pay_currency,
      status: payment.payment_status,
    });
  } catch (err) {
    console.error('[PAYMENT CREATE ERROR]', err.response?.data || err.message);
    res.status(500).json({ error: 'Could not create payment. Please try again.' });
  }
});

app.get('/api/payments/currencies', async (req, res) => {
  try {
    const response = await axios.get(`${NOWPAYMENTS_API}/currencies`, {
      headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY }
    });
    const common = ['btc', 'eth', 'usdt', 'usdc', 'sol', 'bnb', 'xrp'];
    const filtered = response.data.currencies?.filter(c => common.includes(c.toLowerCase())) || common;
    res.json({ currencies: filtered });
  } catch (err) {
    res.json({ currencies: ['BTC', 'ETH', 'USDT', 'USDC', 'SOL'] });
  }
});

app.post('/api/payments/ipn', async (req, res) => {
  try {
    const receivedSig = req.headers['x-nowpayments-sig'];
    const body = req.body.toString();
    const hmac = crypto.createHmac('sha512', process.env.NOWPAYMENTS_IPN_SECRET || '');
    const sortedBody = JSON.stringify(JSON.parse(body), Object.keys(JSON.parse(body)).sort());
    hmac.update(sortedBody);
    const expectedSig = hmac.digest('hex');

    if (receivedSig !== expectedSig) {
      console.error('[IPN] Invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const data = JSON.parse(body);
    if (data.payment_status === 'finished' || data.payment_status === 'confirmed') {
      const transaction = await prisma.transaction.findFirst({ where: { txHash: data.payment_id?.toString() } });
      if (transaction && transaction.status !== 'completed') {
        await prisma.transaction.update({ where: { id: transaction.id }, data: { status: 'completed' } });
        const wallet = await prisma.wallet.findUnique({ where: { userId: transaction.userId } });
        if (wallet) {
          const currency = transaction.currency.toLowerCase();
          const updateData = {};
          if (currency === 'btc') updateData.btcBalance = wallet.btcBalance + transaction.amount;
          else if (currency === 'eth') updateData.ethBalance = wallet.ethBalance + transaction.amount;
          else if (currency === 'usdc' || currency === 'usdt') updateData.usdcBalance = wallet.usdcBalance + transaction.usdValue;
          else if (currency === 'sol') updateData.solBalance = wallet.solBalance + transaction.amount;
          await prisma.wallet.update({ where: { userId: transaction.userId }, data: updateData });
        }
      }
    }
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('[IPN ERROR]', err.message);
    res.status(500).json({ error: 'IPN processing failed' });
  }
});

// ─────────────────────────────────────────────
// SIGNAL EMAIL BROADCAST (internal use)
// ─────────────────────────────────────────────
app.post('/api/signals/broadcast-email', async (req, res) => {
  try {
    const { secret, signals } = req.body;
    if (secret !== process.env.SIGNAL_SECRET) return res.status(401).json({ error: 'Unauthorized' });

    const users = await prisma.user.findMany({
      where: { plan: { in: ['pro', 'elite'] }, status: 'active' }
    });

    let sent = 0;
    for (const user of users) {
      await sendEmail(user.email, `⚡ ${signals.length} New AlphaEdge Signals`, signalAlertEmail(user.firstName, signals));
      sent++;
    }
    res.json({ message: `Emails sent to ${sent} users` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function safeUser(user) {
  const { passwordHash, verifyToken, resetToken, resetExpires, ...safe } = user;
  return safe;
}


// ─────────────────────────────────────────────
// TELEGRAM WEBHOOK ENDPOINT
// ─────────────────────────────────────────────
app.post('/telegram-webhook', async (req, res) => {
  try {
    const update = req.body;
    console.log('[WEBHOOK] Update received:', JSON.stringify(update).substring(0, 100));
    res.status(200).json({ ok: true });
  } catch(err) {
    console.error('[WEBHOOK] Error:', err.message);
    res.status(200).json({ ok: true });
  }
});


app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'alphaedge-api', uptime: process.uptime() });
});

async function main() {
  try {
    await prisma.$connect();
    console.log('[DB] Connected to PostgreSQL');
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
  }
}
main();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AlphaEdge Auth API running on port ${PORT}`);
});

// ─────────────────────────────────────────────
// GOOGLE OAUTH
// ─────────────────────────────────────────────
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT = 'https://alphaedge-backend-production.up.railway.app/api/auth/google/callback';

app.get('/api/auth/google', (req, res) => {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account'
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect(`${FRONTEND_URL}/alphaedge-login.html?error=google_failed`);
  try {
    // Exchange code for tokens
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT,
      grant_type: 'authorization_code'
    });
    const { access_token } = tokenRes.data;

    // Get user info
    const userRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const { email, given_name, family_name, picture } = userRes.data;

    // Find or create user
    let user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          firstName: given_name || 'User',
          lastName: family_name || '',
          email: email.toLowerCase(),
          passwordHash: await require('bcryptjs').hash(crypto.randomBytes(32).toString('hex'), 12),
          plan: 'free',
          status: 'active',
          emailVerified: true,
          avatar: picture || null
        }
      });
      await prisma.wallet.create({ data: { userId: user.id } });
      await sendEmail(email, 'Welcome to AlphaEdge! 🚀', welcomeEmail(given_name || 'Trader'));
      console.log(`[GOOGLE AUTH] New user: ${email}`);
    } else {
      console.log(`[GOOGLE AUTH] Existing user: ${email}`);
    }

    const token = signToken(user.id);
    // Redirect to dashboard with token
    res.redirect(`${FRONTEND_URL}/alphaedge-dashboard.html?token=${token}&user=${encodeURIComponent(JSON.stringify(safeUser(user)))}`);
  } catch(err) {
    console.error('[GOOGLE AUTH ERROR]', err.message);
    res.redirect(`${FRONTEND_URL}/alphaedge-login.html?error=google_failed`);
  }
});
