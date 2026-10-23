import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { ghiChuTraSan, hoiQuyetDinh, keHoach } from "../../src/quyetdinh";
import type { Env } from "../../src/types";

const diem = (d: Partial<Record<"tim_sp" | "bang_size" | "don_hang" | "kien_thuc", number>>) =>
  ({ tim_sp: 0, bang_size: 0, don_hang: 0, kien_thuc: 0, ...d });

it("câu nhiều ý: tra sẵn mọi việc chắc chắn trong một lượt", () => {
  const k = keHoach(diem({ tim_sp: 0.92, bang_size: 0.96 }), "Có áo sơ mi trắng không, mình 1m65 55kg mặc size gì");
  expect(k.traSan.map((c) => c.name)).toEqual(["tim_san_pham", "truy_van"]);
  expect(k.traSan[0].args).toMatchObject({ theo_mo_ta: "Có áo sơ mi trắng không, mình 1m65 55kg mặc size gì" });
  expect(String(k.traSan[1].args.sql)).toMatch(/FROM bang_size/i);
  expect(k.khongCongCu).toBe(false);
});

it("hỏi đơn hàng thì tra sẵn xem_don", () => {
  expect(keHoach(diem({ don_hang: 0.96 }), "đơn mình giao chưa").traSan.map((c) => c.name)).toEqual(["xem_don"]);
});

it("câu kiến thức không tra sẵn sản phẩm dù điểm tìm hàng khá cao", () => {
  const k = keHoach(diem({ tim_sp: 0.85, kien_thuc: 0.9 }), "da ngăm mặc màu gì hợp");
  expect(k.traSan).toEqual([]);
});

it("mọi việc tra cứu đều chắc chắn không cần: trả lời luôn, không cho gọi công cụ", () => {
  expect(keHoach(diem({ kien_thuc: 0.3 }), "Chào shop")).toEqual({ traSan: [], khongCongCu: true });
});

it("lưỡng lự thì để DeepSeek tự quyết như cũ", () => {
  expect(keHoach(diem({ tim_sp: 0.69, bang_size: 0.52 }), "mẫu lúc nãy còn size M không")).toEqual({ traSan: [], khongCongCu: false });
});

it("hỏi Clef một lần với đủ câu hỏi, gửi kèm vài tin gần nhất", async () => {
  let goi: any;
  const fake = { ...env, QUYET_DINH: "clef-flash", AI: { run: async (model: string, input: any) => {
    goi = { model, input };
    return { answers: { tim_sp: { noul: 0.9 }, bang_size: { noul: 0.1 }, don_hang: { noul: 0.0 }, kien_thuc: { noul: 0.2 } } };
  } } } as unknown as Env;
  const d = await hoiQuyetDinh(fake, [{ role: "model", text: "[SP001] Áo sơ mi trắng" }], "mẫu đó còn M không");
  expect(d).toEqual({ tim_sp: 0.9, bang_size: 0.1, don_hang: 0, kien_thuc: 0.2 });
  expect(goi.model).toBe("@cf/cloudflare/clef-flash");
  expect(Object.keys(goi.input.questions).sort()).toEqual(["bang_size", "don_hang", "kien_thuc", "tim_sp"]);
  expect(goi.input.state).toContain("[SP001] Áo sơ mi trắng");
  expect(goi.input.state).toContain("mẫu đó còn M không");
});

it("tắt công tắc, Clef lỗi hoặc quá chậm thì trả null để bot chạy như cũ", async () => {
  expect(await hoiQuyetDinh({ ...env, QUYET_DINH: "" } as Env, [], "chào")).toBeNull();
  const loi = { ...env, QUYET_DINH: "clef-flash", AI: { run: async () => { throw new Error("hết hạn mức"); } } } as unknown as Env;
  expect(await hoiQuyetDinh(loi, [], "chào")).toBeNull();
  const cham = { ...env, QUYET_DINH: "clef-flash", AI: { run: () => new Promise(() => {}) } } as unknown as Env;
  expect(await hoiQuyetDinh(cham, [], "chào", 50)).toBeNull();
});

it("ghi chú kết quả tra sẵn để DeepSeek dùng, nói rõ được tra thêm nếu chưa đủ", () => {
  const g = ghiChuTraSan([{ name: "truy_van", args: { sql: "SELECT * FROM bang_size" }, result: { rows: [{ size: "M" }] } }]);
  expect(g).toContain("truy_van");
  expect(g).toContain('"size":"M"');
  expect(g).toMatch(/gọi thêm công cụ/);
});
