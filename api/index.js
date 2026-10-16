'use strict';
// Vercel serverless entry: every /api/* request is rewritten here (see vercel.json)
// and handled by the same Express app used in local/Render deployments.
module.exports = require('../server/server');
