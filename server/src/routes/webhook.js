const express = require("express");
const config = require("../config");
const { answerPreCheckoutQuery } = require("../telegram");
const { getProduct } = require("../products");
const db = require("../db");

const router = express.Router();

// Telegram calls this URL directly (never the browser), so the path itself
// acts as a shared secret. As defense in depth, Telegram also echoes back
// whatever `secret_token` was configured via setWebhook in this header —
// verify it so a leaked/guessed path alone isn't enough to inject fake
// "payment succeeded" updates.
function verifyWebhookSecret(req, res, next) {
  if (req.params.secret !== config.WEBHOOK_SECRET_PATH) {
    return res.status(404).end();
  }
  if (config.WEBHOOK_SECRET_TOKEN) {
    const header = req.get("X-Telegram-Bot-Api-Secret-Token");
    if (header !== config.WEBHOOK_SECRET_TOKEN) {
      return res.status(401).end();
    }
  }
  next();
}

router.post("/webhook/:secret", verifyWebhookSecret, async (req, res) => {
  const update = req.body || {};

  try {
    if (update.pre_checkout_query) {
      await handlePreCheckoutQuery(update.pre_checkout_query);
    } else if (update.message && update.message.successful_payment) {
      handleSuccessfulPayment(update.message);
    }
  } catch (err) {
    // Telegram will retry on non-2xx, but we still want to log and move on
    // rather than let one bad update loop forever.
    console.error("webhook handling error:", err);
  }

  // Always 200 quickly — Telegram requires answerPreCheckoutQuery within 10s
  // and will retry the webhook delivery itself on failure/timeout.
  res.status(200).json({ ok: true });
});

async function handlePreCheckoutQuery(query) {
  const [telegramId, productId] = String(query.invoice_payload).split(":");
  const product = getProduct(productId);
  const buyerMatches = String(query.from && query.from.id) === telegramId;

  if (!product || !buyerMatches || query.total_amount !== product.stars) {
    await answerPreCheckoutQuery(
      config.BOT_TOKEN,
      query.id,
      false,
      "This item is no longer available. Please try again."
    );
    return;
  }

  await answerPreCheckoutQuery(config.BOT_TOKEN, query.id, true);
}

function handleSuccessfulPayment(message) {
  const payment = message.successful_payment;
  const [telegramId, productId] = String(payment.invoice_payload).split(":");
  const product = getProduct(productId);

  if (!product || payment.currency !== "XTR" || payment.total_amount !== product.stars) {
    // Should be unreachable given the pre_checkout_query check, but never
    // silently grant something that doesn't match the known catalog price.
    console.error("successful_payment did not match expected product/price", payment);
    return;
  }

  const recorded = db.recordPurchase({
    telegramId,
    productId,
    starsAmount: payment.total_amount,
    chargeId: payment.telegram_payment_charge_id,
    invoicePayload: payment.invoice_payload
  });

  if (recorded) {
    db.recordEvent({
      telegramId,
      name: "purchase_completed",
      props: { productId, stars: payment.total_amount }
    });
  }
}

module.exports = router;
