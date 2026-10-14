import { GeminiError, generate, modelsOf } from "./gemini";
import { systemPrompt } from "./prompt";
import { runTool, TOOL_DECLARATIONS } from "./tools";
import type { ChatTurn, Env, ToolTrace } from "./types";

const HISTORY_TURNS = 10;
/** Số vòng gọi công cụ tối đa cho một tin nhắn (viết SQL, xem kết quả, sửa...). */
const MAX_TOOL_ROUNDS = 4;

async function loadHistory(env: Env, userKey: string): Promise<ChatTurn[]> {
  return (await env.SHOP_KV.get<ChatTurn[]>(`hist:${userKey}`, "json")) ?? [];
}

async function saveHistory(env: Env, userKey: string, history: ChatTurn[]) {
  await env.SHOP_KV.put(`hist:${userKey}`, JSON.stringify(history.slice(-HISTORY_TURNS)), {
    expirationTtl: 60 * 60 * 24 * 7,
  });
}

/** Model vừa quá tải thì tạm bỏ qua 5 phút, để khách không phải chờ nó hết giờ ở mỗi tin nhắn. */
const PAUSE_MS = 5 * 60_000;
const pausedUntil = new Map<string, number>();

/**
 * Lượt đầu thử model chính rồi tới model dự phòng. Đã chọn được model thì giữ nguyên cho các vòng sau
 * (Gemini 3 kèm chữ ký suy nghĩ trong lịch sử, đổi model giữa chừng có thể bị từ chối); lỗi tạm thời thì thử lại một lần.
 */
async function callModel(env: Env, body: unknown, sticky?: string): Promise<{ model: string; data: any }> {
  const all = modelsOf(env);
  const ready = all.filter((m) => (pausedUntil.get(m) ?? 0) < Date.now());
  const candidates = sticky ? [sticky, sticky] : ready.length ? ready : all;
  let lastErr: unknown;
  for (const model of candidates) {
    try {
      return { model, data: await generate(env, model, body) };
    } catch (err) {
      lastErr = err;
      if (!(err instanceof GeminiError && err.retryable)) throw err;
      console.warn(String(err));
      if (!sticky) pausedUntil.set(model, Date.now() + PAUSE_MS);
    }
  }
  throw lastErr;
}

export interface BotReply {
  text: string;
  images: string[];
  model?: string;
  trace?: ToolTrace[];
}

/** Xử lý một tin nhắn của khách: Gemini tự gọi công cụ tra cứu (SQL) rồi viết câu trả lời. */
export async function handleUserMessage(env: Env, userKey: string, message: string): Promise<BotReply> {
  const history = [...(await loadHistory(env, userKey)), { role: "user" as const, text: message }];
  const contents: any[] = history.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
  const trace: ToolTrace[] = [];
  const base = {
    systemInstruction: { parts: [{ text: systemPrompt(env) }] },
    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    generationConfig: { temperature: 0.3 },
  };

  let model: string | undefined;
  let text = "";
  for (let round = 0; ; round++) {
    const lastRound = round >= MAX_TOOL_ROUNDS;
    const body = lastRound ? { ...base, contents, toolConfig: { functionCallingConfig: { mode: "NONE" } } } : { ...base, contents };
    const res = await callModel(env, body, model);
    model = res.model;

    const content = res.data.candidates?.[0]?.content;
    const parts: any[] = content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length || lastRound) {
      text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
      break;
    }

    contents.push(content); // giữ nguyên (kể cả chữ ký suy nghĩ) như Gemini yêu cầu
    const responses = [];
    for (const p of calls) {
      const { name, args = {}, id } = p.functionCall;
      const result = await runTool(env, name, args);
      trace.push({ cong_cu: name, tham_so: args, ket_qua: result });
      responses.push({ functionResponse: { name, ...(id ? { id } : {}), response: result } });
    }
    contents.push({ role: "user", parts: responses });
  }

  if (!text) text = "Dạ em chưa trả lời được câu này, em chuyển nhân viên hỗ trợ chị ngay nhé.";
  await saveHistory(env, userKey, [...history, { role: "model", text }]);
  return { text, images: await imagesFor(env, text), model, trace };
}

/** Ảnh của tối đa 3 sản phẩm được nhắc trong câu trả lời (theo mã [SP...]), chỉ lấy link http. */
async function imagesFor(env: Env, text: string): Promise<string[]> {
  const codes = [...new Set([...text.matchAll(/\bSP[\w-]+/g)].map((m) => m[0]))].slice(0, 3);
  if (!codes.length) return [];
  const { results } = await env.DB.prepare(
    "SELECT ma_sp, anh_chinh_url FROM san_pham WHERE ma_sp IN (SELECT value FROM json_each(?))",
  ).bind(JSON.stringify(codes)).all<{ ma_sp: string; anh_chinh_url: string }>();
  const url = new Map(results.map((r) => [r.ma_sp, r.anh_chinh_url]));
  return codes.map((c) => url.get(c) ?? "").filter((u) => u.startsWith("http"));
}
