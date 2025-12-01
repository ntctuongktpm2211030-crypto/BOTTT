// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import Fuse from "fuse.js";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ===== 1. Đọc config LLM từ .env =====
const LLM_PROVIDER = process.env.LLM_PROVIDER || "openrouter";
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_BASE_URL =
  process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1";
const LLM_MODEL = process.env.LLM_MODEL || "google/gemma-2-9b-it";

if (!LLM_API_KEY) {
  console.warn(
    "⚠️  Chưa có LLM_API_KEY trong .env, chatbot sẽ không gọi được LLM."
  );
}

// ===== 2. Helper: __dirname + bỏ dấu tiếng Việt =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function removeVietnameseTones(str = "") {
  if (!str) return "";
  let s = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/đ/g, "d").replace(/Đ/g, "D");
  return s.toLowerCase();
}

// ✅ Bộ nhớ session đơn giản (nhớ lastLocation)
const sessions = {};   // { sessionId: { lastLocation: string|null, lastUserMessage: string|null } }

// ===== 3. Load dữ liệu nội bộ (destinations, flights, foods, tours, policies, tips) =====

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

  // global fuse (dùng fallback)
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

// ===== 3.x Canonical locations (tỉnh/thành Việt Nam) =====
// Dùng để fuzzy match tên địa điểm, sau đó detectLocationFromText trả về loc.name
const canonicalLocations = [
  // 5 thành phố trực thuộc TW
  {
    id: "ha-noi",
    name: "Hà Nội",
    extraAliases: ["hanoi", "tp ha noi", "thanh pho ha noi", "hn"]
  },
  {
    id: "ho-chi-minh",
    name: "TP. Hồ Chí Minh",
    extraAliases: [
      "ho chi minh",
      "ho chi minh city",
      "tp hcm",
      "tphcm",
      "hcm",
      "sai gon",
      "saigon",
      "thanh pho ho chi minh"
    ]
  },
  {
    id: "hai-phong",
    name: "Hải Phòng",
    extraAliases: ["hai phong", "thanh pho hai phong"]
  },
  {
    id: "da-nang",
    name: "Đà Nẵng",
    extraAliases: ["da nang", "danang", "thanh pho da nang"]
  },
  {
    id: "can-tho",
    name: "Cần Thơ",
    extraAliases: ["can tho", "thanh pho can tho", "tay do"]
  },

  // Miền núi phía Bắc
  { id: "ha-giang", name: "Hà Giang", extraAliases: ["ha giang"] },
  { id: "cao-bang", name: "Cao Bằng", extraAliases: ["cao bang"] },
  { id: "lao-cai", name: "Lào Cai", extraAliases: ["lao cai", "sapa", "sa pa"] },
  { id: "dien-bien", name: "Điện Biên", extraAliases: ["dien bien"] },
  { id: "lai-chau", name: "Lai Châu", extraAliases: ["lai chau"] },
  { id: "son-la", name: "Sơn La", extraAliases: ["son la", "moc chau"] },
  { id: "yen-bai", name: "Yên Bái", extraAliases: ["yen bai", "mu cang chai"] },
  { id: "tuyen-quang", name: "Tuyên Quang", extraAliases: ["tuyen quang"] },
  { id: "bac-kan", name: "Bắc Kạn", extraAliases: ["bac kan"] },
  { id: "thai-nguyen", name: "Thái Nguyên", extraAliases: ["thai nguyen"] },
  { id: "lang-son", name: "Lạng Sơn", extraAliases: ["lang son", "mau son"] },
  { id: "phu-tho", name: "Phú Thọ", extraAliases: ["phu tho", "den hung"] },
  { id: "vinh-phuc", name: "Vĩnh Phúc", extraAliases: ["vinh phuc", "tam dao"] },
  { id: "quang-ninh", name: "Quảng Ninh", extraAliases: ["quang ninh", "ha long"] },
  { id: "bac-giang", name: "Bắc Giang", extraAliases: ["bac giang"] },
  { id: "bac-ninh", name: "Bắc Ninh", extraAliases: ["bac ninh", "quan ho"] },

  // Đồng bằng Bắc Bộ
  { id: "hai-duong", name: "Hải Dương", extraAliases: ["hai duong"] },
  { id: "hung-yen", name: "Hưng Yên", extraAliases: ["hung yen", "pho hien"] },
  { id: "hoa-binh", name: "Hòa Bình", extraAliases: ["hoa binh"] },
  { id: "ha-nam", name: "Hà Nam", extraAliases: ["ha nam", "tam chuc"] },
  { id: "thai-binh", name: "Thái Bình", extraAliases: ["thai binh"] },
  { id: "nam-dinh", name: "Nam Định", extraAliases: ["nam dinh"] },
  { id: "ninh-binh", name: "Ninh Bình", extraAliases: ["ninh binh", "trang an"] },

  // Bắc Trung Bộ
  { id: "thanh-hoa", name: "Thanh Hóa", extraAliases: ["thanh hoa", "sam son"] },
  { id: "nghe-an", name: "Nghệ An", extraAliases: ["nghe an", "vinh"] },
  { id: "ha-tinh", name: "Hà Tĩnh", extraAliases: ["ha tinh"] },
  { id: "quang-binh", name: "Quảng Bình", extraAliases: ["quang binh", "phong nha"] },
  { id: "quang-tri", name: "Quảng Trị", extraAliases: ["quang tri"] },
  {
    id: "thua-thien-hue",
    name: "Thừa Thiên Huế",
    extraAliases: ["thua thien hue", "hue", "co do hue"]
  },

  // Duyên hải Nam Trung Bộ
  { id: "quang-nam", name: "Quảng Nam", extraAliases: ["quang nam", "hoi an"] },
  { id: "quang-ngai", name: "Quảng Ngãi", extraAliases: ["quang ngai", "ly son"] },
  { id: "binh-dinh", name: "Bình Định", extraAliases: ["binh dinh", "quy nhon"] },
  { id: "phu-yen", name: "Phú Yên", extraAliases: ["phu yen", "tuy hoa"] },
  { id: "khanh-hoa", name: "Khánh Hòa", extraAliases: ["khanh hoa", "nha trang"] },
  { id: "ninh-thuan", name: "Ninh Thuận", extraAliases: ["ninh thuan", "phan rang"] },
  {
    id: "binh-thuan",
    name: "Bình Thuận",
    extraAliases: ["binh thuan", "phan thiet", "mui ne"]
  },

  // Tây Nguyên
  { id: "kon-tum", name: "Kon Tum", extraAliases: ["kon tum"] },
  { id: "gia-lai", name: "Gia Lai", extraAliases: ["gia lai", "pleiku"] },
  { id: "dak-lak", name: "Đắk Lắk", extraAliases: ["dak lak", "buon ma thuot"] },
  { id: "dak-nong", name: "Đắk Nông", extraAliases: ["dak nong"] },
  { id: "lam-dong", name: "Lâm Đồng", extraAliases: ["lam dong", "da lat", "dalat"] },

  // Đông Nam Bộ
  {
    id: "ba-ria-vung-tau",
    name: "Bà Rịa – Vũng Tàu",
    extraAliases: ["ba ria vung tau", "vung tau", "ba ria"]
  },
  { id: "binh-duong", name: "Bình Dương", extraAliases: ["binh duong"] },
  { id: "binh-phuoc", name: "Bình Phước", extraAliases: ["binh phuoc"] },
  { id: "dong-nai", name: "Đồng Nai", extraAliases: ["dong nai", "bien hoa"] },
  { id: "tay-ninh", name: "Tây Ninh", extraAliases: ["tay ninh"] },
  { id: "long-an", name: "Long An", extraAliases: ["long an"] },

  // Đồng bằng sông Cửu Long
  { id: "tien-giang", name: "Tiền Giang", extraAliases: ["tien giang", "my tho"] },
  { id: "ben-tre", name: "Bến Tre", extraAliases: ["ben tre", "xu dua"] },
  { id: "tra-vinh", name: "Trà Vinh", extraAliases: ["tra vinh"] },
  { id: "vinh-long", name: "Vĩnh Long", extraAliases: ["vinh long"] },
  { id: "dong-thap", name: "Đồng Tháp", extraAliases: ["dong thap", "sa dec"] },
  { id: "an-giang", name: "An Giang", extraAliases: ["an giang", "chau doc", "long xuyen"] },
  {
    id: "kien-giang",
    name: "Kiên Giang",
    extraAliases: ["kien giang", "phu quoc", "rach gia"]
  },
  { id: "hau-giang", name: "Hậu Giang", extraAliases: ["hau giang", "vi thanh"] },
  { id: "soc-trang", name: "Sóc Trăng", extraAliases: ["soc trang"] },
  { id: "bac-lieu", name: "Bạc Liêu", extraAliases: ["bac lieu"] },
  { id: "ca-mau", name: "Cà Mau", extraAliases: ["ca mau", "dat mui", "mui ca mau"] }
];

// ===== 3.7 Helper: detectLocationFromText (để cập nhật lastLocation) =====
function detectLocationFromText(text) {
  const raw = text || "";
  const query = removeVietnameseTones(raw);
  if (!query) return null;

  // 1️⃣ Xử lý một vài typo nặng thường gặp (ưu tiên nhất)
  const hardTypos = [
    { name: "Cần Thơ", patterns: ["can thor", "can tho2"] }
    // có thể thêm nữa nếu em gặp thực tế
  ];

  for (const loc of hardTypos) {
    if (loc.patterns.some((p) => query.includes(p))) {
      return loc.name;
    }
  }

  // 2️⃣ Dò theo canonicalLocations (tỉnh/thành) trước
  let bestLoc = null;
  let bestLen = 0;

  for (const loc of canonicalLocations) {
    const baseAliases = [loc.name, ...(loc.extraAliases || [])];

    for (const alias of baseAliases) {
      const aliasNorm = removeVietnameseTones(alias);
      if (!aliasNorm || aliasNorm.length < 3) continue;

      if (query.includes(aliasNorm) && aliasNorm.length > bestLen) {
        bestLen = aliasNorm.length;
        bestLoc = loc;
      }
    }
  }

  if (bestLoc) {
    // Trả về name để các chỗ khác (FOODS, TOURS...) dùng .city so sánh
    return bestLoc.name;
  }

  // 3️⃣ AUTO MATCH theo toàn bộ destinations.json như cũ
  const qClean = query.replace(/[^a-z0-9]+/g, "");

  let bestCity = null;
  let bestCityLen = 0;

  for (const d of destinations) {
    if (!d.city) continue;
    const cityNorm = removeVietnameseTones(d.city).replace(/[^a-z0-9]+/g, "");
    if (!cityNorm || cityNorm.length < 3) continue;

    if (qClean.includes(cityNorm) && cityNorm.length > bestCityLen) {
      bestCityLen = cityNorm.length;
      bestCity = d.city;
    }
  }

  if (bestCity) {
    return bestCity;
  }

  // 4️⃣ Fallback về Fuse trên destinations nếu vẫn không match
  if (!destinationsFuse) return null;

  const results = destinationsFuse.search(query);
  if (!results.length) return null;

  const best = results[0];
  if (best.score != null && best.score > 0.6) {
    return null;
  }

  const d = best.item;
  return d.city || d.name || null;
}

// ===== 4. System prompt chatbot du lịch =====
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

// ===== 5. Hàm build context (RAG mini) =====
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

// ✅ SỬA Ở ĐÂY: FOODS dùng thêm lastLocation
function buildFoodsContext(userMessage, lastLocation) {
  if (!foods || foods.length === 0) return "[]";

  const query = removeVietnameseTones(userMessage || "");
  let baseList = foods;

  // Nếu đã nhớ lastLocation → ưu tiên món ăn ở đó
  if (lastLocation) {
    const locNorm = removeVietnameseTones(lastLocation);
    const filtered = foods.filter((f) =>
      removeVietnameseTones(f.city || "").includes(locNorm)
    );
    if (filtered.length > 0) {
      baseList = filtered;
    }
  }

  if (!query) {
    return JSON.stringify(baseList.slice(0, 6), null, 2);
  }

  // Fuzzy trên danh sách đã lọc
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

  // Ưu tiên tour có chứa địa điểm lastLocation
  if (lastLocation) {
    const locNorm = removeVietnameseTones(lastLocation);
    const filtered = tours.filter((t) => {
      const destStr = removeVietnameseTones((t.destinations || []).join(" "));
      return destStr.includes(locNorm);
    });
    if (filtered.length > 0) {
      baseList = filtered;
    }
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
  const finalList = bestMatches.length > 0 ? bestMatches : baseList.slice(0, 4);
  return JSON.stringify(finalList, null, 2);
}
function buildPoliciesContext(userMessage) {
  if (!policies || policies.length === 0) return "[]";

  const query = removeVietnameseTones(userMessage || "");
  if (!policiesFuse || !query) {
    // Nếu không có query hoặc chưa init Fuse → trả hết (hoặc giới hạn)
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
    // Không có query → trả vài tips đầu
    return JSON.stringify(travelTips.slice(0, 4), null, 2);
  }

  const results = tipsFuse.search(query);
  const bestMatches = results.slice(0, 4).map((r) => r.item);
  const finalList =
    bestMatches.length > 0 ? bestMatches : travelTips.slice(0, 4);

  return JSON.stringify(finalList, null, 2);
}

function detectQueryIntent(text = "") {
  const q = removeVietnameseTones(text || "");
  if (!q) return "other";

  // 🍽️ Từ khóa liên quan ĂN UỐNG
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

  // 📍 Từ khóa ĐỊA ĐIỂM / TOUR / LỊCH TRÌNH
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

  // 💡 Từ khóa MẸO / TIPS / KINH NGHIỆM
  const tipsKeywords = [
    "meo", "meo du lich", "kinh nghiem", "tip", "tips",
    "luu y", "chu y", "nen di thang may", "gia re nhat",
    "thoi diem nao", "thang nao", "mua nao",
    "thoi tiet", "thoi tiet o", "co mua khong", "mua nao dep",
    "phuong tien", "di chuyen bang gi", "di bang gi",
    "gia ve", "gia ve may bay", "bay thang nao re",
    "hanh ly", "ky gui", "mang gi khi di", "can chuan bi gi",
    "doi tra", "huy tour", "huy ve", "bao gom gi",
    "an toan", "bao hiem du lich", "tui tien"
  ];

  let foodScore = 0;
  let placeScore = 0;
  let tipsScore = 0;

  // Đếm điểm food
  for (const kw of foodKeywords) {
    if (q.includes(kw)) foodScore += 2;
  }

  // Đếm điểm place
  for (const kw of placeKeywords) {
    if (q.includes(kw)) placeScore += 2;
  }

  // Đếm điểm tips
  for (const kw of tipsKeywords) {
    if (q.includes(kw)) tipsScore += 2;
  }

  // Một số pattern boost nhanh:
  if (/an gi o /.test(q)) foodScore += 3;
  if (/goi y quan/.test(q)) foodScore += 2;
  if (/quan nao/.test(q)) foodScore += 2;

  if (/di dau/.test(q) || /sap xep lich/.test(q)) placeScore += 3;
  if (/lich trinh/.test(q)) placeScore += 3;
  if (/tour /.test(q)) placeScore += 3;

  // 🔎 Tính max + quyết định
  const scores = { food: foodScore, place: placeScore, tips: tipsScore };
  const maxScore = Math.max(foodScore, placeScore, tipsScore);

  // Không trúng gì rõ ràng
  if (maxScore <= 0) return "other";

  // Lấy tất cả intent có điểm = max
  const topIntents = Object.entries(scores)
    .filter(([, v]) => v === maxScore)
    .map(([k]) => k);

  // Chỉ có 1 loại thắng rõ ràng
  if (topIntents.length === 1) {
    return topIntents[0]; // "food" | "place" | "tips"
  }

  // Nhiều loại cùng cao → mixed
  return "mixed";
}

// ===== 6. Hàm gọi LLM qua OpenRouter (hoặc provider khác) =====
async function callLLMChat({ system, user }) {
  if (!LLM_API_KEY) {
    throw new Error("Thiếu LLM_API_KEY, không gọi được LLM.");
  }

  const base = LLM_BASE_URL.replace(/\/$/, "");
  const url = `${base}/chat/completions`;

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
    headers["HTTP-Referer"] = "http://localhost:5173";
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

// ===== 7. Endpoint /api/chat =====
app.post("/api/chat", async (req, res) => {
  try {
    const { message, sessionId, origin, destination, tripType } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Thiếu message" });
    }

    // 👉 NEW: detect intent
    const intent = detectQueryIntent(message);

    // ==== SESSION + NGỮ CẢNH =====
    const sid = sessionId || "default";
    if (!sessions[sid]) {
      sessions[sid] = { lastLocation: null, lastUserMessage: null };
    }

    const previousUserMessage = sessions[sid].lastUserMessage;

    // Cập nhật lastLocation nếu message chứa tên địa điểm (fuzzy)
    const detectedLoc = detectLocationFromText(message);
    if (detectedLoc) {
      sessions[sid].lastLocation = detectedLoc;
      console.log("🧭 Cập nhật lastLocation:", sid, "=>", detectedLoc);
    }

    const currentLocation = sessions[sid].lastLocation;

    // Text đưa vào RAG: câu trước + câu hiện tại (nếu có)
    const ragText = previousUserMessage
      ? `${previousUserMessage}\n${message}`
      : message;

    // ==== RAG: build các context =====
    const destinationsContext = buildDestinationsContext(ragText);
    const foodsContext = buildFoodsContext(ragText, currentLocation);
const toursContext = buildToursContext(ragText, currentLocation);
    const policiesContext = buildPoliciesContext(ragText);
    const tipsContext = buildTipsContext(ragText);

    // ==== Giá vé (nếu có origin/destination) ====
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

QUY TẮC THEO Ý ĐỊNH CÂU HỎI:
- Nếu intent = "place": ƯU TIÊN dùng DESTINATIONS + TOURS (địa điểm, lịch trình, tour).
- Nếu intent = "food": ƯU TIÊN dùng FOODS (món ăn, quán ăn), không lan man phần tour/đi chơi nếu user không hỏi.
- Nếu intent = "tips": ƯU TIÊN dùng TIPS + POLICIES (mẹo, kinh nghiệm, lưu ý).
- Nếu intent = "mixed": Kết hợp hợp lý theo nội dung người dùng hỏi.
- Nếu intent = "other": Trả lời chung, dựa trên toàn bộ context.

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

    // Lưu lại câu hiện tại làm "câu trước" cho lượt sau
    sessions[sid].lastUserMessage = message;

    return res.json({
      reply,
      sessionId: sid
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

// ===== 8. Endpoint /api/flights/estimate-local =====
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

// ===== 9. Start server =====
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(
    `🚀 Tour chatbot backend chạy tại http://localhost:${PORT} với provider: ${LLM_PROVIDER}`
  );
});
