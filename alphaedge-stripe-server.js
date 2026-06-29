/**
 * ─────────────────────────────────────────────────────────────
 * alphaedge-stripe-server.js — LIVE KEYS VERSION
 * ─────────────────────────────────────────────────────────────
 *
 * .env variables needed:
 *   STRIPE_SECRET_KEY=sk_live_...          (Dashboard → Developers → API keys)
 *   STRIPE_WEBHOOK_SECRET=whsec_...        (Dashboard → Developers → Webhooks → signing secret)
 *   STRIPE_PRICE_PRO=price_live_...        (Dashboard → Products → Pro plan price ID)
 *   STRIPE_PRICE_ELITE=price_live_...      (Dashboard → Products → Elite plan price ID)
 *   SIGNAL_SECRET=...                      (same value as in alphaedge-signals.js)
 *   CLIENT_URL=https://alphaedgetrading.site
 *   AUTH_API_URL=http://localhost:3000     (internal URL for alphaedge-auth.js)
 *   SIGNALS_API_URL=http://localhost:3002  (internal URL for alphaedge-signals.js)
 *
 * Stripe Dashboard setup:
 *   1. Create two Products: "AlphaEdge Pro" ($49/mo) and "AlphaEdge Elite" ($149/mo)
 *   2. Set Billing → Payment methods → Cards ON, disable test mode
 *   3. Webhooks → Add endpoint:
 *        URL: https://alphaedge-backend-uu13.onrender.com/stripe/webhook
 *        Events to listen for (select all of these):
 *          checkout.session.completed
 *          customer.subscription.created
 *          customer.subscription.updated
 *          customer.subscription.deleted
 *          invoice.payment_succeeded
 *          invoice.payment_failed
 * ─────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const express = require('express');
const Stripe  = require('stripe');
const axios   = require('axios');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const app    = express();

const FRONTEND_URL   = process.env.CLIENT_URL        || 'https://alphaedgetrading.site';
const AUTH_API       = process.env.AUTH_API_URL      || 'http://localhost:3000';
const SIGNALS_API    = process.env.SIGNALS_API_URL   || 'http://localhost:3002';
const SIGNAL_SECRET  = process.env.SIGNAL_SECRET;

// ── Raw body needed for Stripe webhook signature verification ──
app.use('/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ─────────────────────────────────────────────
// PRICE ID → PLAN NAME MAP
// ─────────────────────────────────────────────
function planFromPriceId(priceId) {
  const map = {
    [process.env.STRIPE_PRICE_PRO]:   'pro',
    [process.env.STRIPE_PRICE_ELITE]: 'elite',
  };
  return map[priceId] || 'free';
}

// ─────────────────────────────────────────────
// CREATE CHECKOUT SESSION
// ─────────────────────────────────────────────
app.post('/stripe/checkout', async (req, res) => {
  const { plan, userId, userEmail, telegramUserId } = req.body;

  if (!plan || !userId) {
    return res.status(400).json({ error: 'plan and userId are required.' });
  }

  const priceId = plan === 'elite'
    ? process.env.STRIPE_PRICE_ELITE
    : process.env.STRIPE_PRICE_PRO;

  if (!priceId) {
    return res.status(500).json({ error: `No price ID configured for plan: ${plan}` });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode:               'subscription',
      payment_method_types: ['card'],
      customer_email:     userEmail,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        userId,                            // AlphaEdge DB user ID
        plan,
        telegramUserId: telegramUserId || '', // for Telegram channel invite
      },
      subscription_data: {
        metadata: { userId, plan, telegramUserId: telegramUserId || '' },
      },
      success_url: `${FRONTEND_URL}/alphaedge-dashboard.html?sub=success&plan=${plan}`,
      cancel_url:  `${FRONTEND_URL}/alphaedge-checkout.html?sub=cancelled`,
    });

    console.log(`[CHECKOUT] Session created: ${session.id} | ${userEmail} | ${plan}`);
    res.json({ url: session.url });
  } catch (err) {
    console.error('[CHECKOUT ERROR]', err.message);
    res.status(500).json({ error: 'Could not create checkout session.' });
  }
});

// ─────────────────────────────────────────────
// CUSTOMER PORTAL (manage/cancel subscription)
// ─────────────────────────────────────────────
app.post('/stripe/portal', async (req, res) => {
  const { stripeCustomerId } = req.body;
  if (!stripeCustomerId) return res.status(400).json({ error: 'stripeCustomerId required.' });

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer:   stripeCustomerId,
      return_url: `${FRONTEND_URL}/alphaedge-dashboard.html`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('[PORTAL ERROR]', err.message);
    res.status(500).json({ error: 'Could not open billing portal.' });
  }
});

// ─────────────────────────────────────────────
// STRIPE WEBHOOK — the core event handler
// ─────────────────────────────────────────────
app.post('/stripe/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[WEBHOOK] Signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  console.log(`[WEBHOOK] Event: ${event.type}`);

  try {
    switch (event.type) {

      // ── Checkout completed → activate subscription ──────────
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription') break;

        const { userId, plan, telegramUserId } = session.metadata;
        const stripeCustomerId = session.customer;
        const subscriptionId   = session.subscription;

        // 1. Update plan in our DB
        await updateUserPlan(userId, plan, stripeCustomerId, subscriptionId);

        // 2. Grant Telegram channel access
        if (telegramUserId) {
          await grantTelegramAccess(telegramUserId, plan);
        }

        console.log(`[WEBHOOK] Subscription activated: user=${userId} plan=${plan}`);
        break;
      }

      // ── Subscription updated (plan change / renewal) ─────────
      case 'customer.subscription.updated': {
        const sub    = event.data.object;
        const userId = sub.metadata?.userId;
        if (!userId) break;

        const priceId = sub.items.data[0]?.price?.id;
        const plan    = planFromPriceId(priceId);
        const status  = sub.status; // active, past_due, canceled, etc.

        if (status === 'active') {
          await updateUserPlan(userId, plan, sub.customer, sub.id);
          console.log(`[WEBHOOK] Subscription updated: user=${userId} plan=${plan}`);
        } else if (status === 'past_due') {
          console.warn(`[WEBHOOK] Payment past due: user=${userId}`);
          // Optionally: send payment reminder email here
        }
        break;
      }

      // ── Subscription cancelled → downgrade to free ───────────
      case 'customer.subscription.deleted': {
        const sub              = event.data.object;
        const userId           = sub.metadata?.userId;
        const telegramUserId   = sub.metadata?.telegramUserId;
        const priceId          = sub.items.data[0]?.price?.id;
        const plan             = planFromPriceId(priceId);

        if (userId) {
          await updateUserPlan(userId, 'free', sub.customer, null);
          console.log(`[WEBHOOK] Subscription cancelled: user=${userId} → downgraded to free`);
        }

        // Revoke Telegram access
        if (telegramUserId && plan !== 'free') {
          await revokeTelegramAccess(telegramUserId, plan);
        }
        break;
      }

      // ── Invoice paid → log renewal ───────────────────────────
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (invoice.billing_reason === 'subscription_cycle') {
          console.log(`[WEBHOOK] Subscription renewed: customer=${invoice.customer} amount=$${(invoice.amount_paid / 100).toFixed(2)}`);
          // Optionally: send renewal confirmation email
        }
        break;
      }

      // ── Invoice failed → warn user ────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        console.error(`[WEBHOOK] Payment FAILED: customer=${invoice.customer} attempt=${invoice.attempt_count}`);
        // Optionally: trigger a "payment failed" email to the user
        break;
      }

      default:
        // Silently ignore unhandled event types
        break;
    }
  } catch (err) {
    console.error(`[WEBHOOK] Handler error for ${event.type}:`, err.message);
    // Still return 200 to prevent Stripe from retrying a broken handler
  }

  res.status(200).json({ received: true });
});

// ─────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────

async function updateUserPlan(userId, plan, stripeCustomerId, subscriptionId) {
  try {
    await axios.post(`${AUTH_API}/api/user/update-plan`, {
      userId,
      plan,
      stripeCustomerId,
      subscriptionId,
    });
  } catch (err) {
    console.error(`[STRIPE] updateUserPlan failed for user ${userId}:`, err.message);
  }
}

async function grantTelegramAccess(telegramUserId, plan) {
  try {
    await axios.post(`${SIGNALS_API}/api/grant-access`, {
      telegramUserId,
      plan,
      secret: SIGNAL_SECRET,
    });
  } catch (err) {
    console.error(`[STRIPE] grantTelegramAccess failed:`, err.message);
  }
}

async function revokeTelegramAccess(telegramUserId, plan) {
  try {
    await axios.post(`${SIGNALS_API}/api/revoke-access`, {
      telegramUserId,
      plan,
      secret: SIGNAL_SECRET,
    });
  } catch (err) {
    console.error(`[STRIPE] revokeTelegramAccess failed:`, err.message);
  }
}

// ─────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:    'ok',
    service:   'alphaedge-stripe',
    liveMode:  process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ?? false,
    uptime:    process.uptime(),
  });
});

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  const mode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? '🟢 LIVE' : '🟡 TEST';
  console.log(`[STRIPE] Server running on port ${PORT} — ${mode} mode`);
});

/**
 * ─────────────────────────────────────────────────────────────
 * ALSO UPDATE alphaedge-auth.js — /api/user/update-plan
 * ─────────────────────────────────────────────────────────────
 *
 * The existing route only updates `plan`. Add stripeCustomerId
 * and subscriptionId so you can open the billing portal later:
 *
 * app.post('/api/user/update-plan', async (req, res) => {
 *   const { userId, plan, stripeCustomerId, subscriptionId } = req.body;
 *   if (!userId || !plan) return res.status(400).json({ error: 'userId and plan are required.' });
 *
 *   const data = { plan };
 *   if (stripeCustomerId) data.stripeCustomerId = stripeCustomerId;
 *   if (subscriptionId)   data.subscriptionId   = subscriptionId;
 *
 *   await prisma.user.update({ where: { id: userId }, data });
 *   res.json({ message: 'Plan updated.' });
 * });
 *
 * ─────────────────────────────────────────────────────────────
 * PRISMA SCHEMA — add these fields to your User model:
 * ─────────────────────────────────────────────────────────────
 *
 * model User {
 *   ...existing fields...
 *   stripeCustomerId  String?
 *   subscriptionId    String?
 * }
 *
 * npx prisma migrate dev --name add_stripe_fields
 * ─────────────────────────────────────────────────────────────
 */
