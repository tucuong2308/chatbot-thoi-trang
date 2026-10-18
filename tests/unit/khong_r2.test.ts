import { env } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { processJob, serveR2Image } from "../../src/dongbo";
import type { Env } from "../../src/types";
import { napMau } from "./setup";

const DRIVE = "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing";
const TRUC_TIEP = "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const khongR2 = { ...env, ANH: undefined } as unknown as Env;

beforeEach(async () => {
  await napMau(env);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM dong_bo"),
    env.DB.prepare("UPDATE san_pham SET anh_chinh_url = ? WHERE ma_sp = 'SP1'").bind(DRIVE),
    env.DB.prepare("INSERT INTO dong_bo (ma_sp, chu_mong_muon, chu_da_tao, anh_mong_muon, cap_nhat) VALUES ('SP1', 'x', 'x', ?, '')").bind(DRIVE),
  ]);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("generativelanguage")) return Response.json({ embedding: { values: Array(768).fill(0.1) } });
    return new Response(new Uint8Array([255, 216, 255, 224]), { headers: { "content-type": "image/jpeg" } });
  });
});
afterEach(() => vi.restoreAllMocks());

it("không có R2 thì vẫn tạo vector ảnh và dùng link gốc (Drive đổi sang link tải thẳng)", async () => {
  await processJob(khongR2, { loai: "san_pham", ma_sp: "SP1" });
  const d = await env.DB.prepare("SELECT anh_da_luu, anh_duong_dan, loi FROM dong_bo WHERE ma_sp = 'SP1'").first();
  expect(d).toEqual({ anh_da_luu: DRIVE, anh_duong_dan: TRUC_TIEP, loi: null });
  expect((await env.DB.prepare("SELECT anh_chinh_url FROM san_pham WHERE ma_sp = 'SP1'").first())?.anh_chinh_url).toBe(TRUC_TIEP);
  expect((await env.DB.prepare("SELECT count(*) c FROM vec WHERE ma_sp = 'SP1' AND kieu = 'anh'").first())?.c).toBe(1);
});

it("không có R2 thì /r2/ trả 404", async () => {
  expect((await serveR2Image(khongR2, "anh/x.jpg")).status).toBe(404);
});
