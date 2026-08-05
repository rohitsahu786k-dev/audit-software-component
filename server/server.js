'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { getCollection, shutdown } = require('./lib/mongo');
const { requireApiAuth, wrapAsync } = require('./middleware/auth');
const { runEmailAutomation } = require('./lib/email-engine');
const authRoutes = require('./routes/auth');
const syncRoutes = require('./routes/sync');
const emailRoutes = require('./routes/email');
const mediaRoutes = require('./routes/media');

const app = express();
const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 3001);
const REQUIRED_SYNC_CLIENT = 'AuditPro-Web/2026-07-02-sync-guard-2';
const APP_VERSION = process.env.APP_VERSION || '2026-07-02';

// ── CORS ──────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (!ALLOWED_ORIGINS.length) return cb(null, true);
    if (ALLOWED_ORIGINS.includes('*')) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`Origin ${origin} not allowed`));
  },
  credentials: true,
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Auth-Token', 'X-AuditPro-Client', 'X-AuditPro-Version']
}));

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ── SECURITY HEADERS ────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// ── AUTH MIDDLEWARE ──────────────────────────────────
app.use(wrapAsync(requireApiAuth));

// ── HEALTH ──────────────────────────────────────────
app.get('/api/health', wrapAsync(async (_req, res) => {
  await getCollection();
  res.json({ ok: true, ts: new Date().toISOString(), version: APP_VERSION, service: 'OnePWS-AuditPro' });
}));

app.get('/api/version', (_req, res) => {
  res.json({ ok: true, version: APP_VERSION, syncClient: REQUIRED_SYNC_CLIENT });
});

// ── ROUTES ──────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/media', mediaRoutes);

// ── 404 ─────────────────────────────────────────────
app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

// ── STATIC CLIENT ───────────────────────────────────
// When client/dist exists (i.e. a deployed build), one service serves both the API
// and the SPA. apiFetch in client/src/utils/api.js uses relative /api paths, so
// same-origin serving means no CORS or API-base config is needed in the browser.
// In local dev the build is absent and Vite serves :5173 with its own /api proxy.
const CLIENT_DIST = path.resolve(__dirname, '../client/dist');
if (fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
  app.use(express.static(CLIENT_DIST));
  // Client-side routes (react-router) must fall back to index.html. /api never
  // reaches here — the 404 handler above already terminated those requests.
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
  console.log('[AuditPro] Serving client build from client/dist');
} else {
  console.log('[AuditPro] No client build found — API only (run "npm run build:client" to serve the SPA)');
}

// ── ERROR HANDLER ────────────────────────────────────
app.use((err, _req, res, _next) => {
  const status = err.statusCode || err.status || 500;
  if (status >= 500) console.error('[AuditPro Server Error]', err);
  res.status(status).json({ ok: false, error: err.message || 'Internal server error' });
});

// ── EMAIL AUTOMATION CRON ────────────────────────────
// Reminders must fire whether or not anyone has the portal open, so the dispatch loop lives here
// rather than in the browser. Requires a host that keeps the process alive (not a sleeping tier).
const EMAIL_CRON = process.env.EMAIL_CRON || '0 9 * * *';
const EMAIL_CRON_TZ = process.env.EMAIL_CRON_TZ || 'Asia/Kolkata';
const EMAIL_AUTOMATION_ENABLED = String(process.env.EMAIL_AUTOMATION || 'true').toLowerCase() !== 'false';

let emailCronTask = null;
if (EMAIL_AUTOMATION_ENABLED) {
  if (!cron.validate(EMAIL_CRON)) {
    console.error(`[AuditPro] Invalid EMAIL_CRON "${EMAIL_CRON}" — email automation is DISABLED`);
  } else {
    emailCronTask = cron.schedule(EMAIL_CRON, () => {
      runEmailAutomation({ by: 'cron' }).catch(err => console.error('[AuditPro] Email automation failed:', err));
    }, { timezone: EMAIL_CRON_TZ });
    console.log(`[AuditPro] Email automation scheduled: "${EMAIL_CRON}" (${EMAIL_CRON_TZ})`);
  }
} else {
  console.log('[AuditPro] Email automation disabled (EMAIL_AUTOMATION=false)');
}

const server = app.listen(PORT, () => console.log(`[AuditPro] Server running on port ${PORT}`));

const stop = async () => { if (emailCronTask) emailCronTask.stop(); server.close(); await shutdown(); };
process.on('SIGTERM', async () => { await stop(); });
process.on('SIGINT', async () => { await stop(); process.exit(0); });

module.exports = app;
