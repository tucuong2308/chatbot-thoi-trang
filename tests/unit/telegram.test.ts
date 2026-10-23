import { env, SELF } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import { datWebhookTelegram, kenhTelegram, layTinTelegram, maBiMat } from "../../src/telegram";
import type { ProductCard } from "../../src/types";

const CARD: ProductCard = { ma_sp: "SP1", ten_sp: "Áo thun", gia: "199.000đ", size: "M, L", anh: "https://shop.vn/anh/SP1.jpg" };

/** Giả API Telegram: ghi lại từng lần gọi (tên hàm + body), trả ok trừ khi `loi` chứa tên hàm. */
function giaTelegram(loi: string[] = []) {
  const goi: { ham: string; body: any }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const ham = String(input).split("/").pop()!;
    goi.push({ ham, body: JSON.parse(String(init?.body ?? "{}")) });
    return Response.json({ ok: !loi.includes(ham) }, { status: loi.includes(ham) ? 400 : 200 });
  });
  return goi;
}
afterEach(() => { vi.restoreAllMocks(); });

it("đọc tin chữ trong chat riêng, đổi /start thành lời chào", () => {
  expect(layTinTelegram({ message: { chat: { id: 42, type: "private" }, text: "có áo thun không" } }))
    .toEqual({ kenh: "tg", chatId: "42", text: "có áo thun không" });
  expect(layTinTelegram({ message: { chat: { id: 42, type: "private" }, text: "/start" } })?.text).toBe("Chào shop");
});

it("bỏ qua nhóm, tin không có chữ và loại cập nhật khác", () => {
  expect(layTinTelegram({ message: { chat: { id: -5, type: "group" }, text: "hi" } })).toBeNull();
  expect(layTinTelegram({ message: { chat: { id: 42, type: "private" }, sticker: {} } })).toBeNull();
  expect(layTinTelegram({ edited_message: { chat: { id: 42, type: "private" }, text: "x" } })).toBeNull();
  expect(layTinTelegram({})).toBeNull();
});

it("nút bấm: DON:... giữ nguyên làm payload, nút thẻ sản phẩm mở lại thành câu hỏi", () => {
  const cb = (data: string) => layTinTelegram({ callback_query: { id: "q1", data, message: { chat: { id: 42, type: "private" } } } });
  expect(cb("DON:XAC_NHAN:ab12cd34")).toEqual({ kenh: "tg", chatId: "42", text: "DON:XAC_NHAN:ab12cd34", payload: "DON:XAC_NHAN:ab12cd34", callbackId: "q1" });
  expect(cb("SP:MUA:SP1")).toMatchObject({ text: "Em muốn mua mẫu [SP1]", payload: "Em muốn mua mẫu [SP1]" });
  expect(cb("SP:HOI:SP1")).toMatchObject({ text: "Cho em hỏi thêm về mẫu [SP1]" });
});

it("mã bí mật webhook cố định theo token, chỉ gồm ký tự Telegram cho phép", async () => {
  const a = await maBiMat("123:abc");
  expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
  expect(await maBiMat("123:abc")).toBe(a);
  expect(await maBiMat("123:xyz")).not.toBe(a);
});

it("webhook từ chối request sai mã bí mật", async () => {
  const sai = await SELF.fetch("https://x/webhook/telegram", { method: "POST", body: "{}", headers: { "x-telegram-bot-api-secret-token": "sai" } });
  expect(sai.status).toBe(401);
  const dung = await SELF.fetch("https://x/webhook/telegram", {
    method: "POST", body: "{}", headers: { "x-telegram-bot-api-secret-token": await maBiMat(env.TELEGRAM_BOT_TOKEN!) },
  });
  expect(dung.status).toBe(200);
});

it("thẻ sản phẩm gửi thành ảnh kèm chú thích và hai nút ngắn gọn", async () => {
  const goi = giaTelegram();
  await kenhTelegram(env, "42").the([CARD]);
  expect(goi).toHaveLength(1);
  expect(goi[0].ham).toBe("sendPhoto");
  expect(goi[0].body).toMatchObject({ chat_id: "42", photo: CARD.anh, caption: expect.stringContaining("[SP1] Áo thun") });
  expect(goi[0].body.caption).toContain("199.000đ");
  expect(goi[0].body.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data)).toEqual(["SP:HOI:SP1", "SP:MUA:SP1"]);
});

it("ảnh lỗi hoặc không có link đầy đủ thì gửi chữ kèm nút", async () => {
  const goi = giaTelegram(["sendPhoto"]);
  await kenhTelegram(env, "42").the([CARD, { ...CARD, ma_sp: "SP2", anh: "/anh/SP2.jpg" }]);
  expect(goi.map((g) => g.ham)).toEqual(["sendPhoto", "sendMessage", "sendMessage"]);
  expect(goi[2].body.text).toContain("[SP2]");
  expect(goi[2].body.reply_markup.inline_keyboard.flat()[1].callback_data).toBe("SP:MUA:SP2");
});

it("tin có nút xác nhận đơn và tin chữ dài được chia nhỏ", async () => {
  const goi = giaTelegram();
  const k = kenhTelegram(env, "42");
  await k.nut("Kiểm tra đơn", [{ tieu_de: "Xác nhận đặt hàng", payload: "DON:XAC_NHAN:ab12cd34" }, { tieu_de: "Sửa lại", payload: "Em muốn sửa lại đơn" }]);
  expect(goi[0].body.reply_markup.inline_keyboard).toEqual([
    [{ text: "Xác nhận đặt hàng", callback_data: "DON:XAC_NHAN:ab12cd34" }],
    [{ text: "Sửa lại", callback_data: "Em muốn sửa lại đơn" }],
  ]);
  await k.chu("a".repeat(5000));
  expect(goi.slice(1).map((g) => g.body.text.length)).toEqual([4096, 904]);
});

it("đặt webhook với địa chỉ công khai và mã bí mật", async () => {
  const goi = giaTelegram();
  await datWebhookTelegram(env);
  expect(goi[0].ham).toBe("setWebhook");
  expect(goi[0].body).toMatchObject({
    url: `${env.DIA_CHI_CONG_KHAI}/webhook/telegram`,
    secret_token: await maBiMat(env.TELEGRAM_BOT_TOKEN!),
    allowed_updates: ["message", "callback_query"],
  });
});
