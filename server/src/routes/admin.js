const express = require("express");
const config = require("../config");
const { db, nowIso } = require("../db");
const {
  COOKIE_NAME,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  isRateLimited,
  recordFailedAttempt,
  clearAttempts
} = require("../adminAuth");

const router = express.Router();

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

function layout(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${escapeHtml(title)} · Merge Arena Admin</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #0f0a1a; color: #f2ecff; font-family: system-ui, sans-serif; padding: 24px; }
    a { color: #ffc857; }
    h1 { font-size: 20px; margin: 0 0 20px; }
    h2 { font-size: 15px; margin: 28px 0 10px; color: #d9c8ff; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
    .card { background: #1c1330; border: 1px solid #33224d; border-radius: 12px; padding: 14px; }
    .card strong { display: block; font-size: 24px; }
    .card span { font-size: 11px; color: #a893d9; text-transform: uppercase; letter-spacing: 0.05em; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #2a1d44; }
    th { color: #a893d9; font-weight: 600; font-size: 11px; text-transform: uppercase; }
    form { display: flex; flex-direction: column; gap: 10px; max-width: 280px; margin: 60px auto; }
    input { padding: 10px; border-radius: 8px; border: 1px solid #33224d; background: #1c1330; color: #fff; }
    button { padding: 10px; border-radius: 8px; border: none; background: #ffc857; color: #2a1030; font-weight: 700; cursor: pointer; }
    .error { color: #ff6b8a; font-size: 13px; }
    .topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

router.get("/admin/login", (req, res) => {
  res.send(
    layout(
      "Login",
      `<form method="post" action="/admin/login">
        <h1>Merge Arena Admin</h1>
        ${req.query.error ? `<p class="error">Wrong password, or too many attempts — try again later.</p>` : ""}
        <input type="password" name="password" placeholder="Admin password" autofocus required />
        <button type="submit">Log in</button>
      </form>`
    )
  );
});

router.post("/admin/login", express.urlencoded({ extended: false }), (req, res) => {
  const ip = req.ip || "unknown";
  if (isRateLimited(ip)) return res.redirect("/admin/login?error=1");
  if (!config.ADMIN_PASSWORD || req.body.password !== config.ADMIN_PASSWORD) {
    recordFailedAttempt(ip);
    return res.redirect("/admin/login?error=1");
  }
  clearAttempts(ip);
  const token = createSessionToken(config.SESSION_SECRET);
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=43200`
  );
  res.redirect("/admin");
});

router.get("/admin/logout", (req, res) => {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`);
  res.redirect("/admin/login");
});

function requireAdminSession(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  if (!verifySessionToken(cookies[COOKIE_NAME], config.SESSION_SECRET)) {
    return res.redirect("/admin/login");
  }
  next();
}

router.get("/admin", requireAdminSession, (req, res) => {
  const totalUsers = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const dau = db
    .prepare("SELECT COUNT(DISTINCT telegram_id) AS n FROM sessions WHERE created_at >= ?")
    .get(dayAgo).n;
  const wau = db
    .prepare("SELECT COUNT(DISTINCT telegram_id) AS n FROM sessions WHERE created_at >= ?")
    .get(weekAgo).n;

  const revenueRow = db
    .prepare("SELECT COALESCE(SUM(stars_amount), 0) AS total, COUNT(*) AS n FROM purchases WHERE status = 'confirmed'")
    .get();

  const revenueByProduct = db
    .prepare(
      `SELECT product_id, COUNT(*) AS purchases, SUM(stars_amount) AS revenue
       FROM purchases WHERE status = 'confirmed' GROUP BY product_id ORDER BY revenue DESC`
    )
    .all();

  const campaigns = db
    .prepare(
      `SELECT COALESCE(first_start_param, '(direct / no campaign)') AS campaign, COUNT(*) AS installs
       FROM users GROUP BY first_start_param ORDER BY installs DESC LIMIT 20`
    )
    .all();

  const campaignRevenue = db
    .prepare(
      `SELECT COALESCE(u.first_start_param, '(direct / no campaign)') AS campaign, SUM(p.stars_amount) AS revenue
       FROM purchases p JOIN users u ON u.telegram_id = p.telegram_id
       WHERE p.status = 'confirmed'
       GROUP BY u.first_start_param`
    )
    .all();
  const revenueByCampaign = Object.fromEntries(campaignRevenue.map((r) => [r.campaign, r.revenue]));

  const achievementEvents = db
    .prepare("SELECT props FROM events WHERE name = 'achievement_claimed'")
    .all();
  const achievementCounts = {};
  achievementEvents.forEach((row) => {
    try {
      const id = JSON.parse(row.props || "{}").id || "unknown";
      achievementCounts[id] = (achievementCounts[id] || 0) + 1;
    } catch {
      // ignore malformed props
    }
  });

  const recentPurchases = db
    .prepare("SELECT * FROM purchases ORDER BY id DESC LIMIT 30")
    .all();
  const recentEvents = db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT 30").all();

  const body = `
    <div class="topbar">
      <h1>Merge Arena — Admin</h1>
      <a href="/admin/logout">Log out</a>
    </div>

    <div class="grid">
      <div class="card"><span>Total users</span><strong>${totalUsers}</strong></div>
      <div class="card"><span>DAU (24h)</span><strong>${dau}</strong></div>
      <div class="card"><span>WAU (7d)</span><strong>${wau}</strong></div>
      <div class="card"><span>Total revenue</span><strong>${revenueRow.total} ★</strong></div>
      <div class="card"><span>Total purchases</span><strong>${revenueRow.n}</strong></div>
    </div>

    <h2>Revenue by product</h2>
    <table>
      <tr><th>Product</th><th>Purchases</th><th>Revenue (★)</th></tr>
      ${revenueByProduct
        .map((r) => `<tr><td>${escapeHtml(r.product_id)}</td><td>${r.purchases}</td><td>${r.revenue}</td></tr>`)
        .join("") || `<tr><td colspan="3">No purchases yet.</td></tr>`}
    </table>

    <h2>Ad campaigns (by start_param on first open)</h2>
    <table>
      <tr><th>Campaign</th><th>Installs</th><th>Revenue (★)</th></tr>
      ${campaigns
        .map(
          (r) =>
            `<tr><td>${escapeHtml(r.campaign)}</td><td>${r.installs}</td><td>${revenueByCampaign[r.campaign] || 0}</td></tr>`
        )
        .join("") || `<tr><td colspan="3">No users yet.</td></tr>`}
    </table>

    <h2>Achievement claims</h2>
    <table>
      <tr><th>Achievement</th><th>Claims</th></tr>
      ${
        Object.entries(achievementCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([id, count]) => `<tr><td>${escapeHtml(id)}</td><td>${count}</td></tr>`)
          .join("") || `<tr><td colspan="2">No achievements claimed yet.</td></tr>`
      }
    </table>

    <h2>Recent purchases</h2>
    <table>
      <tr><th>When</th><th>User</th><th>Product</th><th>Stars</th><th>Charge ID</th></tr>
      ${
        recentPurchases
          .map(
            (p) =>
              `<tr><td>${escapeHtml(p.created_at)}</td><td>${escapeHtml(p.telegram_id)}</td><td>${escapeHtml(p.product_id)}</td><td>${p.stars_amount}</td><td>${escapeHtml(p.telegram_payment_charge_id)}</td></tr>`
          )
          .join("") || `<tr><td colspan="5">No purchases yet.</td></tr>`
      }
    </table>

    <h2>Recent events</h2>
    <table>
      <tr><th>When</th><th>User</th><th>Event</th><th>Props</th></tr>
      ${
        recentEvents
          .map(
            (e) =>
              `<tr><td>${escapeHtml(e.created_at)}</td><td>${escapeHtml(e.telegram_id || "-")}</td><td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.props || "")}</td></tr>`
          )
          .join("") || `<tr><td colspan="4">No events yet.</td></tr>`
      }
    </table>

    <p style="margin-top:24px;color:#6b5a94;font-size:11px;">Generated ${escapeHtml(nowIso())}</p>
  `;

  res.send(layout("Dashboard", body));
});

module.exports = router;
