// db/mongo.js
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

export async function connectMongo() {
  // Lấy từ .env
  const uri = process.env.MONGO_URI; // ví dụ mongodb+srv://...

  if (!uri) {
    console.warn("⚠️ MONGO_URI chưa cấu hình, sẽ không lưu lịch sử chat.");
    return;
  }

  // 1 = connected, 2 = connecting
  if (mongoose.connection.readyState === 1) return;

  try {
    await mongoose.connect(uri, {
      dbName: process.env.MONGO_DB_NAME || "tour_chatbot",
    });
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connect error:", err.message);
  }
}
