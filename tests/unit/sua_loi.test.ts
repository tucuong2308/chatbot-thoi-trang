import { env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { ghiChuLichSu } from "../../src/agent";
import { donThayDoiTu, xacNhanDon } from "../../src/donhang/don";
import { layNhap, soanDon } from "../../src/donhang/nhap";
import { runSelect } from "../../src/sql";
import { runTool, type ToolContext } from "../../src/tools";
import { napMau } from "./setup";

const NGUOI = { ten: "Lan", sdt: "0912345678", dia_chi: "12 Lê Lợi, Huế" };
const ctx: ToolContext = { khach: "fb:1", notifyWait: async () => {}, onNhap: () => {}, onYeuCauHuy: () => {} };
beforeEach(async () => {
  await napMau(env);
  await env.DB.batch([env.DB.prepare("DELETE FROM don_hang"), env.DB.prepare("DELETE FROM don_hang_mon")]);
});

it("model không đọc được bảng đơn hàng qua SQL", async () => {
  await expect(runSelect(env, "SELECT ten, sdt, dia_chi FROM don_hang", 50)).rejects.toThrow();
  await expect(runSelect(env, "SELECT * FROM don_hang_mon", 50)).rejects.toThrow();
  await expect(runSelect(env, "SELECT * FROM don_nhap", 50)).rejects.toThrow();
});

it("tham số soan_don sai dạng thì trả loi, không ném lỗi", async () => {
  expect(await runTool(env, "soan_don", { mon: [{ size: "M" }] }, ctx)).toHaveProperty("loi");
  expect(await runTool(env, "soan_don", { mon: "SP1 size M" }, ctx)).toHaveProperty("loi");
  expect(await runTool(env, "soan_don", {}, ctx)).toHaveProperty("loi");
});

it("đơn nháp lưu ở D1 và hết hạn sau 7 ngày", async () => {
  const r = await soanDon(env, "fb:1", { mon: [{ ma_sp: "SP2", size: "S" }], ...NGUOI });
  expect(r.ok).toBe(true);
  expect((await env.DB.prepare("SELECT count(*) c FROM don_nhap WHERE khach = 'fb:1'").first())?.c).toBe(1);
  await env.DB.prepare("UPDATE don_nhap SET cap_nhat = ? WHERE khach = 'fb:1'").bind(Date.now() - 8 * 86400_000).run();
  expect(await layNhap(env, "fb:1")).toBeNull();
});

it("hội thoại quá dài bị cắt còn phần cuối, vừa một ô Sheets", async () => {
  const r = await soanDon(env, "fb:1", { mon: [{ ma_sp: "SP2", size: "S" }], ...NGUOI });
  if (!r.ok) throw new Error();
  const x = await xacNhanDon(env, "fb:1", r.nhap.id);
  const dai = Array.from({ length: 40 }, (_, i) => ({ vai: "bot", chu: `tin ${i} ` + "x".repeat(2000), luc: 0 }));
  await env.DB.prepare("UPDATE don_hang SET hoi_thoai = ?").bind(JSON.stringify(dai)).run();
  const d = (await donThayDoiTu(env, 0)).don[0];
  expect(x.kq).toBe("da_tao");
  expect(d.hoi_thoai.length).toBeLessThanOrEqual(45000);
  expect(d.hoi_thoai).toContain("tin 39");
  expect(d.hoi_thoai.startsWith("…")).toBe(true);
});

it("lịch sử model giữ tóm tắt đơn đã gửi để sửa đơn sau nhiều lượt", () => {
  const tom_tat = "Đơn của anh/chị:\n- [SP1] Đầm hoa · M · Đỏ × 1 = 300.000đ";
  const t = ghiChuLichSu("Dạ chị kiểm tra đơn giúp em nhé", { nhap: { id: "ab" } as any, tom_tat });
  expect(t).toContain("Dạ chị kiểm tra đơn giúp em nhé");
  expect(t).toContain(tom_tat);
  expect(ghiChuLichSu("chào chị", undefined)).toBe("chào chị");
});
