import type { Env, ProductCard, TinNhanMessenger } from "./types";

const api = (env: Env, method: string) => `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;

/**
 * Kiểm tra request đúng là do Telegram gửi: header X-Telegram-Bot-Api-Secret-Token phải trùng TELEGRAM_SECRET
 * (chuỗi đã đăng ký khi gọi setWebhook). Chưa đặt TELEGRAM_SECRET thì từ chối hết.
 */
export function verifyTelegram(env: Env, header: string | null): boolean {
  const secret = env.TELEGRAM_SECRET ?? "";
  if (!secret || !header || header.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

/**
 * Nút trên thẻ sản phẩm. callback_data của Telegram tối đa 64 byte, nên gửi mã ngắn rồi đổi lại thành
 * đúng câu chữ như nút Messenger khi khách bấm.
 */
const NUT_SP: Record<string, { tieu_de: string; cau: (ma: string) => string }> = {
  "SP:HOI:": { tieu_de: "Hỏi thêm món này", cau: (ma) => `Cho em hỏi thêm về mẫu [${ma}]` },
  "SP:MUA:": { tieu_de: "Muốn mua món này", cau: (ma) => `Em muốn mua mẫu [${ma}]` },
};
const vuaCallback = (s: string) => new TextEncoder().encode(s).length <= 64;

/** Câu chữ ứng với một nút khách bấm; payload "DON:..." giữ nguyên để code xử lý đặt / hủy đơn. */
function chuCuaNut(data: string): string {
  for (const [tien_to, nut] of Object.entries(NUT_SP)) if (data.startsWith(tien_to)) return nut.cau(data.slice(tien_to.length));
  return data;
}

/** Lấy tin nhắn chữ và nút bấm từ một update của Telegram. Chỉ nhận chat riêng với bot, bỏ qua nhóm. */
export function extractTelegram(update: any): TinNhanMessenger[] {
  const msg = update?.message;
  if (msg?.chat?.type === "private" && typeof msg.text === "string") {
    // /start là lệnh Telegram tự gửi khi khách mở bot lần đầu.
    const text = msg.text.trim() === "/start" ? "Xin chào shop" : msg.text;
    return [{ kenh: "tg", senderId: String(msg.chat.id), text }];
  }
  const cb = update?.callback_query;
  if (cb?.message?.chat?.type === "private" && typeof cb.data === "string") {
    const text = chuCuaNut(cb.data);
    return [{
      kenh: "tg", senderId: String(cb.message.chat.id), text, callbackId: String(cb.id),
      payload: cb.data.startsWith("DON:") ? cb.data : text,
    }];
  }
  return [];
}

async function call(env: Env, method: string, body: object): Promise<boolean> {
  const res = await fetch(api(env, method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error(`Telegram ${method} lỗi`, res.status, await res.text());
  return res.ok;
}

type NutTg = { text: string; callback_data: string };
const banPhim = (hang: NutTg[][]) => ({ reply_markup: { inline_keyboard: hang } });

export const tgSendText = (env: Env, chat: string, text: string) =>
  call(env, "sendMessage", { chat_id: chat, text: text.slice(0, 4096) });

export const tgTyping = (env: Env, chat: string) => call(env, "sendChatAction", { chat_id: chat, action: "typing" });

/** Tắt vòng xoay trên nút khách vừa bấm. */
export const tgAnswerCallback = (env: Env, id: string) => call(env, "answerCallbackQuery", { callback_query_id: id });

/**
 * Telegram không có thẻ lướt ngang như Messenger: mỗi món là một ảnh kèm chú thích (tên, giá, size) và hai nút.
 * Ảnh lỗi (VD Telegram không tải được link) thì gửi chữ kèm nút để khách vẫn thấy món.
 */
export async function tgSendProductCards(env: Env, chat: string, cards: ProductCard[]) {
  for (const c of cards) {
    const caption = [`[${c.ma_sp}] ${c.ten_sp}`, c.gia, c.size ? `Size ${c.size}` : "Tạm hết hàng"].join("\n");
    const nut = Object.entries(NUT_SP)
      .map(([tien_to, n]) => ({ text: n.tieu_de, callback_data: tien_to + c.ma_sp }))
      .filter((n) => vuaCallback(n.callback_data));
    const phim = nut.length ? banPhim([nut]) : {};
    const ok = c.anh.startsWith("http") && await call(env, "sendPhoto", { chat_id: chat, photo: c.anh, caption, ...phim });
    if (!ok) await call(env, "sendMessage", { chat_id: chat, text: caption, ...phim });
  }
}

/** Tin kèm nút bấm (xác nhận đặt / hủy đơn), mỗi nút một hàng. */
export const tgSendButtons = (env: Env, chat: string, text: string, buttons: { tieu_de: string; payload: string }[]) =>
  call(env, "sendMessage", {
    chat_id: chat,
    text: text.slice(0, 4096),
    ...banPhim(buttons.filter((b) => vuaCallback(b.payload)).map((b) => [{ text: b.tieu_de, callback_data: b.payload }])),
  });

/** Đăng ký webhook với Telegram: gọi một lần sau khi deploy (POST /admin/telegram/webhook). */
export async function tgSetWebhook(env: Env, url: string): Promise<unknown> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_SECRET) throw new Error("Chưa đặt TELEGRAM_BOT_TOKEN hoặc TELEGRAM_SECRET");
  const res = await fetch(api(env, "setWebhook"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, secret_token: env.TELEGRAM_SECRET, allowed_updates: ["message", "callback_query"] }),
  });
  return res.json();
}
