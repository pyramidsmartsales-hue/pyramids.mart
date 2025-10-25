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

// محاولة تحميل routers من مواقع متعددة (إذا وجدت)
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

  // Attempt to import whatsapp helper to serve /qr (if available)
  let getLastQrDataUrl = null;
  try {
    const w = await import(`file://${path.join(__dirname, "whatsapp.js")}`);
    getLastQrDataUrl = w.getLastQrDataUrl || w.default?.getLastQrDataUrl || null;
    // Some versions export named function; others export directly. We try common variants.
    if (!getLastQrDataUrl && w.getLastQrDataUrl === undefined && w.default?.getLastQrDataUrl === undefined && w.getLastQrDataUrl === undefined) {
      // if no function, but module exported function as named export
      getLastQrDataUrl = w.getLastQrDataUrl || null;
    }
  } catch (e) {
    console.warn("whatsapp.js not loadable for /qr route:", e.message);
  }

  // Health
  app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

  // /qr route: show last QR image (if whatsapp.js stores it)
  app.get("/qr", (req, res) => {
    try {
      if (!getLastQrDataUrl) {
        return res.send(`<h3>No QR available right now.</h3>
          <p>Either the WhatsApp client is already authenticated, or the server hasn't emitted a QR yet. Check logs for 'QR event received'.</p>
          <p>Also ensure whatsapp.js exports getLastQrDataUrl and you installed the 'qrcode' package.</p>`);
      }
      const dataUrl = getLastQrDataUrl();
      if (!dataUrl) {
        return res.send(`<h3>No QR available right now.</h3>
          <p>Check server logs for "QR event received".</p>`);
      }
      return res.send(`
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;font-family:Arial">
          <h2>Scan this QR with WhatsApp (Linked devices → Link a device)</h2>
          <img src="${dataUrl}" alt="whatsapp-qr" style="width:300px;height:300px;border:1px solid #ddd;padding:8px;background:#fff"/>
          <p style="color:#666">If it does not appear, check server logs in Render for the 'qr' event.</p>
        </div>
      `);
    } catch (err) {
      console.error("Error serving /qr:", err);
      res.status(500).send("Internal error");
    }
  });

  // Static files (index.html etc)
  const staticDir = path.join(__dirname);
  app.use(express.static(staticDir));

  // Any non-API and non-QR route -> index.html (SPA)
  app.get(/^\/(?!api|qr).*/, (req, res) => {
    const indexPath = path.join(staticDir, "index.html");
    if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
    return res.send("✅ Pyramids Mart Server is running successfully!");
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
})();
