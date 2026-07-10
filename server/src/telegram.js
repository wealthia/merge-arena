const crypto = require("crypto");

const TELEGRAM_API = "https://api.telegram.org";
const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60; // reject stale initData (replay hardening)

/**
 * Validates Telegram Mini App `initData` per the official algorithm:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * secret_key = HMAC_SHA256(key="WebAppData", data=bot_token)
 * data_check_string = all fields except `hash`, sorted alphabetically, "key=value" joined by "\n"
 * valid if HMAC_SHA256(key=secret_key, data=data_check_string) === hash
 */
function validateInitData(initData, botToken) {
  if (!initData || typeof initData !== "string" || !botToken) {
    return { valid: false, reason: "missing initData or bot token" };
  }

  let params;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { valid: false, reason: "malformed initData" };
  }

  const hash = params.get("hash");
  if (!hash) return { valid: false, reason: "missing hash" };
  params.delete("hash");

  const pairs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = pairs.map(([key, value]) => `${key}=${value}`).join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (!timingSafeEqualHex(computedHash, hash)) {
    return { valid: false, reason: "hash mismatch" };
  }

  const authDate = Number(params.get("auth_date"));
  if (Number.isFinite(authDate)) {
    const ageSeconds = Date.now() / 1000 - authDate;
    if (ageSeconds > MAX_INIT_DATA_AGE_SECONDS || ageSeconds < -60) {
      return { valid: false, reason: "stale initData" };
    }
  }

  let user = null;
  try {
    user = params.get("user") ? JSON.parse(params.get("user")) : null;
  } catch {
    return { valid: false, reason: "malformed user field" };
  }
  if (!user || !user.id) return { valid: false, reason: "missing user id" };

  return {
    valid: true,
    user,
    startParam: params.get("start_param") || null,
    authDate
  };
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

async function callTelegramApi(botToken, method, params) {
  const res = await fetch(`${TELEGRAM_API}/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params)
  });
  const json = await res.json();
  if (!json.ok) {
    throw new Error(`Telegram API ${method} failed: ${json.description || res.status}`);
  }
  return json.result;
}

/**
 * Creates a reusable Stars (XTR) invoice link.
 * `provider_token` must be omitted entirely for Stars payments — Telegram
 * rejects the call if it's present, even as an empty string.
 */
function createInvoiceLink(botToken, { title, description, payload, starsAmount }) {
  return callTelegramApi(botToken, "createInvoiceLink", {
    title,
    description,
    payload,
    currency: "XTR",
    prices: [{ label: title, amount: starsAmount }]
  });
}

function answerPreCheckoutQuery(botToken, preCheckoutQueryId, ok, errorMessage) {
  return callTelegramApi(botToken, "answerPreCheckoutQuery", {
    pre_checkout_query_id: preCheckoutQueryId,
    ok,
    ...(errorMessage ? { error_message: errorMessage } : {})
  });
}

function setWebhook(botToken, url, secretToken) {
  return callTelegramApi(botToken, "setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "pre_checkout_query"]
  });
}

module.exports = {
  validateInitData,
  createInvoiceLink,
  answerPreCheckoutQuery,
  setWebhook,
  callTelegramApi
};
