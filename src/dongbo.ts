import { embedParts, GeminiError } from "./gemini";
import type { Env, ViecNen } from "./types";
import { saveVector } from "./vectors";

/**
 * Việc nền sau mỗi lần đồng bộ Google Sheets: món mới hoặc vừa sửa cần vector mới (kênh mô tả, kênh ảnh),
 * và ảnh từ link trong Sheets được tải về R2 để Messenger luôn tải được.
 * Bảng dong_bo ghi lại đã làm tới đâu, nên món không đổi không bị tạo lại vector.
 */

type Row = Record<string, any>;

/** Thuộc tính đưa vào đoạn chữ tạo vector, cùng thứ tự với scripts/embed_products.py để vector cũ và mới so được với nhau. */
const ATTRS = ["gioi_tinh", "danh_muc", "kieu_sp", "kieu_co", "tay_ao", "do_dai", "dang", "chat_lieu",
  "hoa_tiet", "mau_chinh", "phong_cach", "dip", "chi_tiet"];

export function productText(p: Row): string {
  const parts = [p.ten_sp, ...ATTRS.filter((a) => p[a]).map((a) => `${a}: ${p[a]}`), p.mo_ta_tu_do];
  return parts.filter(Boolean).join(". ");
}

async function hash(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface DongBo {
  ma_sp: string;
  chu_mong_muon: string | null;
  chu_da_tao: string | null;
  anh_mong_muon: string | null;
  anh_da_luu: string | null;
  anh_duong_dan: string | null;
  loi: string | null;
}

/** Trạng thái theo dõi hiện có, để importCatalog biết ảnh nào đã lưu R2 (dùng đường dẫn R2 thay cho link gốc). */
export async function loadDongBo(env: Env): Promise<Map<string, DongBo>> {
  const { results } = await env.DB.prepare("SELECT * FROM dong_bo").all<DongBo>();
  return new Map(results.map((r) => [r.ma_sp, r]));
}

/** Link ảnh để phục vụ: ảnh đã lưu R2 nếu đúng link hiện tại trong Sheets, không thì dùng link gốc. */
export function servedImage(src: string, d: DongBo | undefined): string {
  return d?.anh_duong_dan && d.anh_da_luu === src ? d.anh_duong_dan : src;
}

/**
 * Sau khi ghi danh mục mới vào D1: cập nhật bảng dong_bo và đưa các món cần làm vào hàng đợi.
 * Món đã có vector từ trước khi có bảng này (bộ demo nạp bằng script Python) được coi là đã xong, không tạo lại.
 * `products` là các dòng đã chuẩn hóa, `sources` là link ảnh gốc trong Sheets của từng mã.
 * Món đã lỗi mà chưa sửa gì thì bỏ qua, trừ khi `retryErrors` (bấm "Đồng bộ ngay": có thể chủ shop vừa sửa quyền chia sẻ ảnh).
 */
export async function planJobs(
  env: Env, products: Row[], sources: Map<string, string>, before: Map<string, DongBo>, retryErrors = false,
): Promise<number> {
  const { results } = await env.DB.prepare("SELECT ma_sp, kieu FROM vec").all<{ ma_sp: string; kieu: string }>();
  const hasVec = new Set(results.map((r) => `${r.ma_sp}|${r.kieu}`));
  const now = new Date().toISOString();

  const rows: Row[] = [];
  const jobs: ViecNen[] = [];
  for (const p of products) {
    const h = await hash(productText(p));
    const src = sources.get(p.ma_sp) ?? "";
    const old = before.get(p.ma_sp);
    const d: Row = old ? { ...old } : {
      ma_sp: p.ma_sp,
      chu_da_tao: hasVec.has(`${p.ma_sp}|mo_ta`) ? h : null,
      anh_da_luu: src && hasVec.has(`${p.ma_sp}|anh`) ? src : null,
      // Ảnh demo nằm sẵn trong public/anh (đường dẫn bắt đầu bằng /), phục vụ được ngay.
      anh_duong_dan: src.startsWith("/") && hasVec.has(`${p.ma_sp}|anh`) ? src : null,
      loi: null,
    };
    d.chu_mong_muon = h;
    d.anh_mong_muon = src;
    d.cap_nhat = now;
    rows.push(d);
    const failedSame = (what: string, same: boolean) => !retryErrors && same && !!old?.loi?.includes(what);
    const needText = d.chu_da_tao !== h && !failedSame("vector mô tả", old?.chu_mong_muon === h);
    const needImage = !!src && d.anh_da_luu !== src && !failedSame("ảnh:", old?.anh_mong_muon === src);
    if (needText || needImage) jobs.push({ loai: "san_pham", ma_sp: p.ma_sp });
  }

  const cols = ["ma_sp", "chu_mong_muon", "chu_da_tao", "anh_mong_muon", "anh_da_luu", "anh_duong_dan", "loi", "cap_nhat"];
  const sql = `INSERT OR REPLACE INTO dong_bo (${cols.join(", ")}) SELECT ${cols.map((c) => `json_extract(value, '$.${c}')`).join(", ")} FROM json_each(?)`;
  const stmts = [];
  for (let i = 0; i < rows.length; i += 500) stmts.push(env.DB.prepare(sql).bind(JSON.stringify(rows.slice(i, i + 500))));
  // Món đã xóa khỏi Sheets: bỏ luôn vector và trạng thái (ảnh trên R2 để lại, không ảnh hưởng gì).
  stmts.push(
    env.DB.prepare("DELETE FROM dong_bo WHERE ma_sp NOT IN (SELECT ma_sp FROM san_pham)"),
    env.DB.prepare("DELETE FROM vec WHERE ma_sp NOT IN (SELECT ma_sp FROM san_pham)"),
    env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('phien_ban_vec', ?)").bind(now),
  );
  await env.DB.batch(stmts);

  for (let i = 0; i < jobs.length; i += 100) await env.VIEC_NEN.sendBatch(jobs.slice(i, i + 100).map((body) => ({ body })));
  return jobs.length;
}

/** Link chia sẻ Google Drive (…/file/d/<id>/view, …open?id=<id>) đổi sang link tải thẳng. */
export function directImageUrl(src: string): string {
  const id = src.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([\w-]{20,})/)?.[1];
  return id ? `https://drive.google.com/uc?export=download&id=${id}` : src;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

async function downloadImage(env: Env, src: string): Promise<{ bytes: ArrayBuffer; mime: string }> {
  // Ảnh demo trong public/anh: đọc từ Static Assets của chính Worker.
  const res = src.startsWith("/")
    ? await env.ASSETS.fetch(new Request(new URL(src, "https://assets.local")))
    : await fetch(directImageUrl(src), { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`không tải được ảnh (${res.status}): ${src}`);
  const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!mime.startsWith("image/")) {
    throw new Error(`link không phải ảnh (${mime || "không rõ loại"}), kiểm tra quyền chia sẻ: ${src}`);
  }
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`ảnh quá lớn (${Math.round(bytes.byteLength / 1e6)} MB, tối đa 10 MB)`);
  return { bytes, mime };
}

function toBase64(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

/** Xử lý một món trong hàng đợi: tạo vector mô tả nếu chữ đổi; tải ảnh (lưu R2 nếu có) và tạo vector ảnh nếu link ảnh đổi. */
export async function processJob(env: Env, job: ViecNen): Promise<void> {
  const d = await env.DB.prepare("SELECT * FROM dong_bo WHERE ma_sp = ?").bind(job.ma_sp).first<DongBo>();
  const p = await env.DB.prepare("SELECT * FROM san_pham WHERE ma_sp = ?").bind(job.ma_sp).first<Row>();
  if (!d || !p) return; // món đã bị xóa khỏi Sheets

  const errors: string[] = [];
  const text = productText(p);
  const h = await hash(text);
  if (d.chu_da_tao !== h) {
    try {
      await saveVector(env, p.ma_sp, "mo_ta", await embedParts(env, [{ text }]));
      await env.DB.prepare("UPDATE dong_bo SET chu_da_tao = ? WHERE ma_sp = ?").bind(h, p.ma_sp).run();
    } catch (err) {
      if (err instanceof GeminiError && err.status === 429) throw err; // để hàng đợi chạy lại sau
      errors.push(`vector mô tả: ${(err as Error).message}`);
    }
  }

  const src = d.anh_mong_muon ?? "";
  if (src && d.anh_da_luu !== src) {
    try {
      const { bytes, mime } = await downloadImage(env, src);
      // Có R2 thì giữ một bản riêng (không phụ thuộc link gốc); chưa bật R2 thì dùng thẳng link gốc
      // (link chia sẻ Drive đổi sang link tải thẳng; Messenger có thể không hiển thị được ảnh Drive).
      let path = directImageUrl(src);
      if (env.ANH) {
        const key = `anh/${p.ma_sp}-${await hash(src)}.${EXT[mime] ?? "jpg"}`;
        await env.ANH.put(key, bytes, { httpMetadata: { contentType: mime } });
        path = `/r2/${key}`;
      }
      await saveVector(env, p.ma_sp, "anh", await embedParts(env, [{ inline_data: { mime_type: mime, data: toBase64(bytes) } }]));
      await env.DB.batch([
        env.DB.prepare("UPDATE dong_bo SET anh_da_luu = ?, anh_duong_dan = ? WHERE ma_sp = ?").bind(src, path, p.ma_sp),
        // Lần đồng bộ sau sẽ tự dùng lại đường dẫn này (servedImage), không cần chờ.
        env.DB.prepare("UPDATE san_pham SET anh_chinh_url = ? WHERE ma_sp = ?").bind(path, p.ma_sp),
      ]);
    } catch (err) {
      if (err instanceof GeminiError && err.status === 429) throw err;
      errors.push(`ảnh: ${(err as Error).message}`);
    }
  }

  await env.DB.prepare("UPDATE dong_bo SET loi = ? WHERE ma_sp = ?").bind(errors.join("; ") || null, p.ma_sp).run();
}

/** Tiến độ cho menu "Bot > Xem tiến độ" trong Sheets. */
export async function syncStatus(env: Env) {
  const tong = await env.DB.prepare(
    `SELECT COUNT(*) AS tong,
            SUM(CASE WHEN chu_da_tao IS NOT chu_mong_muon
                       OR (COALESCE(anh_mong_muon, '') <> '' AND anh_da_luu IS NOT anh_mong_muon) THEN 1 ELSE 0 END) AS cho_xu_ly
     FROM dong_bo`,
  ).first<{ tong: number; cho_xu_ly: number }>();
  const { results } = await env.DB.prepare("SELECT ma_sp, loi FROM dong_bo WHERE loi IS NOT NULL ORDER BY ma_sp LIMIT 100")
    .all<{ ma_sp: string; loi: string }>();
  const lan_cuoi = await env.DB.prepare("SELECT v FROM meta WHERE k = 'cap_nhat_luc'").first<string>("v");
  return { tong_mon: tong?.tong ?? 0, cho_xu_ly: tong?.cho_xu_ly ?? 0, loi: results, dong_bo_lan_cuoi: lan_cuoi };
}

/** Phục vụ ảnh đã lưu trên R2: GET /r2/anh/<file>. Tên file có mã băm của link gốc nên cache vĩnh viễn được. */
export async function serveR2Image(env: Env, key: string): Promise<Response> {
  const obj = env.ANH ? await env.ANH.get(key) : null;
  if (!obj) return new Response("Không có ảnh", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "image/jpeg",
      "cache-control": "public, max-age=31536000, immutable",
      etag: obj.httpEtag,
    },
  });
}
