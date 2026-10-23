import { env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { soanDon } from "../../src/donhang/nhap";
import { docHoiThoai } from "../../src/hoithoai";
import { handleIncoming } from "../../src/tinnhan";
import type { TinGui } from "../../src/types";
import { napMau } from "./setup";

const NGUOI = { ten: "Lan", sdt: "0912345678", dia_chi: "12 Lê Lợi, Huế" };
async function nhapId(khach: string, size = "M") {
  const r = await soanDon(env, khach, { mon: [{ ma_sp: "SP1", size, mau: "Đỏ" }], ...NGUOI });
  if (!r.ok) throw new Error(r.loi.join("; "));
  return r.nhap.id;
}
const chu = (t: TinGui[]) => t.map((x) => (x.loai === "the" ? "" : x.chu)).join("\n");
beforeEach(async () => {
  await napMau(env);
  await env.DB.batch([env.DB.prepare("DELETE FROM don_hang"), env.DB.prepare("DELETE FROM don_hang_mon")]);
});

it("bấm xác nhận tạo đơn, bấm lại báo đã ghi nhận, ghi nhật ký và lịch sử model", async () => {
  const id = await nhapId("fb:1");
  const a = await handleIncoming(env, "fb:1", { payload: `DON:XAC_NHAN:${id}` });
  expect(a.tin[0]).toMatchObject({ loai: "chu", chu: expect.stringMatching(/đã nhận đơn DH-\d{6}-001/) });
  const b = await handleIncoming(env, "fb:1", { payload: `DON:XAC_NHAN:${id}` });
  expect(chu(b.tin)).toContain("đã được ghi nhận");
  const log = await docHoiThoai(env, "fb:1");
  expect(log.map((l) => l.chu)).toContain("Bấm: Xác nhận đặt hàng");
  expect(log.some((l) => l.vai === "bot" && l.chu.includes("đã nhận đơn"))).toBe(true);
  const hist = await env.SHOP_KV.get<{ role: string; text: string }[]>("hist:fb:1", "json");
  expect(hist?.at(-1)).toMatchObject({ role: "model", text: expect.stringContaining("đã được ghi nhận") });
});

it("bấm hủy thì hủy đơn của chính khách", async () => {
  const a = await handleIncoming(env, "fb:1", { payload: `DON:XAC_NHAN:${await nhapId("fb:1")}` });
  const ma = chu(a.tin).match(/DH-\d{6}-\d{3}/)![0];
  expect(chu((await handleIncoming(env, "fb:2", { payload: `DON:HUY:${ma}` })).tin)).toContain("không tìm thấy đơn");
  expect(chu((await handleIncoming(env, "fb:1", { payload: `DON:HUY:${ma}` })).tin)).toContain(`đã hủy đơn ${ma}`);
  expect((await docHoiThoai(env, "fb:1")).map((l) => l.chu)).toContain("Bấm: Xác nhận hủy");
});

it("nút cũ thì gửi lại tóm tắt và nút của nháp mới nhất", async () => {
  const cu = await nhapId("fb:3");
  const moi = await nhapId("fb:3", "L");
  const r = await handleIncoming(env, "fb:3", { payload: `DON:XAC_NHAN:${cu}` });
  expect(r.tin[0]).toMatchObject({ loai: "chu", chu: expect.stringContaining("đã cũ") });
  expect(r.tin[1]).toMatchObject({ loai: "chu", chu: expect.stringContaining("Tiền hàng") });
  expect(r.tin[2]).toMatchObject({ loai: "nut", nut: [{ tieu_de: "Xác nhận đặt hàng", payload: `DON:XAC_NHAN:${moi}` }, { tieu_de: "Sửa lại", payload: "Em muốn sửa lại đơn" }] });
});

it("đổi giá thì báo thay đổi và gửi tóm tắt mới", async () => {
  const id = await nhapId("fb:4");
  await env.DB.prepare("UPDATE san_pham SET gia_ban = 350000 WHERE ma_sp = 'SP1'").run();
  const r = await handleIncoming(env, "fb:4", { payload: `DON:XAC_NHAN:${id}` });
  expect(r.tin[0]).toMatchObject({ loai: "chu", chu: expect.stringContaining("giá đổi từ 300.000đ thành 350.000đ") });
  expect(r.tin.at(-1)?.loai).toBe("nut");
});

it("payload DON: lạ thì báo chưa hiểu", async () => {
  expect(chu((await handleIncoming(env, "fb:5", { payload: "DON:lung tung" })).tin)).toContain("chưa hiểu");
});
