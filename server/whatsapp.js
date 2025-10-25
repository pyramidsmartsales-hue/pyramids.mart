// whatsapp.js
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode-terminal';

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "pyramidsmart" }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--no-zygote",
      "--single-process"
    ]
  }
});

client.on('qr', qr => {
  console.log('QR code received. Scan using WhatsApp -> Linked Devices -> Link a device:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp client ready');
});

client.on('auth_failure', msg => {
  console.error('Auth failure:', msg);
});

client.on('disconnected', reason => {
  console.log('WhatsApp disconnected:', reason);
});

export { client, MessageMedia };
export default client;
