// whatsapp.js
// helper لدمج whatsapp-web.js (اختياري). هذا الملف يوفر:
// - exported: client (when initialized), MessageMedia (class), ensureClientReady(timeout), getNumberIdSafe(number),
//   normalizeNumber(number), getClient()

import path from "path";
import fs from "fs";
import qrcodeTerminal from "qrcode-terminal"; // لإظهار QR في الطرفية

let client = null;
let MessageMedia = null;
let ready = false;

async function tryLoadWhatsappWeb() {
  try {
    // dynamic import; this will fail if whatsapp-web.js isn't installed (that's fine)
    const mod = await import("whatsapp-web.js");
    const Client = mod.Client || (mod.default && mod.default.Client) || mod;
    MessageMedia = mod.MessageMedia || (mod.default && mod.default.MessageMedia) || mod.MessageMedia;
    const LocalAuth = mod.LocalAuth || (mod.default && mod.default.LocalAuth);

    if (!Client) {
      console.warn("whatsapp-web.js Client not found in module exports.");
      return null;
    }

    // Create client with LocalAuth for persistence
    const opts = {};
    if (LocalAuth) opts.authStrategy = new LocalAuth({ dataPath: "./.wwebjs_auth" });

    client = new Client(opts);

    client.on("ready", () => {
      ready = true;
      console.info("✅ WhatsApp client is ready.");
    });

    client.on("auth_failure", (msg) => {
      console.warn("❌ WhatsApp auth failure:", msg);
    });

    client.on("disconnected", (reason) => {
      ready = false;
      console.warn("⚠️ WhatsApp disconnected:", reason);
    });

    // عرض رمز QR في الطرفية للمسح
    client.on("qr", (qr) => {
      console.log("\n📱 WhatsApp QR code received — scan it using WhatsApp on your phone:\n");
      qrcodeTerminal.generate(qr, { small: true });
      console.log("\n(إذا لم يظهر الكود بشكل صحيح، تأكد من أن الخط في الطرفية يدعم رموز ASCII)\n");
    });

    // start client
    await client.initialize();
    return client;
  } catch (err) {
    console.warn("whatsapp-web.js not available or failed to initialize:", err && err.message ? err.message : err);
    client = null;
    return null;
  }
}

export async function getClient() {
  if (client) return client;
  return await tryLoadWhatsappWeb();
}

export async function ensureClientReady(timeout = 15000, poll = 500) {
  if (!client) await tryLoadWhatsappWeb();
  if (!client) return false;
  if (ready) return true;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (ready) return true;
    await new Promise((r) => setTimeout(r, poll));
  }
  return ready;
}

export function normalizeNumber(raw) {
  if (!raw) return raw;
  return String(raw).replace(/[^\d]/g, "");
}

export async function getNumberIdSafe(number) {
  if (!client) return null;
  try {
    if (typeof client.getNumberId === "function") {
      return await client.getNumberId(number);
    }
    return number;
  } catch (err) {
    console.warn("getNumberIdSafe error:", err && err.message ? err.message : err);
    return null;
  }
}

export { client, MessageMedia };
export default { getClient, ensureClientReady, normalizeNumber, getNumberIdSafe, client, MessageMedia };
