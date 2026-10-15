import { generate, GeminiError, textOf } from "./gemini";
import type { Env } from "./types";

/**
 * Lớp gọi model trò chuyện, dùng chung cho Gemini và các API kiểu OpenAI (NVIDIA build.nvidia.com,
 * OpenRouter, DeepSeek...). Chọn bằng LLM_NHA_CUNG_CAP = "openai" hoặc "gemini" (không đặt thì là Gemini).
 * Embedding luôn dùng Gemini (src/gemini.ts) vì vector sản phẩm đã tạo bằng model đó.
 */

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type Msg =
  | { role: "user"; text: string }
  /** raw: tin nhắn gốc của nhà cung cấp, gửi lại nguyên vẹn (chữ ký suy nghĩ của Gemini, reasoning_content...) */
  | { role: "assistant"; text: string; toolCalls: ToolCall[]; raw?: unknown }
  | { role: "tool"; results: { call: ToolCall; result: Record<string, unknown> }[] };

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  model: string;
  raw: unknown;
}

export type Part = { text: string } | { image: { mime: string; b64: string } };

const isOpenAI = (env: Env) => env.LLM_NHA_CUNG_CAP === "openai";

export function providerLabel(env: Env): string {
  return isOpenAI(env) ? `openai:${env.OPENAI_MODEL}` : "gemini";
}

/** Số ảnh mỗi lần gửi model nhìn. Nhiều máy chủ kiểu OpenAI giới hạn số ảnh mỗi request chặt hơn Gemini. */
export function imagesPerRequest(env: Env): number {
  return Number(env.ANH_MOI_LO) || (isOpenAI(env) ? 8 : 16);
}

/** Một lượt hỏi model, có khai báo công cụ (tools theo định dạng của Gemini: type viết hoa). */
export async function chat(
  env: Env, req: { system: string; messages: Msg[]; tools: object[]; noTools?: boolean; sticky?: string },
): Promise<ChatResult> {
  return isOpenAI(env) ? chatOpenAI(env, req) : chatGemini(env, req);
}

/** Cho model nhìn ảnh + chữ và trả về JSON đúng schema (schema theo định dạng của Gemini). */
export async function visionJson(env: Env, parts: Part[], schema: object): Promise<any> {
  if (!isOpenAI(env)) {
    const { data } = await generate(env, {
      contents: [{ role: "user", parts: parts.map((p) => ("text" in p ? p : { inline_data: { mime_type: p.image.mime, data: p.image.b64 } })) }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0 },
    }, { timeoutMs: 45_000 });
    return JSON.parse(textOf(data) || "{}");
  }
  const content = parts.map((p) => ("text" in p
    ? { type: "text", text: p.text }
    : { type: "image_url", image_url: { url: `data:${p.image.mime};base64,${p.image.b64}` } }));
  content.push({ type: "text", text: `Chỉ trả về một đối tượng JSON đúng schema sau, không thêm chữ nào khác:\n${JSON.stringify(toJsonSchema(schema))}` });
  // Xem ảnh chỉ cần nhận xét ngắn: tắt phần suy nghĩ của DeepSeek, nếu không nó có thể nghĩ hết số token
  // cho phép rồi trả về câu trả lời rỗng (đo thực tế: 6 ảnh, có suy nghĩ 30-48 giây; tắt suy nghĩ 2,5 giây).
  const noThinking = /deepseek/i.test(env.OPENAI_BASE_URL ?? "") ? { thinking: { type: "disabled" } } : {};
  const res = await openaiCall(env, { messages: [{ role: "user", content }], temperature: 0, ...noThinking }, 90_000);
  return parseJsonLoose(res.message.content ?? "");
}

// ---------------- Gemini ----------------

/** Gemini có lúc không gửi id cho lời gọi công cụ; đánh dấu id tự tạo để không gửi ngược lại. */
const NO_ID = "__khong_id_";

async function chatGemini(
  env: Env, req: { system: string; messages: Msg[]; tools: object[]; noTools?: boolean; sticky?: string },
): Promise<ChatResult> {
  const contents = req.messages.map((m) => {
    if (m.role === "user") return { role: "user", parts: [{ text: m.text }] };
    if (m.role === "assistant") {
      return (m.raw as object) ?? {
        role: "model",
        parts: [...(m.text ? [{ text: m.text }] : []), ...m.toolCalls.map((c) => ({ functionCall: { name: c.name, args: c.args } }))],
      };
    }
    return {
      role: "user",
      parts: m.results.map(({ call, result }) => ({
        functionResponse: { name: call.name, ...(call.id.startsWith(NO_ID) ? {} : { id: call.id }), response: result },
      })),
    };
  });
  const body = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents,
    tools: [{ functionDeclarations: req.tools }],
    ...(req.noTools ? { toolConfig: { functionCallingConfig: { mode: "NONE" } } } : {}),
    generationConfig: { temperature: 0.3 },
  };
  const { model, data } = await generate(env, body, { sticky: req.sticky });
  const content = data.candidates?.[0]?.content;
  const toolCalls: ToolCall[] = (content?.parts ?? [])
    .filter((p: any) => p.functionCall)
    .map((p: any, i: number) => ({ id: p.functionCall.id ?? `${NO_ID}${i}`, name: p.functionCall.name, args: p.functionCall.args ?? {} }));
  return { text: textOf(data), toolCalls, model, raw: content };
}

// ---------------- API kiểu OpenAI ----------------

/** Đổi schema kiểu Gemini (type: "OBJECT") sang JSON Schema chuẩn (type: "object"). */
function toJsonSchema(s: any): any {
  if (Array.isArray(s)) return s.map(toJsonSchema);
  if (!s || typeof s !== "object") return s;
  const out: any = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "nullable") continue;
    out[k] = k === "type" && typeof v === "string" ? v.toLowerCase() : toJsonSchema(v);
  }
  return out;
}

function parseJsonLoose(text: string): any {
  const t = text.replace(/```(?:json)?/g, "").trim();
  try { return JSON.parse(t); } catch { /* thử cắt phần JSON */ }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch { /* bỏ qua */ }
  }
  return {};
}

async function openaiCall(env: Env, body: Record<string, unknown>, timeoutMs: number, modelOverride?: string): Promise<{ model: string; message: any }> {
  const models = modelOverride ? [modelOverride] : [env.OPENAI_MODEL, env.OPENAI_MODEL_DU_PHONG].filter((m): m is string => !!m);
  const base = (env.OPENAI_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const model of models) {
      let res: Response;
      try {
        res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY || env.NVIDIA_API_KEY}` },
          // Model suy luận tính cả phần suy nghĩ vào max_tokens; để rộng tay kẻo bị cắt trước khi kịp trả lời.
          body: JSON.stringify({ model, max_tokens: 16_000, ...body }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        lastErr = new GeminiError(`${model} không phản hồi: ${(err as Error).message}`, 0);
        continue;
      }
      if (res.ok) {
        const data: any = await res.json();
        const choice = data.choices?.[0];
        if (choice?.finish_reason === "length") console.warn(`${model} bị cắt vì hết max_tokens`);
        return { model, message: choice?.message ?? {} };
      }
      const wait = Number(res.headers.get("retry-after")) * 1000 || 20_000;
      lastErr = new GeminiError(`${model} lỗi ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status, wait);
      if (![429, 500, 502, 503, 504].includes(res.status)) throw lastErr;
      console.warn(String(lastErr));
    }
    // Mọi model đều bận / vượt hạn mức: (chờ nếu là 429) rồi thử lại một lần
    const e = lastErr as GeminiError;
    if (attempt === 0 && e?.status === 429) await new Promise((r) => setTimeout(r, Math.min(e.retryAfterMs, 40_000)));
  }
  throw lastErr;
}

async function chatOpenAI(
  env: Env, req: { system: string; messages: Msg[]; tools: object[]; noTools?: boolean; sticky?: string },
): Promise<ChatResult> {
  const messages: any[] = [{ role: "system", content: req.system }];
  for (const m of req.messages) {
    if (m.role === "user") messages.push({ role: "user", content: m.text });
    else if (m.role === "assistant") {
      messages.push((m.raw as object) ?? {
        role: "assistant",
        content: m.text || null,
        ...(m.toolCalls.length ? {
          tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })),
        } : {}),
      });
    } else {
      for (const { call, result } of m.results) messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  const tools = req.tools.map((t: any) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: toJsonSchema(t.parameters) },
  }));
  const { model, message } = await openaiCall(env, {
    messages, tools, tool_choice: req.noTools ? "none" : "auto", temperature: 0.3,
  }, 120_000, req.sticky);

  let toolCalls: ToolCall[] = (message.tool_calls ?? []).map((c: any) => {
    let args: Record<string, unknown> = {};
    try { args = typeof c.function?.arguments === "string" ? JSON.parse(c.function.arguments || "{}") : c.function?.arguments ?? {}; } catch { /* để rỗng */ }
    return { id: c.id, name: c.function?.name, args };
  });
  // Đôi khi máy chủ không tách được lời gọi công cụ của DeepSeek và trả nguyên dạng <｜DSML｜ invoke ...> trong content.
  if (!toolCalls.length && /DSML｜\s*invoke/.test(message.content ?? "")) {
    toolCalls = parseDsml(message.content);
    if (toolCalls.length) {
      message.content = null;
      message.tool_calls = toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }));
    }
  }
  // Giữ nguyên tin nhắn của model (kể cả reasoning_content) để gửi lại ở vòng sau như nhiều model suy luận yêu cầu.
  const raw = { role: "assistant", content: message.content ?? null, ...message };
  return { text: String(message.content ?? "").trim(), toolCalls, model, raw };
}

/** Đọc lời gọi công cụ dạng chữ của DeepSeek: <｜DSML｜ invoke name="..."> <｜DSML｜ parameter name="..." string="true">...</｜DSML｜ parameter> */
export function parseDsml(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const invokes = text.split(/<｜DSML｜\s*invoke\s+name="/).slice(1);
  invokes.forEach((chunk, i) => {
    const name = chunk.slice(0, chunk.indexOf('"'));
    const args: Record<string, unknown> = {};
    for (const m of chunk.matchAll(/<｜DSML｜\s*parameter\s+name="([^"]+)"(?:\s+string="(true|false)")?>([\s\S]*?)(?=<\/?｜DSML｜)/g)) {
      const [, key, isString, raw] = m;
      const value = raw.trim();
      if (isString === "false") {
        try { args[key] = JSON.parse(value); continue; } catch { /* giữ dạng chuỗi */ }
      }
      args[key] = value;
    }
    if (name) calls.push({ id: `dsml_${Date.now()}_${i}`, name, args });
  });
  return calls;
}
