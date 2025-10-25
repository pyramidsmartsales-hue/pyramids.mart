// whatsapp.js
import pkg from "whatsapp-web.js";
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from "qrcode-terminal";

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "pyramidsmart" }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--unhandled-rejections=strict"],
  },
});

client.on("qr", (qr) => {
  console.log("📱 Scan this QR code (WhatsApp -> Linked devices -> Link a device):");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => console.log("✅ WhatsApp client is ready!"));
client.on("auth_failure", (msg) => console.error("Authentication failure:", msg));
client.on("disconnected", (reason) => console.log("WhatsApp disconnected:", reason));

client.initialize();

export { MessageMedia };
export default client;
