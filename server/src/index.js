const express = require("express");
const config = require("./config");
const { setWebhook } = require("./telegram");
const apiRouter = require("./routes/api");
const webhookRouter = require("./routes/webhook");
const adminRouter = require("./routes/admin");

const app = express();

app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", config.CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.use(express.json({ limit: "64kb" }));

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "merge-arena-server" });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api", apiRouter);
app.use("/api", webhookRouter);
app.use("/", adminRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "internal error" });
});

function start() {
  const server = app.listen(config.PORT, () => {
    console.log(`merge-arena-server listening on :${config.PORT}`);
  });

  if (config.BOT_TOKEN && config.PUBLIC_URL) {
    const webhookUrl = `${config.PUBLIC_URL.replace(/\/$/, "")}/api/webhook/${config.WEBHOOK_SECRET_PATH}`;
    setWebhook(config.BOT_TOKEN, webhookUrl, config.WEBHOOK_SECRET_TOKEN)
      .then(() => console.log(`Telegram webhook registered: ${webhookUrl}`))
      .catch((err) => console.error("Failed to register Telegram webhook:", err.message));
  } else {
    console.warn(
      "BOT_TOKEN and/or PUBLIC_URL not set — Stars payments are disabled until both are configured."
    );
  }

  return server;
}

if (require.main === module) {
  start();
}

module.exports = { app, start };
