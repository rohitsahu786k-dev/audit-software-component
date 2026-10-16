'use strict';

const helmet = require('helmet');
const cors = require('cors');
const { ALLOWED_ORIGINS } = require('../lib/config');

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Keep in sync with the headers block in vercel.json (static files on Vercel are served
// by its CDN and never pass through Express).
const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com', 'https://unpkg.com'],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
  imgSrc: ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com'],
  mediaSrc: ["'self'", 'blob:', 'https://res.cloudinary.com'],
  connectSrc: ["'self'"],
  workerSrc: ["'self'", 'blob:', 'https://cdnjs.cloudflare.com'],
  frameSrc: ["'self'", 'blob:', 'https://res.cloudinary.com'],
  objectSrc: ["'self'", 'blob:'],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'self'"],
};

const securityHeaders = helmet({
  contentSecurityPolicy: { useDefaults: false, directives: CSP_DIRECTIVES },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  referrerPolicy: { policy: 'same-origin' },
});

// API responses carry account and audit data: never let a browser or proxy cache them.
function noStoreApi(req, res, next) {
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
}

function requestOrigin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function isAllowedOrigin(req, origin) {
  return origin === requestOrigin(req) || ALLOWED_ORIGINS.includes(origin);
}

// Same-origin only unless ALLOWED_ORIGINS lists extra browsers. (The previous behaviour
// of allowing every origin when the list was empty, with credentials on, is gone.)
const corsMiddleware = cors((req, cb) => {
  const origin = req.headers.origin;
  cb(null, {
    origin: !origin || isAllowedOrigin(req, origin),
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-AuditPro-Client', 'X-AuditPro-Version', 'X-Auth-Return-Redirect'],
  });
});

// CSRF defence for cookie-authenticated requests, layered on top of SameSite=Lax:
//  1. a browser-supplied Origin must be ours (or explicitly allowed);
//  2. Sec-Fetch-Site must not say cross-site;
//  3. JSON API calls must carry the custom X-AuditPro-Client header, which a cross-site
//     form or <img> cannot send and which forces a CORS preflight for scripts.
// Auth.js endpoints additionally require its own signed CSRF token.
function csrfGuard(req, res, next) {
  if (!req.path.startsWith('/api/') || !UNSAFE_METHODS.has(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(req, origin)) return res.status(403).json({ ok: false, error: 'Cross-origin request blocked' });
  if (req.headers['sec-fetch-site'] === 'cross-site' && !(origin && isAllowedOrigin(req, origin))) {
    return res.status(403).json({ ok: false, error: 'Cross-site request blocked' });
  }
  const isAuthJs = req.path.startsWith('/api/auth/') && !['/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/profile', '/api/auth/admin-reset-password', '/api/auth/verify-password'].includes(req.path);
  if (!isAuthJs && !req.headers['x-auditpro-client']) return res.status(403).json({ ok: false, error: 'Missing client header' });
  return next();
}

module.exports = { securityHeaders, noStoreApi, corsMiddleware, csrfGuard };
