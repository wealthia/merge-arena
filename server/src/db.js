const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "merge-arena.sqlite");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    first_start_param TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    start_param TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT,
    name TEXT NOT NULL,
    props TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    payload TEXT UNIQUE NOT NULL,
    stars_amount INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    stars_amount INTEGER NOT NULL,
    telegram_payment_charge_id TEXT UNIQUE NOT NULL,
    invoice_payload TEXT,
    status TEXT NOT NULL DEFAULT 'confirmed',
    claimed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_telegram_id ON sessions(telegram_id);
  CREATE INDEX IF NOT EXISTS idx_events_telegram_id ON events(telegram_id);
  CREATE INDEX IF NOT EXISTS idx_purchases_telegram_id ON purchases(telegram_id);
`);

function nowIso() {
  return new Date().toISOString();
}

function upsertUser({ telegramId, username, firstName, startParam }) {
  const now = nowIso();
  const existing = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(telegramId);
  if (existing) {
    db.prepare(
      "UPDATE users SET username = ?, first_name = ?, last_seen_at = ? WHERE telegram_id = ?"
    ).run(username || existing.username, firstName || existing.first_name, now, telegramId);
    return { ...existing, username: username || existing.username, first_name: firstName || existing.first_name };
  }
  db.prepare(
    "INSERT INTO users (telegram_id, username, first_name, first_start_param, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(telegramId, username || null, firstName || null, startParam || null, now, now);
  return db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(telegramId);
}

function recordSession({ telegramId, startParam }) {
  db.prepare("INSERT INTO sessions (telegram_id, start_param, created_at) VALUES (?, ?, ?)").run(
    telegramId,
    startParam || null,
    nowIso()
  );
}

function recordEvent({ telegramId, name, props }) {
  db.prepare("INSERT INTO events (telegram_id, name, props, created_at) VALUES (?, ?, ?, ?)").run(
    telegramId || null,
    name,
    props ? JSON.stringify(props) : null,
    nowIso()
  );
}

function recordInvoice({ telegramId, productId, payload, starsAmount }) {
  db.prepare(
    "INSERT INTO invoices (telegram_id, product_id, payload, stars_amount, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(telegramId, productId, payload, starsAmount, nowIso());
}

// Idempotent: Telegram may redeliver the same webhook update, and
// telegram_payment_charge_id is UNIQUE, so a duplicate insert is rejected
// rather than double-crediting the purchase.
function recordPurchase({ telegramId, productId, starsAmount, chargeId, invoicePayload }) {
  try {
    db.prepare(
      `INSERT INTO purchases (telegram_id, product_id, stars_amount, telegram_payment_charge_id, invoice_payload, status, claimed, created_at)
       VALUES (?, ?, ?, ?, ?, 'confirmed', 0, ?)`
    ).run(telegramId, productId, starsAmount, chargeId, invoicePayload || null, nowIso());
    return true;
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) return false; // already recorded
    throw err;
  }
}

function claimPendingPurchases(telegramId) {
  const pending = db
    .prepare("SELECT * FROM purchases WHERE telegram_id = ? AND claimed = 0")
    .all(telegramId);
  if (pending.length) {
    const ids = pending.map((p) => p.id);
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`UPDATE purchases SET claimed = 1 WHERE id IN (${placeholders})`).run(...ids);
  }
  return pending;
}

module.exports = {
  db,
  nowIso,
  upsertUser,
  recordSession,
  recordEvent,
  recordInvoice,
  recordPurchase,
  claimPendingPurchases
};
