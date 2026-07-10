const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BOT_TOKEN = "123456:TEST-fake-bot-token-for-unit-tests";

process.env.DB_PATH = path.join(os.tmpdir(), `merge-arena-test-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
process.env.BOT_TOKEN = BOT_TOKEN;
process.env.ADMIN_PASSWORD = "correct-password";
process.env.SESSION_SECRET = "test-session-secret";
process.env.WEBHOOK_SECRET_PATH = "test-webhook-path";
process.env.WEBHOOK_SECRET_TOKEN = "test-webhook-token";
delete process.env.PUBLIC_URL; // avoid auto setWebhook call on require

// Mock outbound Telegram API calls so tests never hit the real network and
// never need a real bot token. Only calls to api.telegram.org are
// intercepted — everything else (including the test's own HTTP requests to
// the local server under test) goes through the real fetch.
const telegramCalls = [];
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (!String(url).startsWith("https://api.telegram.org")) {
    return realFetch(url, opts);
  }

  const method = String(url).split("/").pop();
  const body = opts && opts.body ? JSON.parse(opts.body) : {};
  telegramCalls.push({ method, body });

  if (method === "createInvoiceLink") {
    return jsonResponse({ ok: true, result: `https://t.me/fake-invoice/${Date.now()}` });
  }
  if (method === "answerPreCheckoutQuery" || method === "setWebhook") {
    return jsonResponse({ ok: true, result: true });
  }
  return jsonResponse({ ok: false, description: "unhandled mock method" });
};

function jsonResponse(obj) {
  return { json: async () => obj };
}

const { app } = require("../src/index");
const { validateInitData } = require("../src/telegram");

function buildInitData(fields) {
  const entries = Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return `${qs}&hash=${hash}`;
}

function makeUserInitData(userId, overrides = {}) {
  return buildInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "AAtest",
    user: JSON.stringify({ id: userId, username: `user${userId}`, first_name: "Test" }),
    ...overrides
  });
}

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(process.env.DB_PATH, { force: true });
  fs.rmSync(`${process.env.DB_PATH}-wal`, { force: true });
  fs.rmSync(`${process.env.DB_PATH}-shm`, { force: true });
});

test("validateInitData: accepts correctly signed data", () => {
  const initData = makeUserInitData(1001);
  const result = validateInitData(initData, BOT_TOKEN);
  assert.equal(result.valid, true);
  assert.equal(result.user.id, 1001);
});

test("validateInitData: rejects tampered data", () => {
  const initData = makeUserInitData(1001).replace("user1001", "user9999");
  const result = validateInitData(initData, BOT_TOKEN);
  assert.equal(result.valid, false);
});

test("validateInitData: rejects data signed with a different bot token", () => {
  const initData = makeUserInitData(1001);
  const result = validateInitData(initData, "999999:a-completely-different-token");
  assert.equal(result.valid, false);
});

test("POST /api/session: rejects invalid initData", async () => {
  const res = await fetch(`${baseUrl}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData: "not-a-real-signature" })
  });
  assert.equal(res.status, 401);
});

test("POST /api/session: accepts valid initData, captures start_param, returns no entitlements yet", async () => {
  const initData = makeUserInitData(2002, { start_param: "campaign_summer_sale" });
  const res = await fetch(`${baseUrl}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData })
  });
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(json.entitlements, []);
});

test("POST /api/invoice: rejects unknown productId", async () => {
  const initData = makeUserInitData(2002);
  const res = await fetch(`${baseUrl}/api/invoice`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData, productId: "totally_made_up_product" })
  });
  assert.equal(res.status, 400);
});

test("POST /api/invoice: creates an invoice using the server's authoritative price, ignoring any client-sent price", async () => {
  const initData = makeUserInitData(2002);
  const res = await fetch(`${baseUrl}/api/invoice`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData, productId: "epic_summon", stars: 1 }) // client tries to lie about price
  });
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.ok(json.invoiceLink.startsWith("https://t.me/fake-invoice/"));

  const lastCall = telegramCalls[telegramCalls.length - 1];
  assert.equal(lastCall.method, "createInvoiceLink");
  assert.equal(lastCall.body.currency, "XTR");
  assert.equal(lastCall.body.prices[0].amount, 90); // real epic_summon price, not the client's "1"
  assert.equal("provider_token" in lastCall.body, false); // must be omitted entirely for Stars
});

test("webhook: rejects requests with the wrong secret path", async () => {
  const res = await fetch(`${baseUrl}/api/webhook/wrong-path`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 404);
});

test("webhook: rejects requests with a missing/incorrect secret token header", async () => {
  const res = await fetch(`${baseUrl}/api/webhook/${process.env.WEBHOOK_SECRET_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 401);
});

test("webhook: pre_checkout_query for a valid matching order is approved", async () => {
  const before = telegramCalls.length;
  const res = await fetch(`${baseUrl}/api/webhook/${process.env.WEBHOOK_SECRET_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": process.env.WEBHOOK_SECRET_TOKEN
    },
    body: JSON.stringify({
      pre_checkout_query: {
        id: "pcq_1",
        from: { id: 3003 },
        invoice_payload: "3003:gem_starter:abc123",
        total_amount: 50,
        currency: "XTR"
      }
    })
  });
  assert.equal(res.status, 200);
  const call = telegramCalls.slice(before).find((c) => c.method === "answerPreCheckoutQuery");
  assert.ok(call, "expected answerPreCheckoutQuery to be called");
  assert.equal(call.body.ok, true);
});

test("webhook: pre_checkout_query with a mismatched price is rejected (not approved)", async () => {
  const before = telegramCalls.length;
  await fetch(`${baseUrl}/api/webhook/${process.env.WEBHOOK_SECRET_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": process.env.WEBHOOK_SECRET_TOKEN
    },
    body: JSON.stringify({
      pre_checkout_query: {
        id: "pcq_2",
        from: { id: 3003 },
        invoice_payload: "3003:gem_starter:abc123",
        total_amount: 1, // tampered — real price is 50
        currency: "XTR"
      }
    })
  });
  const call = telegramCalls.slice(before).find((c) => c.method === "answerPreCheckoutQuery");
  assert.equal(call.body.ok, false);
});

test("webhook: successful_payment records a purchase, then /api/entitlements delivers it exactly once", async () => {
  const chargeId = `charge_${Date.now()}`;
  await fetch(`${baseUrl}/api/webhook/${process.env.WEBHOOK_SECRET_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": process.env.WEBHOOK_SECRET_TOKEN
    },
    body: JSON.stringify({
      message: {
        successful_payment: {
          currency: "XTR",
          total_amount: 50,
          invoice_payload: "3003:gem_starter:abc123",
          telegram_payment_charge_id: chargeId
        }
      }
    })
  });

  const initData = makeUserInitData(3003);
  const res1 = await fetch(`${baseUrl}/api/entitlements?initData=${encodeURIComponent(initData)}`);
  const json1 = await res1.json();
  assert.equal(json1.entitlements.length, 1);
  assert.equal(json1.entitlements[0].productId, "gem_starter");
  assert.equal(json1.entitlements[0].chargeId, chargeId);

  const res2 = await fetch(`${baseUrl}/api/entitlements?initData=${encodeURIComponent(initData)}`);
  const json2 = await res2.json();
  assert.deepEqual(json2.entitlements, [], "entitlement should not be delivered twice");
});

test("webhook: redelivering the same successful_payment update does not double-credit the purchase", async () => {
  const chargeId = `charge_dup_${Date.now()}`;
  const payload = {
    message: {
      successful_payment: {
        currency: "XTR",
        total_amount: 40,
        invoice_payload: "4004:rare_summon:xyz789",
        telegram_payment_charge_id: chargeId
      }
    }
  };

  for (let i = 0; i < 2; i += 1) {
    await fetch(`${baseUrl}/api/webhook/${process.env.WEBHOOK_SECRET_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": process.env.WEBHOOK_SECRET_TOKEN
      },
      body: JSON.stringify(payload)
    });
  }

  const initData = makeUserInitData(4004);
  const res = await fetch(`${baseUrl}/api/entitlements?initData=${encodeURIComponent(initData)}`);
  const json = await res.json();
  assert.equal(json.entitlements.length, 1, "duplicate webhook delivery must not create a second entitlement");
});

test("POST /api/event: records an event without requiring initData", async () => {
  const res = await fetch(`${baseUrl}/api/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "achievement_claimed", props: { id: "first_win" } })
  });
  assert.equal(res.status, 200);
});

test("POST /api/event: rejects an oversized/missing event name", async () => {
  const res = await fetch(`${baseUrl}/api/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ props: {} })
  });
  assert.equal(res.status, 400);
});

test("admin: /admin redirects to login when not authenticated", async () => {
  const res = await fetch(`${baseUrl}/admin`, { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location"), /\/admin\/login/);
});

test("admin: wrong password does not grant a session cookie", async () => {
  const res = await fetch(`${baseUrl}/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "password=wrong-password",
    redirect: "manual"
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("set-cookie"), null);
  assert.match(res.headers.get("location"), /error=1/);
});

test("admin: correct password grants a session cookie that unlocks the dashboard", async () => {
  const loginRes = await fetch(`${baseUrl}/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "password=correct-password",
    redirect: "manual"
  });
  const setCookie = loginRes.headers.get("set-cookie");
  assert.ok(setCookie, "expected a Set-Cookie header on successful login");
  const cookie = setCookie.split(";")[0];

  const dashboardRes = await fetch(`${baseUrl}/admin`, { headers: { cookie } });
  assert.equal(dashboardRes.status, 200);
  const html = await dashboardRes.text();
  assert.match(html, /Total users/);
  assert.match(html, /Revenue by product/);
  assert.match(html, /gem_starter/); // the purchase recorded earlier should show up
});
