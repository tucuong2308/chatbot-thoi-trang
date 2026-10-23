import { env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { hoTroThayDoiTu } from "../../src/hotro";
import { extractMessages } from "../../src/messenger";
import { checkSelect } from "../../src/sql";
import { extractTelegram } from "../../src/telegram";
import { handleIncoming } from "../../src/tinnhan";
import { runTool } from "../../src/tools";

const chat = { id: 42, type: "private" };
const ctx = (khach: string) => ({ khach, notifyWait: async () => {}, onNhap: () => {}, onYeuCauHuy: () => {} });
beforeEach(async () => { await env.DB.prepare("DELETE FROM ho_tro").run(); });

it("Messenger: tin chỉ có ảnh / thoại / sticker không bị bỏ qua", () => {
  const ev = (message: object) => ({ entry: [{ messaging: [{ sender: { id: "9" }, message }] }] });
  expect(extractMessages(ev({ attachments: [{ type: "image", payload: { url: "https://a" } }] })))
    .toEqual([{ kenh: "fb", senderId: "9", text: "", dinh_kem: "anh" }]);
  expect(extractMessages(ev({ attachments: [{ type: "audio", payload: {} }] }))[0].dinh_kem).toBe("thoai");
  expect(extractMessages(ev({ sticker_id: 369239263222822, attachments: [{ type: "image", payload: { sticker_id: 369239263222822 } }] }))[0].dinh_kem).toBe("sticker");
  expect(extractMessages(ev({ text: "chào" }))).toEqual([{ kenh: "fb", senderId: "9", text: "chào" }]);
});

it("Telegram: ảnh kèm chú thích giữ chú thích, tin thoại và tệp", () => {
  expect(extractTelegram({ message: { chat, photo: [{}], caption: "có mẫu này ko" } }))
    .toEqual([{ kenh: "tg", senderId: "42", text: "có mẫu này ko", dinh_kem: "anh" }]);
  expect(extractTelegram({ message: { chat, voice: {} } })[0]).toMatchObject({ text: "", dinh_kem: "thoai" });
  expect(extractTelegram({ message: { chat, document: { mime_type: "image/png" } } })[0].dinh_kem).toBe("anh");
  expect(extractTelegram({ message: { chat, document: { mime_type: "application/pdf" } } })[0].dinh_kem).toBe("tep");
});

it("chỉ có ảnh / thoại: trả lời ngay không qua model, ghi vào lịch sử", async () => {
  const a = await handleIncoming(env, "tg:7", { text: "", dinh_kem: "anh" });
  expect(a.tin).toEqual([{ loai: "chu", chu: expect.stringContaining("chưa xem được ảnh") }]);
  const b = await handleIncoming(env, "tg:7", { text: "", dinh_kem: "thoai" });
  expect(b.tin[0]).toMatchObject({ chu: expect.stringContaining("chưa nghe được tin nhắn thoại") });
  const hist = await env.SHOP_KV.get<{ role: string; text: string }[]>("hist:tg:7", "json");
  expect(hist?.map((h) => h.text)).toEqual([
    "(gửi ảnh)", expect.stringContaining("chưa xem được ảnh"), "(gửi tin nhắn thoại)", expect.stringContaining("nhắn chữ"),
  ]);
});

it("chuyen_nhan_vien tạo yêu cầu, gọi lại thì cập nhật; Sheets kéo được", async () => {
  const a = await runTool(env, "chuyen_nhan_vien", { ly_do: "hỏi đổi size sau khi nhận" }, ctx("tg:5"));
  expect(a).toMatchObject({ ok: true, ma: expect.stringMatching(/^HT-\d{6}-001$/), cap_nhat_yeu_cau_cu: false });
  expect(await runTool(env, "chuyen_nhan_vien", { ly_do: "x", sdt: "12345" }, ctx("tg:5"))).toMatchObject({ loi: expect.stringContaining("không đúng") });
  const b = await runTool(env, "chuyen_nhan_vien", { ly_do: "hỏi phí ship", sdt: "+84 905 123 456" }, ctx("tg:5"));
  expect(b).toMatchObject({ ok: true, ma: a.ma, cap_nhat_yeu_cau_cu: true });
  const c = await runTool(env, "chuyen_nhan_vien", { ly_do: "mua 10 áo" }, ctx("fb:6"));
  expect(c.ma).toMatch(/-002$/);
  const { yeu_cau, con_tro } = await hoTroThayDoiTu(env, 0);
  expect(yeu_cau.find((y) => y.ma === a.ma)).toMatchObject({
    kenh: "Telegram", sdt: "0905123456", ly_do: "hỏi đổi size sau khi nhận\nhỏi phí ship",
  });
  expect(yeu_cau.find((y) => y.ma === c.ma)?.kenh).toBe("Messenger");
  expect((await hoTroThayDoiTu(env, con_tro + 1)).yeu_cau).toEqual([]);
  expect(await runTool(env, "chuyen_nhan_vien", {}, ctx("fb:6"))).toMatchObject({ loi: expect.stringContaining("ly_do") });
});

it("model không đọc được bảng mới", () => {
  for (const bang of ["ho_tro", "tin_cho", "khach_dang_xu_ly"]) {
    expect(() => checkSelect(`SELECT * FROM ${bang}`)).toThrow(/không được phép/);
  }
});
