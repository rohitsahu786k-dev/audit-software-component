'use strict';

const express = require('express');
const router = express.Router();
const { wrapAsync, requireRoles, actorOf } = require('../middleware/auth');
const { getCollection } = require('../lib/mongo');
const { getCloudinaryConfig, getCloudinaryEndpoint, cloudinarySignature, cloudinaryPostMultipart, mediaTypeFromUpload, destroyCloudinaryAsset } = require('../lib/cloudinary');

const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024;
const RESOURCE_TYPES = new Set(['image', 'video', 'raw', 'auto']);
// Script-capable types would be served from the Cloudinary domain as active content.
const BLOCKED_DATA_URL = /^data:(text\/html|image\/svg\+xml|application\/(x-|javascript|xhtml))/i;
const MEDIA_MANAGERS = ['admin', 'auditor'];

router.post('/sign-upload', wrapAsync(async (req, res) => {
  requireRoles(req, MEDIA_MANAGERS, 'Only Master Admin or Auditor can request upload signatures');
  const cfg = getCloudinaryConfig();
  if (!cfg.cloudName || !cfg.apiKey || !cfg.apiSecret) return res.status(503).json({ ok: false, error: 'Cloudinary is not configured' });
  const folder = String((req.body && req.body.folder) || 'auditpro').replace(/[^a-zA-Z0-9_/-]/g, '_').slice(0, 100);
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder, timestamp };
  const signature = cloudinarySignature(params, cfg.apiSecret);
  res.json({ ok: true, cloudName: cfg.cloudName, apiKey: cfg.apiKey, signature, timestamp, folder });
}));

router.post('/upload-by-url', wrapAsync(async (req, res) => {
  requireRoles(req, MEDIA_MANAGERS, 'Only Master Admin or Auditor can import media by URL');
  const cfg = getCloudinaryConfig();
  if (!cfg.cloudName || !cfg.apiKey || !cfg.apiSecret) return res.status(503).json({ ok: false, error: 'Cloudinary is not configured' });
  const rawUrl = String((req.body && req.body.url) || '').trim();
  if (!rawUrl || !/^https:\/\//i.test(rawUrl)) return res.status(400).json({ ok: false, error: 'A valid https:// URL is required' });
  const folder = String((req.body && req.body.folder) || 'auditpro').replace(/[^a-zA-Z0-9_/-]/g, '_').slice(0, 100);
  const resourceType = String((req.body && req.body.resource_type) || 'auto');
  if (!RESOURCE_TYPES.has(resourceType)) return res.status(400).json({ ok: false, error: 'Invalid resource type' });
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { file: rawUrl, folder, resource_type: resourceType, timestamp };
  const signature = cloudinarySignature({ folder, resource_type: resourceType, timestamp }, cfg.apiSecret);
  const endpoint = getCloudinaryEndpoint(cfg, resourceType, 'upload');
  const response = await cloudinaryPostMultipart(endpoint, { ...params, api_key: cfg.apiKey, signature });
  const data = response.data || {};
  if (!response.ok || data.error) return res.status(response.status || 502).json({ ok: false, error: (data.error && data.error.message) || 'Cloudinary upload failed' });
  const item = { id: data.public_id, url: data.secure_url, thumbUrl: data.secure_url, name: data.original_filename || data.public_id, format: data.format, size: data.bytes, resourceType: data.resource_type, mediaType: mediaTypeFromUpload(data), addedAt: new Date().toISOString(), addedBy: actorOf(req) };
  res.json({ ok: true, item });
}));

router.post('/upload-base64', wrapAsync(async (req, res) => {
  const cfg = getCloudinaryConfig();
  if (!cfg.cloudName || !cfg.apiKey || !cfg.apiSecret) return res.status(503).json({ ok: false, error: 'Cloudinary is not configured' });
  const dataUrl = String((req.body && req.body.data) || '').trim();
  if (!dataUrl.startsWith('data:') || BLOCKED_DATA_URL.test(dataUrl)) return res.status(400).json({ ok: false, error: 'A supported file data URL is required' });
  if (Math.ceil(dataUrl.length * 0.75) > MAX_UPLOAD_SIZE_BYTES) return res.status(413).json({ ok: false, error: 'File too large' });
  const folder = String((req.body && req.body.folder) || 'auditpro').replace(/[^a-zA-Z0-9_/-]/g, '_').slice(0, 100);
  const filename = String((req.body && req.body.filename) || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder, timestamp, use_filename: true };
  const signature = cloudinarySignature(params, cfg.apiSecret);
  const endpoint = getCloudinaryEndpoint(cfg, 'auto', 'upload');
  const response = await cloudinaryPostMultipart(endpoint, { file: dataUrl, ...params, public_id: `${folder}/${filename}_${timestamp}`, api_key: cfg.apiKey, signature });
  const data = response.data || {};
  if (!response.ok || data.error) return res.status(response.status || 502).json({ ok: false, error: (data.error && data.error.message) || 'Upload failed' });
  const item = { id: data.public_id, url: data.secure_url, thumbUrl: data.secure_url, name: filename, format: data.format, size: data.bytes, resourceType: data.resource_type, mediaType: mediaTypeFromUpload(data), addedAt: new Date().toISOString(), addedBy: actorOf(req) };
  res.json({ ok: true, item });
}));

router.delete('/:publicId(*)', wrapAsync(async (req, res) => {
  requireRoles(req, MEDIA_MANAGERS, 'Only Master Admin or Auditor can delete media');
  const publicId = decodeURIComponent(String(req.params.publicId || '')).trim();
  if (!publicId) return res.status(400).json({ ok: false, error: 'publicId is required' });
  const resourceType = String((req.query && req.query.resource_type) || 'image');
  if (!RESOURCE_TYPES.has(resourceType)) return res.status(400).json({ ok: false, error: 'Invalid resource type' });
  const data = await destroyCloudinaryAsset(publicId, resourceType);
  res.json({ ok: true, result: data.result });
}));

router.get('/status', wrapAsync(async (_req, res) => {
  const cfg = getCloudinaryConfig();
  const configured = Boolean(cfg.cloudName && cfg.apiKey && cfg.apiSecret);
  res.json({ ok: true, configured, cloudName: configured ? cfg.cloudName : null });
}));

router.get('/list', wrapAsync(async (_req, res) => {
  const collection = await getCollection();
  const row = await collection.findOne({ key: 'ap_media_library' });
  const items = Array.isArray(row && row.value) ? row.value : [];
  res.json({ ok: true, items, count: items.length });
}));

module.exports = router;
