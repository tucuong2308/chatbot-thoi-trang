import { handleIncoming } from "./tinnhan";
import type { Env, ProductCard } from "./types";

/** Cách gửi tin trên một kênh chat (Messenger, Telegram). Bot soạn tin giống nhau, mỗi kênh tự gửi theo kiểu của mình. */
export interface KenhGui {
  chu(text: string): Promise<unknown>;
  /** Các món gợi ý: ảnh, tên, giá, size và hai nút hỏi thêm / muốn mua. */
  the(cards: ProductCard[]): Promise<unknown>;
  nut(text: string, buttons: { tieu_de: string; payload: string }[]): Promise<unknown>;
  dangSoan(): Promise<unknown>;
}

/** Câu chữ gửi khi khách bấm nút trên thẻ sản phẩm, xử lý như khách tự nhắn. */
export const hoiThem = (ma: string) => `Cho em hỏi thêm về mẫu [${ma}]`;
export const muonMua = (ma: string) => `Em muốn mua mẫu [${ma}]`;

/** Trả lời một tin của khách `khach` (đã gắn tiền tố kênh, VD "fb:..." / "tg:...") qua kênh `kenh`. */
export async function traLoi(env: Env, khach: string, vao: { text: string; payload?: string }, kenh: KenhGui) {
  await kenh.dangSoan();
  try {
    const { tin } = await handleIncoming(env, khach, vao, {
      send: async (msg) => {
        await kenh.chu(msg);
        await kenh.dangSoan();
      },
      typing: async () => { await kenh.dangSoan(); },
    });
    // Theo thứ tự: lời tư vấn, thẻ sản phẩm (ảnh + giá + size), rồi tóm tắt đơn và nút xác nhận nếu có.
    for (const t of tin) {
      if (t.loai === "chu") await kenh.chu(t.chu);
      else if (t.loai === "the") await kenh.the(t.the);
      else await kenh.nut(t.chu, t.nut);
    }
  } catch (err) {
    console.error(err);
    await kenh.chu("Dạ em đang gặp chút trục trặc, chị đợi em một lát hoặc nhắn lại giúp em nhé.");
  }
}
