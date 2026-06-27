require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();

app.use(cors({
  origin: ['https://alphaedgetrading.site', 'http://alphaedgetrading.site'],
  credentials: true
}));

// Raw body needed for IPN signature verification
app.use('/api/payments/ipn', express.raw({ type: 'application/json' }));
app.use(express.json());

const NOWPAYMENTS_API = 'https://api.nowpayments.io/v1';
const API_KEY = process.env.NOWPAYMENTS_API_KEY;
const IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET;
const FRONTEND_URL = process.env.CLIENT_URL || 'https://alphaedgetrading.site';

// ─────────────────────────────────────────────
// CREATE PAYMENT
// ─────────────────────────────────────────────
app.post('/api/payments/create', async (req, res) => {
  try {
    const { userId, currency, amount, description } = req.body;

    if (!userId || !currency || !amount) {
      return res.status(400).json({ error: 'userId, currency, and amount are required.' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // Create payment with NOWPayments
    const response = await axios.post(`${NOWPAYMENTS_API}/payment`, {
      price_amount: amount,
      price_currency: 'usd',
      pay_currency: currency.toLowerCase(),
      order_id: `ae_${userId}_${Date.now()}`,
      order_description: description || `AlphaEdge deposit — ${user.email}`,
      ipn_callback_url: `https://alphaedge-backend-uu13.onrender.com/api/payments/ipn`,
      success_url: `${FRONTEND_URL}/alphaedge-wallet.html?deposit=success`,
      cancel_url: `${FRONTEND_URL}/alphaedge-wallet.html?deposit=cancelled`,
    }, {
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json'
      }
    });

    const payment = response.data;

    // Store pending transaction in DB
    await prisma.transaction.create({
      data: {
        userId,
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
      expiresAt: payment.expiration_estimate_date,
    });

  } catch (err) {
    console.error('[PAYMENT CREATE ERROR]', err.response?.data || err.message);
    res.status(500).json({ error: 'Could not create payment. Please try again.' });
  }
});

// ─────────────────────────────────────────────
// GET PAYMENT STATUS
// ─────────────────────────────────────────────
app.get('/api/payments/status/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    const response = await axios.get(`${NOWPAYMENTS_API}/payment/${paymentId}`, {
      headers: { 'x-api-key': API_KEY }
    });
    res.json(response.data);
  } catch (err) {
    console.error('[PAYMENT STATUS ERROR]', err.message);
    res.status(500).json({ error: 'Could not fetch payment status.' });
  }
});

// ─────────────────────────────────────────────
// GET AVAILABLE CURRENCIES
// ─────────────────────────────────────────────
app.get('/api/payments/currencies', async (req, res) => {
  try {
    const response = await axios.get(`${NOWPAYMENTS_API}/currencies`, {
      headers: { 'x-api-key': API_KEY }
    });
    // Filter to most common ones
    const common = ['btc', 'eth', 'usdt', 'usdc', 'sol', 'bnb', 'xrp'];
    const filtered = response.data.currencies?.filter(c => common.includes(c.toLowerCase())) || common;
    res.json({ currencies: filtered });
  } catch (err) {
    console.error('[CURRENCIES ERROR]', err.message);
    res.json({ currencies: ['BTC', 'ETH', 'USDT', 'USDC', 'SOL'] });
  }
});

// ─────────────────────────────────────────────
// IPN WEBHOOK — NOWPayments notifies us when payment is confirmed
// ─────────────────────────────────────────────
app.post('/api/payments/ipn', async (req, res) => {
  try {
    // Verify IPN signature
    const receivedSig = req.headers['x-nowpayments-sig'];
    const body = req.body.toString();
    
    const hmac = crypto.createHmac('sha512', IPN_SECRET);
    const sortedBody = JSON.stringify(JSON.parse(body), Object.keys(JSON.parse(body)).sort());
    hmac.update(sortedBody);
    const expectedSig = hmac.digest('hex');

    if (receivedSig !== expectedSig) {
      console.error('[IPN] Invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const data = JSON.parse(body);
    console.log('[IPN] Payment notification:', data.payment_status, data.payment_id);

    // Only process confirmed/finished payments
    if (data.payment_status === 'finished' || data.payment_status === 'confirmed') {
      // Find the transaction
      const transaction = await prisma.transaction.findFirst({
        where: { txHash: data.payment_id?.toString() }
      });

      if (transaction && transaction.status !== 'completed') {
        // Update transaction status
        await prisma.transaction.update({
          where: { id: transaction.id },
          data: { status: 'completed', txHash: data.outcome_amount?.toString() }
        });

        // Update wallet balance
        const wallet = await prisma.wallet.findUnique({
          where: { userId: transaction.userId }
        });

        if (wallet) {
          const currency = transaction.currency.toLowerCase();
          const updateData = {};
          
          if (currency === 'btc') updateData.btcBalance = wallet.btcBalance + transaction.amount;
          else if (currency === 'eth') updateData.ethBalance = wallet.ethBalance + transaction.amount;
          else if (currency === 'usdc' || currency === 'usdt') updateData.usdcBalance = wallet.usdcBalance + transaction.usdValue;
          else if (currency === 'sol') updateData.solBalance = wallet.solBalance + transaction.amount;

          await prisma.wallet.update({
            where: { userId: transaction.userId },
            data: updateData
          });

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
// GET MINIMUM PAYMENT AMOUNT
// ─────────────────────────────────────────────
app.get('/api/payments/minimum/:currency', async (req, res) => {
  try {
    const { currency } = req.params;
    const response = await axios.get(
      `${NOWPAYMENTS_API}/min-amount?currency_from=${currency.toLowerCase()}&currency_to=usd`,
      { headers: { 'x-api-key': API_KEY } }
    );
    res.json(response.data);
  } catch (err) {
    res.json({ min_amount: 10 });
  }
});

// HEALTH CHECK
app.get('/health/payments', (req, res) => {
  res.json({ status: 'ok', service: 'payments' });
});

const PORT = process.env.PAYMENTS_PORT || 3003;
app.listen(PORT, () => {
  console.log(`AlphaEdge Payments API running on port ${PORT}`);
});

module.exports = app;
