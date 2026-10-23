import type { Env, TinNhanMessenger, ViecKhach } from "./types";

/**
 * Khách hay nhắn nhiều tin liền nhau ("shop ơi" / "có quần jean ko" / "ống rộng ấy", hoặc tên, số điện thoại,
 * địa chỉ thành ba tin). Nếu mỗi tin là một lượt riêng thì các lượt chạy song song, mỗi lượt chỉ thấy một phần
 * hội thoại và ghi đè lịch sử của nhau. Nên:
 *  1. Webhook ghi tin vào bảng tin_cho rồi hẹn hàng đợi xử lý khách đó sau GOM_GIAY giây.
 *  2. Lượt xử lý giữ khóa của khách (mỗi khách một lượt tại một thời điểm), lấy hết tin đang chờ và gộp các tin chữ
 *     liền nhau thành một. Tin tới trong lúc bot đang trả lời sẽ được gộp ở vòng kế tiếp.
 */
export const GOM_GIAY = 3;
/** Khóa tự hết hạn sau thời gian này, phòng khi lượt trước bị dừng giữa chừng (một lượt agent tối đa khoảng 3 phút). */
const KHOA_GIAY = 300;
/** Số vòng lấy tin trong một lần chạy: gói Workers miễn phí giới hạn số truy vấn D1 và lượt gọi ra ngoài mỗi lần. */
const SO_VONG = 2;

const maKhach = (kenh: string, senderId: string) => `${kenh}:${senderId}`;

/** Webhook nhận tin: lưu lại rồi hẹn xử lý mỗi khách một lần sau GOM_GIAY giây. */
export async function nhanTin(env: Env, tin: TinNhanMessenger[]) {
  if (!tin.length) return;
  const now = Date.now();
  await env.DB.batch(tin.map((m) => env.DB.prepare("INSERT INTO tin_cho (khach, du_lieu, luc) VALUES (?, ?, ?)")
    .bind(maKhach(m.kenh ?? "fb", m.senderId), JSON.stringify(m), now)));
  const viec = new Map<string, ViecKhach>();
  for (const m of tin) viec.set(maKhach(m.kenh ?? "fb", m.senderId), { loai: "khach", kenh: m.kenh ?? "fb", senderId: m.senderId });
  await env.HANG_DOI.sendBatch([...viec.values()].map((body) => ({ body, delaySeconds: GOM_GIAY })));
}

/** Giữ khóa của khách nếu đang trống (hoặc đã hết hạn). */
async function khoa(env: Env, khach: string): Promise<boolean> {
  const now = Date.now();
  const r = await env.DB.prepare(
    `INSERT INTO khach_dang_xu_ly (khach, het_han) VALUES (?1, ?2)
     ON CONFLICT (khach) DO UPDATE SET het_han = ?2 WHERE khach_dang_xu_ly.het_han < ?3
     RETURNING khach`,
  ).bind(khach, now + KHOA_GIAY * 1000, now).first();
  return !!r;
}

const moKhoa = (env: Env, khach: string) => env.DB.prepare("DELETE FROM khach_dang_xu_ly WHERE khach = ?").bind(khach).run();

/** Lấy và xóa mọi tin đang chờ của khách, theo thứ tự đến. */
async function layTinCho(env: Env, khach: string): Promise<TinNhanMessenger[]> {
  const { results } = await env.DB.prepare("DELETE FROM tin_cho WHERE khach = ? RETURNING id, du_lieu").bind(khach)
    .all<{ id: number; du_lieu: string }>();
  return results.sort((a, b) => a.id - b.id).map((r) => JSON.parse(r.du_lieu));
}

/**
 * Gộp tin thành các lượt: tin chữ / đính kèm liền nhau thành một lượt (chữ nối bằng xuống dòng);
 * mỗi lần bấm nút là một lượt riêng, giữ đúng thứ tự.
 */
export function gomTin(tin: TinNhanMessenger[]): TinNhanMessenger[] {
  const out: TinNhanMessenger[] = [];
  let nhom: TinNhanMessenger | null = null;
  for (const m of tin) {
    if (m.payload) {
      nhom = null;
      out.push(m);
      continue;
    }
    if (!nhom) {
      nhom = { ...m };
      out.push(nhom);
      continue;
    }
    nhom.text = [nhom.text, m.text].filter((t) => t.trim()).join("\n");
    nhom.dinh_kem ??= m.dinh_kem;
  }
  return out;
}

/**
 * Trả lời mọi tin đang chờ của một khách. "ban" nghĩa là khách đang có lượt khác chạy hoặc còn tin chưa xử lý:
 * hàng đợi nên thử lại sau vài giây.
 */
export async function xuLyKhach(
  env: Env, viec: ViecKhach, traLoi: (m: TinNhanMessenger) => Promise<void>,
): Promise<"xong" | "ban"> {
  const khach = maKhach(viec.kenh, viec.senderId);
  for (let vong = 0; vong < SO_VONG; vong++) {
    if (!(await khoa(env, khach))) return "ban";
    try {
      const tin = await layTinCho(env, khach);
      if (!tin.length) return "xong";
      for (const luot of gomTin(tin)) await traLoi(luot);
    } finally {
      await moKhoa(env, khach);
    }
  }
  // Hết số vòng mà khách vẫn nhắn tiếp: để một lần chạy khác lo.
  const con = await env.DB.prepare("SELECT 1 FROM tin_cho WHERE khach = ? LIMIT 1").bind(khach).first();
  return con ? "ban" : "xong";
}
