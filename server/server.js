// server.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import path from "path";
import fs from "fs";

import customersRouter from "./customers.js";
let sendRouter;
try {
  const mod = await import("./send.js");
  sendRouter = mod.default ?? mod;
} catch (err) {
  console.warn("send.js not imported:", err && err.message ? err.message : err);
}

const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

if (customersRouter) {
  app.use("/api/customers", customersRouter.default ?? customersRouter);
}
if (sendRouter) {
  app.use("/api/send", sendRouter.default ?? sendRouter);
}

// Serve uploads (if any)
const uploadsDir = path.join(process.cwd(), "uploads");
if (fs.existsSync(uploadsDir)) {
  app.use("/uploads", express.static(uploadsDir));
}

app.get("/", (req, res) => {
  res.send("OK — Pyramida Smart Service API");
});

app.use((req, res) => res.status(404).json({ error: "not_found" }));

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err && (err.stack || err.message) ? (err.stack || err.message) : err);
  res.status(500).json({ error: "server_error", message: err && err.message ? err.message : String(err) });
});

const port = parseInt(process.env.PORT || process.env.PORT_NUMBER || "3000", 10);
app.listen(port, () => {
  console.log(`Server started on port ${port} (NODE_ENV=${process.env.NODE_ENV || "development"})`);
});
