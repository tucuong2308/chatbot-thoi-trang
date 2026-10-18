import type { Env } from "./types";

/**
 * Chạy câu SQL do model viết, chỉ cho đọc. Ba lớp chặn:
 *  1. Chỉ một câu lệnh, bắt đầu bằng SELECT hoặc WITH, không có từ khóa ghi/đổi cấu trúc.
 *  2. Câu lệnh được bọc thành truy vấn con `SELECT * FROM (...)`: lệnh ghi đặt trong đó là lỗi cú pháp
 *     (nhờ vậy hàm replace() vẫn dùng được mà REPLACE INTO thì không).
 *  3. Dữ liệu chỉ là bản sao từ Google Sheets, lần đồng bộ sau sẽ dựng lại.
 */
const WRITE_WORDS =
  /\b(insert|update|delete|upsert|drop|alter|create|attach|detach|pragma|vacuum|reindex|analyze|truncate|begin|commit|rollback|savepoint|release)\b/i;
/**
 * Bảng không cho model đọc: bảng nội bộ (vector rất dài, vô ích với model) và bảng đơn hàng (họ tên, số điện thoại,
 * địa chỉ, hội thoại của mọi khách; model chỉ xem đơn của khách đang nhắn qua công cụ xem_don).
 */
const HIDDEN_TABLES = /\b(vec|meta|dong_bo|don_hang|don_hang_mon|don_nhap|sqlite_\w+|_cf_\w+|d1_\w+)\b/i;

export class SqlError extends Error {}

/** Bỏ chú thích và làm rỗng nội dung chuỗi '...' để kiểm tra từ khóa không bị đánh lừa. */
function scan(sql: string): { code: string; stripped: string } {
  let code = "";      // câu lệnh đã bỏ chú thích (để chạy)
  let stripped = "";  // như trên nhưng nội dung chuỗi thay bằng khoảng trắng (để kiểm tra)
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      code += " "; stripped += " ";
    } else if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) throw new SqlError("Chú thích /* chưa đóng");
      i = end + 1;
      code += " "; stripped += " ";
    } else if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      for (; j < sql.length; j++) {
        if (sql[j] === c && sql[j + 1] === c) { j++; continue; } // '' là dấu nháy trong chuỗi
        if (sql[j] === c) break;
      }
      if (j >= sql.length) throw new SqlError(`Chuỗi ${c} chưa đóng`);
      const lit = sql.slice(i, j + 1);
      code += lit;
      // Tên cột/bảng trong "..." vẫn phải kiểm tra; chỉ chuỗi '...' mới được làm rỗng.
      stripped += c === "'" ? `'${" ".repeat(lit.length - 2)}'` : lit;
      i = j;
    } else {
      code += c; stripped += c;
    }
  }
  return { code, stripped };
}

export function checkSelect(sql: string): string {
  const { code, stripped } = scan(sql);
  const body = code.trim().replace(/;\s*$/, "");
  const check = stripped.trim().replace(/;\s*$/, "");
  if (!body) throw new SqlError("Câu SQL rỗng");
  if (check.includes(";")) throw new SqlError("Chỉ được một câu lệnh, không dùng dấu ;");
  if (!/^(select|with)\b/i.test(check)) throw new SqlError("Chỉ được dùng SELECT (hoặc WITH ... SELECT)");
  const w = check.match(WRITE_WORDS);
  if (w) throw new SqlError(`Không được dùng ${w[0].toUpperCase()}: chỉ được đọc dữ liệu`);
  const h = check.match(HIDDEN_TABLES);
  if (h) throw new SqlError(`Bảng ${h[0]} không được phép truy vấn`);
  return body;
}

/** Chạy câu SELECT của model, tối đa `limit` dòng. Lỗi trả về dạng SqlError để báo lại cho model sửa. */
export async function runSelect(env: Env, sql: string, limit: number): Promise<Record<string, unknown>[]> {
  const body = checkSelect(sql);
  try {
    const res = await env.DB.prepare(`SELECT * FROM (${body}) LIMIT ${limit}`).all();
    return res.results as Record<string, unknown>[];
  } catch (err) {
    throw new SqlError(`SQL lỗi: ${(err as Error).message}`);
  }
}
