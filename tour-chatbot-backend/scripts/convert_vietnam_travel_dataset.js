// scripts/convert_vietnam_travel_dataset.js
// Script convert vietnam_travel_dataset.xlsx -> data/destinations.json

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

// DÙNG require cho xlsx để dùng được XLSX.readFile
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

// Lấy __dirname trong ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==== 1. Đường dẫn file vào/ra ====
const inputPath = path.join(__dirname, "..", "raw_data", "vietnam_travel_dataset.xlsx");
// Ví dụ bạn để file ở: D:/botTT/tour-chatbot-backend/raw_data/vietnam_travel_dataset.xlsx

const outputPath = path.join(__dirname, "..", "data", "destinations.json");

// ==== 2. Đọc file Excel ====
if (!fs.existsSync(inputPath)) {
  console.error("❌ Không tìm thấy file:", inputPath);
  process.exit(1);
}

console.log("📂 Đang đọc file Excel:", inputPath);

const workbook = XLSX.readFile(inputPath);   // <-- Bây giờ dùng được
const firstSheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[firstSheetName];

// Chuyển sheet -> array object
const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

console.log("📊 Số dòng đọc được từ Excel:", rows.length);

// ==== 3. Map sang schema destinations.json ====
const destinations = rows.map((row, index) => ({
  id: row.id || row.ID || `dest-${index + 1}`,
  city: row.city || row.City || row.province || row.Province || row.Location || "",
  country: row.country || row.Country || "Vietnam",
  name: row.name || row.PlaceName || row.Destination || row.Title || "",
  description: row.description || row.Description || "",
  highlights: String(row.highlights || row.Highlights || row.Tags || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  bestTime: row.bestTime || row.BestTime || row.Season || "",
  tags: String(row.tags || row.Category || row.Type || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  lat: row.lat || row.latitude || row.Lat || null,
  lng: row.lng || row.longitude || row.Lng || null
}));

// ==== 4. Ghi ra JSON ====
if (!fs.existsSync(path.join(__dirname, "..", "data"))) {
  fs.mkdirSync(path.join(__dirname, "..", "data"), { recursive: true });
}

fs.writeFileSync(outputPath, JSON.stringify(destinations, null, 2), "utf8");

console.log("✅ Đã xuất ra:", outputPath);
console.log("✅ Tổng số destinations:", destinations.length);
