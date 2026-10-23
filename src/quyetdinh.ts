import type { ChatTurn, Env } from "./types";

/**
 * Lớp quyết định chạy trước DeepSeek: hỏi model quyết định (Cloudflare Clef, cùng kiểu Jev của TypeSafe) một lần
 * xem tin của khách cần những việc tra cứu nào. Việc chắc chắn thì code tự tra sẵn, DeepSeek chỉ còn viết câu trả lời,
 * bớt được các vòng gọi model. Lưỡng lự, lỗi hoặc quá chậm thì để DeepSeek tự quyết như cũ.
 * Bật bằng QUYET_DINH = "clef-flash" (hoặc "clef") trong wrangler.toml; để trống là tắt.
 */

export interface DiemQuyetDinh { tim_sp: number; bang_size: number; don_hang: number; kien_thuc: number }
export interface CongCuTraSan { name: string; args: Record<string, unknown> }

/** Trên ngưỡng này thì tra sẵn; mọi việc tra cứu dưới KHONG thì cho trả lời luôn. Ở giữa là lưỡng lự. */
const CHAC = 0.8;
const KHONG = 0.2;
/** Đo khi chat thử: Clef thường 250-750 ms nhưng hay có lần 1,5-2 giây; 1,5 giây thì bỏ lỡ khá nhiều lần. */
const CHO_TOI_DA_MS = 2500;
const SO_TIN_NGU_CANH = 4;

// Clef hiểu câu hỏi tiếng Anh tốt nhất; tin khách vẫn để nguyên tiếng Việt.
const CAU_HOI = {
  tim_sp: {
    type: "noul",
    instructions: "The customer's latest message asks whether the shop has some item, wants product suggestions, or asks about price, " +
      "color or stock of the shop's products. General fashion advice questions that do not ask for the shop's items are NOT this.",
  },
  bang_size: {
    type: "noul",
    instructions: "The customer's latest message asks which size fits them, gives their height/weight/measurements, or asks for the size chart.",
  },
  don_hang: { type: "noul", instructions: "The customer's latest message asks about an order they already placed (status, delivery, cancel)." },
  kien_thuc: {
    type: "noul",
    instructions: "The customer's latest message is small talk (greeting, thanks) or a general fashion knowledge question " +
      "(how to match colors, what suits a body shape or skin tone, fabric care) that can be answered without looking up the shop's data.",
  },
} as const;

export async function hoiQuyetDinh(env: Env, lichSu: ChatTurn[], tin: string, choToiDaMs = CHO_TOI_DA_MS): Promise<DiemQuyetDinh | null> {
  const model = env.QUYET_DINH?.trim();
  if (!model || !env.AI) return null;
  const nguCanh = lichSu.slice(-SO_TIN_NGU_CANH).map((t) => `${t.role === "user" ? "Customer" : "Shop"}: ${t.text.slice(0, 400)}`);
  const state = `${nguCanh.length ? `Recent conversation (Vietnamese):\n${nguCanh.join("\n")}\n\n` : ""}Customer's latest message (Vietnamese): ${tin}`;
  let hetGio: ReturnType<typeof setTimeout> | null = null;
  try {
    const r: any = await Promise.race([
      env.AI.run(`@cf/cloudflare/${model}` as any, { model, state, questions: CAU_HOI } as any),
      new Promise((_, reject) => { hetGio = setTimeout(() => reject(new Error("quá thời gian")), choToiDaMs); }),
    ]);
    const so = (k: keyof DiemQuyetDinh) => Number(r?.answers?.[k]?.noul ?? NaN);
    const d = { tim_sp: so("tim_sp"), bang_size: so("bang_size"), don_hang: so("don_hang"), kien_thuc: so("kien_thuc") };
    return Object.values(d).every(Number.isFinite) ? d : null;
  } catch (err) {
    console.warn(`Lớp quyết định ${model} bỏ qua: ${(err as Error).message}`);
    return null;
  } finally {
    if (hetGio) clearTimeout(hetGio);
  }
}

/** Từ điểm quyết định ra việc tra sẵn. khongCongCu: chắc chắn không cần tra gì, DeepSeek trả lời luôn. */
export function keHoach(d: DiemQuyetDinh, tin: string): { traSan: CongCuTraSan[]; khongCongCu: boolean } {
  const traSan: CongCuTraSan[] = [];
  if (d.tim_sp >= CHAC && d.kien_thuc < 0.5) traSan.push({ name: "tim_san_pham", args: { theo_mo_ta: tin } });
  if (d.bang_size >= CHAC) traSan.push({ name: "truy_van", args: { sql: "SELECT * FROM bang_size" } });
  if (d.don_hang >= CHAC) traSan.push({ name: "xem_don", args: {} });
  const khongCongCu = !traSan.length && Math.max(d.tim_sp, d.bang_size, d.don_hang) < KHONG;
  return { traSan, khongCongCu };
}

/** Ghi chú gắn sau tin khách: kết quả đã tra sẵn để DeepSeek dùng luôn. */
export function ghiChuTraSan(ketQua: (CongCuTraSan & { result: Record<string, unknown> })[]): string {
  const dong = ketQua.map((k) => `- ${k.name}(${JSON.stringify(k.args)}) → ${JSON.stringify(k.result)}`);
  return "\n\n(Hệ thống đã tra sẵn cho tin này, dùng luôn kết quả dưới đây. Nếu chưa đủ hoặc chưa đúng ý khách " +
    `(VD cần lọc giá, giới tính, màu) thì gọi thêm công cụ.)\n${dong.join("\n")}`;
}
