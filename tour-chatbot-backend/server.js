// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import Fuse from "fuse.js";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

import { Location } from "./models/Location.js"; // ✅ dùng data vị trí có sẵn

dotenv.config();

/* ==========================
   0. KẾT NỐI MONGO (LƯU LỊCH SỬ CHAT + LOCATION)
========================== */

const MONGO_URI = process.env.MONGO_URI || "";
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || "tour_chatbot";
const MONGO_ENABLED = !!MONGO_URI;

if (!MONGO_ENABLED) {
  console.warn(
    "⚠️  Không có MONGO_URI, lịch sử chat & vị trí sẽ không lưu vào database."
  );
} else {
  mongoose
    .connect(MONGO_URI, { dbName: MONGO_DB_NAME })
    .then(() => console.log("✅ MongoDB connected"))
    .catch((err) =>
      console.error("❌ MongoDB connect error:", err.message || err)
    );
}

// Schema lưu lịch sử các message trong 1 cuộc hội thoại
const MessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true }
  },
  { _id: false, timestamps: true }
);

const ConversationSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true }, // FE lưu clientId trong localStorage
    title: { type: String, default: "" },
    messages: [MessageSchema]
  },
  { timestamps: true }
);

const Conversation = mongoose.model("Conversation", ConversationSchema);

/* ==========================
   1. CẤU HÌNH LLM
========================== */

const LLM_PROVIDER = process.env.LLM_PROVIDER || "openrouter";
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_BASE_URL =
  (process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1").replace(
    /\/$/,
    ""
  );
const LLM_MODEL = process.env.LLM_MODEL || "google/gemma-2-9b-it";

if (!LLM_API_KEY) {
  console.warn(
    "⚠️  Chưa có LLM_API_KEY trong .env, chatbot sẽ không gọi được LLM."
  );
}

async function callLLMChat({ system, user }) {
  if (!LLM_API_KEY) {
    console.warn("⚠️ Thiếu LLM_API_KEY, trả lời demo.");
    return "Hiện tại mình chưa kết nối được tới LLM, bạn kiểm tra lại API key giúp mình nhé.";
  }

  const url = `${LLM_BASE_URL}/chat/completions`;

  const body = {
    model: LLM_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    temperature: 0.7
  };

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${LLM_API_KEY}`
  };

  if (LLM_PROVIDER === "openrouter") {
    headers["HTTP-Referer"] =
      process.env.APP_PUBLIC_URL || "http://localhost:5173";
    headers["X-Title"] = "Tour Recommendation Chatbot";
  }

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    const error = new Error(`LLM API error: ${resp.status} ${resp.statusText}`);
    error.status = resp.status;
    error.rawBody = errBody;
    console.error("⚠️ LLM error body:", errBody);
    throw error;
  }

  const data = await resp.json();
  const reply = data.choices?.[0]?.message?.content;
  return reply || "Xin lỗi, mình chưa trả lời được câu hỏi này.";
}

/* ==========================
   2. HELPER CHUNG
========================== */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function removeVietnameseTones(str = "") {
  if (!str) return "";
  let s = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/đ/g, "d").replace(/Đ/g, "D");
  return s.toLowerCase();
}

/* ========= SESSION TRONG RAM (NHỚ lastLocation & HISTORY) ========= */

const MAX_HISTORY = 10;

const sessions = {
  // [sessionId]: {
  //   lastLocation: string | null,
  //   lastCoords: { lat, lng } | null,
  //   history: [{ role: "user" | "assistant", content: string }]
  // }
};

function appendHistory(session, role, content) {
  if (!session.history) session.history = [];
  session.history.push({ role, content });
  if (session.history.length > MAX_HISTORY) {
    session.history = session.history.slice(-MAX_HISTORY);
  }
}

/* ==========================
   3. LOAD DATA JSON (DEST, FLIGHTS, FOODS, TOURS, POLICIES, TIPS)
========================== */

// --- 3.1 Destinations ---
const destinationsPath = path.join(__dirname, "data", "destinations.json");
let destinations = [];
let destinationsFuse = null;

try {
  const fileContent = fs.readFileSync(destinationsPath, "utf8");
  const raw = JSON.parse(fileContent);
  destinations = raw.map((d) => {
    const name =
      `${d.city || ""} ${d.name || ""} ${d.country || ""} ${(
        d.tags || []
      ).join(" ")}`.trim();
    return {
      ...d,
      searchKey: removeVietnameseTones(name)
    };
  });

  destinationsFuse = new Fuse(destinations, {
    keys: ["searchKey"],
    includeScore: true,
    threshold: 0.35
  });

  console.log("✅ Loaded destinations:", destinations.length);
} catch (err) {
  console.error("⚠️ Không thể load data destinations.json:", err.message);
}

// --- 3.2 Flights estimates ---
const flightEstimatesPath = path.join(
  __dirname,
  "data",
  "flight_price_estimates.json"
);
let flightEstimates = [];
try {
  const flightContent = fs.readFileSync(flightEstimatesPath, "utf8");
  flightEstimates = JSON.parse(flightContent);
  console.log("✅ Loaded flight estimates:", flightEstimates.length);
} catch (err) {
  console.error(
    "⚠️ Không thể load flight_price_estimates.json:",
    err.message
  );
}

function findFlightEstimate(origin, destination) {
  if (!flightEstimates || flightEstimates.length === 0) return null;
  const o = origin.toUpperCase();
  const d = destination.toUpperCase();
  const route1 = `${o}-${d}`;
  const route2 = `${d}-${o}`;

  return flightEstimates.find(
    (r) =>
      r.routeCode.toUpperCase() === route1 ||
      r.routeCode.toUpperCase() === route2
  );
}

// --- 3.3 Foods ---
const foodsPath = path.join(__dirname, "data", "foods.json");
let foods = [];
let foodsFuse = null;

try {
  const foodContent = fs.readFileSync(foodsPath, "utf8");
  const rawFoods = JSON.parse(foodContent);
  foods = rawFoods.map((f) => {
    const combined =
      `${f.city || ""} ${f.country || ""} ${f.dishName || ""} ${(
        f.tags || []
      ).join(" ")}`.trim();
    return {
      ...f,
      searchKey: removeVietnameseTones(combined)
    };
  });

  foodsFuse = new Fuse(foods, {
    keys: ["searchKey"],
    includeScore: true,
    threshold: 0.35
  });

  console.log("✅ Loaded foods:", foods.length);
} catch (err) {
  console.error("⚠️ Không thể load foods.json:", err.message);
}

// --- 3.4 Tours ---
const toursPath = path.join(__dirname, "data", "tours.json");
let tours = [];
let toursFuse = null;

try {
  const toursContent = fs.readFileSync(toursPath, "utf8");
  const rawTours = JSON.parse(toursContent);
  tours = rawTours.map((t) => {
    const combined =
      `${t.title || ""} ${(t.destinations || []).join(" ")} ${(t.style || []).join(
        " "
      )} ${(t.target || []).join(" ")}`.trim();
    return {
      ...t,
      searchKey: removeVietnameseTones(combined)
    };
  });

  toursFuse = new Fuse(tours, {
    keys: ["searchKey"],
    includeScore: true,
    threshold: 0.35
  });

  console.log("✅ Loaded tours:", tours.length);
} catch (err) {
  console.error("⚠️ Không thể load tours.json:", err.message);
}

// --- 3.5 Policies ---
const policiesPath = path.join(__dirname, "data", "policies.json");
let policies = [];
let policiesFuse = null;

try {
  const policiesContent = fs.readFileSync(policiesPath, "utf8");
  const rawPolicies = JSON.parse(policiesContent);
  policies = rawPolicies.map((p) => {
    const combined =
      `${p.category || ""} ${p.title || ""} ${(p.keywords || []).join(
        " "
      )}`.trim();
    return {
      ...p,
      searchKey: removeVietnameseTones(combined)
    };
  });

  policiesFuse = new Fuse(policies, {
    keys: ["searchKey"],
    includeScore: true,
    threshold: 0.35
  });

  console.log("✅ Loaded policies:", policies.length);
} catch (err) {
  console.error("⚠️ Không thể load policies.json:", err.message);
}

// --- 3.6 Travel tips ---
const tipsPath = path.join(__dirname, "data", "travel_tips.json");
let travelTips = [];
let tipsFuse = null;

try {
  const tipsContent = fs.readFileSync(tipsPath, "utf8");
  const rawTips = JSON.parse(tipsContent);
  travelTips = rawTips.map((t) => {
    const combined =
      `${t.topic || ""} ${t.title || ""} ${(t.tags || []).join(" ")}`.trim();
    return {
      ...t,
      searchKey: removeVietnameseTones(combined)
    };
  });

  tipsFuse = new Fuse(travelTips, {
    keys: ["searchKey"],
    includeScore: true,
    threshold: 0.35
  });

  console.log("✅ Loaded travel tips:", travelTips.length);
} catch (err) {
  console.error("⚠️ Không thể load travel_tips.json:", err.message);
}

/* ==========================
   3.x DETECT LOCATION TỪ MONGODB
========================== */

/**
 * Dùng data vị trí có sẵn trong MongoDB để tìm địa điểm.
 * Trả về document location (name, lat, lng, ...) hoặc null nếu không tìm thấy.
 */
async function detectLocationFromTextDb(text) {
  const raw = text || "";
  const q = removeVietnameseTones(raw);
  if (!q) return null;

  const tokens = q.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  if (!tokens.length) return null;

  const main = tokens.join(" ");
  const regex = new RegExp(main.replace(/\s+/g, ".*"), "i");

  // 1️⃣ ưu tiên searchKey / name / aliases
  let loc =
    (await Location.findOne({
      $or: [
        { searchKey: { $regex: regex } },
        { name: { $regex: regex } },
        { aliases: { $regex: regex } }
      ]
    }).lean()) || null;

  if (loc) return loc;

  // 2️⃣ fallback: match từng token
  const orArr = tokens.map((t) => ({
    $or: [
      { searchKey: { $regex: new RegExp(t, "i") } },
      { name: { $regex: new RegExp(t, "i") } },
      { aliases: { $regex: new RegExp(t, "i") } }
    ]
  }));

  loc = await Location.findOne({ $or: orArr }).lean();
  return loc || null;
}

/* ==========================
   4. SYSTEM PROMPT (FULL)
========================== */

const systemPrompt = `
Bạn là một trợ lý du lịch thân thiện, nói tiếng Việt tự nhiên, có thể tư vấn cả du lịch Việt Nam và quốc tế.

MỤC TIÊU:
- Giúp người dùng:
  + Chọn điểm đến phù hợp (theo sở thích, mùa, ngân sách, số ngày).
  + Lên lịch trình chi tiết từng ngày.
  + Gợi ý nơi ăn uống (từ dữ liệu FOOD) và tour/combo (từ dữ liệu TOURS).
  + Giải đáp các câu hỏi thực tế (thời tiết, di chuyển, lưu ý, chính sách đặt tour, tips).

NGUYÊN TẮC:
1. Ngắn gọn – rõ ràng – dễ đọc:
   - Ưu tiên gạch đầu dòng, chia mục rõ.
   - Không viết một đoạn quá dài liên tục.

2. Hỏi lại khi thiếu thông tin:
   - Hỏi tối đa 2 câu để làm rõ:
     + Đi đâu? (Nếu chưa rõ, gợi ý vài lựa chọn tiêu biểu)
     + Đi bao nhiêu ngày?
     + Ngân sách khoảng bao nhiêu/người?
     + Thích kiểu du lịch nào? (biển, núi, nghỉ dưỡng, khám phá, ẩm thực,...)

3. Lịch trình (Itinerary):
   - Format:
     Ngày 1:
       - Sáng: ...
       - Chiều: ...
       - Tối: ...
   - Mỗi ngày nên có:
     + 1–2 điểm tham quan chính.
     + Gợi ý 1–2 món ăn/đặc sản hoặc khu vực nên ăn uống.
   - Giải thích ngắn tại sao lịch trình này hợp lý.

4. Dữ liệu nội bộ (RAG mini):
   - DESTINATIONS: thông tin điểm đến (thành phố/tỉnh, highlights, bestTime).
   - FOODS: món ăn + quán cụ thể + địa chỉ + khoảng giá.
   - TOURS: các tour/combo gợi ý sẵn (thành phần, giá ước lượng, đối tượng phù hợp).
   - POLICIES: các lưu ý/kinh nghiệm khi đặt tour, thanh toán, hủy/đổi với bên thứ ba.
   - TIPS: mẹo, kinh nghiệm du lịch theo từng chủ đề (vé máy bay, Đà Nẵng, Đà Lạt, Cần Thơ,...).

   KHI TRẢ LỜI:
   - Nếu câu hỏi liên quan đến:
     + Ăn gì/ quán nào/ địa chỉ → ƯU TIÊN dùng FOODS.
     + Tour gói có sẵn/ combo → ƯU TIÊN dùng TOURS.
     + Chính sách đặt tour/ thanh toán/ hủy → ƯU TIÊN dùng POLICIES (lưu ý chung, không phải chính sách của ứng dụng).
     + Kinh nghiệm du lịch → ƯU TIÊN dùng TIPS.
   - Có thể kết hợp nhiều nguồn (ví dụ: tư vấn lịch trình + gợi ý quán ăn + tip thời tiết).
   - Không bịa ra tên quán/địa chỉ mới nếu dữ liệu không có. Khi thiếu data, trả lời chung chung và bảo người dùng kiểm tra thêm.

5. Giá vé máy bay (khi có dữ liệu):
   - Khi có dữ liệu routeCode, from, to, currency, oneWayLow, oneWayHigh, roundTripLow, roundTripHigh, note:
     - Diễn giải:
       + Nêu rõ tuyến bay (ví dụ: "TP.HCM (SGN) → Phú Quốc (PQC)").
       + Nêu khoảng giá rõ ràng:
         * Vé khứ hồi: "khoảng X–Y VND/người cho vé khứ hồi".
         * Vé một chiều: "khoảng X–Y VND/người cho vé một chiều".
       + Tóm tắt ghi chú quan trọng (note) thành 1 câu.
     - Luôn nhấn mạnh đây là giá ước lượng, có thể thay đổi theo thời điểm đặt, hãng bay và khuyến mãi.

6. Fuzzy địa điểm & chính tả:
   - Nếu người dùng gõ tên địa điểm hơi sai chính tả (ví dụ: "Da nang", "Đà nẳng", "Phu quoc", "Fú quốc"...):
     + Cố gắng suy đoán địa điểm đúng nhất dựa trên dữ liệu DESTINATIONS, FOODS, TOURS, TIPS.
     + Nếu nghi ngờ giữa 2–3 nơi, hãy hỏi lại để xác nhận thay vì bịa.
   - Nếu trước đó user đã hỏi rõ về một địa điểm (ví dụ: "món ăn ở An Giang") và câu sau chỉ hỏi món (ví dụ: "bún cá"),
     thì mặc định hiểu họ vẫn đang hỏi ở cùng địa điểm đó, trừ khi họ nói rõ nơi khác.

7. Phong cách:
   - Xưng hô: "mình" – "bạn".
   - Thân thiện, tích cực, mang tính gợi ý.
   - Cuối câu trả lời thường nên có 1 câu gợi mở:
     + "Nếu bạn cho mình biết thêm ngân sách và số người đi, mình sẽ tối ưu lịch trình giúp bạn nhé!"

8. Không lặp lại món/quán khi user muốn "món khác":

- Nếu user dùng các cụm như:
  "món khác", "quán khác", "còn chỗ nào nữa", "gợi ý thêm", "thêm vài quán nữa"

  → HIỂU RÕ rằng user không muốn nghe lại món/quán cũ.

- Trong trường hợp đó:
  + Hãy chọn MÓN hoặc QUÁN KHÁC trong FOODS (khác dishName hoặc restaurant).
  + Nếu dữ liệu nội bộ chỉ còn 1–2 gợi ý nữa, hãy nói rõ:
    "Mình gợi ý thêm 1–2 quán khác, ngoài ra dữ liệu hiện tại chưa có thêm."

- Tuyệt đối không được lặp nguyên tên quán/món y chang câu trả lời trước, trừ khi user yêu cầu mô tả chi tiết hơn về đúng quán đó.
`;

/* ==========================
   5. BUILD CONTEXT (RAG MINI)
========================== */
function buildDestinationsContext(userMessage) {
  if (!destinations || destinations.length === 0) return "[]";
  const query = removeVietnameseTones(userMessage || "");
  if (!destinationsFuse || !query) {
    return JSON.stringify(destinations.slice(0, 5), null, 2);
  }
  const results = destinationsFuse.search(query);
  const bestMatches = results.slice(0, 5).map((r) => r.item);
  const finalList =
    bestMatches.length > 0 ? bestMatches : destinations.slice(0, 5);
  return JSON.stringify(finalList, null, 2);
}

function buildFoodsContext(userMessage, lastLocation) {
  if (!foods || foods.length === 0) return "[]";

  const query = removeVietnameseTones(userMessage || "");
  let baseList = foods;

  if (lastLocation) {
    const locNorm = removeVietnameseTones(lastLocation);
    const filtered = foods.filter((f) =>
      removeVietnameseTones(f.city || "").includes(locNorm)
    );
    if (filtered.length > 0) baseList = filtered;
  }

  if (!query) {
    return JSON.stringify(baseList.slice(0, 6), null, 2);
  }

  const fuse = new Fuse(baseList, {
    keys: ["searchKey"],
    includeScore: true,
    threshold: 0.35
  });

  const results = fuse.search(query);
  const bestMatches = results.slice(0, 6).map((r) => r.item);
  const finalList = bestMatches.length > 0 ? bestMatches : baseList.slice(0, 6);
  return JSON.stringify(finalList, null, 2);
}

function buildToursContext(userMessage, lastLocation) {
  if (!tours || tours.length === 0) return "[]";

  const query = removeVietnameseTones(userMessage || "");
  let baseList = tours;

  if (lastLocation) {
    const locNorm = removeVietnameseTones(lastLocation);
    const filtered = tours.filter((t) => {
      const destStr = removeVietnameseTones((t.destinations || []).join(" "));
      return destStr.includes(locNorm);
    });
    if (filtered.length > 0) baseList = filtered;
  }

  if (!query) {
    return JSON.stringify(baseList.slice(0, 4), null, 2);
  }

  const fuse = new Fuse(baseList, {
    keys: ["searchKey"],
    includeScore: true,
    threshold: 0.35
  });

  const results = fuse.search(query);
  const bestMatches = results.slice(0, 4).map((r) => r.item);
  const finalList =
    bestMatches.length > 0 ? bestMatches : baseList.slice(0, 4);
  return JSON.stringify(finalList, null, 2);
}

function buildPoliciesContext(userMessage) {
  if (!policies || policies.length === 0) return "[]";
  const query = removeVietnameseTones(userMessage || "");
  if (!policiesFuse || !query) {
    return JSON.stringify(policies, null, 2);
  }
  const results = policiesFuse.search(query);
  const bestMatches = results.slice(0, 3).map((r) => r.item);
  const finalList = bestMatches.length > 0 ? bestMatches : policies;
  return JSON.stringify(finalList, null, 2);
}

function buildTipsContext(userMessage) {
  if (!travelTips || travelTips.length === 0) return "[]";
  const query = removeVietnameseTones(userMessage || "");
  if (!tipsFuse || !query) {
    return JSON.stringify(travelTips.slice(0, 4), null, 2);
  }
  const results = tipsFuse.search(query);
  const bestMatches = results.slice(0, 4).map((r) => r.item);
  const finalList =
    bestMatches.length > 0 ? bestMatches : travelTips.slice(0, 4);
  return JSON.stringify(finalList, null, 2);
}

/* ==========================
   5.x FEATURED DESTINATIONS (ĐIỂM ĐẾN NỔI BẬT)
========================== */

function buildFeaturedDestinations(maxCount = 10) {
  if (!destinations || destinations.length === 0) return "[]";

  // Nếu trong destinations.json có isFeatured: true thì ưu tiên
  const featured = destinations.filter((d) => d.isFeatured);
  const base = featured.length > 0 ? featured : destinations;

  const list = base.slice(0, maxCount).map((d) => ({
    name: d.name || "",
    city: d.city || "",
    country: d.country || "",
    region: d.region || "",
    tags: d.tags || [],
    bestTime: d.bestTime || "",
    shortDesc: d.shortDesc || d.description || ""
  }));

  return JSON.stringify(list, null, 2);
}

/* ==========================
   5.y CITY DESTINATIONS (ĐIỂM ĐẾN TRONG 1 TỈNH/THÀNH)
========================== */

function buildCityDestinationsContext(locationName, maxCount = 10) {
  if (!destinations || destinations.length === 0 || !locationName) return "[]";

  const locNorm = removeVietnameseTones(locationName);

  const list = destinations
    .filter((d) => {
      const cityNorm = removeVietnameseTones(d.city || "");
      return cityNorm.includes(locNorm);
    })
    .slice(0, maxCount)
    .map((d) => ({
      name: d.name || "",
      city: d.city || "",
      country: d.country || "",
      region: d.region || "",
      tags: d.tags || [],
      bestTime: d.bestTime || "",
      shortDesc: d.shortDesc || d.description || ""
    }));

  return JSON.stringify(list, null, 2);
}
/* ==========================
   6. detectQueryIntent
========================== */

function detectQueryIntent(text = "") {
  const q = removeVietnameseTones(text || "");
  if (!q) return "other";

  const foodKeywords = [
    "an gi",
    "an gi o",
    "an gi tai",
    "do an",
    "do an ngon",
    "mon an",
    "mon gi",
    "quan an",
    "quan ngon",
    "quan nhau",
    "quan hai san",
    "an uong",
    "nha hang",
    "buffet",
    "bbq",
    "lau nuong",
    "an sang",
    "an trua",
    "an toi",
    "food",
    "street food",
    "dac san",
    "dac san gi",
    "quan ca phe",
    "cafe",
    "ca phe"
  ];

  const placeKeywords = [
    "di dau",
    "di choi",
    "di du lich",
    "lich trinh",
    "itinerary",
    "tour",
    "combo",
    "goi tour",
    "lich trinh 3n2d",
    "lich trinh 4n3d",
    "lich trinh 2n1d",
    "check in",
    "tham quan",
    "choi gi",
    "o dau",
    "o khach san nao",
    "khach san",
    "hotel",
    "homestay",
    "resort",
    "luu tru",
    "cho o",
    "dia diem",
    "diem den",
    "diem tham quan",
    "cho vui choi",
    "lich trinh tham quan",
    "sap xep lich trinh",
    "goi y lich trinh"
  ];

  const tipsKeywords = [
    "meo",
    "meo du lich",
    "kinh nghiem",
    "tip",
    "tips",
    "luu y",
    "chu y",
    "nen di thang may",
    "gia re nhat",
    "thoi diem nao",
    "thang nao",
    "mua nao",
    "thoi tiet",
    "thoi tiet o",
    "co mua khong",
    "mua nao dep",
    "phuong tien",
    "di chuyen bang gi",
    "di bang gi",
    "gia ve",
    "gia ve may bay",
    "bay thang nao re",
    "hanh ly",
    "ky gui",
    "mang gi khi di",
    "can chuan bi gi",
    "doi tra",
    "huy tour",
    "huy ve",
    "bao gom gi",
    "an toan",
    "bao hiem du lich",
    "tui tien"
  ];

  let foodScore = 0;
  let placeScore = 0;
  let tipsScore = 0;

  for (const kw of foodKeywords) if (q.includes(kw)) foodScore += 2;
  for (const kw of placeKeywords) if (q.includes(kw)) placeScore += 2;
  for (const kw of tipsKeywords) if (q.includes(kw)) tipsScore += 2;

  if (/an gi o /.test(q)) foodScore += 3;
  if (/goi y quan/.test(q)) foodScore += 2;
  if (/quan nao/.test(q)) foodScore += 2;

  if (/di dau/.test(q) || /sap xep lich/.test(q)) placeScore += 3;
  if (/lich trinh/.test(q)) placeScore += 3;
  if (/tour /.test(q)) placeScore += 3;

  const scores = { food: foodScore, place: placeScore, tips: tipsScore };
  const maxScore = Math.max(foodScore, placeScore, tipsScore);
  if (maxScore <= 0) return "other";

  const topIntents = Object.entries(scores)
    .filter(([, v]) => v === maxScore)
    .map(([k]) => k);
  if (topIntents.length === 1) return topIntents[0];
  return "mixed";
}

/* ==========================
   6.1 NHẬN DIỆN CÂU HỎI "CÓ NHỮNG NƠI NÀO / ĐI ĐÂU"
========================== */

function isGenericPlaceQuestion(text = "") {
  const q = removeVietnameseTones(text || "");
  if (!q) return false;

  const patterns = [
    "co nhung noi nao",
    "co nhung dia diem nao",
    "nhung noi nao dep",
    "nhung dia diem nao dep",
    "nen di dau",
    "nen di choi dau",
    "nen di du lich o dau",
    "goi y diem den",
    "goi y vai noi",
    "goi y vai dia diem",
    "di choi o dau",
    "di du lich o dau",
    "o viet nam nen di dau",
    "o vn nen di dau"
  ];

  return patterns.some((p) => q.includes(p));
}

/* ==========================
   6.2 NHẬN DIỆN CÂU HỎI "Ở <TỈNH/THÀNH> CÓ NHỮNG ĐỊA ĐIỂM NÀO"
========================== */

function isCityPlacesQuestion(text = "") {
  const q = removeVietnameseTones(text || "");
  if (!q) return false;

  const keyPatterns = [
    "co nhung dia diem nao",
    "co nhung noi nao",
    "nhung dia diem nao",
    "nhung noi nao",
    "cho nao dep",
    "noi nao dep",
    "co cho nao choi",
    "co cho nao tham quan",
    "co diem nao tham quan"
  ];

  return keyPatterns.some((p) => q.includes(p));
}
/* ==========================
   7. LƯU CONVERSATION VÀO MONGO
========================== */

async function saveConversationTurn({
  clientId,
  conversationId,
  userMessage,
  assistantReply
}) {
  if (!MONGO_ENABLED || !clientId) return { conversationId };

  if (mongoose.connection.readyState !== 1) {
    return { conversationId };
  }

  let conv = null;
  if (conversationId) {
    conv = await Conversation.findById(conversationId).catch(() => null);
  }

  if (!conv) {
    const title = userMessage.slice(0, 40);
    conv = await Conversation.create({
      clientId,
      title,
      messages: [
        { role: "user", content: userMessage },
        { role: "assistant", content: assistantReply }
      ]
    });
  } else {
    conv.messages.push({ role: "user", content: userMessage });
    conv.messages.push({ role: "assistant", content: assistantReply });
    if (!conv.title) conv.title = userMessage.slice(0, 40);
    await conv.save();
  }

  return { conversationId: conv._id.toString() };
}

/* ==========================
   8. EXPRESS APP + ROUTES
========================== */

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    provider: LLM_PROVIDER,
    dataLoaded: {
      destinations: destinations.length,
      foods: foods.length,
      tours: tours.length
    }
  });
});
/* ----- 8.1 API CHAT ----- */

app.post("/api/chat", async (req, res) => {
  try {
    const {
      message,
      sessionId,
      origin,
      destination,
      tripType,
      clientId,
      conversationId
    } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Thiếu message" });
    }

    const intent = detectQueryIntent(message);

    // SESSION
    const sid = sessionId || "default";
    if (!sessions[sid]) {
      sessions[sid] = { lastLocation: null, lastCoords: null, history: [] };
    }
    const session = sessions[sid];

    const previousUserMessage =
      session.history
        ?.filter((m) => m.role === "user")
        .slice(-1)[0]?.content || null;

    /* 🔍 Dò địa điểm từ MongoDB (Location) */
    let detectedLocName = null;
    let detectedCoords = null;

    try {
      const locDoc = await detectLocationFromTextDb(message);
      if (locDoc) {
        detectedLocName = locDoc.name || null;
        if (locDoc.lat != null && locDoc.lng != null) {
          detectedCoords = { lat: locDoc.lat, lng: locDoc.lng };
        }
      }
    } catch (e) {
      console.warn("⚠️ detectLocationFromTextDb error:", e.message || e);
    }

    // Cập nhật lastLocation / lastCoords trong session nếu tìm được location
    if (detectedLocName) {
      session.lastLocation = detectedLocName;
      if (detectedCoords) {
        session.lastCoords = detectedCoords;
      }
      console.log(
        "🧭 Cập nhật lastLocation:",
        sid,
        "=>",
        detectedLocName,
        detectedCoords ? JSON.stringify(detectedCoords) : ""
      );
    }

    const currentLocation = session.lastLocation;
    const currentCoords = session.lastCoords || null;

    // 🆕 1) Hỏi chung chung "có những nơi nào / nên đi đâu" (KHÔNG có location)
    const genericPlaceQuestion =
      intent === "place" &&
      !detectedLocName &&
      isGenericPlaceQuestion(message);

    // 🆕 2) Hỏi "Ở <tỉnh/thành> có những địa điểm nào" (CÓ location)
    const cityPlacesQuestion =
      !!detectedLocName &&
      intent === "place" &&
      isCityPlacesQuestion(message);

    // Thêm history user
    appendHistory(session, "user", message);

    // Text đưa vào RAG: ghép các câu user gần nhất
    const ragText = session.history
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n");

    // Build context
    const destinationsContext = buildDestinationsContext(ragText);
    const foodsContext = buildFoodsContext(ragText, currentLocation);
    const toursContext = buildToursContext(ragText, currentLocation);
    const policiesContext = buildPoliciesContext(ragText);
    const tipsContext = buildTipsContext(ragText);

    // 🆕 Context điểm đến nổi bật toàn quốc (khi genericPlaceQuestion)
    const featuredDestinationsContext = genericPlaceQuestion
      ? buildFeaturedDestinations(12)
      : "";

    // 🆕 Context điểm đến trong tỉnh/thành hiện tại (khi cityPlacesQuestion)
    const cityDestinationsContext = cityPlacesQuestion
      ? buildCityDestinationsContext(currentLocation, 12)
      : "";

    // Giá vé nếu có origin/destination
    let flightContextText = "";
    if (origin && destination) {
      const estimate = findFlightEstimate(origin, destination);
      if (estimate) {
        const type = (tripType || "roundtrip").toLowerCase();
        const low =
          type === "oneway" ? estimate.oneWayLow : estimate.roundTripLow;
        const high =
          type === "oneway" ? estimate.oneWayHigh : estimate.roundTripHigh;

        flightContextText = `
Dữ liệu giá vé máy bay ước lượng:
- Tuyến: ${estimate.from} (${origin.toUpperCase()}) → ${estimate.to} (${destination.toUpperCase()})
- Loại vé: ${type === "oneway" ? "Một chiều" : "Khứ hồi"}
- Khoảng giá: từ ${low} đến ${high} ${estimate.currency} / người
- Ghi chú: ${estimate.note}

YÊU CẦU:
- Dùng thông tin trên để diễn giải lại cho người dùng bằng 1–3 câu tiếng Việt tự nhiên.
- Nhấn mạnh đây chỉ là giá tham khảo, có thể thay đổi theo thời điểm đặt vé, hãng bay và khuyến mãi.
`;
      }
    }

    const userPrompt = `
Ý ĐỊNH CÂU HỎI (intent): ${intent}

LỊCH SỬ NGẮN:
- Câu trước của user: ${previousUserMessage || "(chưa có)"}
- Câu hiện tại của user: "${message}"
- Địa điểm đang được hiểu (lastLocation): ${currentLocation || "chưa xác định"}
- Tọa độ hiện tại (nếu có): ${currentCoords ? JSON.stringify(currentCoords) : "chưa có"}

DỮ LIỆU NỘI BỘ (JSON):

1. DESTINATIONS:
${destinationsContext}

2. FOODS (món ăn + quán + địa chỉ):
${foodsContext}

3. TOURS (combo/ tour gợi ý sẵn):
${toursContext}

4. POLICIES (lưu ý đặt tour/thanh toán/hủy):
${policiesContext}

5. TIPS (kinh nghiệm du lịch):
${tipsContext}
${genericPlaceQuestion ? `
6. FEATURED_DESTINATIONS (danh sách điểm đến nổi bật toàn quốc):
${featuredDestinationsContext}
` : ""}${cityPlacesQuestion ? `
7. CITY_DESTINATIONS (danh sách địa điểm trong tỉnh/thành hiện tại):
${cityDestinationsContext}
` : ""}

QUY TẮC THEO Ý ĐỊNH CÂU HỎI:
- Nếu intent = "place": ƯU TIÊN dùng DESTINATIONS + TOURS (địa điểm, lịch trình, tour).
- Nếu intent = "food": ƯU TIÊN dùng FOODS (món ăn, quán ăn), không lan man phần tour/đi chơi nếu user không hỏi.
- Nếu intent = "tips": ƯU TIÊN dùng TIPS + POLICIES (mẹo, kinh nghiệm, lưu ý).
- Nếu intent = "mixed": Kết hợp hợp lý theo nội dung người dùng hỏi.
- Nếu intent = "other": Trả lời chung, dựa trên toàn bộ context.

${genericPlaceQuestion ? `
HƯỚNG DẪN ĐẶC BIỆT KHI USER HỎI CHUNG CHUNG "CÓ NHỮNG NƠI NÀO / NÊN ĐI ĐÂU":

- Người dùng đang hỏi chung chung về điểm đến, CHƯA nhắc tỉnh/thành cụ thể.
- Hãy ưu tiên dùng FEATURED_DESTINATIONS để gợi ý 5–8 điểm đến nổi bật, có thể chia theo vùng miền (Bắc – Trung – Nam).
- Với mỗi điểm đến nên nêu:
  + Tên thành phố/tỉnh.
  + 1–2 điểm nổi bật: cảnh, hoạt động chính.
  + Thời điểm đi đẹp nhất (nếu có bestTime).
- Nếu user nói thêm về "thích biển / núi / nghỉ dưỡng / phượt" thì chọn trong FEATURED_DESTINATIONS những nơi phù hợp.
` : ""}

${cityPlacesQuestion ? `
HƯỚNG DẪN ĐẶC BIỆT KHI USER HỎI "Ở ${currentLocation} CÓ NHỮNG ĐỊA ĐIỂM NÀO":

- Hãy dùng CITY_DESTINATIONS để gợi ý 4–8 địa điểm cụ thể tại ${currentLocation}.
- Với mỗi địa điểm:
  + Nêu tên, mô tả ngắn lý do nên đi (view đẹp, trải nghiệm đặc trưng...).
  + Nếu có bestTime thì mô tả sơ mùa/tháng đẹp.
- Không gợi ý tỉnh/thành khác ngoài ${currentLocation}, trừ khi user hỏi thêm về nơi khác.
` : ""}

${flightContextText ? flightContextText : ""}

QUY TẮC BẮT BUỘC VỀ NGỮ CẢNH ĐỊA ĐIỂM:
- Nếu lastLocation KHÁC null (ví dụ: "An Giang") và trong câu hiện tại user KHÔNG nhắc địa điểm mới,
  thì MẶC ĐỊNH HIỂU user vẫn đang hỏi về đúng địa điểm đó.
- Trong trường hợp đó:
  + KHÔNG hỏi lại kiểu "bạn muốn ăn ở đâu?".
  + KHÔNG gợi ý thành phố khác (như Đà Nẵng, Sài Gòn...) trừ khi user nói rõ muốn gợi ý nơi khác.
  + Ví dụ: user đã nói "món ăn ở An Giang" rồi hỏi tiếp "bún cá nha" → phải hiểu là "bún cá ở An Giang".

HƯỚNG DẪN TRẢ LỜI:
- ƯU TIÊN dùng dữ liệu FOODS cho đúng thành phố/tỉnh trong lastLocation (nếu có).
- Với câu hỏi về ăn uống:
  + Nêu rõ món, tên quán, địa chỉ, khoảng giá (nếu có trong FOODS).
  + Nếu thiếu dữ liệu quán cụ thể, có thể tư vấn chung chung cho đúng thành phố/tỉnh, nhưng KHÔNG bịa tên quán.
- Với tour/combo, chính sách, tips → dùng TOURS, POLICIES, TIPS tương ứng.
- Luôn trả lời bằng tiếng Việt, giọng thân thiện, dễ hiểu.
`;

    const reply = await callLLMChat({
      system: systemPrompt,
      user: userPrompt
    });

    // Lưu vào session history
    appendHistory(session, "assistant", reply);

    // Lưu vào Mongo (conversation list giống ChatGPT)
    const saveResult = await saveConversationTurn({
      clientId,
      conversationId,
      userMessage: message,
      assistantReply: reply
    });

    return res.json({
      reply,
      sessionId: sid,
      conversationId: saveResult.conversationId || conversationId || null
    });
  } catch (err) {
    console.error("❌ Lỗi /api/chat:", err);

    if (err.status === 401) {
      return res.status(500).json({
        error: "Lỗi xác thực với LLM API (kiểm tra lại API key)."
      });
    }

    if (err.status === 429) {
      return res.status(429).json({
        error:
          "LLM API đang báo hết quota / giới hạn lượt gọi. Kiểm tra lại gói sử dụng hoặc thử lại sau."
      });
    }

    return res.status(500).json({
      error: "Lỗi server khi xử lý chat.",
      detail: err.rawBody || null
    });
  }
});

/* ----- 8.2 API FLIGHT LOCAL ESTIMATE ----- */

app.get("/api/flights/estimate-local", (req, res) => {
  const { origin, destination, tripType } = req.query;

  if (!origin || !destination) {
    return res.status(400).json({
      error: "Thiếu origin hoặc destination (ví dụ origin=SGN&destination=DAD)"
    });
  }

  const estimate = findFlightEstimate(origin, destination);

  if (!estimate) {
    return res.json({
      route: `${origin.toUpperCase()}-${destination.toUpperCase()}`,
      estimates: null,
      note:
        "Chưa có dữ liệu ước lượng cho chặng bay này. Vui lòng kiểm tra trực tiếp trên các ứng dụng đặt vé (Traveloka, Skyscanner, v.v.)."
    });
  }

  const type = (tripType || "roundtrip").toLowerCase();
  let low, high;
  if (type === "oneway") {
    low = estimate.oneWayLow;
    high = estimate.oneWayHigh;
  } else {
    low = estimate.roundTripLow;
    high = estimate.roundTripHigh;
  }

  return res.json({
    route: estimate.routeCode,
    from: estimate.from,
    to: estimate.to,
    currency: estimate.currency,
    type,
    low,
    high,
    note:
      (estimate.note || "") +
      " Đây chỉ là giá tham khảo, giá thực tế có thể thay đổi theo thời điểm đặt vé, hãng bay và khuyến mãi."
  });
});

/* ----- 8.3 API LỊCH SỬ CONVERSATION (SIDEBAR) ----- */

app.get("/api/conversations", async (req, res) => {
  try {
    if (!MONGO_ENABLED) {
      return res.status(400).json({ error: "MongoDB chưa được cấu hình." });
    }

    const { clientId } = req.query;
    if (!clientId) {
      return res.status(400).json({ error: "Thiếu clientId" });
    }

    const conversations = await Conversation.find({ clientId })
      .sort({ updatedAt: -1 })
      .select("_id title createdAt updatedAt")
      .lean();

    res.json(conversations);
  } catch (err) {
    console.error("❌ Lỗi /api/conversations:", err);
    res
      .status(500)
      .json({ error: "Lỗi server khi lấy danh sách cuộc trò chuyện." });
  }
});

app.get("/api/conversations/:id", async (req, res) => {
  try {
    if (!MONGO_ENABLED) {
      return res.status(400).json({ error: "MongoDB chưa được cấu hình." });
    }

    const { clientId } = req.query;
    const { id } = req.params;
    if (!clientId) {
      return res.status(400).json({ error: "Thiếu clientId" });
    }

    const conv = await Conversation.findOne({ _id: id, clientId }).lean();
    if (!conv) {
      return res.status(404).json({ error: "Không tìm thấy cuộc trò chuyện" });
    }

    res.json(conv);
  } catch (err) {
    console.error("❌ Lỗi /api/conversations/:id:", err);
    res
      .status(500)
      .json({ error: "Lỗi server khi lấy chi tiết cuộc trò chuyện." });
  }
});

/* ==========================
   9. START SERVER
========================== */

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(
    `🚀 Tour chatbot backend chạy tại http://localhost:${PORT} với provider: ${LLM_PROVIDER}`
  );
});
