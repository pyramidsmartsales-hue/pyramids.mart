// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const __dirname = path.resolve();

// حاول استيراد الروترات (هي ستصدر الـ Router كـ default)
async function loadRouterCandidates() {
  const candidates = [
    path.join(__dirname, "customers.js"),
    path.join(__dirname, "send.js"),
    path.join(__dirname, "server", "customers.js"),
    path.join(__dirname, "server", "send.js"),
    path.join(__dirname, "src", "customers.js"),
    path.join(__dirname, "src", "send.js"),
    path.join(__dirname, "src", "server", "customers.js"),
    path.join(__dirname, "src", "server", "send.js"),
  ];

  const routers = { customers: null, send: null };

  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const m = await import(`file://${p}`);
      const name = p.toLowerCase();
      if (name.includes("customers") && m.default) routers.customers = m.default;
      if (name.includes("send") && m.default) routers.send = m.default;
    } catch (err) {
      console.warn("Could not import candidate router:", p, err.message);
    }
  }

  return routers;
}

(async () => {
  const { customers, send } = await loadRouterCandidates();

  if (customers) app.use("/api/customers", customers);
  else {
    console.warn("customers router not found - mounting fallback.");
    const r = express.Router();
    r.get("/", (req, res) => res.json([]));
    app.use("/api/customers", r);
  }

  if (send) app.use("/api/send", send);
  else {
    console.warn("send router not found - mounting fallback.");
    const r = express.Router();
    r.post("/broadcast", (req, res) => res.json({ placeholder: true }));
    app.use("/api/send", r);
  }

  // Health
  app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

  // Static (serve index.html if exists)
  const staticDir = path.join(__dirname);
  app.use(express.static(staticDir));

  app.get(/^\/(?!api).*/, (req, res) => {
    const indexPath = path.join(staticDir, "index.html");
    if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
    return res.send("✅ Pyramids Mart Server is running successfully!");
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
})();
