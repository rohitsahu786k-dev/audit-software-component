'use strict';
// Read-only against the source DB: clones every collection into a separate staging database
// on the SAME cluster, so local development never touches production data.
// Usage: node server/scripts/clone-to-staging.js [stagingDbName]
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { MongoClient } = require('mongodb');

async function main() {
  const uri = process.env.MONGODB_URI;
  const sourceDbName = process.env.MONGODB_DB || 'onepws_audit';
  const targetDbName = process.argv[2] || `${sourceDbName}_staging`;
  if (!uri) throw new Error('MONGODB_URI is not set');
  if (targetDbName === sourceDbName) throw new Error('Staging DB name must differ from the source DB name');

  const client = new MongoClient(uri);
  await client.connect();
  const sourceDb = client.db(sourceDbName);
  const targetDb = client.db(targetDbName);

  const collections = await sourceDb.listCollections().toArray();
  let totalDocs = 0;
  for (const c of collections) {
    const docs = await sourceDb.collection(c.name).find({}).toArray();
    const targetCollection = targetDb.collection(c.name);
    await targetCollection.deleteMany({});
    if (docs.length) await targetCollection.insertMany(docs);
    totalDocs += docs.length;
    console.log(`  ${c.name}: ${docs.length} docs cloned`);
  }
  console.log(`\nCloned ${sourceDbName} -> ${targetDbName}: ${collections.length} collection(s), ${totalDocs} doc(s) total.`);
  await client.close();
}
main().catch(err => { console.error('Clone failed:', err.message); process.exit(1); });
