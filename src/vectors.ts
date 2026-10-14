import { insertJson } from "./catalog";
import type { Env } from "./types";

/**
 * Vector sản phẩm nằm trong bảng vec của D1 và được giữ trong bộ nhớ của isolate.
 * SQL lọc ra các món hợp lệ, rồi chấm điểm gần nghĩa ngay trong Worker:
 * vài nghìn sản phẩm x 768 chiều chỉ mất vài mili giây, không cần dịch vụ vector riêng.
 */
type Kind = "mo_ta" | "anh";
type VecMap = Map<string, Partial<Record<Kind, Float32Array>>>;

let cache: { version: string; data: VecMap } | null = null;

function decode(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return normalize(new Float32Array(bytes.buffer));
}

function encode(values: number[]): string {
  const bytes = new Uint8Array(new Float32Array(values).buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

async function loadVectors(env: Env): Promise<VecMap> {
  const version = (await env.DB.prepare("SELECT v FROM meta WHERE k = 'phien_ban_vec'").first<string>("v")) ?? "";
  if (cache && cache.version === version) return cache.data;
  const { results } = await env.DB.prepare("SELECT ma_sp, kieu, v FROM vec").all<{ ma_sp: string; kieu: Kind; v: string }>();
  const data: VecMap = new Map();
  for (const r of results) {
    const entry = data.get(r.ma_sp) ?? {};
    entry[r.kieu] = decode(r.v);
    data.set(r.ma_sp, entry);
  }
  cache = { version, data };
  return data;
}

/**
 * Xếp `ids` theo độ gần với vector câu hỏi. Có cả vector chữ lẫn vector ảnh thì gộp hai bảng xếp hạng
 * bằng RRF (điểm chữ và điểm ảnh khác thang đo nên không cộng thẳng). Món chưa có vector giữ thứ tự cũ, xếp sau.
 */
export async function rankIds(env: Env, query: number[], ids: string[]): Promise<{ ids: string[]; scores: Map<string, number> }> {
  const vecs = await loadVectors(env);
  const q = normalize(new Float32Array(query));
  const scores = new Map<string, number>();
  for (const kind of ["mo_ta", "anh"] as const) {
    const ranked = ids
      .flatMap((id) => {
        const v = vecs.get(id)?.[kind];
        return v && v.length === q.length ? [{ id, s: dot(q, v) }] : [];
      })
      .sort((a, b) => b.s - a.s);
    ranked.forEach(({ id }, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + rank)));
  }
  const order = new Map(ids.map((id, i) => [id, i]));
  const sorted = [...ids].sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || order.get(a)! - order.get(b)!);
  return { ids: sorted, scores };
}

export interface VectorLine {
  id: string;
  kieu?: Kind;
  values?: number[];
  b64?: string;
}

/** Nạp vector từ scripts/embed_products.py (mỗi dòng một JSON). Ghi đè vector cùng mã và cùng kiểu. */
export async function importVectors(env: Env, lines: VectorLine[]): Promise<{ da_nap: number; bo_qua: number }> {
  const rows = lines.flatMap((l) => {
    const kieu = l.kieu ?? "mo_ta";
    if (!l.id || !["mo_ta", "anh"].includes(kieu)) return [];
    const v = l.b64 ?? (l.values?.length ? encode(l.values) : "");
    return v ? [{ ma_sp: l.id, kieu, v }] : [];
  });
  await env.DB.batch([
    ...insertJson(env, "vec", ["ma_sp", "kieu", "v"], rows, "INSERT OR REPLACE"),
    env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('phien_ban_vec', ?)").bind(new Date().toISOString()),
  ]);
  return { da_nap: rows.length, bo_qua: lines.length - rows.length };
}
