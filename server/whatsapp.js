// whatsapp.js
// حفظ واستعادة جلسة WhatsApp عبر Cloudinary لضمان الثبات بين النشرات (deploys)

import fs from "fs";
import path from "path";
import qrcode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js";
import { v2 as cloudinary } from "cloudinary";
import AdmZip from "adm-zip";
import axios from "axios";

const cwd = process.cwd();
const uploadsDir = path.join(cwd, "uploads");
const authDir = path.join(cwd, ".wwebjs_auth");
const lastQrFile = path.join(uploadsDir, "last_qr.png");
const sessionZipTmp = path.join(uploadsDir, "wwebjs_auth.zip");

// ensure folders exist
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

// Cloudinary config from environment
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "";
const CLOUD_KEY = process.env.CLOUDINARY_API_KEY || "";
const CLOUD_SECRET = process.env.CLOUDINARY_API_SECRET || "";
const SESSION_PUBLIC_ID = process.env.SESSION_PUBLIC_ID || "wa_session_default";

if (CLOUD_NAME && CLOUD_KEY && CLOUD_SECRET) {
  cloudinary.config({
    cloud_name: CLOUD_NAME,
    api_key: CLOUD_KEY,
    api_secret: CLOUD_SECRET,
    secure: true,
  });
} else {
  console.warn("Cloudinary credentials not found in environment. Session backup disabled.");
}

// store last QR data url (for /qr)
let lastQrDataUrl = null;

// Helper: save data URL (base64 PNG) to file
async function saveDataUrlToPng(dataUrl, filepath) {
  try {
    const matches = dataUrl.match(/^data:(image\/png|image\/jpeg);base64,(.+)$/);
    if (!matches) {
      const buffer = Buffer.from(dataUrl.split(",")[1], "base64");
      fs.writeFileSync(filepath, buffer);
      return;
    }
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, "base64");
    fs.writeFileSync(filepath, buffer);
  } catch (e) {
    console.warn("Could not save QR file:", e.message);
  }
}

// Helper: zip the .wwebjs_auth folder
function zipAuthFolder(outputZipPath) {
  const zip = new AdmZip();
  if (!fs.existsSync(authDir)) return false;
  zip.addLocalFolder(authDir);
  zip.writeZip(outputZipPath);
  return true;
}

// Helper: extract zip to auth folder (overwrite)
function extractZipToAuth(zipPath) {
  const zip = new AdmZip(zipPath);
  if (fs.existsSync(authDir)) {
    fs.rmSync(authDir, { recursive: true, force: true });
  }
  fs.mkdirSync(authDir, { recursive: true });
  zip.extractAllTo(authDir, true);
}

// Upload zip file to Cloudinary (overwrite public_id)
async function uploadSessionToCloudinary(zipPath) {
  if (!cloudinary || !CLOUD_NAME) {
    console.warn("Cloudinary not configured; skipping upload.");
    return null;
  }
  if (!fs.existsSync(zipPath)) {
    console.warn("Session zip not found for upload:", zipPath);
    return null;
  }
  try {
    const res = await cloudinary.uploader.upload(zipPath, {
      resource_type: "auto",
      public_id: SESSION_PUBLIC_ID,
      overwrite: true,
      folder: "wa_sessions",
    });
    console.info("Session uploaded to Cloudinary:", res.public_id);
    return res;
  } catch (e) {
    console.error("Failed to upload session to Cloudinary:", e.message || e);
    return null;
  }
}

// Download session zip from Cloudinary (if exists) and extract
async function downloadSessionFromCloudinary() {
  if (!cloudinary || !CLOUD_NAME) {
    return false;
  }
  try {
    // Try to get resource directly
    const info = await cloudinary.api.resource(SESSION_PUBLIC_ID, { resource_type: "raw" }).catch(() => null);
    if (info && info.secure_url) {
      const url = info.secure_url;
      const response = await axios.get(url, { responseType: "arraybuffer" });
      fs.writeFileSync(sessionZipTmp, Buffer.from(response.data));
      extractZipToAuth(sessionZipTmp);
      fs.unlinkSync(sessionZipTmp);
      console.info("Session restored from Cloudinary.");
      return true;
    }
    // fallback: list resources in folder
    const list = await cloudinary.api.resources({ type: "upload", prefix: `wa_sessions/${SESSION_PUBLIC_ID}` }).catch(() => null);
    if (list && list.resources && list.resources.length > 0) {
      const url = list.resources[0].secure_url;
      const r = await axios.get(url, { responseType: "arraybuffer" });
      fs.writeFileSync(sessionZipTmp, Buffer.from(r.data));
      extractZipToAuth(sessionZipTmp);
      fs.unlinkSync(sessionZipTmp);
      console.info("Session restored from Cloudinary (by list).");
      return true;
    }
    console.info("No session found on Cloudinary to restore.");
    return false;
  } catch (e) {
    console.warn("Could not download session from Cloudinary:", e.message || e);
    return false;
  }
}

// *** Initialize client ***
// Before initializing, attempt to restore session from Cloudinary (if credentials present).
(async () => {
  if (CLOUD_NAME && CLOUD_KEY && CLOUD_SECRET) {
    try {
      console.info("Trying to restore session from Cloudinary...");
      await downloadSessionFromCloudinary();
    } catch (e) {
      console.warn("Session restore attempt failed:", e.message || e);
    }
  }
})();

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "server",
    dataPath: authDir,
  }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
    ],
  },
  takeoverOnConflict: true,
});

// QR event -> generate PNG and ASCII
client.on("qr", async (qr) => {
  try {
    const dataUrl = await qrcode.toDataURL(qr, { errorCorrectionLevel: "H", margin: 1, width: 600 });
    lastQrDataUrl = dataUrl;
    await saveDataUrlToPng(dataUrl, lastQrFile);
    qrcodeTerminal.generate(qr, { small: true });
    console.info("✅ QR generated and saved. Visit /qr to scan it.");
    console.info("QR event received — generating image and ASCII in logs...");
  } catch (e) {
    console.error("Error on QR event:", e.message || e);
  }
});

client.on("ready", () => {
  console.info("✅ WhatsApp client is ready!");
  lastQrDataUrl = null;
});

client.on("authenticated", async (session) => {
  console.info("✅ Authenticated with WhatsApp (session saved).");
  // create zip and upload to Cloudinary
  try {
    const zipped = zipAuthFolder(sessionZipTmp);
    if (zipped && CLOUD_NAME && CLOUD_KEY && CLOUD_SECRET) {
      await uploadSessionToCloudinary(sessionZipTmp);
      if (fs.existsSync(sessionZipTmp)) fs.unlinkSync(sessionZipTmp);
    } else {
      console.info("Cloudinary not configured or zip failed; not uploading session.");
    }
  } catch (e) {
    console.warn("Failed to save/upload session:", e.message || e);
  }
});

client.on("auth_failure", (msg) => {
  console.error("Authentication failure:", msg);
});

client.on("disconnected", (reason) => {
  console.warn("WhatsApp client disconnected:", reason);
  // LocalAuth will keep session files; if they exist they will be reused on next start.
});

// init
(async () => {
  try {
    await client.initialize();
  } catch (e) {
    console.error("Failed to initialize WhatsApp client:", e.message || e);
  }
})();

export default client;
export { MessageMedia };

function getLastQrDataUrl() {
  return lastQrDataUrl;
}
export { getLastQrDataUrl };
