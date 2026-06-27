require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cors = require('cors');
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();

app.use(cors({
  origin: ['https://alphaedgetrading.site', 'http://alphaedgetrading.site', 'https://cfutrell82-alt.github.io'],
  credentials: true
}));

// Raw body for IPN webhook
app.use('/api/payments/ipn', express.raw({ type: 'application/json' }));
app.use(express.json());

const NOWPAYMENTS_API = 'https://api.nowpayments.io/v1';
const FRONTEND_URL = process.env.CLIENT_URL || 'https://alphaedgetrading.site';

// JWT HELPERS
function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

// AUTH MIDDLEWARE
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
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

// SIGN UP
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

    console.log(`[SIGNUP] New user: ${email}`);
    const token = signToken(user.id);
    res.status(201).json({ token, user: safeUser(user), message: 'Account created successfully!' });
  } catch (err) {
    console.error('[SIGNUP ERROR]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// LOG IN
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

// GET CURRENT USER
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: safeUser(req.user) });
});

// FORGOT PASSWORD
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return res.json({ message: 'If an account exists, a reset link has been sent.' });
  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetExpires = new Date(Date.now() + 30 * 60 * 1000);
  await prisma.user.update({ where: { id: user.id }, data: { resetToken, resetExpires } });
  console.log(`[PASSWORD RESET] Token for ${email}: ${resetToken}`);
  res.json({ message: 'If an account exists, a reset link has been sent.' });
});

// RESET PASSWORD
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

// UPDATE PLAN
app.post('/api/user/update-plan', async (req, res) => {
  const { userId, plan } = req.body;
  if (!userId || !plan) return res.status(400).json({ error: 'userId and plan are required.' });
  await prisma.user.update({ where: { id: userId }, data: { plan } });
  res.json({ message: 'Plan updated.' });
});

// GOOGLE OAUTH scaffold
app.get('/api/auth/google', (req, res) => {
  res.status(501).json({ error: 'Google OAuth not yet configured.' });
});

// ─────────────────────────────────────────────
// WALLET ROUTES
// ─────────────────────────────────────────────

// GET WALLET
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
// PAYMENTS ROUTES (NOWPayments)
// ─────────────────────────────────────────────

// CREATE PAYMENT
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
      ipn_callback_url: `https://alphaedge-backend-uu13.onrender.com/api/payments/ipn`,
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

// GET PAYMENT STATUS
app.get('/api/payments/status/:paymentId', requireAuth, async (req, res) => {
  try {
    const response = await axios.get(`${NOWPAYMENTS_API}/payment/${req.params.paymentId}`, {
      headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY }
    });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch payment status.' });
  }
});

// GET CURRENCIES
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

// IPN WEBHOOK
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
    console.log('[IPN] Payment:', data.payment_status, data.payment_id);

    if (data.payment_status === 'finished' || data.payment_status === 'confirmed') {
      const transaction = await prisma.transaction.findFirst({
        where: { txHash: data.payment_id?.toString() }
      });

      if (transaction && transaction.status !== 'completed') {
        await prisma.transaction.update({
          where: { id: transaction.id },
          data: { status: 'completed' }
        });

        const wallet = await prisma.wallet.findUnique({ where: { userId: transaction.userId } });
        if (wallet) {
          const currency = transaction.currency.toLowerCase();
          const updateData = {};
          if (currency === 'btc') updateData.btcBalance = wallet.btcBalance + transaction.amount;
          else if (currency === 'eth') updateData.ethBalance = wallet.ethBalance + transaction.amount;
          else if (currency === 'usdc' || currency === 'usdt') updateData.usdcBalance = wallet.usdcBalance + transaction.usdValue;
          else if (currency === 'sol') updateData.solBalance = wallet.solBalance + transaction.amount;
          await prisma.wallet.update({ where: { userId: transaction.userId }, data: updateData });
          console.log(`[IPN] Wallet updated for user ${transaction.userId}`);
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
// HELPERS
// ─────────────────────────────────────────────
function safeUser(user) {
  const { passwordHash, verifyToken, resetToken, resetExpires, ...safe } = user;
  return safe;
}

// HEALTH CHECK
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'alphaedge-api', uptime: process.uptime() });
});

// DB CONNECT
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
