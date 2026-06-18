/**
 * AlphaEdge — Stripe Subscription Backend
 * ────────────────────────────────────────
 * Stack: Node.js + Express + Stripe Node SDK
 *
 * Install:
 *   npm install express stripe cors dotenv
 *
 * .env file:
 *   STRIPE_SECRET_KEY=sk_live_...
 *   STRIPE_WEBHOOK_SECRET=whsec_...
 *   CLIENT_URL=https://yoursite.com
 */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

// ─── MIDDLEWARE ───────────────────────────────────────────────
// Raw body needed for webhook signature verification
app.use('/api/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(cors({ origin: process.env.CLIENT_URL }));


// ─── PRICE IDs ────────────────────────────────────────────────
// Create these in your Stripe Dashboard → Products
// Paste the price IDs here
const PRICES = {
  pro_monthly:   'price_YOUR_PRO_MONTHLY_ID',
  pro_annual:    'price_YOUR_PRO_ANNUAL_ID',
  elite_monthly: 'price_YOUR_ELITE_MONTHLY_ID',
  elite_annual:  'price_YOUR_ELITE_ANNUAL_ID',
};


// ─── CREATE SUBSCRIPTION ──────────────────────────────────────
// Called by the checkout page after user fills in the form.
// Returns a clientSecret so Stripe.js can collect the card securely.
app.post('/api/create-subscription', async (req, res) => {
  const { email, name, priceId, trial } = req.body;

  try {
    // 1. Create or retrieve Stripe Customer
    let customer;
    const existing = await stripe.customers.list({ email, limit: 1 });

    if (existing.data.length > 0) {
      customer = existing.data[0];
    } else {
      customer = await stripe.customers.create({ email, name });
    }

    // 2. Create subscription
    //    For trial plans (Pro monthly), add trial_period_days
    const subscriptionParams = {
      customer: customer.id,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent', 'pending_setup_intent'],
    };

    if (trial) {
      subscriptionParams.trial_period_days = 7;
    }

    const subscription = await stripe.subscriptions.create(subscriptionParams);

    // 3. Return the appropriate client secret
    //    - Trial subscriptions use SetupIntent (no charge yet)
    //    - Paid subscriptions use PaymentIntent
    if (trial && subscription.pending_setup_intent) {
      res.json({ clientSecret: subscription.pending_setup_intent.client_secret });
    } else {
      res.json({
        clientSecret: subscription.latest_invoice.payment_intent.client_secret,
      });
    }

  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(400).json({ error: err.message });
  }
});


// ─── CANCEL SUBSCRIPTION ──────────────────────────────────────
// Call this from your member dashboard "Cancel plan" button
app.post('/api/cancel-subscription', async (req, res) => {
  const { subscriptionId } = req.body;

  try {
    // Cancel at period end (subscriber keeps access until billing date)
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    res.json({ status: subscription.status, cancelAt: subscription.cancel_at });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ─── CHANGE PLAN ──────────────────────────────────────────────
// Upgrade Pro → Elite or switch monthly ↔ annual
app.post('/api/change-plan', async (req, res) => {
  const { subscriptionId, newPriceId } = req.body;

  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const currentItemId = subscription.items.data[0].id;

    const updated = await stripe.subscriptions.update(subscriptionId, {
      items: [{ id: currentItemId, price: newPriceId }],
      proration_behavior: 'create_prorations', // Charges/credits difference immediately
    });

    res.json({ status: updated.status, plan: updated.items.data[0].price.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ─── CUSTOMER PORTAL SESSION ──────────────────────────────────
// Opens Stripe's hosted portal for billing management
// (update card, download invoices, cancel — all handled by Stripe)
app.post('/api/customer-portal', async (req, res) => {
  const { customerId } = req.body;

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.CLIENT_URL}/dashboard`,
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ─── WEBHOOK HANDLER ──────────────────────────────────────────
// Stripe sends events here. Use these to update your database,
// grant/revoke access, send welcome emails, etc.
//
// Setup in Stripe Dashboard → Developers → Webhooks
// Events to listen for (minimum):
//   customer.subscription.created
//   customer.subscription.updated
//   customer.subscription.deleted
//   invoice.payment_succeeded
//   invoice.payment_failed
//   customer.subscription.trial_will_end

app.post('/api/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle events
  switch (event.type) {

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const plan = getPlanFromPriceId(sub.items.data[0].price.id);

      // TODO: update your database
      // db.users.update({ stripeCustomerId: sub.customer }, {
      //   subscriptionId: sub.id,
      //   plan,
      //   status: sub.status,   // 'active', 'trialing', 'past_due', 'canceled'
      //   currentPeriodEnd: new Date(sub.current_period_end * 1000),
      //   cancelAtPeriodEnd: sub.cancel_at_period_end,
      // });

      console.log(`Subscription ${sub.status} for customer ${sub.customer} — plan: ${plan}`);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;

      // TODO: revoke access in your database
      // db.users.update({ stripeCustomerId: sub.customer }, {
      //   plan: 'free',
      //   status: 'canceled',
      //   subscriptionId: null,
      // });

      console.log(`Subscription canceled for customer ${sub.customer}`);
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;

      // TODO: send receipt email, log payment
      // emailService.sendReceipt(invoice.customer_email, invoice.hosted_invoice_url);

      console.log(`Payment succeeded: $${invoice.amount_paid / 100} from ${invoice.customer_email}`);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;

      // TODO: send payment failure email, flag account
      // emailService.sendPaymentFailed(invoice.customer_email, invoice.hosted_invoice_url);

      console.warn(`Payment failed for ${invoice.customer_email}`);
      break;
    }

    case 'customer.subscription.trial_will_end': {
      const sub = event.data.object;
      const trialEndDate = new Date(sub.trial_end * 1000);

      // TODO: send "trial ending in 3 days" email
      // emailService.sendTrialEnding(sub.customer, trialEndDate);

      console.log(`Trial ending ${trialEndDate.toDateString()} for customer ${sub.customer}`);
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});


// ─── HELPERS ──────────────────────────────────────────────────
function getPlanFromPriceId(priceId) {
  const map = {
    [PRICES.pro_monthly]:   'pro',
    [PRICES.pro_annual]:    'pro',
    [PRICES.elite_monthly]: 'elite',
    [PRICES.elite_annual]:  'elite',
  };
  return map[priceId] || 'free';
}


// ─── START ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`AlphaEdge API running on port ${PORT}`));


/**
 * ════════════════════════════════════════════════
 * SETUP CHECKLIST
 * ════════════════════════════════════════════════
 *
 * 1. STRIPE DASHBOARD SETUP
 *    ├── Create product "AlphaEdge Pro"
 *    │     - Monthly price: $49/mo  → copy price ID → PRICES.pro_monthly
 *    │     - Annual price:  $470/yr → copy price ID → PRICES.pro_annual
 *    ├── Create product "AlphaEdge Elite"
 *    │     - Monthly price: $149/mo → copy price ID → PRICES.elite_monthly
 *    │     - Annual price:  $1,430/yr → copy price ID → PRICES.elite_annual
 *    └── Enable Customer Portal (Billing → Customer portal → Activate)
 *
 * 2. ENVIRONMENT VARIABLES
 *    STRIPE_SECRET_KEY=sk_live_...        (from Stripe Dashboard → API Keys)
 *    STRIPE_WEBHOOK_SECRET=whsec_...      (from Dashboard → Webhooks → signing secret)
 *    CLIENT_URL=https://alphaedge.com
 *
 * 3. WEBHOOK ENDPOINT
 *    Register: https://yourapi.com/api/webhook
 *    Events:
 *      ✓ customer.subscription.created
 *      ✓ customer.subscription.updated
 *      ✓ customer.subscription.deleted
 *      ✓ invoice.payment_succeeded
 *      ✓ invoice.payment_failed
 *      ✓ customer.subscription.trial_will_end
 *
 * 4. CHECKOUT PAGE
 *    Replace in alphaedge-checkout.html:
 *      STRIPE_CONFIG.publishableKey = 'pk_live_...'
 *      STRIPE_CONFIG.backendUrl = 'https://yourapi.com/api/create-subscription'
 *      STRIPE_CONFIG.prices = { ... } (same IDs as above)
 *
 * 5. DATABASE SCHEMA (add to your users table)
 *    stripe_customer_id   VARCHAR
 *    subscription_id      VARCHAR
 *    plan                 ENUM('free', 'pro', 'elite')
 *    subscription_status  ENUM('active', 'trialing', 'past_due', 'canceled')
 *    current_period_end   TIMESTAMP
 *    cancel_at_period_end BOOLEAN
 *
 * 6. TEST CARDS (Stripe test mode)
 *    Success:  4242 4242 4242 4242
 *    Decline:  4000 0000 0000 0002
 *    3D Secure: 4000 0027 6000 3184
 *    Any future expiry, any CVC
 *
 * ════════════════════════════════════════════════
 */