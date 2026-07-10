const crypto = require("crypto");

const COOKIE_NAME = "merge_arena_admin";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function createSessionToken(secret) {
  const payload = JSON.stringify({ exp: Date.now() + SESSION_TTL_MS });
  const encoded = Buffer.from(payload).toString("base64url");
  const signature = sign(encoded, secret);
  return `${encoded}.${signature}`;
}

function verifySessionToken(token, secret) {
  if (!token || typeof token !== "string" || !token.includes(".")) return false;
  const [encoded, signature] = token.split(".");
  const expected = sign(encoded, secret);
  if (expected.length !== signature.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

// Simple in-memory rate limit for login attempts — resets on process
// restart, which is fine for a low-traffic admin login endpoint. Not meant
// to replace a real WAF, just to slow down naive brute-forcing.
const attemptsByIp = new Map();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

function isRateLimited(ip) {
  const entry = attemptsByIp.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.windowStart > WINDOW_MS) {
    attemptsByIp.delete(ip);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailedAttempt(ip) {
  const entry = attemptsByIp.get(ip);
  if (!entry || Date.now() - entry.windowStart > WINDOW_MS) {
    attemptsByIp.set(ip, { count: 1, windowStart: Date.now() });
    return;
  }
  entry.count += 1;
}

function clearAttempts(ip) {
  attemptsByIp.delete(ip);
}

module.exports = {
  COOKIE_NAME,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  isRateLimited,
  recordFailedAttempt,
  clearAttempts
};
