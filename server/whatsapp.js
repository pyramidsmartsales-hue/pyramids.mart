// whatsapp.js
import pkg from "whatsapp-web.js";
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcodeTerm from "qrcode-terminal";
import QRCode from "qrcode";

import fs from "fs";
import path from "path";

const SESSION_DIR = path.join(process.cwd(), ".wwebjs_auth"); // default LocalAuth folder
const CLIENT_ID = "pyramidsmart";

// If environment requests reset, remove existing session folder before initializing
if (process.env.RESET_WA_SESSION === "true") {
  try {
    if (fs.existsSync(SESSION_DIR)) {
      console.log("RESET_WA_SESSION=true -> removing WhatsApp session folder:", SESSION_DIR);
      // recursive delete
      fs.rmSync(SESSION_DIR, { recursive: true, force: true });
      console.log("Session folder removed.");
    } else {
      console.log("RESET_WA_SESSION=true but session folder not found:", SESSION_DIR);
    }
  } catch (e) {
    console.warn("Could not remove session folder:", e.message);
  }
}

const client = new Client({
  authStrategy: new LocalAuth({ clientId: CLIENT_ID }),
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

// متغير لحفظ QR في الذاكرة
let lastQrDataUrl = null;

// helper: save QR image to uploads/last_qr.png
async function saveQrToFile(dataUrl) {
  try {
    const uploadDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    fs.writeFileSync(path.join(uploadDir, "last_qr.png"), base64, "base64");
  } catch (e) {
    console.warn("Could not save QR file:", e.message);
  }
}

client.on("qr", async (qr) => {
  try {
    console.log("QR event received — generating image and ASCII in logs...");
    qrcodeTerm.generate(qr, { small: true });

    const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 300 });
    lastQrDataUrl = dataUrl;
    await saveQrToFile(dataUrl);

    console.log("✅ QR generated and saved. Visit /qr to scan it.");
  } catch (err) {
    console.error("QR generation error:", err);
  }
});

client.on("ready", () => console.log("✅ WhatsApp client is ready!"));
client.on("authenticated", () => console.log("✅ Authenticated with WhatsApp (session saved)."));
client.on("auth_failure", (msg) => console.error("Authentication failure:", msg));
client.on("disconnected", (reason) => console.log("WhatsApp disconnected:", reason));

// initialize client
client.initialize();

// return dataURL from memory or file
function getLastQrDataUrl() {
  if (lastQrDataUrl) return lastQrDataUrl;

  const filePath = path.join(process.cwd(), "uploads", "last_qr.png");
  if (fs.existsSync(filePath)) {
    const base64 = fs.readFileSync(filePath).toString("base64");
    return `data:image/png;base64,${base64}`;
  }

  return null;
}

export { MessageMedia, getLastQrDataUrl };
export default client;
