import { env } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import worker from "../../src/index";
import { extractTelegram, tgSendButtons, tgSendProductCards, verifyTelegram } from "../../src/telegram";
import type { Env } from "../../src/types";

const tg = { ...env, TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_SECRET: "bi_mat-1" } as Env;
const chatRieng = { id: 42, type: "private" };
afterEach(() => vi.restoreAllMocks());

it("kiểm tra header bí mật", () => {
  expect(verifyTelegram(tg, "bi_mat-1")).toBe(true);
  expect(verifyTelegram(tg, "bi_mat-2")).toBe(false);
  expect(verifyTelegram(tg, null)).toBe(false);
  expect(verifyTelegram({ ...tg, TELEGRAM_SECRET: "" }, "")).toBe(false);
});

it("đọc tin chữ, /start, nút sản phẩm, nút đơn; bỏ qua nhóm", () => {
  expect(extractTelegram({ message: { chat: chatRieng, text: "váy đi biển" } }))
    .toEqual([{ kenh: "tg", senderId: "42", text: "váy đi biển" }]);
  expect(extractTelegram({ message: { chat: chatRieng, text: "/start" } })[0].text).toBe("Xin chào shop");
  expect(extractTelegram({ message: { chat: { id: -5, type: "group" }, text: "hi" } })).toEqual([]);
  expect(extractTelegram({ message: { chat: chatRieng, sticker: {} } })).toEqual([]);
  expect(extractTelegram({ callback_query: { id: "c1", data: "SP:MUA:SP0007", message: { chat: chatRieng } } }))
    .toEqual([{ kenh: "tg", senderId: "42", text: "Em muốn mua mẫu [SP0007]", payload: "Em muốn mua mẫu [SP0007]", callbackId: "c1" }]);
  expect(extractTelegram({ callback_query: { id: "c2", data: "DON:XAC_NHAN:ab12cd34", message: { chat: chatRieng } } })[0])
    .toMatchObject({ text: "DON:XAC_NHAN:ab12cd34", payload: "DON:XAC_NHAN:ab12cd34" });
});

it("webhook: sai bí mật thì 403, đúng thì đẩy vào hàng đợi", async () => {
  const sendBatch = vi.fn();
  const e = { ...tg, HANG_DOI: { sendBatch } } as unknown as Env;
  const goi = (secret: string, body: string) => worker.fetch(new Request("https://x/webhook/telegram", {
    method: "POST", headers: { "x-telegram-bot-api-secret-token": secret }, body,
  }), e);
  expect((await goi("sai", "{}")).status).toBe(403);
  expect((await goi("bi_mat-1", "không phải json")).status).toBe(200);
  expect(sendBatch).not.toHaveBeenCalled();
  expect((await goi("bi_mat-1", JSON.stringify({ message: { chat: chatRieng, text: "chào" } }))).status).toBe(200);
  expect(sendBatch).toHaveBeenCalledWith([{ body: { kenh: "tg", senderId: "42", text: "chào" } }]);
});

it("thẻ sản phẩm: gửi ảnh kèm nút, ảnh lỗi thì gửi chữ", async () => {
  const goi: { method: string; body: any }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const method = String(url).split("/").at(-1)!;
    goi.push({ method, body: JSON.parse(String(init?.body)) });
    return new Response("{}", { status: method === "sendPhoto" ? 400 : 200 });
  });
  await tgSendProductCards(tg, "42", [{ ma_sp: "SP1", ten_sp: "Đầm hoa", gia: "300.000đ", size: "M, L", anh: "https://a/1.jpg" }]);
  expect(goi.map((g) => g.method)).toEqual(["sendPhoto", "sendMessage"]);
  expect(goi[1].body.text).toBe("[SP1] Đầm hoa\n300.000đ\nSize M, L");
  expect(goi[1].body.reply_markup.inline_keyboard[0].map((n: any) => n.callback_data)).toEqual(["SP:HOI:SP1", "SP:MUA:SP1"]);

  goi.length = 0;
  await tgSendButtons(tg, "42", "Kiểm tra đơn", [{ tieu_de: "Xác nhận đặt hàng", payload: "DON:XAC_NHAN:ab12" }, { tieu_de: "Sửa lại", payload: "Em muốn sửa lại đơn" }]);
  expect(goi[0].body.reply_markup.inline_keyboard).toEqual([
    [{ text: "Xác nhận đặt hàng", callback_data: "DON:XAC_NHAN:ab12" }], [{ text: "Sửa lại", callback_data: "Em muốn sửa lại đơn" }],
  ]);
});
