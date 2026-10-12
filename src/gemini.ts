import type { ChatTurn, Env } from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

async function call(env: Env, model: string, method: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE}/${model}:${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini ${method} lỗi ${res.status}: ${await res.text()}`);
  return res.json();
}

const toContents = (history: ChatTurn[]) =>
  history.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));

/** Gọi Gemini và bắt trả JSON đúng schema (structured output). */
export async function generateJson<T>(
  env: Env, system: string, history: ChatTurn[], schema: object,
): Promise<T> {
  const data = await call(env, env.GEMINI_MODEL, "generateContent", {
    systemInstruction: { parts: [{ text: system }] },
    contents: toContents(history),
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0 },
  });
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  return JSON.parse(text) as T;
}

export async function generateText(env: Env, system: string, history: ChatTurn[]): Promise<string> {
  const data = await call(env, env.GEMINI_MODEL, "generateContent", {
    systemInstruction: { parts: [{ text: system }] },
    contents: toContents(history),
    generationConfig: { temperature: 0.6 },
  });
  return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
}

/** Embedding cho câu hỏi của khách. Phải dùng cùng model và số chiều với lúc nạp sản phẩm. */
export async function embedText(env: Env, text: string): Promise<number[]> {
  const data = await call(env, env.EMBED_MODEL, "embedContent", {
    content: { parts: [{ text }] },
    outputDimensionality: Number(env.EMBED_DIM),
  });
  return data.embedding?.values ?? [];
}
