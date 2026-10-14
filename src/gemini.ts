import type { Env } from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiError extends Error {
  constructor(message: string, readonly status: number) {
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
  if (!res.ok) throw new GeminiError(`Gemini ${model} ${method} lỗi ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
  return res.json();
}

/** Model chính trước, model dự phòng sau. */
export function modelsOf(env: Env): string[] {
  return [...new Set([env.GEMINI_MODEL, env.GEMINI_MODEL_DU_PHONG].filter((m): m is string => !!m))];
}

/** Gọi generateContent với đúng một model (body gồm contents, tools, systemInstruction...). */
export function generate(env: Env, model: string, body: unknown, timeoutMs = 20_000): Promise<any> {
  return call(env, model, "generateContent", body, timeoutMs);
}

/** Embedding cho câu hỏi của khách. Phải dùng cùng model và số chiều với lúc nạp sản phẩm. */
export async function embedText(env: Env, text: string): Promise<number[]> {
  const data = await call(env, env.EMBED_MODEL, "embedContent", {
    content: { parts: [{ text }] },
    outputDimensionality: Number(env.EMBED_DIM),
  }, 10_000);
  return data.embedding?.values ?? [];
}
