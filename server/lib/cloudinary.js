'use strict';

const crypto = require('crypto');
const https = require('https');

function cleanEnvValue(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function getCloudinaryConfig() {
  const url = cleanEnvValue(process.env.CLOUDINARY_URL);
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'cloudinary:') {
        const cloudName = parsed.hostname || parsed.pathname.replace(/^\/+/, '');
        return {
          apiKey: decodeURIComponent(parsed.username || ''),
          apiSecret: decodeURIComponent(parsed.password || ''),
          cloudName: decodeURIComponent(cloudName || '')
        };
      }
    } catch (_err) {
      const match = url.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
      if (match) {
        return {
          apiKey: decodeURIComponent(match[1]),
          apiSecret: decodeURIComponent(match[2]),
          cloudName: decodeURIComponent(match[3].replace(/[/?#].*$/, ''))
        };
      }
    }
  }

  return {
    cloudName: cleanEnvValue(process.env.CLOUDINARY_CLOUD_NAME),
    apiKey: cleanEnvValue(process.env.CLOUDINARY_API_KEY),
    apiSecret: cleanEnvValue(process.env.CLOUDINARY_API_SECRET)
  };
}

function getCloudinaryEndpoint(cfg, resourceType, action) {
  const cloudName = encodeURIComponent(cfg.cloudName);
  const type = encodeURIComponent(resourceType);
  return `https://api.cloudinary.com/v1_1/${cloudName}/${type}/${action}`;
}

function cloudinarySignature(params, secret) {
  const payload = Object.keys(params)
    .filter(key => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
  return crypto.createHash('sha1').update(payload + secret).digest('hex');
}

function cloudinaryPostMultipart(endpoint, fields) {
  const boundary = `----auditpro-${crypto.randomBytes(12).toString('hex')}`;
  const chunks = [];
  Object.entries(fields || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${key}"\r\n\r\n`));
    chunks.push(Buffer.from(String(value)));
    chunks.push(Buffer.from('\r\n'));
  });
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(chunks);
  const url = new URL(endpoint);

  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'POST',
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      },
      timeout: 30000
    }, res => {
      const parts = [];
      res.on('data', chunk => parts.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8');
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (_err) { data = { raw: text }; }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode || 502, data });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Cloudinary request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

function mediaTypeFromUpload(upload) {
  if (!upload) return 'document';
  if (upload.resource_type === 'image') return 'image';
  if (upload.resource_type === 'video') return 'video';
  if (String(upload.format || '').toLowerCase() === 'pdf') return 'pdf';
  return 'document';
}

async function destroyCloudinaryAsset(publicId, resourceType) {
  const cfg = getCloudinaryConfig();
  if (!cfg.cloudName || !cfg.apiKey || !cfg.apiSecret) {
    const err = new Error('Cloudinary is not configured');
    err.statusCode = 503;
    throw err;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const params = { public_id: publicId, timestamp };
  const type = resourceType || 'image';
  const response = await cloudinaryPostMultipart(getCloudinaryEndpoint(cfg, type, 'destroy'), {
    public_id: publicId,
    timestamp,
    api_key: cfg.apiKey,
    signature: cloudinarySignature(params, cfg.apiSecret)
  });
  const data = response.data || {};
  if (!response.ok || data.error) {
    const err = new Error(data.error && data.error.message ? data.error.message : 'Cloudinary delete failed');
    err.statusCode = response.status || 502;
    throw err;
  }
  return data;
}

module.exports = {
  getCloudinaryConfig,
  getCloudinaryEndpoint,
  cloudinarySignature,
  cloudinaryPostMultipart,
  mediaTypeFromUpload,
  destroyCloudinaryAsset
};
