import { env } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleUserMessage } from "../../src/agent";
import { boMarkdown } from "../../src/dinhdang";
import { systemPrompt } from "../../src/prompt";
import { hoiQuyetDinh } from "../../src/quyetdinh";
import { handleIncoming } from "../../src/tinnhan";
import { runTool } from "../../src/tools";
import type { Env } from "../../src/types";
import { napMau } from "./setup";

// Các lỗi tìm ra khi tự chat thử với bot qua /chat-thu (23/10).

const ctx = (khach = "fb:sua") => ({ khach, notifyWait: async () => {}, onNhap: () => {}, onYeuCauHuy: () => {} });

beforeEach(async () => {
  await napMau(env);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM thong_tin_shop"),
    env.DB.prepare(`INSERT INTO san_pham (ma_sp, ten_sp, gia_ban, gioi_tinh, trang_thai) VALUES
      ('SP38504', 'Gini and Jony Girls Navy Blue Skirts', 219000, 'nữ', 'đang bán')`),
    env.DB.prepare("INSERT INTO bien_the (ma_bien_the, ma_sp, mau, size, ton_kho) VALUES ('SP38504-S', 'SP38504', '', 'S', 3)"),
  ]);
});
afterEach(() => vi.restoreAllMocks());

it("1. tìm hàng cho người lớn thì bỏ đồ trẻ em, và báo cho model biết đã bỏ", async () => {
  const r: any = await runTool(env, "tim_san_pham", { sql: "SELECT ma_sp FROM san_pham" }, ctx());
  expect(r.san_pham.map((p: any) => p.ma_sp)).not.toContain("SP38504");
  expect(r.da_bo_do_tre_em).toBe(1);
});

it("1. khách tìm đồ cho bé thì vẫn có đồ trẻ em, gắn cờ tre_em", async () => {
  const r: any = await runTool(env, "tim_san_pham", { sql: "SELECT ma_sp FROM san_pham WHERE gioi_tinh = 'nữ' -- cho bé gái" }, ctx());
  expect(r.san_pham.find((p: any) => p.ma_sp === "SP38504")).toMatchObject({ tre_em: true });
});

it("2. soan_don nhận cách gọi sai hay gặp: món viết phẳng, nguoi_nhan / so_dien_thoai", async () => {
  const r: any = await runTool(env, "soan_don", {
    ma_sp: "SP1", size: "L", mau: "Đỏ", so_luong: "1",
    nguoi_nhan: "Nguyễn Thị Lan", so_dien_thoai: "0912345678", dia_chi: "25 Lý Thường Kiệt, Hoàn Kiếm, Hà Nội",
  }, ctx("fb:phang"));
  expect(r).toMatchObject({ ok: true, so_mon: 1 });
});

it("2. soan_don sai hẳn thì lỗi kèm ví dụ gọi đúng", async () => {
  const r: any = await runTool(env, "soan_don", { ghi_chu: "x" }, ctx());
  expect(r.loi.join(" ")).toContain('"mon":[{"ma_sp"');
});

it("3. bỏ Markdown vì Messenger / Telegram hiện nguyên dấu sao", () => {
  expect(boMarkdown("Chị mặc **size M** nhé, mẫu __đẹp__ ạ\n## Gợi ý\n- [SP1] Đầm")).toBe("Chị mặc size M nhé, mẫu đẹp ạ\nGợi ý\n- [SP1] Đầm");
});

it("3. câu trả lời của bot không còn Markdown", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({
    choices: [{ message: { role: "assistant", content: "Dạ chị mặc **size M** ạ." }, finish_reason: "stop" }], usage: {},
  }));
  const e = { ...env, LLM_NHA_CUNG_CAP: "openai", OPENAI_MODEL: "deepseek-flash", QUYET_DINH: "" } as Env;
  expect((await handleUserMessage(e, "u-md", "mình mặc size gì")).text).toBe("Dạ chị mặc size M ạ.");
});

it("4. prompt cấm hứa giữ hàng hay việc shop chưa làm", () => {
  expect(systemPrompt(env, [])).toMatch(/không hứa giữ hàng/i);
});

it("5. tin đã nhận đơn lấy thời gian giao từ ThongTinShop, chưa có thì không tự nói số ngày", async () => {
  const datDon = async (khach: string) => {
    await runTool(env, "soan_don", { mon: [{ ma_sp: "SP2", size: "S" }], ten: "Lan", sdt: "0912345678", dia_chi: "1 Lê Lợi, Quận 1, TP HCM" },
      { ...ctx(khach), onNhap: (n: any) => { (globalThis as any).__nhap = n; } });
    return handleIncoming(env, khach, { payload: `DON:XAC_NHAN:${(globalThis as any).__nhap.id}` });
  };
  const khongCo = await datDon("fb:giao1");
  expect((khongCo.tin[0] as any).chu).not.toMatch(/ngày/);
  await env.DB.prepare("INSERT INTO thong_tin_shop (stt, chu_de, noi_dung) VALUES (1, 'Thời gian giao hàng', 'Nội thành 1 ngày, tỉnh 2-4 ngày.')").run();
  await env.DB.prepare("UPDATE bien_the SET ton_kho = 5 WHERE ma_sp = 'SP2'").run();
  const co = await datDon("fb:giao2");
  expect((co.tin[0] as any).chu).toContain("Nội thành 1 ngày, tỉnh 2-4 ngày.");
});

it("6. Clef chậm 2 giây vẫn được chờ (trước đây bỏ qua sau 1,5 giây)", async () => {
  const cham = { ...env, QUYET_DINH: "clef-flash", AI: { run: () => new Promise((r) => setTimeout(() => r({
    answers: { tim_sp: { noul: 0.9 }, bang_size: { noul: 0 }, don_hang: { noul: 0 }, kien_thuc: { noul: 0 } },
  }), 2000)) } } as unknown as Env;
  expect(await hoiQuyetDinh(cham, [], "váy đi tiệc")).toMatchObject({ tim_sp: 0.9 });
}, 10_000);
