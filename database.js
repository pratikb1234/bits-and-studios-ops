// ─── Bits & Studios — MongoDB Persistence Layer ───────────────────────────────
// Wraps the existing file-based sharedState with MongoDB Atlas when
// MONGODB_URI env var is set. Falls back to JSON file for local dev.
//
// SETUP (one-time, free):
//   1. Go to mongodb.com/atlas → Create free M0 cluster
//   2. Create database "bits_studios", collection "workspace"
//   3. Get connection string → set as MONGODB_URI on Render
//
// The entire sharedState is stored as a single document with _id = "main"

'use strict';

const { MongoClient } = require('mongodb');

let _client = null;
let _col    = null;
let _ready  = false;

async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return false;

  try {
    _client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await _client.connect();
    const db = _client.db('bits_studios');
    _col     = db.collection('workspace');
    _ready   = true;
    console.log('[MongoDB] ✅ Connected to Atlas');
    return true;
  } catch (e) {
    console.error('[MongoDB] ❌ Connection failed:', e.message);
    console.warn('[MongoDB] Falling back to local JSON file storage');
    _ready = false;
    return false;
  }
}

async function loadFromMongo() {
  if (!_ready || !_col) return null;
  try {
    const doc = await _col.findOne({ _id: 'main' });
    if (doc) {
      const { _id, ...data } = doc;
      console.log('[MongoDB] Data loaded from Atlas');
      return data;
    }
    return null;
  } catch (e) {
    console.error('[MongoDB] Load error:', e.message);
    return null;
  }
}

async function saveToMongo(data) {
  if (!_ready || !_col) return false;
  try {
    await _col.replaceOne(
      { _id: 'main' },
      { _id: 'main', ...data },
      { upsert: true }
    );
    return true;
  } catch (e) {
    console.error('[MongoDB] Save error:', e.message);
    return false;
  }
}

module.exports = { connectMongo, loadFromMongo, saveToMongo, get isReady() { return _ready; } };
