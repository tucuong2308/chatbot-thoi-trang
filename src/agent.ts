import { chat, type Msg } from "./llm";
import { systemPrompt } from "./prompt";
import { runTool, TOOL_DECLARATIONS } from "./tools";
import type { ChatTurn, Env, ToolTrace } from "./types";

const HISTORY_TURNS = 10;
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

async function saveHistory(env: Env, userKey: string, history: ChatTurn[]) {
  await env.SHOP_KV.put(`hist:${userKey}`, JSON.stringify(history.slice(-HISTORY_TURNS)), {
    expirationTtl: 60 * 60 * 24 * 7,
  });
}

export interface BotReply {
  text: string;
  images: string[];
  /** Tin nhắn tạm đã gửi trong lúc bot làm việc lâu (VD nhắn khách chờ trước khi xem ảnh). */
  interim: string[];
  model?: string;
  trace?: ToolTrace[];
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
  const interim: string[] = [];
  const ctx = {
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
  await saveHistory(env, userKey, [...history, { role: "model", text }]);
  return { text, images: await imagesFor(env, text), interim, model, trace };
}

const codesIn = (text: string) => [...new Set([...text.matchAll(/\bSP[\w-]+/g)].map((m) => m[0]))];

/** Bỏ các dòng nhắc mã bịa; nếu không còn sản phẩm thật nào thì thay bằng câu hẹn nhân viên kiểm tra. */
function dropLinesWith(text: string, codes: string[]): string {
  const out = text.split("\n").filter((line) => !codes.some((c) => line.includes(c))).join("\n").trim();
  return codesIn(out).length ? out : "Dạ em chưa tìm được mẫu phù hợp trong kho, em nhờ nhân viên shop kiểm tra và nhắn lại chị ngay nhé.";
}

/** Ảnh của tối đa 3 sản phẩm được nhắc trong câu trả lời (theo mã [SP...]), dạng link http để gửi Messenger. */
async function imagesFor(env: Env, text: string): Promise<string[]> {
  const codes = [...new Set([...text.matchAll(/\bSP[\w-]+/g)].map((m) => m[0]))].slice(0, 3);
  if (!codes.length) return [];
  const { results } = await env.DB.prepare(
    "SELECT ma_sp, anh_chinh_url FROM san_pham WHERE ma_sp IN (SELECT value FROM json_each(?))",
  ).bind(JSON.stringify(codes)).all<{ ma_sp: string; anh_chinh_url: string }>();
  const url = new Map(results.map((r) => [r.ma_sp, r.anh_chinh_url ?? ""]));
  const base = (env.DIA_CHI_CONG_KHAI ?? "").replace(/\/$/, "");
  return codes
    .map((c) => url.get(c) ?? "")
    .map((u) => (u.startsWith("/") && base ? base + u : u))
    .filter((u) => u.startsWith("http"));
}
