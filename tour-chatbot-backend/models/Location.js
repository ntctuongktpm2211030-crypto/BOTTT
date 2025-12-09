// models/Location.js
import mongoose from "mongoose";

/**
 * Schema này KHÔNG ép buộc quá chặt,
 * để bạn có thể dùng lại collection vị trí đang có sẵn trên Mongo.
 *
 * Giả sử document hiện tại có dạng:
 * {
 *    _id: ...,
 *    name: "Cần Thơ",
 *    lat: 10.04516,
 *    lng: 105.74685,
 *    aliases: ["can tho", "thanh pho can tho"],
 *    searchKey: "can tho thanh pho can tho"
 *    // ... các field khác cũng không sao
 * }
 *
 * 👉 Nếu tên field khác (vd: latitude/longitude), chỉ cần sửa lại dưới đây.
 */

const LocationSchema = new mongoose.Schema(
  {
    name: { type: String },          // Tên hiển thị: "Cần Thơ", "Đà Nẵng", ...
    aliases: [{ type: String }],     // Mảng alias: ["can tho", "thanh pho can tho"]
    lat: { type: Number },           // Vĩ độ
    lng: { type: Number },           // Kinh độ

    // Field bỏ dấu / chuẩn hoá để search
    searchKey: { type: String },

    // Nếu collection có thêm field khác thì cứ để thoải mái,
    // không cần khai báo hết.
  },
  {
    // ⚠️ ĐỔI CHO ĐÚNG TÊN COLLECTION THẬT CỦA BẠN
    // ví dụ bạn đang dùng "atm_locations" thì để collection: "atm_locations"
    collection: "locations",
    timestamps: false
  }
);

export const Location = mongoose.model("Location", LocationSchema);
