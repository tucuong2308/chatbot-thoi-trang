import { env } from "cloudflare:test";
import { beforeEach, expect, it, vi } from "vitest";
import { gomTin, nhanTin, xuLyKhach } from "../../src/gomtin";
import type { Env, TinNhanMessenger } from "../../src/types";

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM tin_cho"), env.DB.prepare("DELETE FROM khach_dang_xu_ly")]);
});

const chu = (text: string, senderId = "1"): TinNhanMessenger => ({ kenh: "fb", senderId, text });

it("gộp tin chữ liền nhau, nút bấm tách riêng, giữ đính kèm", () => {
  expect(gomTin([chu("shop ơi"), chu("có quần jean ko"), chu("ống rộng ấy")]))
    .toEqual([{ kenh: "fb", senderId: "1", text: "shop ơi\ncó quần jean ko\nống rộng ấy" }]);
  const nut = { kenh: "fb" as const, senderId: "1", text: "DON:XAC_NHAN:ab", payload: "DON:XAC_NHAN:ab" };
  expect(gomTin([chu("a"), nut, chu("b"), chu("c")]).map((m) => m.text)).toEqual(["a", "DON:XAC_NHAN:ab", "b\nc"]);
  const anh = { kenh: "tg" as const, senderId: "1", text: "", dinh_kem: "anh" as const };
  expect(gomTin([anh, { ...chu("có mẫu này ko"), kenh: "tg" }])).toEqual([{ kenh: "tg", senderId: "1", text: "có mẫu này ko", dinh_kem: "anh" }]);
});

it("webhook lưu tin, hẹn mỗi khách một việc sau vài giây", async () => {
  const sendBatch = vi.fn();
  await nhanTin({ ...env, HANG_DOI: { sendBatch } } as unknown as Env, [chu("a"), chu("b"), chu("c", "2")]);
  expect(sendBatch).toHaveBeenCalledWith([
    { body: { loai: "khach", kenh: "fb", senderId: "1" }, delaySeconds: 3 },
    { body: { loai: "khach", kenh: "fb", senderId: "2" }, delaySeconds: 3 },
  ]);
  expect((await env.DB.prepare("SELECT count(*) c FROM tin_cho").first())?.c).toBe(3);
});

it("một lượt trả lời mọi tin đang chờ của khách, tin tới giữa chừng được gộp ở vòng sau", async () => {
  const e = { ...env, HANG_DOI: { sendBatch: vi.fn() } } as unknown as Env;
  await nhanTin(e, [chu("Phạm Bảo Ngọc"), chu("0905 123 456")]);
  const luot: string[] = [];
  const kq = await xuLyKhach(e, { loai: "khach", kenh: "fb", senderId: "1" }, async (m) => {
    luot.push(m.text);
    if (luot.length === 1) await nhanTin(e, [chu("45 Trần Phú, Đà Nẵng")]); // khách nhắn tiếp lúc bot đang trả lời
  });
  expect(kq).toBe("xong");
  expect(luot).toEqual(["Phạm Bảo Ngọc\n0905 123 456", "45 Trần Phú, Đà Nẵng"]);
  // Việc thứ hai của cùng khách tới sau: không còn gì để làm.
  expect(await xuLyKhach(e, { loai: "khach", kenh: "fb", senderId: "1" }, async () => { throw new Error("không được gọi"); })).toBe("xong");
});

it("khách đang có lượt khác chạy thì báo bận, không trả lời song song", async () => {
  const e = { ...env, HANG_DOI: { sendBatch: vi.fn() } } as unknown as Env;
  await nhanTin(e, [chu("a")]);
  const luot: string[] = [];
  const ngoai = await xuLyKhach(e, { loai: "khach", kenh: "fb", senderId: "1" }, async (m) => {
    luot.push(m.text);
    if (luot.length > 1) return;
    await nhanTin(e, [chu("b")]);
    const trong = await xuLyKhach(e, { loai: "khach", kenh: "fb", senderId: "1" }, async () => { throw new Error("không được chạy song song"); });
    expect(trong).toBe("ban");
  });
  expect(luot).toEqual(["a", "b"]);
  expect(ngoai).toBe("xong");
  expect((await env.DB.prepare("SELECT count(*) c FROM tin_cho").first())?.c).toBe(0); // "b" đã được vòng sau xử lý
});

it("khóa quá hạn (lượt trước bị dừng) thì lượt mới vẫn chạy", async () => {
  const e = { ...env, HANG_DOI: { sendBatch: vi.fn() } } as unknown as Env;
  await env.DB.prepare("INSERT INTO khach_dang_xu_ly VALUES ('fb:1', ?)").bind(Date.now() - 1000).run();
  await nhanTin(e, [chu("a")]);
  const luot: string[] = [];
  expect(await xuLyKhach(e, { loai: "khach", kenh: "fb", senderId: "1" }, async (m) => { luot.push(m.text); })).toBe("xong");
  expect(luot).toEqual(["a"]);
});
