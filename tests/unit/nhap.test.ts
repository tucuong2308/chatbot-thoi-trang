import { env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { layNhap, soanDon } from "../../src/donhang/nhap";
import { napMau } from "./setup";

const NGUOI = { ten: "Lan", sdt: "+84912345678", dia_chi: "12 Lê Lợi, Huế" };
beforeEach(() => napMau(env));

it("đủ thông tin thì lưu nháp, size/màu theo cách viết trong kho, tiền đúng", async () => {
  const r = await soanDon(env, "fb:1", { mon: [{ ma_sp: "SP1", size: "m", mau: "do", so_luong: 2 }, { ma_sp: "SP2", size: "S" }], ...NGUOI });
  if (!r.ok) throw new Error(r.loi.join("; "));
  expect(r.nhap.tien_hang).toBe(800000);
  expect(r.nhap.mon[0]).toMatchObject({ ma_sp: "SP1", ten_sp: "Đầm hoa", size: "M", mau: "Đỏ", so_luong: 2, don_gia: 300000 });
  expect(r.nhap.mon[1]).toMatchObject({ ma_sp: "SP2", size: "S", mau: "", so_luong: 1 });
  expect(r.nhap.sdt).toBe("0912345678");
  expect(r.tom_tat).toContain("Tiền hàng: 800.000đ");
  expect((await layNhap(env, "fb:1"))?.id).toBe(r.nhap.id);
});

it("gom mọi lỗi cùng lúc và không lưu nháp", async () => {
  const e = await soanDon(env, "fb:2", {
    mon: [{ ma_sp: "SP1", size: "M" }, { ma_sp: "SP1", size: "M", mau: "Xanh" }, { ma_sp: "SP1", size: "L", mau: "Đỏ", so_luong: 6 }, { ma_sp: "SP9", size: "M" }],
    ten: "Lan", dia_chi: "12 Lê Lợi, Huế",
  });
  expect(e.ok).toBe(false);
  if (e.ok) return;
  expect(e.loi).toEqual(expect.arrayContaining([
    "[SP1] cần chọn màu, còn hàng: Đỏ",
    "[SP1] size M màu Xanh đã hết; còn: M/Đỏ, L/Đỏ",
    "[SP1] tối đa 5 chiếc mỗi món; cần nhiều hơn thì gọi chuyen_nhan_vien",
    "[SP9] không có trong danh mục hoặc đã ngừng bán",
    "thiếu số điện thoại",
  ]));
  expect(await layNhap(env, "fb:2")).toBeNull();
});

it("báo vượt tồn kho, sai số điện thoại, thiếu địa chỉ, chưa có món", async () => {
  const e = await soanDon(env, "fb:3", { mon: [{ ma_sp: "SP1", size: "M", mau: "Đỏ", so_luong: 4 }], ten: "Lan", sdt: "12345", dia_chi: "Huế" });
  expect(!e.ok && e.loi).toEqual(expect.arrayContaining([
    "[SP1] size M màu Đỏ chỉ còn 3",
    "số điện thoại 12345 không đúng (cần 10 số, bắt đầu bằng 0)",
    expect.stringMatching(/^địa chỉ: thiếu số nhà/),
  ]));
  const k = await soanDon(env, "fb:3", { mon: [], ...NGUOI });
  expect(!k.ok && k.loi).toContain("chưa có món nào");
});

it("gộp dòng trùng biến thể", async () => {
  const r = await soanDon(env, "fb:4", { mon: [{ ma_sp: "SP2", size: "S" }, { ma_sp: "sp2", size: "s" }], ...NGUOI });
  expect(r.ok && r.nhap.mon).toHaveLength(1);
  expect(r.ok && r.nhap.mon[0].so_luong).toBe(2);
});

it("món ngừng bán bị từ chối", async () => {
  await env.DB.prepare("UPDATE san_pham SET trang_thai = 'ngừng bán' WHERE ma_sp = 'SP2'").run();
  const e = await soanDon(env, "fb:5", { mon: [{ ma_sp: "SP2", size: "S" }], ...NGUOI });
  expect(!e.ok && e.loi).toContain("[SP2] không có trong danh mục hoặc đã ngừng bán");
});

it("soạn lại thì thay nháp cũ bằng id mới", async () => {
  const r1 = await soanDon(env, "fb:1", { mon: [{ ma_sp: "SP2", size: "S" }], ...NGUOI });
  const r2 = await soanDon(env, "fb:1", { mon: [{ ma_sp: "SP1", size: "L", mau: "Đỏ" }], ...NGUOI });
  expect(r1.ok && r2.ok).toBe(true);
  expect((await layNhap(env, "fb:1"))?.id).toBe(r2.ok && r2.nhap.id);
  expect(r2.ok && r2.nhap.id).not.toBe(r1.ok && r1.nhap.id);
});
