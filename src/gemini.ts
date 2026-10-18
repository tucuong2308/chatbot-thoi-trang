import type { Env } from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs = 0) {
    super(message);
  }
  /** Quá tải, vượt lượt gọi hoặc quá giờ: nên thử lại / đổi model. */
  get retryable() {
    return [0, 429, 500, 503, 504].includes(this.status);
  }
}

async function call(env: Env, model: string, method: string, body: unknown, timeoutMs: number): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${model}:${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new GeminiError(`Gemini ${model} không phản hồi: ${(err as Error).message}`, 0);
  }
  if (!res.ok) {
    const body = await res.text();
    const delay = Number(body.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/)?.[1] ?? 0) * 1000;
    const quota = body.match(/"quotaId":\s*"([^"]+)"/)?.[1] ?? "";
    throw new GeminiError(`Gemini ${model} ${method} lỗi ${res.status}${quota ? ` (${quota})` : ""}: ${body.slice(0, 300)}`, res.status, delay);
  }
  return res.json();
}

/** Model vừa quá tải thì tạm bỏ qua 5 phút, để khách không phải chờ nó hết giờ ở mỗi tin nhắn. */
const PAUSE_MS = 5 * 60_000;
const pausedUntil = new Map<string, number>();

/**
 * Gọi generateContent: thử model chính rồi tới model dự phòng (GEMINI_MODEL, GEMINI_MODEL_DU_PHONG).
 * Truyền `sticky` để giữ đúng một model cho cả cuộc gọi nhiều vòng (Gemini 3 kèm chữ ký suy nghĩ trong lịch sử,
 * đổi model giữa chừng có thể bị từ chối); khi đó lỗi tạm thời chỉ được thử lại một lần.
 */
export async function generate(
  env: Env, body: unknown, opts: { sticky?: string; timeoutMs?: number; afterWait?: boolean } = {},
): Promise<{ model: string; data: any }> {
  const all = [...new Set([env.GEMINI_MODEL, env.GEMINI_MODEL_DU_PHONG].filter((m): m is string => !!m))];
  const ready = all.filter((m) => (pausedUntil.get(m) ?? 0) < Date.now());
  const candidates = opts.sticky ? [opts.sticky, opts.sticky] : ready.length ? ready : all;
  let lastErr: unknown;
  for (const model of candidates) {
    try {
      return { model, data: await call(env, model, "generateContent", body, opts.timeoutMs ?? 25_000) };
    } catch (err) {
      lastErr = err;
      if (!(err instanceof GeminiError && err.retryable)) throw err;
      console.warn(String(err));
      // Hết hạn mức trong NGÀY: bỏ qua model đó 1 giờ. Vượt hạn mức mỗi phút chỉ là tạm thời, không bỏ qua.
      const daily = err.status === 429 && err.message.includes("PerDay");
      if (!opts.sticky && (daily || err.status !== 429)) pausedUntil.set(model, Date.now() + (daily ? 60 * 60_000 : PAUSE_MS));
    }
  }
  // Mọi model đều vượt hạn mức gọi mỗi phút: chờ đúng thời gian Google gợi ý (tối đa 40 giây) rồi thử lại một lần.
  const wait = lastErr instanceof GeminiError && lastErr.status === 429 ? Math.min(lastErr.retryAfterMs || 20_000, 40_000) : 0;
  if (wait && !opts.afterWait) {
    await new Promise((r) => setTimeout(r, wait));
    return generate(env, body, { ...opts, afterWait: true });
  }
  throw lastErr;
}

/** Lấy phần chữ (bỏ phần suy nghĩ) từ một phản hồi generateContent. */
export function textOf(data: any): string {
  const parts: any[] = data.candidates?.[0]?.content?.parts ?? [];
  return parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
}

/** Embedding cho một nội dung bất kỳ (chữ hoặc ảnh inline_data), dùng khi tạo vector sản phẩm lúc đồng bộ Sheets. */
export async function embedParts(env: Env, parts: object[]): Promise<number[]> {
  const data = await call(env, env.EMBED_MODEL, "embedContent", {
    content: { parts },
    outputDimensionality: Number(env.EMBED_DIM),
  }, 30_000);
  return data.embedding?.values ?? [];
}

/** Embedding cho câu hỏi của khách. Phải dùng cùng model và số chiều với lúc nạp sản phẩm. */
export async function embedText(env: Env, text: string): Promise<number[]> {
  const data = await call(env, env.EMBED_MODEL, "embedContent", {
    content: { parts: [{ text }] },
    outputDimensionality: Number(env.EMBED_DIM),
  }, 10_000);
  return data.embedding?.values ?? [];
}
