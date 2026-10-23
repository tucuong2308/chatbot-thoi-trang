import type { DinhKem, Env, ProductCard, TinNhanMessenger } from "./types";

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

/** Loại đính kèm của Messenger đổi sang loại của bot. Sticker cũng đến dưới dạng ảnh, có sticker_id. */
function dinhKem(a: any): DinhKem {
  if (a?.payload?.sticker_id) return "sticker";
  return ({ image: "anh", audio: "thoai", video: "video" } as Record<string, DinhKem>)[a?.type] ?? "tep";
}

/** Lấy tin nhắn từ payload webhook của Messenger: chữ, nút bấm (postback), và tin chỉ có ảnh / thoại / sticker. */
export function extractMessages(payload: any): TinNhanMessenger[] {
  const out: TinNhanMessenger[] = [];
  for (const entry of payload?.entry ?? []) {
    for (const ev of entry.messaging ?? []) {
      if (ev.message?.is_echo) continue; // tin do chính page gửi
      const senderId = ev.sender?.id;
      if (!senderId) continue;
      if (ev.message?.text) out.push({ kenh: "fb", senderId, text: ev.message.text });
      else if (ev.message?.attachments?.length) out.push({ kenh: "fb", senderId, text: "", dinh_kem: dinhKem(ev.message.attachments[0]) });
      // Khách bấm nút trên thẻ sản phẩm: payload là câu hỏi viết sẵn, xử lý như tin nhắn chữ.
      else if (ev.postback?.payload) out.push({ kenh: "fb", senderId, text: ev.postback.payload, payload: ev.postback.payload });
    }
  }
  return out;
}

/** Gọi Send API. Lỗi chỉ ghi log và trả false: một tin gửi hỏng không được làm dừng cả lượt trả lời. */
async function post(env: Env, body: object): Promise<boolean> {
  try {
    const res = await fetch(`${GRAPH}?access_token=${env.FB_PAGE_TOKEN}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error("Gửi Messenger lỗi", res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error("Gửi Messenger lỗi mạng", String(err));
    return false;
  }
}

const send = (env: Env, recipientId: string, message: object) =>
  post(env, { recipient: { id: recipientId }, messaging_type: "RESPONSE", message });

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

/** Tin kèm tối đa 3 nút postback (button template, chữ tối đa 640 ký tự). */
export const sendButtons = (env: Env, to: string, text: string, buttons: { tieu_de: string; payload: string }[]) =>
  send(env, to, {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: text.slice(0, 640),
        buttons: buttons.slice(0, 3).map((b) => ({ type: "postback", title: b.tieu_de.slice(0, 20), payload: b.payload })),
      },
    },
  });

export const sendTyping = (env: Env, to: string) => post(env, { recipient: { id: to }, sender_action: "typing_on" });
