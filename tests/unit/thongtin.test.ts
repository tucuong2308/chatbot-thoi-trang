import { env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { importCatalog } from "../../src/catalog";
import { docThongTinShop, systemPrompt } from "../../src/prompt";

const SP = [{ ma_sp: "SP1", ten_sp: "Áo", gia_ban: "100000", trang_thai: "đang bán" }];
const THONG_TIN = [
  { chu_de: "", noi_dung: "Dòng giải thích của mẫu, không có chủ đề" },
  { chu_de: "Đổi trả", noi_dung: "Đổi size trong 7 ngày, còn tem mác." },
  { chu_de: "Địa chỉ", noi_dung: "" },
  { chu_de: " Giờ làm việc ", noi_dung: " 8h - 22h   mỗi ngày " },
];

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM thong_tin_shop").run();
});

it("nạp trang ThongTinShop, bỏ dòng thiếu chủ đề hoặc nội dung", async () => {
  const kq = await importCatalog(env, { san_pham: SP, thong_tin_shop: THONG_TIN });
  expect(kq.thong_tin_shop).toBe(2);
  expect(await docThongTinShop(env)).toEqual([
    { chu_de: "Đổi trả", noi_dung: "Đổi size trong 7 ngày, còn tem mác." },
    { chu_de: "Giờ làm việc", noi_dung: "8h - 22h mỗi ngày" },
  ]);
});

it("Sheets chưa có trang ThongTinShop thì giữ nguyên thông tin cũ", async () => {
  await importCatalog(env, { san_pham: SP, thong_tin_shop: THONG_TIN });
  await importCatalog(env, { san_pham: SP });
  expect(await docThongTinShop(env)).toHaveLength(2);
});

it("prompt có thông tin shop, và nói rõ chủ đề nào chưa có thì không được bịa", () => {
  const p = systemPrompt(env, [{ chu_de: "Đổi trả", noi_dung: "Đổi size trong 7 ngày." }]);
  expect(p).toContain("- Đổi trả: Đổi size trong 7 ngày.");
  expect(p).toMatch(/Thông tin shop/);
  const trong = systemPrompt(env, []);
  expect(trong).toContain("(chủ shop chưa ghi thông tin nào)");
});

it("prompt cho phép trả lời bằng hiểu biết, không bắt tra cứu mọi câu", () => {
  const p = systemPrompt(env, []);
  expect(p).toMatch(/không cần gọi công cụ/i);
  expect(p).not.toContain("Câu không liên quan đến mua sắm, khiếu nại, đổi trả, hoặc điều không tra được: nói sẽ chuyển nhân viên");
});
