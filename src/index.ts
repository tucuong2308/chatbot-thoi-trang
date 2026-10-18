import { ENUM_VALUES, importCatalog, MULTI_VALUES, syncCatalog, TRANG_THAI } from "./catalog";
import { processJob, serveR2Image, syncStatus } from "./dongbo";
import { GeminiError } from "./gemini";
import { extractMessages, sendButtons, sendProductCards, sendText, sendTyping, verifySignature } from "./messenger";
import { handleIncoming } from "./tinnhan";
import type { Env, TinNhanMessenger, ViecNen } from "./types";
import { importVectors, type VectorLine } from "./vectors";

async function replyMessenger(env: Env, senderId: string, text: string, payload?: string) {
  await sendTyping(env, senderId);
  try {
    const { tin } = await handleIncoming(env, `fb:${senderId}`, { text, payload }, {
      send: async (msg) => {
        await sendText(env, senderId, msg);
        await sendTyping(env, senderId);
      },
      typing: async () => { await sendTyping(env, senderId); },
    });
    // Theo thứ tự: lời tư vấn, thẻ sản phẩm (ảnh + giá + size), rồi tóm tắt đơn và nút xác nhận nếu có.
    for (const t of tin) {
      if (t.loai === "chu") await sendText(env, senderId, t.chu);
      else if (t.loai === "the") await sendProductCards(env, senderId, t.the);
      else await sendButtons(env, senderId, t.chu, t.nut);
    }
  } catch (err) {
    console.error(err);
    await sendText(env, senderId, "Dạ em đang gặp chút trục trặc, chị đợi em một lát hoặc nhắn lại giúp em nhé.");
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Meta xác minh webhook lần đầu
    if (req.method === "GET" && url.pathname === "/webhook/messenger") {
      const ok = url.searchParams.get("hub.mode") === "subscribe" &&
        url.searchParams.get("hub.verify_token") === env.FB_VERIFY_TOKEN;
      return ok ? new Response(url.searchParams.get("hub.challenge")) : new Response("Forbidden", { status: 403 });
    }

    // Tin nhắn mới từ Messenger: trả 200 ngay, đẩy vào hàng đợi.
    // Không xử lý bằng waitUntil vì nó chỉ có 30 giây sau khi trả lời, không đủ cho nhiều vòng tra cứu và xem ảnh.
    if (req.method === "POST" && url.pathname === "/webhook/messenger") {
      const body = await req.text();
      if (!(await verifySignature(env, body, req.headers.get("x-hub-signature-256")))) {
        return new Response("Bad signature", { status: 401 });
      }
      const messages = extractMessages(JSON.parse(body));
      if (messages.length) await env.HANG_DOI.sendBatch(messages.map((m) => ({ body: m })));
      return new Response("EVENT_RECEIVED");
    }

    // Ảnh tải từ link trong Sheets, lưu trên R2 (ảnh demo trong public/anh do Static Assets phục vụ)
    if (req.method === "GET" && url.pathname.startsWith("/r2/")) return serveR2Image(env, decodeURIComponent(url.pathname.slice(4)));

    // Thử bot không cần Facebook: POST /chat {"user":"test","text":"..."} hoặc {"user":"test","payload":"DON:..."} (bấm nút)
    if (req.method === "POST" && url.pathname === "/chat") {
      if (req.headers.get("x-admin-key") !== env.ADMIN_KEY) return new Response("Unauthorized", { status: 401 });
      const { user, text, payload } = await req.json<{ user: string; text?: string; payload?: string }>();
      const { tin, reply } = await handleIncoming(env, `test:${user}`, { text, payload });
      return Response.json({ ...reply, tin });
    }

    if (url.pathname.startsWith("/admin/")) {
      if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
      if (req.headers.get("x-admin-key") !== env.ADMIN_KEY) return new Response("Unauthorized", { status: 401 });
      try {
        // Đồng bộ ngay từ Google Sheets
        if (url.pathname === "/admin/sync") return Response.json(await syncCatalog(env));
        // Nạp 3 bảng: Apps Script trong Sheets gửi mảng dòng {"san_pham": [{...}], ...}; cũng nhận chuỗi CSV.
        if (url.pathname === "/admin/import") return Response.json(await importCatalog(env, await req.json()));
        // Danh sách giá trị hợp lệ, để Apps Script dựng trang DanhMuc và danh sách thả xuống
        if (url.pathname === "/admin/danh-sach") {
          return Response.json({
            mot_gia_tri: ENUM_VALUES, nhieu_gia_tri: MULTI_VALUES, trang_thai: TRANG_THAI,
            size: ["XS", "S", "M", "L", "XL", "XXL", "Freesize"],
          });
        }
        // Tiến độ tải ảnh / tạo vector sau khi đồng bộ
        if (url.pathname === "/admin/trang-thai") return Response.json(await syncStatus(env));
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

  /** Consumer của hai hàng đợi: tin nhắn Messenger và việc nền sau đồng bộ. Mỗi lần tối đa 15 phút. */
  async queue(batch: MessageBatch<TinNhanMessenger | ViecNen>, env: Env) {
    for (const m of batch.messages) {
      const body = m.body;
      if ("loai" in body) {
        try {
          await processJob(env, body);
          m.ack();
        } catch (err) {
          // Vượt hạn mức Gemini: chạy lại sau (hàng đợi việc nền cho phép thử lại vài lần).
          console.warn(String(err));
          m.retry({ delaySeconds: err instanceof GeminiError ? Math.max(30, Math.ceil(err.retryAfterMs / 1000)) : 60 });
        }
        continue;
      }
      await replyMessenger(env, body.senderId, body.text, body.payload);
      m.ack(); // lỗi đã được báo cho khách trong replyMessenger, không gửi lại để khỏi trả lời trùng
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(syncCatalog(env));
  },
} satisfies ExportedHandler<Env, TinNhanMessenger | ViecNen>;
