import { handleUserMessage } from "./agent";
import { importCatalog, syncCatalog } from "./catalog";
import { extractMessages, sendImage, sendText, sendTyping, verifySignature } from "./messenger";
import type { Env } from "./types";
import { importVectors, type VectorLine } from "./vectors";

async function replyMessenger(env: Env, senderId: string, text: string) {
  await sendTyping(env, senderId);
  try {
    const reply = await handleUserMessage(env, `fb:${senderId}`, text);
    for (const url of reply.images) await sendImage(env, senderId, url);
    await sendText(env, senderId, reply.text);
  } catch (err) {
    console.error(err);
    await sendText(env, senderId, "Dạ em đang gặp chút trục trặc, chị đợi em một lát hoặc nhắn lại giúp em nhé.");
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // Meta xác minh webhook lần đầu
    if (req.method === "GET" && url.pathname === "/webhook/messenger") {
      const ok = url.searchParams.get("hub.mode") === "subscribe" &&
        url.searchParams.get("hub.verify_token") === env.FB_VERIFY_TOKEN;
      return ok ? new Response(url.searchParams.get("hub.challenge")) : new Response("Forbidden", { status: 403 });
    }

    // Tin nhắn mới từ Messenger: trả 200 ngay, xử lý ở nền
    if (req.method === "POST" && url.pathname === "/webhook/messenger") {
      const body = await req.text();
      if (!(await verifySignature(env, body, req.headers.get("x-hub-signature-256")))) {
        return new Response("Bad signature", { status: 401 });
      }
      for (const m of extractMessages(JSON.parse(body))) {
        ctx.waitUntil(replyMessenger(env, m.senderId, m.text));
      }
      return new Response("EVENT_RECEIVED");
    }

    // Thử bot không cần Facebook: POST /chat {"user":"test","text":"..."}
    if (req.method === "POST" && url.pathname === "/chat") {
      if (req.headers.get("x-admin-key") !== env.ADMIN_KEY) return new Response("Unauthorized", { status: 401 });
      const { user, text } = await req.json<{ user: string; text: string }>();
      return Response.json(await handleUserMessage(env, `test:${user}`, text));
    }

    if (url.pathname.startsWith("/admin/")) {
      if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
      if (req.headers.get("x-admin-key") !== env.ADMIN_KEY) return new Response("Unauthorized", { status: 401 });
      try {
        // Đồng bộ ngay từ Google Sheets
        if (url.pathname === "/admin/sync") return Response.json(await syncCatalog(env));
        // Nạp thẳng 3 bảng CSV (dùng khi chưa có Google Sheets): {"san_pham": "...", "bien_the": "...", "bang_size": "..."}
        if (url.pathname === "/admin/import") return Response.json(await importCatalog(env, await req.json()));
        // Nạp vector từ scripts/embed_products.py: mỗi dòng một JSON {"id","kieu","b64"|"values"}
        if (url.pathname === "/admin/vectors") {
          const lines = (await req.text()).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as VectorLine);
          return Response.json(await importVectors(env, lines));
        }
      } catch (err) {
        return Response.json({ loi: (err as Error).message }, { status: 400 });
      }
    }

    return new Response("Chatbot thời trang đang chạy");
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(syncCatalog(env));
  },
} satisfies ExportedHandler<Env>;
