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

// متغير لحفظ QR في الذاكرة
let lastQrDataUrl = null;

// دالة لحفظ الكود كصورة في uploads/last_qr.png
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
    console.log("QR event received — generating image...");
    // طباعة QR كـ ASCII في اللوج لتستطيع مسحه مباشرة من Logs
    qrcodeTerm.generate(qr, { small: true });

    // إنشاء PNG data URL
    const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 300 });
    lastQrDataUrl = dataUrl;

    // حفظ نسخة في uploads/last_qr.png للتأكد من توفرها لصفحة /qr
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

// بدء العميل
client.initialize();

// دالة تُرجع الكود من الذاكرة أو من الملف لو موجود
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
