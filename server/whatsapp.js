// whatsapp.js
// حفظ واستعادة جلسة WhatsApp عبر Cloudinary لضمان الثبات بين النشرات (deploys)

import fs from "fs";
import path from "path";
import qrcode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import AdmZip from "adm-zip";
import axios from "axios";
import { v2 as cloudinary } from "cloudinary";

// Robust import for whatsapp-web.js (works if it's CommonJS or ESM)
let Client, LocalAuth, MessageMedia;
try {
  // dynamic import so Node resolves appropriately
  const mod = await import("whatsapp-web.js");
  // If module is CommonJS, mod.default will be the exported object
  const root = mod.default || mod;
  Client = root.Client || root.client || undefined;
  LocalAuth = root.LocalAuth || root.localAuth || undefined;
  MessageMedia = root.MessageMedia || root.messageMedia || undefined;
} catch (err) {
  console.error("Failed to import whatsapp-web.js:", err.message || err);
  // let the rest run — later code will fail more clearly if not available
}

// ensure we actually got the required constructors
if (!Client) {
  throw new Error("whatsapp-web.js Client not available after import. Ensure package is installed and compatible.");
}

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
  console.warn("Cloudinary credentials not found in
