import { imagesPerRequest, type Part, visionJson } from "./llm";
import type { Env } from "./types";

/**
 * Ảnh sản phẩm gửi cho model theo từng lô (imagesPerRequest). Giới hạn của Gemini: tối đa 3.600 ảnh và 20 MB dữ liệu
 * đính kèm mỗi request. Ảnh shop thật thường 100-300 KB (thêm 1/3 khi mã hoá base64), nên lô 16 ảnh
 * nằm khoảng 2-6 MB, an toàn và đủ nhanh. Các lô chạy song song.
 *
 * Số ảnh tối đa mỗi lần gọi xem_anh: mỗi ảnh http là một lượt gọi ra ngoài, gói Workers miễn phí chỉ cho 50.
 */
export const ANH_TOI_DA = 32;

/** Đọc ảnh: link http, hoặc đường dẫn /... nằm trong thư mục public (Workers Static Assets). */
async function loadImage(env: Env, url: string): Promise<{ mime: string; b64: string } | null> {
  try {
    const res = url.startsWith("/")
      ? await env.ASSETS.fetch(new Request(`https://assets.local${url}`))
      : url.startsWith("http") ? await fetch(url, { signal: AbortSignal.timeout(10_000) }) : null;
    if (!res?.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { mime: res.headers.get("content-type")?.split(";")[0] || "image/jpeg", b64: btoa(bin) };
  } catch {
    return null;
  }
}

const SCHEMA = {
  type: "OBJECT",
  properties: {
    ket_qua: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          ma_sp: { type: "STRING" },
          hop: { type: "BOOLEAN" },
          ly_do: { type: "STRING", description: "Một câu ngắn: thấy gì trên ảnh khiến hợp / không hợp" },
        },
        required: ["ma_sp", "hop", "ly_do"],
      },
    },
  },
  required: ["ket_qua"],
};

export interface ImageVerdict {
  ma_sp: string;
  hop: boolean;
  ly_do: string;
}

/** Cho model nhìn ảnh từng sản phẩm và đánh giá có hợp với yêu cầu của khách không. */
export async function judgeImages(
  env: Env, items: { ma_sp: string; anh_chinh_url: string }[], yeuCau: string,
): Promise<{ ket_qua: ImageVerdict[]; khong_doc_duoc_anh: string[] }> {
  const perLot = imagesPerRequest(env);
  const lots: (typeof items)[] = [];
  for (let i = 0; i < items.length; i += perLot) lots.push(items.slice(i, i + perLot));
  const missing: string[] = [];

  const results = await Promise.all(lots.map(async (lot) => {
    const parts: Part[] = [];
    for (const it of lot) {
      const img = await loadImage(env, it.anh_chinh_url ?? "");
      if (!img) { missing.push(it.ma_sp); continue; }
      parts.push({ text: `Ảnh sản phẩm ${it.ma_sp}:` }, { image: img });
    }
    if (!parts.length) return [];
    parts.push({
      text: `Bạn là nhân viên bán hàng thời trang có kinh nghiệm. Yêu cầu của khách: "${yeuCau}".
Nhìn từng ảnh ở trên và đánh giá sản phẩm đó có hợp với yêu cầu không, như một người bán hàng thật sẽ tư vấn.
Chỉ dựa vào những gì thấy trong ảnh; khó nhìn rõ thì nói là không chắc trong ly_do. Trả về đủ mọi mã sản phẩm.`,
    });
    return ((await visionJson(env, parts, SCHEMA)).ket_qua ?? []) as ImageVerdict[];
  }));

  const known = new Set(items.map((i) => i.ma_sp));
  return { ket_qua: results.flat().filter((r) => known.has(r.ma_sp)), khong_doc_duoc_anh: missing };
}
