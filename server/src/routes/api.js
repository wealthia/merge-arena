const express = require("express");
const crypto = require("crypto");
const config = require("../config");
const { validateInitData, createInvoiceLink } = require("../telegram");
const { getProduct } = require("../products");
const db = require("../db");

const router = express.Router();

function requireValidInitData(req, res, next) {
  const initData = req.body && req.body.initData;
  const result = validateInitData(initData, config.BOT_TOKEN);
  if (!config.BOT_TOKEN) {
    return res.status(503).json({ error: "server not configured (missing BOT_TOKEN)" });
  }
  if (!result.valid) {
    return res.status(401).json({ error: "invalid initData", reason: result.reason });
  }
  req.tg = result;
  next();
}

// POST /api/session — called once per app open. Records the session for
// DAU/WAU + ad-campaign attribution (start_param), upserts the user, and
// returns any confirmed-but-unclaimed real purchases so the client can grant
// them locally.
router.post("/session", requireValidInitData, (req, res) => {
  const { user, startParam } = req.tg;
  const telegramId = String(user.id);

  db.upsertUser({ telegramId, username: user.username, firstName: user.first_name, startParam });
  db.recordSession({ telegramId, startParam });
  db.recordEvent({ telegramId, name: "session_start", props: { startParam } });

  const entitlements = db.claimPendingPurchases(telegramId).map((p) => ({
    productId: p.product_id,
    starsAmount: p.stars_amount,
    chargeId: p.telegram_payment_charge_id
  }));

  res.json({ ok: true, entitlements });
});

// POST /api/invoice — creates a real Telegram Stars invoice link for a
// server-known product. The client can never influence the price: it only
// sends a productId, and the price is looked up here.
router.post("/invoice", requireValidInitData, async (req, res) => {
  const { productId } = req.body || {};
  const product = getProduct(productId);
  if (!product) return res.status(400).json({ error: "unknown productId" });

  const telegramId = String(req.tg.user.id);
  const nonce = crypto.randomBytes(6).toString("hex");
  const payload = `${telegramId}:${productId}:${nonce}`;

  try {
    const invoiceLink = await createInvoiceLink(config.BOT_TOKEN, {
      title: product.title,
      description: product.description,
      payload,
      starsAmount: product.stars
    });
    db.recordInvoice({ telegramId, productId, payload, starsAmount: product.stars });
    db.recordEvent({ telegramId, name: "purchase_initiated", props: { productId, stars: product.stars } });
    res.json({ ok: true, invoiceLink });
  } catch (err) {
    res.status(502).json({ error: "failed to create invoice", detail: String(err.message || err) });
  }
});

// GET /api/entitlements — poll for confirmed purchases not yet applied to
// the client's local state (e.g. right after `openInvoice` reports "paid").
router.get("/entitlements", (req, res) => {
  const result = validateInitData(req.query.initData, config.BOT_TOKEN);
  if (!config.BOT_TOKEN) return res.status(503).json({ error: "server not configured" });
  if (!result.valid) return res.status(401).json({ error: "invalid initData", reason: result.reason });

  const telegramId = String(result.user.id);
  const entitlements = db.claimPendingPurchases(telegramId).map((p) => ({
    productId: p.product_id,
    starsAmount: p.stars_amount,
    chargeId: p.telegram_payment_charge_id
  }));
  res.json({ ok: true, entitlements });
});

// POST /api/event — lightweight analytics ingestion for gameplay events
// (merges, battles, achievements, etc). Never blocks or errors the game;
// worst case an event is dropped.
router.post("/event", (req, res) => {
  const { initData, name, props } = req.body || {};
  if (!name || typeof name !== "string" || name.length > 64) {
    return res.status(400).json({ error: "invalid event name" });
  }
  const result = validateInitData(initData, config.BOT_TOKEN);
  const telegramId = result.valid ? String(result.user.id) : null;
  const safeProps = props && typeof props === "object" ? props : undefined;
  db.recordEvent({ telegramId, name, props: safeProps });
  res.json({ ok: true });
});

module.exports = router;
