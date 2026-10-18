import { vnd } from "./dinhdang";
import { chat, type Msg } from "./llm";
import { systemPrompt } from "./prompt";
import { runTool, TOOL_DECLARATIONS } from "./tools";
import type { ChatTurn, DonNhap, Env, ProductCard, TokenUsage, ToolTrace } from "./types";

const HISTORY_TURNS = 10;
/** Số thẻ sản phẩm tối đa gửi kèm một câu trả lời (Messenger cho tối đa 10 thẻ mỗi tin). */
const MAX_CARDS = 5;
/** Số vòng gọi công cụ tối đa cho một tin nhắn (tìm, xem kết quả, xem ảnh, sửa...). */
const MAX_TOOL_ROUNDS = 6;
/** Quá thời gian này thì buộc model trả lời với những gì đã có. Hàng đợi cho tới 15 phút; giữ thấp để khách không chờ lâu. */
const TURN_BUDGET_MS = 90_000;
/** Câu trả lời chỉ hứa sẽ tìm/xem mà chưa có kết quả, VD "Để em tìm các mẫu ... nhé:". */
const PROMISE_ONLY = /(để|em sẽ|em đi|chờ) (em )?(tìm|xem|kiểm tra|lọc|tra)[^.!?]*([:：]|nhé[!.]?)\s*$/i;
const DEFAULT_WAIT = "Dạ chị chờ em một chút, em xem kỹ từng mẫu rồi gửi chị nhé.";

async function loadHistory(env: Env, userKey: string): Promise<ChatTurn[]> {
  return (await env.SHOP_KV.get<ChatTurn[]>(`hist:${userKey}`, "json")) ?? [];
}

/** Thêm lượt vào lịch sử model ngoài vòng trò chuyện, VD kết quả khách bấm nút xác nhận đơn. */
export async function appendHistory(env: Env, userKey: string, turns: ChatTurn[]) {
  await saveHistory(env, userKey, [...(await loadHistory(env, userKey)), ...turns]);
}

async function saveHistory(env: Env, userKey: string, history: ChatTurn[]) {
  await env.SHOP_KV.put(`hist:${userKey}`, JSON.stringify(history.slice(-HISTORY_TURNS)), {
    expirationTtl: 60 * 60 * 24 * 7,
  });
}

export interface BotReply {
  text: string;
  /** Món bot gợi ý (mã viết ở đầu dòng), để gửi thành thẻ sản phẩm có ảnh. */
  the_san_pham: ProductCard[];
  /** Tin nhắn tạm đã gửi trong lúc bot làm việc lâu (VD nhắn khách chờ trước khi xem ảnh). */
  interim: string[];
  model?: string;
  trace?: ToolTrace[];
  /** Token của từng lần gọi model trong lượt này (chỉ có với API kiểu OpenAI), để tính chi phí thật. */
  token?: TokenUsage[];
  /** Bot vừa soạn đơn nháp (soan_don): gửi tóm tắt kèm nút xác nhận. */
  don_nhap?: { nhap: DonNhap; tom_tat: string };
  /** Khách xin hủy đơn này (yeu_cau_huy_don): gửi nút xác nhận hủy. */
  yeu_cau_huy?: string;
}

/**
 * Xử lý một tin nhắn của khách. Gemini tự quyết bước tiếp theo: lọc bằng SQL, tìm theo nghĩa (chữ / ảnh),
 * tự nhìn ảnh sản phẩm, tra bảng size... rồi viết câu trả lời chỉ dựa trên kết quả tra cứu.
 * `send` dùng để gửi tin nhắn tạm cho khách ngay trong lúc xử lý.
 */
export async function handleUserMessage(
  env: Env, userKey: string, message: string, send?: (text: string) => Promise<void>,
  /** Gọi sau mỗi vòng tra cứu: Messenger dùng để bật lại "đang soạn tin", khách không thấy bot im lặng. */
  typing?: () => Promise<void>,
): Promise<BotReply> {
  const started = Date.now();
  const history = [...(await loadHistory(env, userKey)), { role: "user" as const, text: message }];
  const messages: Msg[] = history.map((t) => (t.role === "user" ? { role: "user", text: t.text } : { role: "assistant", text: t.text, toolCalls: [] }));
  const trace: ToolTrace[] = [];
  const token: TokenUsage[] = [];
  const interim: string[] = [];
  let donNhap: BotReply["don_nhap"];
  let yeuCauHuy: string | undefined;
  const ctx = {
    khach: userKey,
    onNhap: (nhap: DonNhap, tom_tat: string) => { donNhap = { nhap, tom_tat }; },
    onYeuCauHuy: (ma: string) => { yeuCauHuy = ma; },
    notifyWait: async (text?: string) => {
      if (interim.length) return;
      const msg = text?.trim() || DEFAULT_WAIT;
      interim.push(msg);
      if (send) await send(msg);
    },
  };
  const system = systemPrompt(env);

  let model: string | undefined;
  let text = "";
  let nudges = 0;
  // Mã sản phẩm bot được phép nhắc: đã có trong kết quả công cụ lượt này, hoặc đã được gợi ý ở các lượt trước.
  const known = new Set(history.filter((t) => t.role === "model").flatMap((t) => codesIn(t.text)));
  for (let round = 0; ; round++) {
    const lastRound = round >= MAX_TOOL_ROUNDS || Date.now() - started > TURN_BUDGET_MS;
    const res = await chat(env, { system, messages, tools: TOOL_DECLARATIONS, noTools: lastRound, sticky: model });
    model = res.model;
    if (res.usage) token.push(res.usage);

    if (!res.toolCalls.length || lastRound) {
      text = res.text;
      // Model nhỏ hay hứa "để em tìm..." rồi dừng, hoặc tự nghĩ ra sản phẩm mà không tra cứu: bắt nó tra cứu thật.
      const invented = codesIn(text).filter((c) => !known.has(c));
      const nudge = PROMISE_ONLY.test(text)
        ? "(Hệ thống) Em chưa tìm. Hãy gọi công cụ ngay bây giờ rồi mới trả lời khách."
        : invented.length
          ? `(Hệ thống) Các mã ${invented.join(", ")} không có trong kết quả tra cứu, tức là em đã tự nghĩ ra. ` +
            "Không bao giờ được bịa sản phẩm: hãy gọi tim_san_pham rồi chỉ giới thiệu mã có trong kết quả."
          : "";
      if (nudge && !lastRound && nudges < 2) {
        nudges++;
        messages.push({ role: "assistant", text, toolCalls: [], raw: res.raw }, { role: "user", text: nudge });
        continue;
      }
      // Hết lượt mà vẫn còn mã bịa: bỏ các dòng đó thay vì gửi cho khách thông tin sai.
      if (invented.length) text = dropLinesWith(text, invented);
      break;
    }

    messages.push({ role: "assistant", text: res.text, toolCalls: res.toolCalls, raw: res.raw }); // giữ nguyên bản gốc cho vòng sau
    const results = await Promise.all(res.toolCalls.map(async (call) => {
      const result = await runTool(env, call.name, call.args, ctx);
      for (const c of codesIn(JSON.stringify(result))) known.add(c);
      trace.push({ cong_cu: call.name, tham_so: call.args, ket_qua: result });
      return { call, result };
    }));
    messages.push({ role: "tool", results });
    await typing?.().catch(() => {});
  }

  if (!text) text = "Dạ em chưa trả lời được câu này, em chuyển nhân viên hỗ trợ chị ngay nhé.";
  await saveHistory(env, userKey, [...history, { role: "model", text: ghiChuLichSu(text, donNhap) }]);
  return {
    text, the_san_pham: await productCards(env, text), interim, model, trace, token, don_nhap: donNhap, yeu_cau_huy: yeuCauHuy,
  };
}

/**
 * Câu trả lời lưu vào lịch sử model. Vừa soạn đơn nháp thì kèm tóm tắt đơn (shop gửi riêng, model không viết lại),
 * để khi khách sửa đơn nhiều lượt sau, model vẫn có đủ mã, size, màu, người nhận cho lần gọi soan_don kế tiếp.
 */
export function ghiChuLichSu(text: string, donNhap: BotReply["don_nhap"]): string {
  return donNhap ? `${text}\n(Tóm tắt đơn đã gửi khách, chờ khách bấm Xác nhận:\n${donNhap.tom_tat})` : text;
}

const codesIn = (text: string) => [...new Set([...text.matchAll(/\bSP[\w-]+/g)].map((m) => m[0]))];

/** Bỏ các dòng nhắc mã bịa; nếu không còn sản phẩm thật nào thì thay bằng câu hẹn nhân viên kiểm tra. */
function dropLinesWith(text: string, codes: string[]): string {
  const out = text.split("\n").filter((line) => !codes.some((c) => line.includes(c))).join("\n").trim();
  return codesIn(out).length ? out : "Dạ em chưa tìm được mẫu phù hợp trong kho, em nhờ nhân viên shop kiểm tra và nhắn lại chị ngay nhé.";
}

/**
 * Món bot thật sự gợi ý: mã [SP...] viết ở đầu một dòng (prompt yêu cầu mỗi món một dòng bắt đầu bằng mã).
 * Mã nhắc giữa câu (món đã loại, món khách chê) không tính, để không gửi ảnh món khách không cần.
 */
export function suggestedCodes(text: string): string[] {
  const codes = [...text.matchAll(/^\s*(?:[-*•]|\d+[.)])?\s*\**\[(SP[\w-]+)\]/gm)].map((m) => m[1]);
  return [...new Set(codes)].slice(0, MAX_CARDS);
}

/** Thẻ sản phẩm (ảnh, tên, giá, size còn hàng) cho các món được gợi ý, theo đúng thứ tự trong câu trả lời. */
async function productCards(env: Env, text: string): Promise<ProductCard[]> {
  const codes = suggestedCodes(text);
  if (!codes.length) return [];
  const { results } = await env.DB.prepare(
    `SELECT s.ma_sp, s.ten_sp, s.gia_ban, s.gia_goc, s.anh_chinh_url,
            (SELECT group_concat(size, ', ') FROM (
               SELECT DISTINCT b.size FROM bien_the b WHERE b.ma_sp = s.ma_sp AND b.ton_kho > 0
               ORDER BY CASE b.size WHEN 'XS' THEN 0 WHEN 'S' THEN 1 WHEN 'M' THEN 2 WHEN 'L' THEN 3
                 WHEN 'XL' THEN 4 WHEN 'XXL' THEN 5 ELSE 6 END)) AS sizes
     FROM san_pham s WHERE s.ma_sp IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify(codes)).all<{
    ma_sp: string; ten_sp: string; gia_ban: number; gia_goc: number | null; anh_chinh_url: string | null; sizes: string | null;
  }>();
  const byCode = new Map(results.map((r) => [r.ma_sp, r]));
  const base = (env.DIA_CHI_CONG_KHAI ?? "").replace(/\/$/, "");
  return codes.flatMap((c) => {
    const r = byCode.get(c);
    if (!r) return [];
    const img = r.anh_chinh_url ?? "";
    return [{
      ma_sp: r.ma_sp,
      ten_sp: r.ten_sp,
      gia: r.gia_goc && r.gia_goc > r.gia_ban ? `${vnd(r.gia_ban)} (giảm từ ${vnd(r.gia_goc)})` : vnd(r.gia_ban),
      size: r.sizes ?? "",
      anh: img.startsWith("/") && base ? base + img : img,
    }];
  });
}

