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

export type Kenh = Kind;

/**
 * Điểm cosine giữa vector câu hỏi của từng kênh và vector sản phẩm cùng kênh.
 * Kênh "mo_ta" so với vector tạo từ chữ, kênh "anh" so với vector tạo từ ảnh. Món thiếu vector thì không có điểm kênh đó.
 */
export async function channelScores(
  env: Env, ids: string[], queries: Partial<Record<Kind, number[]>>,
): Promise<Map<string, Partial<Record<Kind, number>>>> {
  const vecs = await loadVectors(env);
  const out = new Map<string, Partial<Record<Kind, number>>>();
  for (const kind of ["mo_ta", "anh"] as const) {
    const qv = queries[kind];
    if (!qv?.length) continue;
    const q = normalize(new Float32Array(qv));
    for (const id of ids) {
      const v = vecs.get(id)?.[kind];
      if (v && v.length === q.length) out.set(id, { ...out.get(id), [kind]: dot(q, v) });
    }
  }
  return out;
}

export interface VectorLine {
  id: string;
  kieu?: Kind;
  values?: number[];
  b64?: string;
}

/** Ghi một vector của một món (tạo khi đồng bộ Sheets) và đổi phiên bản để các isolate nạp lại bộ nhớ đệm. */
export async function saveVector(env: Env, maSp: string, kieu: Kind, values: number[]) {
  if (!values.length) throw new Error(`Gemini trả về vector rỗng cho ${maSp} (${kieu})`);
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO vec (ma_sp, kieu, v) VALUES (?, ?, ?)").bind(maSp, kieu, encode(values)),
    env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('phien_ban_vec', ?)").bind(new Date().toISOString()),
  ]);
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
