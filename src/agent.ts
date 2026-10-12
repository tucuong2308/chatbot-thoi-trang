import attrSchema from "../data/gemini-schema-thuoc-tinh.json";
import { getCatalog } from "./catalog";
import { generateJson, generateText } from "./gemini";
import { searchProducts, type Hit } from "./search";
import type { ChatTurn, Env, SearchIntent } from "./types";

const HISTORY_TURNS = 10;
const props = (attrSchema as any).properties;
const optEnum = (field: string) => ({ type: "STRING", enum: props[field].enum, nullable: true });

/** Schema để Gemini tách câu hỏi thành bộ lọc. Giá trị lấy đúng danh sách của bảng tính. */
const INTENT_SCHEMA = {
  type: "OBJECT",
  properties: {
    muc_dich: { type: "STRING", enum: ["tim_san_pham", "hoi_size", "hoi_chung", "chao_hoi"] },
    cau_tim_kiem: { type: "STRING", description: "Câu mô tả món khách muốn, viết lại đầy đủ để tìm theo nghĩa" },
    danh_muc: optEnum("danh_muc"),
    kieu_sp: optEnum("kieu_sp"),
    kieu_co: optEnum("kieu_co"),
    tay_ao: optEnum("tay_ao"),
    do_dai: optEnum("do_dai"),
    dang: optEnum("dang"),
    mau_chinh: optEnum("mau_chinh"),
    chat_lieu: optEnum("chat_lieu"),
    phong_cach: optEnum("phong_cach"),
    dip: { type: "STRING", enum: props.dip.items.enum, nullable: true },
    gia_min: { type: "NUMBER", nullable: true },
    gia_max: { type: "NUMBER", nullable: true },
    size: { type: "STRING", enum: ["XS", "S", "M", "L", "XL", "XXL", "Freesize"], nullable: true },
  },
  required: ["muc_dich", "cau_tim_kiem"],
};

const INTENT_PROMPT = `Bạn đọc hội thoại giữa khách và shop thời trang, rồi tách tin nhắn MỚI NHẤT của khách thành bộ lọc.
- Chỉ điền thuộc tính khách nói rõ hoặc suy ra chắc chắn; không chắc thì để null.
- "dưới 500k" => gia_max = 500000. "tầm 300k" => gia_min 250000, gia_max 350000.
- Đồng nghĩa: "bẹt vai", "off-shoulder" => kieu_co "trễ vai"; "váy liền" => danh_muc "đầm".
- Nếu khách nói tiếp ý cũ (VD "có màu đen không"), giữ các thuộc tính từ lượt trước.
- cau_tim_kiem: viết lại mong muốn của khách thành một câu đầy đủ.`;

function formatPrice(n: number) {
  return n.toLocaleString("vi-VN") + "đ";
}

function describeHits(hits: Hit[]): string {
  return hits.map((h, i) => {
    const p = h.product;
    return `${i + 1}. [${p.ma_sp}] ${p.ten_sp} - ${formatPrice(p.gia_ban)}` +
      (p.gia_goc ? ` (giá gốc ${formatPrice(p.gia_goc)})` : "") +
      ` | size còn: ${h.sizesConHang.join(", ")} | ${p.mo_ta_tu_do ?? ""}`;
  }).join("\n");
}

function replyPrompt(env: Env, context: string) {
  return `Bạn là trợ lý AI tư vấn của shop thời trang ${env.SHOP_NAME}, xưng "em", gọi khách là "chị" hoặc "anh" theo ngữ cảnh.
Quy tắc:
- Lượt chào đầu tiên phải nói rõ em là trợ lý AI của shop.
- CHỈ giới thiệu sản phẩm có trong DỮ LIỆU bên dưới, không bịa mã, giá, size hay khuyến mãi.
- Trả lời ngắn gọn như nhắn tin Messenger: tối đa 3 sản phẩm, mỗi món một dòng gồm tên, giá, size còn, một lý do hợp với khách.
- Không có món phù hợp thì nói thật và gợi ý khách nới yêu cầu (màu khác, tầm giá khác).
- Câu nào không biết hoặc khách muốn khiếu nại thì nói sẽ chuyển nhân viên hỗ trợ.

DỮ LIỆU:
${context}`;
}

async function loadHistory(env: Env, userKey: string): Promise<ChatTurn[]> {
  return (await env.SHOP_KV.get<ChatTurn[]>(`hist:${userKey}`, "json")) ?? [];
}

async function saveHistory(env: Env, userKey: string, history: ChatTurn[]) {
  await env.SHOP_KV.put(`hist:${userKey}`, JSON.stringify(history.slice(-HISTORY_TURNS)), {
    expirationTtl: 60 * 60 * 24 * 7,
  });
}

export interface BotReply {
  text: string;
  images: string[];
}

/** Xử lý một tin nhắn của khách, trả về câu trả lời và ảnh sản phẩm nên gửi kèm. */
export async function handleUserMessage(env: Env, userKey: string, message: string): Promise<BotReply> {
  const history = [...(await loadHistory(env, userKey)), { role: "user" as const, text: message }];
  const catalog = await getCatalog(env);

  const intent = await generateJson<SearchIntent>(env, INTENT_PROMPT, history, INTENT_SCHEMA);

  let context = "Không có dữ liệu sản phẩm cho câu này.";
  let images: string[] = [];
  if (intent.muc_dich === "tim_san_pham") {
    const hits = await searchProducts(env, catalog, intent);
    context = hits.length ? `Sản phẩm phù hợp (đã kiểm tra còn hàng):\n${describeHits(hits)}` : "Không tìm thấy sản phẩm khớp yêu cầu.";
    images = hits.slice(0, 3).map((h) => h.product.anh_chinh_url).filter((u) => u.startsWith("http"));
  } else if (intent.muc_dich === "hoi_size") {
    context = "Bảng size của shop:\n" + catalog.sizes
      .map((s) => `${s.size}: ${s.can_nang_kg}kg, cao ${s.chieu_cao_cm}cm, ngực ${s.vong_1_cm}, eo ${s.vong_2_cm}, mông ${s.vong_3_cm}`)
      .join("\n");
  }

  const text = await generateText(env, replyPrompt(env, context), history);
  await saveHistory(env, userKey, [...history, { role: "model", text }]);
  return { text, images };
}
