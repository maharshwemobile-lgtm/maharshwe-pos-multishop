const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = process.env.DATABASE_URL?.startsWith('sqlite:')
  ? process.env.DATABASE_URL.replace(/^sqlite:/, '')
  : path.join(DATA_DIR, 'maharshwe-pos.sqlite');

const adminPermissions = { sale: true, history: true, discount: true, editSale: true, deleteSale: true, inventory: true, accounting: true, settings: true };
const cashierPermissions = { sale: true, history: true, discount: false, editSale: false, deleteSale: false };

let db;

async function getDb() {
  if (db) return db;
  const { open } = require('sqlite');
  const sqlite3 = require('sqlite3');
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  db = await open({ filename: DB_FILE, driver: sqlite3.Database });
  await db.exec('PRAGMA journal_mode = WAL');
  await db.exec('PRAGMA foreign_keys = ON');
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      permissions TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      user_name TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      ip TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await seedAdmin();
  return db;
}

async function seedAdmin() {
  const database = db;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'change-this-admin-password', 12);
  const existing = await database.get('SELECT id FROM users WHERE username = ?', username);
  if (existing) {
    if (process.env.ADMIN_PASSWORD) {
      await database.run(
        `UPDATE users
         SET password_hash = ?, name = ?, role = 'Admin', permissions = ?, active = 1, updated_at = CURRENT_TIMESTAMP
         WHERE username = ?`,
        passwordHash,
        process.env.ADMIN_NAME || 'Admin',
        JSON.stringify(adminPermissions),
        username
      );
    }
    return;
  }
  await database.run(
    `INSERT INTO users (id, username, password_hash, name, role, permissions)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'admin_1',
    username,
    passwordHash,
    process.env.ADMIN_NAME || 'Admin',
    'Admin',
    JSON.stringify(adminPermissions)
  );
}

async function verifyUser(username, password) {
  const database = await getDb();
  const user = await database.get('SELECT * FROM users WHERE lower(username) = lower(?) AND active = 1', username);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;
  return publicUser(user);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    permissions: JSON.parse(user.permissions || '{}'),
    loginType: 'Username Password',
  };
}

async function upsertCashiers(cashiers = []) {
  const database = await getDb();
  for (const cashier of cashiers) {
    if (!cashier?.username || !cashier?.pin) continue;
    const id = cashier.id || `cashier_${Date.now()}`;
    const passwordHash = await bcrypt.hash(String(cashier.pin), 12);
    await database.run(
      `INSERT INTO users (id, username, password_hash, name, role, permissions, updated_at)
       VALUES (?, ?, ?, ?, 'Cashier', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(username) DO UPDATE SET
         password_hash = excluded.password_hash,
         name = excluded.name,
         permissions = excluded.permissions,
         active = 1,
         updated_at = CURRENT_TIMESTAMP`,
      id,
      cashier.username,
      passwordHash,
      cashier.name || cashier.username,
      JSON.stringify(cashier.permissions || cashierPermissions)
    );
  }
}

async function getState(key, fallback = null) {
  const database = await getDb();
  const row = await database.get('SELECT value FROM app_state WHERE key = ?', key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

async function setState(key, value) {
  const database = await getDb();
  await database.run(
    `INSERT INTO app_state (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    key,
    JSON.stringify(value)
  );
}

async function addActivityLog({ id, userId, userName, action, details, ip }) {
  const database = await getDb();
  await database.run(
    `INSERT INTO activity_logs (id, user_id, user_name, action, details, ip)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id || `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId || null,
    userName || 'System',
    action,
    details || '',
    ip || ''
  );
}

async function listActivityLogs(limit = 200) {
  const database = await getDb();
  const rows = await database.all(
    'SELECT id, created_at as time, user_name as user, action, details FROM activity_logs ORDER BY created_at DESC LIMIT ?',
    limit
  );
  return rows;
}

module.exports = {
  adminPermissions,
  cashierPermissions,
  getDb,
  verifyUser,
  upsertCashiers,
  getState,
  setState,
  addActivityLog,
  listActivityLogs,
};
