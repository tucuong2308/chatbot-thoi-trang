import type { Env } from "./types";

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
    }
  }
  return out;
}

async function send(env: Env, recipientId: string, message: object) {
  const res = await fetch(`${GRAPH}?access_token=${env.FB_PAGE_TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: "RESPONSE", message }),
  });
  if (!res.ok) console.error("Gửi Messenger lỗi", res.status, await res.text());
}

export const sendText = (env: Env, to: string, text: string) => send(env, to, { text: text.slice(0, 2000) });

export const sendImage = (env: Env, to: string, url: string) =>
  send(env, to, { attachment: { type: "image", payload: { url, is_reusable: true } } });

export const sendTyping = (env: Env, to: string) =>
  fetch(`${GRAPH}?access_token=${env.FB_PAGE_TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: to }, sender_action: "typing_on" }),
  });
