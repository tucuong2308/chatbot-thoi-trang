import { env, SELF } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { donThayDoiTu, huyDon, xacNhanDon } from "../../src/donhang/don";
import { soanDon } from "../../src/donhang/nhap";
import { ghiHoiThoai } from "../../src/hoithoai";
import { napMau } from "./setup";

async function datDon(khach: string) {
  await ghiHoiThoai(env, khach, "khach", "lấy đầm hoa");
  await ghiHoiThoai(env, khach, "bot", "dạ vâng");
  const r = await soanDon(env, khach, { mon: [{ ma_sp: "SP1", size: "L", mau: "Đỏ" }], ten: "Lan", sdt: "0912345678", dia_chi: "12 Lê Lợi, Huế", ghi_chu: "gọi trước" });
  if (!r.ok) throw new Error(r.loi.join("; "));
  const x = await xacNhanDon(env, khach, r.nhap.id);
  if (x.kq !== "da_tao") throw new Error(x.kq);
  return x.ma_don;
}
beforeEach(async () => {
  await napMau(env);
  await env.DB.batch([env.DB.prepare("DELETE FROM don_hang"), env.DB.prepare("DELETE FROM don_hang_mon")]);
});

it("trả đơn mới và đơn vừa hủy kèm con trỏ; gọi lại từ con trỏ vẫn gồm đơn ở đúng mốc", async () => {
  const a = await datDon("fb:1");
  const b = await datDon("fb:2");
  await huyDon(env, "fb:1", a);
  const r = await donThayDoiTu(env, 0);
  expect(r.don.map((d) => d.ma_don).sort()).toEqual([a, b].sort());
  const huy = r.don.find((d) => d.ma_don === a)!;
  expect(huy.khach_huy).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  expect(huy).toMatchObject({ trang_thai: "Khách hủy", ten: "Lan", sdt: "0912345678", cac_mon: "SP1 · L · Đỏ × 1", tien_hang: 300000, ghi_chu: "gọi trước" });
  expect(huy.hoi_thoai).toBe("Khách: lấy đầm hoa\nBot: dạ vâng");
  expect(r.don.find((d) => d.ma_don === b)!.khach_huy).toBe("");
  const lai = await donThayDoiTu(env, r.con_tro);
  expect(lai.don.map((d) => d.ma_don)).toContain(a);
  expect(lai.con_tro).toBe(r.con_tro);
  const trong = await donThayDoiTu(env, r.con_tro + 1);
  expect(trong).toEqual({ don: [], con_tro: r.con_tro + 1 });
});

it("đường dẫn cần khóa quản trị", async () => {
  const res = await SELF.fetch("http://x/admin/don-hang", { method: "POST", body: "{}" });
  expect(res.status).toBe(401);
  const ok = await SELF.fetch("http://x/admin/don-hang", { method: "POST", body: "{}", headers: { "x-admin-key": env.ADMIN_KEY } });
  expect(await ok.json()).toMatchObject({ don: [] });
});
