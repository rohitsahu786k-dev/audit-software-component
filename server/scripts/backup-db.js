'use strict';
// Read-only full database backup. Dumps every collection to a timestamped JSON file.
// Usage: node server/scripts/backup-db.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'onepws_audit';
  if (!uri) throw new Error('MONGODB_URI is not set');
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const collections = await db.listCollections().toArray();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(__dirname, '../../backups');
  fs.mkdirSync(outDir, { recursive: true });
  const dump = { db: dbName, takenAt: new Date().toISOString(), collections: {} };
  let totalDocs = 0;
  for (const c of collections) {
    const docs = await db.collection(c.name).find({}).toArray();
    dump.collections[c.name] = docs;
    totalDocs += docs.length;
    console.log(`  ${c.name}: ${docs.length} docs`);
  }
  const outFile = path.join(outDir, `backup-${dbName}-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify(dump, null, 2));
  const sizeMB = (fs.statSync(outFile).size / 1048576).toFixed(2);
  console.log(`\nBackup complete: ${collections.length} collections, ${totalDocs} docs, ${sizeMB} MB`);
  console.log(`Saved to: ${outFile}`);
  await client.close();
}
main().catch(err => { console.error('Backup failed:', err.message); process.exit(1); });
