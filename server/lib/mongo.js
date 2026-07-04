'use strict';

const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'onepws_audit';

let mongoClient;
let appData;
let mongoConnectPromise;

async function getCollection() {
  if (!MONGODB_URI) {
    const err = new Error('MONGODB_URI is not configured');
    err.statusCode = 503;
    throw err;
  }

  if (appData) return appData;

  if (!mongoConnectPromise) {
    mongoConnectPromise = (async () => {
      mongoClient = new MongoClient(MONGODB_URI);
      await mongoClient.connect();
      const db = mongoClient.db(MONGODB_DB);
      appData = db.collection('appdata');
      await appData.createIndex({ key: 1 }, { unique: true });
      console.log(`[AuditPro] MongoDB connected: ${MONGODB_DB}.appdata`);
      return appData;
    })().catch(err => {
      mongoClient = null;
      appData = null;
      mongoConnectPromise = null;
      throw err;
    });
  }

  return mongoConnectPromise;
}

async function shutdown() {
  if (mongoClient) {
    await mongoClient.close();
    console.log('[AuditPro] MongoDB connection closed');
  }
}

module.exports = { getCollection, shutdown };
