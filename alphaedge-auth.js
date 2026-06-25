/**
 * AlphaEdge — Authentication Backend
 * ─────────────────────────────────────
 * Stack: Node.js + Express + JWT + bcrypt + nodemailer
 *
 * Install:
 *   npm install express bcryptjs jsonwebtoken nodemailer cors dotenv crypto
 *
 * .env file:
 *   JWT_SECRET=your_very_long_random_secret_string
 *   JWT_EXPIRES_IN=7d
 *   EMAIL_HOST=smtp.yourprovider.com
 *   EMAIL_PORT=587
 *   EMAIL_USER=noreply@alphaedge.com
 *   EMAIL_PASS=your_email_password
 *   CLIENT_URL=https://alphaedge.com
 *   PORT=3003
 *
 * Database: swap the in-memory db below for your real DB
 *   (MongoDB, PostgreSQL, MySQL — structure shown in comments)
 */

require('dotenv').config();
const express    = require('express');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto     = require('crypto');
const cors       = require('cors');

const app = express();
app.use(express.json());
app.use(cors({ 
  origin: ['https://alphaedgetrading.site', 'http://alphaedgetrading.site', 'https://cfutrell82-alt.github.io'],
  credentials: true 
}));


// ─────────────────────────────────────────────
// IN-MEMORY DATABASE (replace with real DB)
// ─────────────────────────────────────────────
// Real DB schema (SQL):
//
// CREATE TABLE users (
//   id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   first_name       VARCHAR(100) NOT NULL,
//   last_name        VARCHAR(100) NOT NULL,
//   email            VARCHAR(255) UNIQUE NOT NULL,
//   password_hash    VARCHAR(255) NOT NULL,
//   plan             VARCHAR(20)  DEFAULT 'free',   -- 'free'|'pro'|'elite'
//   status           VARCHAR(20)  DEFAULT 'active', -- 'active'|'suspended'
//   email_verified   BOOLEAN      DEFAULT false,
//   verify_token     VARCHAR(255),
//   reset_token      VARCHAR(255),
//   reset_expires    TIMESTAMPTZ,
//   stripe_customer  VARCHAR(255),
//   subscription_id  VARCHAR(255),
//   telegram_user_id VARCHAR(100),
//   created_at       TIMESTAMPTZ  DEFAULT now(),
//   last_login       TIMESTAMPTZ
// );

const db = {
  users: [], // { id, firstName, lastName, email, passwordHash, plan, status, emailVerified, verifyToken, resetToken, resetExpires, stripeCustomerId, telegramUserId, createdAt, lastLogin }

  findByEmail(email) {
    return this.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  },
  findById(id) {
    return this.users.find(u => u.id === id);
  },
  findByToken(field, token) {
    return this.users.find(u => u[field] === token);
  },
  create(data) {
    const user = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...data };
    this.users.push(user);
    return user;
  },
  update(id, data) {
    const idx = this.users.findIndex(u => u.id === id);
    if (idx === -1) return null;
    this.users[idx] = { ...this.users[idx], ...data };
    return this.users[idx];
  },
};


// ─────────────────────────────────────────────
// EMAIL TRANSPORTER
// ─────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST,
  port:   parseInt(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendEmail({ to, subject, html }) {
  try {
    await transporter.sendMail({
      from: `"AlphaEdge" <${process.env.EMAIL_USER}>`,
      to, subject, html,
    });
    console.log(`[EMAIL] Sent to ${to}: ${subject}`);
  } catch (err) {
    console.error('[EMAIL] Failed:', err.message);
  }
}


// ─────────────────────────────────────────────
// JWT HELPERS
// ─────────────────────────────────────────────
function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}


// ─────────────────────────────────────────────
// AUTH MIDDLEWARE
// ─────────────────────────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    const user = db.findById(decoded.userId);

    if (!user) return res.status(401).json({ error: 'User not found.' });
    if (user.status === 'suspended') return res.status(403).json({ error: 'Account suspended.' });

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

function requirePlan(...plans) {
  return (req, res, next) => {
    if (!plans.includes(req.user.plan)) {
      return res.status(403).json({
        error: `This feature requires a ${plans.join(' or ')} subscription.`,
        upgradeUrl: `${process.env.CLIENT_URL}/alphaedge-checkout.html`,
      });
    }
    next();
  };
}


// ─────────────────────────────────────────────
// EMAIL TEMPLATES
// ─────────────────────────────────────────────
const emailBase = (content) => `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body { background:#0A0F1E; color:#E8EDF5; font-family:Inter,sans-serif; margin:0; padding:0; }
  .wrap { max-width:560px; margin:40px auto; padding:0 20px; }
  .card { background:#111827; border:1px solid #1E2D45; border-radius:16px; padding:36px; }
  .logo { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:1.3rem; margin-bottom:28px; }
  .logo span { color:#00D4FF; }
  h2 { font-family:'Space Grotesk',sans-serif; font-weight:700; margin-bottom:12px; }
  p { color:#6B7FA3; line-height:1.6; margin-bottom:16px; font-size:0.9rem; }
  .btn { display:inline-block; background:#00D4FF; color:#0A0F1E; padding:13px 28px; border-radius:8px; text-decoration:none; font-weight:700; font-family:'Space Grotesk',sans-serif; margin:8px 0 20px; }
  .footer { margin-top:28px; padding-top:20px; border-top:1px solid #1E2D45; font-size:0.78rem; color:#3A4A6B; }
  .code { background:#0A0F1E; border:1px solid #1E2D45; border-radius:8px; padding:16px 20px; font-family:monospace; font-size:1.5rem; letter-spacing:0.3em; color:#00D4FF; text-align:center; margin:16px 0; }
</style></head><body>
<div class="wrap"><div class="card">
  <div class="logo">Alpha<span>Edge</span></div>
  ${content}
  <div class="footer">AlphaEdge · Not financial advice · <a href="${process.env.CLIENT_URL}/alphaedge-privacy.html" style="color:#6B7FA3;">Privacy Policy</a></div>
</div></div></body></html>`;

const emailTemplates = {
  verify: (name, link) => emailBase(`
    <h2>Verify your email</h2>
    <p>Hi ${name}, thanks for signing up to AlphaEdge. Click below to verify your email address and activate your account.</p>
    <a href="${link}" class="btn">Verify email →</a>
    <p>This link expires in 24 hours. If you didn't sign up, you can safely ignore this email.</p>
  `),

  resetPassword: (name, link) => emailBase(`
    <h2>Reset your password</h2>
    <p>Hi ${name}, we received a request to reset your AlphaEdge password. Click below to choose a new one.</p>
    <a href="${link}" class="btn">Reset password →</a>
    <p>This link expires in 30 minutes. If you didn't request a reset, your account is safe — you can ignore this email.</p>
  `),

  welcome: (name, plan) => emailBase(`
    <h2>Welcome to AlphaEdge${plan !== 'free' ? ` ${capitalize(plan)}` : ''}! 🎉</h2>
    <p>Hi ${name}, your account is active. Here's what to do next:</p>
    <p>1. <strong style="color:#E8EDF5;">Connect Telegram</strong> — go to your dashboard and link your Telegram account to start receiving signals.</p>
    <p>2. <strong style="color:#E8EDF5;">Read the signal guide</strong> — send /help to @AlphaEdgeBot to learn how to read and act on each signal.</p>
    <p>3. <strong style="color:#E8EDF5;">Check the education vault</strong> — we have 20+ courses to sharpen your edge.</p>
    <a href="${process.env.CLIENT_URL}/alphaedge-dashboard.html" class="btn">Go to dashboard →</a>
  `),

  passwordChanged: (name) => emailBase(`
    <h2>Your password was changed</h2>
    <p>Hi ${name}, your AlphaEdge password was successfully updated.</p>
    <p>If you made this change, no action is needed.</p>
    <p>If you did not change your password, please <a href="mailto:support@alphaedge.com" style="color:#00D4FF;">contact support immediately</a>.</p>
  `),
};

function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }


// ─────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────

// ── SIGN UP ──────────────────────────────────
app.post('/api/auth/signup', async (req, res) => {
  const { firstName, lastName, email, password } = req.body;

  if (!firstName || !lastName) return res.status(400).json({ error: 'First and last name are required.' });
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email is required.' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  // Check for existing account
  if (db.findByEmail(email)) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 12);

  // Generate email verification token
  const verifyToken = crypto.randomBytes(32).toString('hex');

  // Create user
  const user = db.create({
    firstName, lastName, email: email.toLowerCase(),
    passwordHash, plan: 'free', status: 'active',
    emailVerified: false, verifyToken,
    stripeCustomerId: null, telegramUserId: null,
    lastLogin: null,
  });

  // Send verification email
  const verifyLink = `${process.env.CLIENT_URL}/api/auth/verify-email?token=${verifyToken}`;
  await sendEmail({
    to: email,
    subject: 'Verify your AlphaEdge account',
    html: emailTemplates.verify(firstName, verifyLink),
  });

  // Return JWT (they can use the app; full features unlock after verification)
  const token = signToken(user.id);

  res.status(201).json({
    token,
    user: safeUser(user),
    message: 'Account created. Please check your email to verify your address.',
  });
});


// ── LOG IN ───────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const user = db.findByEmail(email);
  if (!user) return res.status(401).json({ error: 'Incorrect email or password.' });

  if (user.status === 'suspended') return res.status(403).json({ error: 'This account has been suspended. Contact support.' });

  const passwordMatch = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatch) return res.status(401).json({ error: 'Incorrect email or password.' });

  // Update last login
  db.update(user.id, { lastLogin: new Date().toISOString() });

  const token = signToken(user.id);

  res.json({
    token,
    user: safeUser(user),
  });
});


// ── VERIFY EMAIL ─────────────────────────────
app.get('/api/auth/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Invalid verification link.');

  const user = db.findByToken('verifyToken', token);
  if (!user) return res.status(400).send('Verification link is invalid or has already been used.');

  db.update(user.id, { emailVerified: true, verifyToken: null });

  // Send welcome email
  await sendEmail({
    to: user.email,
    subject: `Welcome to AlphaEdge!`,
    html: emailTemplates.welcome(user.firstName, user.plan),
  });

  // Redirect to dashboard
  res.redirect(`${process.env.CLIENT_URL}/alphaedge-dashboard.html?verified=true`);
});


// ── FORGOT PASSWORD ──────────────────────────
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  const user = db.findByEmail(email);

  // Always return 200 to prevent email enumeration
  if (!user) return res.json({ message: 'If an account exists, a reset link has been sent.' });

  // Generate reset token (expires in 30 minutes)
  const resetToken   = crypto.randomBytes(32).toString('hex');
  const resetExpires = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  db.update(user.id, { resetToken, resetExpires });

  const resetLink = `${process.env.CLIENT_URL}/alphaedge-reset-password.html?token=${resetToken}`;

  await sendEmail({
    to: user.email,
    subject: 'Reset your AlphaEdge password',
    html: emailTemplates.resetPassword(user.firstName, resetLink),
  });

  res.json({ message: 'If an account exists, a reset link has been sent.' });
});


// ── RESET PASSWORD ───────────────────────────
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) return res.status(400).json({ error: 'Token and new password are required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const user = db.findByToken('resetToken', token);
  if (!user) return res.status(400).json({ error: 'Reset link is invalid or has already been used.' });

  // Check expiry
  if (new Date() > new Date(user.resetExpires)) {
    return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  db.update(user.id, { passwordHash, resetToken: null, resetExpires: null });

  await sendEmail({
    to: user.email,
    subject: 'Your AlphaEdge password was changed',
    html: emailTemplates.passwordChanged(user.firstName),
  });

  res.json({ message: 'Password updated successfully. You can now log in.' });
});


// ── GET CURRENT USER ─────────────────────────
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: safeUser(req.user) });
});


// ── UPDATE PROFILE ───────────────────────────
app.put('/api/user/profile', requireAuth, async (req, res) => {
  const { firstName, lastName, email } = req.body;

  if (email && email !== req.user.email) {
    const existing = db.findByEmail(email);
    if (existing && existing.id !== req.user.id) {
      return res.status(409).json({ error: 'That email is already in use.' });
    }
  }

  const updated = db.update(req.user.id, {
    ...(firstName && { firstName }),
    ...(lastName  && { lastName }),
    ...(email     && { email: email.toLowerCase() }),
  });

  res.json({ user: safeUser(updated) });
});


// ── CHANGE PASSWORD ──────────────────────────
app.put('/api/user/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both current and new passwords are required.' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });

  const valid = await bcrypt.compare(currentPassword, req.user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

  const passwordHash = await bcrypt.hash(newPassword, 12);
  db.update(req.user.id, { passwordHash });

  await sendEmail({
    to: req.user.email,
    subject: 'Your AlphaEdge password was changed',
    html: emailTemplates.passwordChanged(req.user.firstName),
  });

  res.json({ message: 'Password updated successfully.' });
});


// ── CONNECT TELEGRAM ─────────────────────────
// User gets a 6-digit code from the bot, pastes it here
// The bot should POST to /api/telegram/register-code when /start is called

const telegramCodes = new Map(); // code → { telegramUserId, username, expires }

// Called by the Telegram bot when user sends /start
app.post('/api/telegram/register-code', async (req, res) => {
  const { secret, telegramUserId, username } = req.body;

  if (req.headers['x-internal-secret'] !== process.env.SIGNAL_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });

  // Generate 6-digit code, expires in 10 minutes
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  telegramCodes.set(code, {
    telegramUserId: telegramUserId.toString(),
    username,
    expires: Date.now() + 10 * 60 * 1000,
  });

  res.json({ code });
});

// Called by the dashboard when user submits their code
app.post('/api/telegram/connect', requireAuth, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code is required.' });

  const entry = telegramCodes.get(code);
  if (!entry) return res.status(400).json({ error: 'Invalid code. Make sure you copied it correctly.' });
  if (Date.now() > entry.expires) {
    telegramCodes.delete(code);
    return res.status(400).json({ error: 'Code has expired. Send /start to @AlphaEdgeBot to get a new one.' });
  }

  // Link Telegram to user account
  db.update(req.user.id, {
    telegramUserId: entry.telegramUserId,
    telegramUsername: entry.username,
  });
  telegramCodes.delete(code);

  // Trigger channel invite via signal service
  try {
    await fetch(`http://localhost:3002/api/grant-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramUserId: entry.telegramUserId,
        plan: req.user.plan,
        secret: process.env.SIGNAL_SECRET,
      }),
    });
  } catch (err) {
    console.error('[TELEGRAM] Could not send invite:', err.message);
  }

  res.json({
    message: 'Telegram connected! Check your Telegram — an invite link has been sent.',
    telegramUsername: entry.username,
  });
});


// ── GOOGLE OAUTH (scaffold) ───────────────────
// Wire up with passport.js + passport-google-oauth20
// or use a service like Auth0 / Clerk for drop-in OAuth
app.get('/api/auth/google', (req, res) => {
  // TODO: redirect to Google OAuth consent screen
  // In production use: passport.authenticate('google', { scope: ['profile', 'email'] })
  res.status(501).json({
    error: 'Google OAuth not yet configured.',
    setup: 'npm install passport passport-google-oauth20, then configure in this file.',
  });
});

app.get('/api/auth/google/callback', (req, res) => {
  // TODO: handle OAuth callback
  // passport.authenticate('google', { failureRedirect: '/login' })
  // Create/find user, sign JWT, redirect to dashboard
  res.redirect(`${process.env.CLIENT_URL}/alphaedge-dashboard.html`);
});


// ── RESEND VERIFICATION EMAIL ────────────────
app.post('/api/auth/resend-verification', requireAuth, async (req, res) => {
  if (req.user.emailVerified) return res.status(400).json({ error: 'Email is already verified.' });

  const verifyToken = crypto.randomBytes(32).toString('hex');
  db.update(req.user.id, { verifyToken });

  const verifyLink = `${process.env.CLIENT_URL}/api/auth/verify-email?token=${verifyToken}`;
  await sendEmail({
    to: req.user.email,
    subject: 'Verify your AlphaEdge account',
    html: emailTemplates.verify(req.user.firstName, verifyLink),
  });

  res.json({ message: 'Verification email resent.' });
});


// ── DELETE ACCOUNT ───────────────────────────
app.delete('/api/user/account', requireAuth, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password confirmation required.' });

  const valid = await bcrypt.compare(password, req.user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Incorrect password.' });

  // TODO: cancel Stripe subscription before deleting
  // await fetch('/api/cancel-subscription', { ... })

  // Soft delete — mark as deleted rather than removing record
  db.update(req.user.id, {
    status: 'deleted',
    email: `deleted_${req.user.id}@alphaedge.com`, // free up email for re-registration
    passwordHash: '',
    telegramUserId: null,
  });

  res.json({ message: 'Account deleted successfully.' });
});


// ─────────────────────────────────────────────
// HELPER: strip sensitive fields before sending user to client
// ─────────────────────────────────────────────
function safeUser(user) {
  const { passwordHash, verifyToken, resetToken, resetExpires, ...safe } = user;
  return safe;
}


// ─────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'auth', uptime: process.uptime() });
});


// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
  console.log(`AlphaEdge Auth API running on port ${PORT}`);
});


/**
 * ════════════════════════════════════════════════
 * SETUP CHECKLIST
 * ════════════════════════════════════════════════
 *
 * 1. ENVIRONMENT VARIABLES
 *    JWT_SECRET=<long random string — use: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
 *    JWT_EXPIRES_IN=7d
 *    EMAIL_HOST=smtp.gmail.com          (or SendGrid, Mailgun, Postmark)
 *    EMAIL_PORT=587
 *    EMAIL_USER=noreply@alphaedge.com
 *    EMAIL_PASS=your_app_password
 *    CLIENT_URL=https://alphaedge.com
 *    SIGNAL_SECRET=same_secret_as_signals_server
 *    PORT=3003
 *
 * 2. CONNECT YOUR REAL DATABASE
 *    Replace the in-memory `db` object with your ORM/query client.
 *    Recommended: Prisma (easiest) or pg (PostgreSQL direct).
 *
 *    Example with Prisma:
 *    const { PrismaClient } = require('@prisma/client');
 *    const prisma = new PrismaClient();
 *    // then replace db.create → prisma.user.create, etc.
 *
 * 3. WIRE UP THE FRONTEND
 *    In alphaedge-auth-modal.js, uncomment and update the fetch calls:
 *
 *    Login:
 *    const res = await fetch('https://yourapi.com/api/auth/login', {
 *      method: 'POST',
 *      headers: { 'Content-Type': 'application/json' },
 *      body: JSON.stringify({ email, password: pw })
 *    });
 *    const data = await res.json();
 *    if (!res.ok) throw new Error(data.error);
 *    localStorage.setItem('ae_token', data.token);
 *    window.location.href = 'alphaedge-dashboard.html';
 *
 *    Signup:
 *    const res = await fetch('https://yourapi.com/api/auth/signup', {
 *      method: 'POST',
 *      headers: { 'Content-Type': 'application/json' },
 *      body: JSON.stringify({ firstName: fname, lastName: lname, email, password: pw })
 *    });
 *
 *    Dashboard (load user data):
 *    const res = await fetch('https://yourapi.com/api/auth/me', {
 *      headers: { 'Authorization': `Bearer ${localStorage.getItem('ae_token')}` }
 *    });
 *    const { user } = await res.json();
 *    // Use user.firstName, user.plan, etc. to populate the dashboard
 *
 * 4. ADD AUTH GUARD TO DASHBOARD
 *    At the top of alphaedge-dashboard.html <script>:
 *
 *    const token = localStorage.getItem('ae_token');
 *    if (!token) window.location.href = 'index.html';
 *    // Optionally verify token with /api/auth/me and redirect if invalid
 *
 * 5. GOOGLE OAUTH (optional)
 *    npm install passport passport-google-oauth20
 *    Create OAuth app at console.cloud.google.com
 *    Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env
 *    Uncomment and configure the /api/auth/google routes above
 *
 * 6. CONNECT TELEGRAM BOT
 *    In alphaedge-signals.js, add to the /start handler:
 *
 *    bot.onText(/\/start/, async (msg) => {
 *      const res = await fetch('http://localhost:3003/api/telegram/register-code', {
 *        method: 'POST',
 *        headers: {
 *          'Content-Type': 'application/json',
 *          'x-internal-secret': process.env.SIGNAL_SECRET
 *        },
 *        body: JSON.stringify({
 *          telegramUserId: msg.chat.id,
 *          username: msg.chat.username || '',
 *        })
 *      });
 *      const { code } = await res.json();
 *      await bot.sendMessage(msg.chat.id,
 *        `Your AlphaEdge connection code: *${code}*\nPaste this in your dashboard. Expires in 10 minutes.`,
 *        { parse_mode: 'Markdown' }
 *      );
 *    });
 *
 * 7. ALL THREE SERVERS RUNNING TOGETHER
 *    Port 3001 — alphaedge-stripe-server.js  (Stripe payments)
 *    Port 3002 — alphaedge-signals.js        (Signal engine + Telegram)
 *    Port 3003 — alphaedge-auth.js           (Auth — this file)
 *
 *    Use a process manager in production:
 *    npm install -g pm2
 *    pm2 start alphaedge-stripe-server.js
 *    pm2 start alphaedge-signals.js
 *    pm2 start alphaedge-auth.js
 *    pm2 save && pm2 startup
 *
 * ════════════════════════════════════════════════
 */
