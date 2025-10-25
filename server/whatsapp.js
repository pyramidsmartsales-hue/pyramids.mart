// whatsapp.js
import pkg from "whatsapp-web.js";
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcodeTerm from "qrcode-terminal";
import QRCode from "qrcode";

import fs from "fs";
import path from "path";

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "pyramidsmart" }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--no-zygote",
      "--single-process",
    ],
  },
});

// store last QR as data URL
let lastQrDataUrl = null;

client.on("qr", async (qr) => {
  try {
    console.log("QR event received (string). Generating PNG and ASCII in logs...");
    // ASCII QR in logs
    qrcodeTerm.generate(qr, { small: true });

    // create PNG dataUrl
    const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 300 });
    lastQrDataUrl = dataUrl;

    // save to uploads/last_qr.png
    try {
      const uploadDir = path.join(process.cwd(), "uploads");
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
      fs.writeFileSync(path.join(uploadDir, "last_qr.png"), base64, "base64");
    } catch (e) {
      console.warn("Could not save QR file:", e.message);
    }

    console.log("QR image generated and stored in memory. Visit /qr to view it.");
  } catch (err) {
    console.error("Error generating QR image:", err);
  }
});

client.on("ready", () => {
  console.log("✅ WhatsApp client is ready!");
});

client.on("authenticated", () => {
  console.log("✅ Authenticated with WhatsApp (session saved).");
});

client.on("auth_failure", (msg) => {
  console.error("Authentication failure:", msg);
});

client.on("disconnected", (reason) => {
  console.log("WhatsApp disconnected:", reason);
});

// initialize
client.initialize();

// helper to get last QR
function getLastQrDataUrl() {
  return lastQrDataUrl;
}

export { MessageMedia, getLastQrDataUrl };
export default client;
