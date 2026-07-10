function required(name, fallback) {
  const value = process.env[name];
  if (value) return value;
  if (fallback !== undefined) return fallback;
  return null;
}

module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  BOT_TOKEN: process.env.BOT_TOKEN || null,
  PUBLIC_URL: process.env.PUBLIC_URL || null,
  WEBHOOK_SECRET_PATH: required("WEBHOOK_SECRET_PATH", "webhook"),
  WEBHOOK_SECRET_TOKEN: process.env.WEBHOOK_SECRET_TOKEN || null,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || null,
  SESSION_SECRET: process.env.SESSION_SECRET || "dev-only-insecure-secret-change-me",
  CORS_ORIGIN: process.env.CORS_ORIGIN || "*"
};
