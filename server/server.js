'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const { getCollection, shutdown } = require('./lib/mongo');
const { requireApiAuth, wrapAsync } = require('./middleware/auth');
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

// ── ERROR HANDLER ────────────────────────────────────
app.use((err, _req, res, _next) => {
  const status = err.statusCode || err.status || 500;
  if (status >= 500) console.error('[AuditPro Server Error]', err);
  res.status(status).json({ ok: false, error: err.message || 'Internal server error' });
});

const server = app.listen(PORT, () => console.log(`[AuditPro] Server running on port ${PORT}`));

process.on('SIGTERM', async () => { server.close(); await shutdown(); });
process.on('SIGINT', async () => { server.close(); await shutdown(); process.exit(0); });

module.exports = app;
