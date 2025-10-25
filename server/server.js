// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

import customersRouter from "./customers.js";
import sendRouter from "./send.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const __dirname = path.resolve();

// ✅ مسارات الـ API
app.use("/api/customers", customersRouter);
app.use("/api/send", sendRouter);

// ✅ Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ✅ تقديم الملفات الثابتة (index.html + assets)
const staticDir = path.join(__dirname);
app.use(express.static(staticDir));

// ✅ أي مسار غير API يرجع index.html
app.get(/^\/(?!api).*/, (req, res) => {
  const indexPath = path.join(staticDir, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send("✅ Pyramids Mart Server is running successfully!");
  }
});

// ✅ تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
