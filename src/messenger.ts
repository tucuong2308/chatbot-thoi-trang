import type { Env, ProductCard } from "./types";

const GRAPH = "https://graph.facebook.com/v21.0/me/messages";

/** Kiểm tra request đúng là do Meta gửi (header X-Hub-Signature-256). */
export async function verifySignature(env: Env, body: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.FB_APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === header.slice("sha256=".length);
}

export interface IncomingText {
  senderId: string;
  text: string;
}

/** Lấy các tin nhắn chữ từ payload webhook của Messenger. */
export function extractMessages(payload: any): IncomingText[] {
  const out: IncomingText[] = [];
  for (const entry of payload?.entry ?? []) {
    for (const ev of entry.messaging ?? []) {
      if (ev.message?.is_echo) continue; // tin do chính page gửi
      if (ev.message?.text) out.push({ senderId: ev.sender.id, text: ev.message.text });
      // Khách bấm nút trên thẻ sản phẩm: payload là câu hỏi viết sẵn, xử lý như tin nhắn chữ.
      else if (ev.postback?.payload) out.push({ senderId: ev.sender.id, text: ev.postback.payload });
    }
  }
  return out;
}

async function send(env: Env, recipientId: string, message: object): Promise<boolean> {
  const res = await fetch(`${GRAPH}?access_token=${env.FB_PAGE_TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: "RESPONSE", message }),
  });
  if (!res.ok) console.error("Gửi Messenger lỗi", res.status, await res.text());
  return res.ok;
}

export const sendText = (env: Env, to: string, text: string) => send(env, to, { text: text.slice(0, 2000) });

export const sendImage = (env: Env, to: string, url: string) =>
  send(env, to, { attachment: { type: "image", payload: { url, is_reusable: true } } });

/**
 * Gửi các món gợi ý thành thẻ lướt ngang (Generic Template): ảnh, tên, giá, size và nút hỏi thêm / muốn mua.
 * Thẻ lỗi (VD ảnh không tải được) thì gửi ảnh trơn từng món để khách vẫn thấy hàng.
 */
export async function sendProductCards(env: Env, to: string, cards: ProductCard[]) {
  if (!cards.length) return;
  const elements = cards.map((c) => ({
    title: `[${c.ma_sp}] ${c.ten_sp}`.slice(0, 80),
    subtitle: [c.gia, c.size ? `Size ${c.size}` : "Tạm hết hàng"].join(" · ").slice(0, 80),
    ...(c.anh.startsWith("http") ? { image_url: c.anh } : {}),
    buttons: [
      { type: "postback", title: "Hỏi thêm món này", payload: `Cho em hỏi thêm về mẫu [${c.ma_sp}]` },
      { type: "postback", title: "Muốn mua món này", payload: `Em muốn mua mẫu [${c.ma_sp}]` },
    ],
  }));
  const ok = await send(env, to, {
    attachment: { type: "template", payload: { template_type: "generic", image_aspect_ratio: "square", elements } },
  });
  if (!ok) for (const c of cards) if (c.anh.startsWith("http")) await sendImage(env, to, c.anh);
}

export const sendTyping = (env: Env, to: string) =>
  fetch(`${GRAPH}?access_token=${env.FB_PAGE_TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: to }, sender_action: "typing_on" }),
  });
