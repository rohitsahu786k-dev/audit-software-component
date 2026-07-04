'use strict';

const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'true').toLowerCase() === 'true';
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || (SMTP_USER ? `OnePWS AuditPro <${SMTP_USER}>` : undefined);

let mailer;

function getMailer() {
  if (!SMTP_USER || !SMTP_PASS) {
    const err = new Error('SMTP_USER or SMTP_PASS is not configured');
    err.statusCode = 503;
    throw err;
  }

  if (!mailer) {
    mailer = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
  }

  return mailer;
}

function parseRecipients(input) {
  if (Array.isArray(input)) return input.map(String).map(v => v.trim()).filter(Boolean);
  if (typeof input === 'string') return input.split(/[;,]/).map(v => v.trim()).filter(Boolean);
  return [];
}

module.exports = { getMailer, parseRecipients, SMTP_FROM, SMTP_USER, SMTP_PASS };
