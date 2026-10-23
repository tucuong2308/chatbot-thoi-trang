import { hoiThem, type KenhGui, muonMua } from "./kenh";
import type { Env, ProductCard, TinNhanTelegram } from "./types";

const API = "https://api.telegram.org/bot";
const TOI_DA_CHU = 4096;
const TOI_DA_CHU_THICH = 1024;

/**
 * Mã bí mật Telegram gửi kèm mỗi webhook (header X-Telegram-Bot-Api-Secret-Token). Suy ra từ token của bot để khỏi
 * phải cài thêm một khóa: đổi token thì chạy lại /admin/telegram-webhook.
 */
export async function maBiMat(token: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`webhook:${token}`));
  return [...new Uint8Array(h)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function kiemTraTelegram(env: Env, header: string | null): Promise<boolean> {
  return !!env.TELEGRAM_BOT_TOKEN && header === (await maBiMat(env.TELEGRAM_BOT_TOKEN));
}

/**
 * callback_data của Telegram tối đa 64 byte: nút trên thẻ sản phẩm gửi dạng ngắn "SP:MUA:<mã>", lúc khách bấm
 * thì mở lại thành câu chữ như Messenger. Các nút khác (DON:..., Sửa lại) vốn đã ngắn.
 */
const NUT_THE: Record<string, (ma: string) => string> = { HOI: hoiThem, MUA: muonMua };
function moNut(data: string): string {
  const m = data.match(/^SP:(HOI|MUA):(.+)$/);
  return m ? NUT_THE[m[1]](m[2]) : data;
}

/** Lấy tin chữ hoặc nút bấm từ một update. Chỉ trả lời chat riêng, bỏ qua nhóm và các loại cập nhật khác. */
export function layTinTelegram(update: any): TinNhanTelegram | null {
  const cb = update?.callback_query;
  if (cb?.data && cb.message?.chat?.type === "private") {
    const payload = moNut(cb.data);
    return { kenh: "tg", chatId: String(cb.message.chat.id), text: payload, payload, callbackId: cb.id };
  }
  const msg = update?.message;
  if (msg?.chat?.type !== "private" || typeof msg.text !== "string") return null;
  // Khách mới bấm Start: coi như lời chào để bot giới thiệu shop.
  const text = /^\/start\b/.test(msg.text) ? "Chào shop" : msg.text;
  return { kenh: "tg", chatId: String(msg.chat.id), text };
}

async function goi(env: Env, ham: string, body: object): Promise<boolean> {
  const res = await fetch(`${API}${env.TELEGRAM_BOT_TOKEN}/${ham}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error("Gọi Telegram lỗi", ham, res.status, await res.text());
  return res.ok;
}

const banPhim = (rows: { text: string; callback_data: string }[][]) => ({ inline_keyboard: rows });
const nutThe = (c: ProductCard) =>
  banPhim([[{ text: "Hỏi thêm món này", callback_data: `SP:HOI:${c.ma_sp}` }, { text: "Muốn mua món này", callback_data: `SP:MUA:${c.ma_sp}` }]]);
const moTaThe = (c: ProductCard) => [`[${c.ma_sp}] ${c.ten_sp}`, c.gia, c.size ? `Size ${c.size}` : "Tạm hết hàng"].join("\n");

export function kenhTelegram(env: Env, chatId: string): KenhGui {
  return {
    async chu(text) {
      for (let i = 0; i < text.length; i += TOI_DA_CHU) await goi(env, "sendMessage", { chat_id: chatId, text: text.slice(i, i + TOI_DA_CHU) });
    },
    async the(cards) {
      for (const c of cards) {
        const ok = c.anh.startsWith("http") &&
          await goi(env, "sendPhoto", { chat_id: chatId, photo: c.anh, caption: moTaThe(c).slice(0, TOI_DA_CHU_THICH), reply_markup: nutThe(c) });
        // Telegram không tải được ảnh: vẫn gửi tên, giá, size và nút để khách đặt được.
        if (!ok) await goi(env, "sendMessage", { chat_id: chatId, text: moTaThe(c), reply_markup: nutThe(c) });
      }
    },
    nut(text, buttons) {
      return goi(env, "sendMessage", {
        chat_id: chatId,
        text: text.slice(0, TOI_DA_CHU),
        reply_markup: banPhim(buttons.map((b) => [{ text: b.tieu_de, callback_data: b.payload }])),
      });
    },
    dangSoan: () => goi(env, "sendChatAction", { chat_id: chatId, action: "typing" }),
  };
}

/** Tắt vòng xoay trên nút khách vừa bấm. */
export const daBamNut = (env: Env, callbackId: string) => goi(env, "answerCallbackQuery", { callback_query_id: callbackId });

/** Báo Telegram gửi tin của bot về Worker này (chạy một lần sau khi cài token, hoặc khi đổi địa chỉ / token). */
export async function datWebhookTelegram(env: Env) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Chưa cài TELEGRAM_BOT_TOKEN (npx wrangler secret put TELEGRAM_BOT_TOKEN)");
  if (!env.DIA_CHI_CONG_KHAI) throw new Error("Chưa đặt DIA_CHI_CONG_KHAI trong wrangler.toml");
  const res = await fetch(`${API}${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: `${env.DIA_CHI_CONG_KHAI.replace(/\/$/, "")}/webhook/telegram`,
      secret_token: await maBiMat(env.TELEGRAM_BOT_TOKEN),
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    }),
  });
  return res.json();
}
