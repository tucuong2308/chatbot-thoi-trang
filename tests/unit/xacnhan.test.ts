import { env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { xacNhanDon } from "../../src/donhang/don";
import { layNhap, soanDon } from "../../src/donhang/nhap";
import { ghiHoiThoai } from "../../src/hoithoai";
import type { DonNhap } from "../../src/types";
import { napMau } from "./setup";

const NGUOI = { ten: "Lan", sdt: "0912345678", dia_chi: "12 Lê Lợi, Huế" };
async function nhap(khach: string, mon = [{ ma_sp: "SP1", size: "M", mau: "Đỏ", so_luong: 2 }]): Promise<DonNhap> {
  const r = await soanDon(env, khach, { mon, ...NGUOI });
  if (!r.ok) throw new Error(r.loi.join("; "));
  return r.nhap;
}
beforeEach(async () => {
  await napMau(env);
  await env.DB.batch([env.DB.prepare("DELETE FROM don_hang"), env.DB.prepare("DELETE FROM don_hang_mon")]);
});

it("tạo đơn, lưu hội thoại, xóa nháp; bấm lại thì trả mã đã có", async () => {
  await ghiHoiThoai(env, "fb:1", "khach", "mình lấy đầm hoa size M");
  const n = await nhap("fb:1");
  const a = await xacNhanDon(env, "fb:1", n.id);
  expect(a).toMatchObject({ kq: "da_tao", ma_don: expect.stringMatching(/^DH-\d{6}-001$/) });
  if (a.kq !== "da_tao") return;
  expect(await xacNhanDon(env, "fb:1", n.id)).toEqual({ kq: "da_co", ma_don: a.ma_don });
  const row = await env.DB.prepare("SELECT * FROM don_hang").first<Record<string, any>>();
  expect(row).toMatchObject({ ma_don: a.ma_don, khach: "fb:1", nhap_id: n.id, tien_hang: 600000, trang_thai: "Mới", sdt: "0912345678" });
  expect(JSON.parse(row!.hoi_thoai)[0]).toMatchObject({ vai: "khach", chu: "mình lấy đầm hoa size M" });
  expect(await env.DB.prepare("SELECT ma_sp, size, mau, so_luong, don_gia FROM don_hang_mon").all().then((r) => r.results))
    .toEqual([{ ma_sp: "SP1", size: "M", mau: "Đỏ", so_luong: 2, don_gia: 300000 }]);
  expect(await layNhap(env, "fb:1")).toBeNull();
  // không trừ kho
  expect((await env.DB.prepare("SELECT ton_kho FROM bien_the WHERE ma_bien_the = 'SP1-M-DO'").first())?.ton_kho).toBe(3);
});

it("bấm hai lần cùng lúc chỉ tạo một đơn", async () => {
  const n = await nhap("fb:3");
  const [x, y] = await Promise.all([xacNhanDon(env, "fb:3", n.id), xacNhanDon(env, "fb:3", n.id)]);
  expect(new Set([x.kq, y.kq])).toEqual(new Set(["da_tao", "da_co"]));
  expect((await env.DB.prepare("SELECT count(*) c FROM don_hang WHERE khach = 'fb:3'").first())?.c).toBe(1);
});

it("nháp cũ thì trả nháp mới nhất", async () => {
  const cu = await nhap("fb:4");
  const moi = await nhap("fb:4", [{ ma_sp: "SP2", size: "S", so_luong: 1 }]);
  expect(await xacNhanDon(env, "fb:4", cu.id)).toMatchObject({ kq: "cu", nhap: { id: moi.id } });
  expect(await xacNhanDon(env, "fb:9", "khongco")).toEqual({ kq: "cu", nhap: null });
});

it("đổi giá giữa chừng: không tạo đơn, soạn nháp mới với giá mới", async () => {
  const n = await nhap("fb:5");
  await env.DB.prepare("UPDATE san_pham SET gia_ban = 350000 WHERE ma_sp = 'SP1'").run();
  const t = await xacNhanDon(env, "fb:5", n.id);
  expect(t.kq).toBe("thay_doi");
  if (t.kq !== "thay_doi") return;
  expect(t.loi).toEqual(["[SP1] giá đổi từ 300.000đ thành 350.000đ"]);
  expect(t.nhap?.tien_hang).toBe(700000);
  expect(t.nhap?.id).not.toBe(n.id);
  expect((await layNhap(env, "fb:5"))?.id).toBe(t.nhap?.id);
  expect((await env.DB.prepare("SELECT count(*) c FROM don_hang").first())?.c).toBe(0);
});

it("hết hàng giữa chừng: bỏ món; không còn món thì xóa nháp", async () => {
  const n = await nhap("fb:6");
  await env.DB.prepare("UPDATE bien_the SET ton_kho = 0 WHERE ma_sp = 'SP1' AND size = 'M'").run();
  const t = await xacNhanDon(env, "fb:6", n.id);
  expect(t).toMatchObject({ kq: "thay_doi", nhap: null });
  expect(await layNhap(env, "fb:6")).toBeNull();
});

it("hai đơn cùng ngày được số 001, 002", async () => {
  const a = await xacNhanDon(env, "fb:7", (await nhap("fb:7")).id);
  const b = await xacNhanDon(env, "fb:8", (await nhap("fb:8")).id);
  expect(a.kq === "da_tao" && a.ma_don.endsWith("-001")).toBe(true);
  expect(b.kq === "da_tao" && b.ma_don.endsWith("-002")).toBe(true);
});
