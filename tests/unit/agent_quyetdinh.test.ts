import { env } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleUserMessage } from "../../src/agent";
import type { Env } from "../../src/types";

let yeuCau: any[];
const traLoiDeepSeek = { choices: [{ message: { role: "assistant", content: "Dạ chị mặc size M nhé." }, finish_reason: "stop" }], usage: {} };

beforeEach(() => {
  yeuCau = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    yeuCau.push(JSON.parse(String(init?.body ?? "{}")));
    return Response.json(traLoiDeepSeek);
  });
});
afterEach(() => vi.restoreAllMocks());

const voiClef = (diem: Record<string, number>) => ({
  ...env, LLM_NHA_CUNG_CAP: "openai", OPENAI_MODEL: "deepseek-flash", QUYET_DINH: "clef-flash",
  AI: { run: async () => ({ answers: Object.fromEntries(Object.entries(diem).map(([k, v]) => [k, { noul: v }])) }) },
}) as unknown as Env;

it("Clef chắc cần bảng size: code tra sẵn, DeepSeek chỉ gọi một lần để viết câu trả lời", async () => {
  const r = await handleUserMessage(voiClef({ tim_sp: 0.1, bang_size: 0.97, don_hang: 0, kien_thuc: 0.1 }), "u-size", "mình 1m58 48kg mặc size nào");
  expect(yeuCau).toHaveLength(1);
  const tinKhach = yeuCau[0].messages.at(-1);
  expect(tinKhach.role).toBe("user");
  expect(tinKhach.content).toContain("mình 1m58 48kg mặc size nào");
  expect(tinKhach.content).toContain("Hệ thống đã tra sẵn");
  expect(yeuCau[0].tool_choice).toBe("auto");
  expect(r.trace?.map((t) => t.cong_cu)).toEqual(["truy_van"]);
  expect(r.quyet_dinh).toMatchObject({ bang_size: 0.97 });
});

it("Clef chắc không cần tra gì: DeepSeek trả lời luôn, không được gọi công cụ", async () => {
  await handleUserMessage(voiClef({ tim_sp: 0.02, bang_size: 0.01, don_hang: 0.03, kien_thuc: 0.9 }), "u-chao", "Chào shop");
  expect(yeuCau).toHaveLength(1);
  expect(yeuCau[0].tool_choice).toBe("none");
});

it("lịch sử lưu tin gốc của khách, không lưu ghi chú tra sẵn", async () => {
  const e = voiClef({ tim_sp: 0.1, bang_size: 0.97, don_hang: 0, kien_thuc: 0.1 });
  await handleUserMessage(e, "u-ls", "mình 1m58 48kg mặc size nào");
  await handleUserMessage(voiClef({ tim_sp: 0.5, bang_size: 0.5, don_hang: 0, kien_thuc: 0.5 }), "u-ls", "ok");
  const tinCu = yeuCau[1].messages.find((m: any) => m.role === "user");
  expect(tinCu.content).toBe("mình 1m58 48kg mặc size nào");
});
