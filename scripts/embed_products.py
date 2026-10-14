"""Tạo embedding cho từng sản phẩm (từ chữ, và từ ảnh nếu muốn) rồi nạp vào Worker.

Đầu vào: CSV sheet SanPham đã gắn thuộc tính (cần ma_sp, ten_sp, các cột thuộc tính, mo_ta_tu_do;
         thêm cột anh hoặc anh_chinh_url nếu dùng --anh).
Đầu ra:  scripts/out/vectors.ndjson (mỗi dòng {"id", "kieu": "mo_ta"|"anh", "b64"})
Nạp:     python scripts/embed_products.py san_pham_da_gan.csv --anh --nap http://localhost:8787

Phải dùng cùng EMBED_MODEL và EMBED_DIM với wrangler.toml, không thì vector không so được với câu hỏi.
"""
import argparse
import base64
import csv
import json
import mimetypes
import os
import struct
import time
import urllib.request

from common import gemini, load_env, post_worker

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL = os.environ.get("EMBED_MODEL", "gemini-embedding-2")
DIM = int(os.environ.get("EMBED_DIM", "768"))
ATTRS = ["gioi_tinh", "danh_muc", "kieu_sp", "kieu_co", "tay_ao", "do_dai", "dang", "chat_lieu",
         "hoa_tiet", "mau_chinh", "phong_cach", "dip", "chi_tiet"]
BATCH = 50


def product_text(row):
    parts = [row.get("ten_sp", "")]
    parts += [f"{a}: {row[a]}" for a in ATTRS if row.get(a)]
    parts.append(row.get("mo_ta_tu_do", ""))
    return ". ".join(p for p in parts if p)


def image_part(src):
    if src.startswith("http"):
        with urllib.request.urlopen(src, timeout=60) as r:
            data, mime = r.read(), r.headers.get_content_type()
    else:
        data, mime = open(src, "rb").read(), mimetypes.guess_type(src)[0] or "image/jpeg"
    return {"inline_data": {"mime_type": mime, "data": base64.b64encode(data).decode()}}


def to_b64(values):
    return base64.b64encode(struct.pack(f"<{len(values)}f", *values)).decode()


def embed_batch(contents, key):
    """batchEmbedContents: tối đa vài chục nội dung mỗi lần gọi, nhanh hơn gọi từng cái."""
    res = gemini(MODEL, "batchEmbedContents", {"requests": [
        {"model": f"models/{MODEL}", "content": c, "outputDimensionality": DIM} for c in contents
    ]}, key)
    return [e["values"] for e in res["embeddings"]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("vao")
    ap.add_argument("--anh", action="store_true", help="tạo thêm vector từ ảnh sản phẩm")
    ap.add_argument("--nap", help="URL của Worker, VD http://localhost:8787")
    args = ap.parse_args()

    key = load_env()
    rows = [r for r in csv.DictReader(open(args.vao, encoding="utf-8-sig")) if r.get("ma_sp", "").startswith("SP")]
    jobs = [(r["ma_sp"], "mo_ta", {"parts": [{"text": product_text(r)}]}) for r in rows]
    if args.anh:
        for r in rows:
            src = r.get("anh") or r.get("anh_chinh_url") or ""
            if src:
                jobs.append((r["ma_sp"], "anh", {"parts": [image_part(src)]}))

    os.makedirs(os.path.join(ROOT, "scripts", "out"), exist_ok=True)
    out_path = os.path.join(ROOT, "scripts", "out", "vectors.ndjson")
    with open(out_path, "w", encoding="utf-8") as f:
        for i in range(0, len(jobs), BATCH):
            chunk = jobs[i:i + BATCH]
            vectors = embed_batch([c for _, _, c in chunk], key)
            for (ma, kieu, _), values in zip(chunk, vectors):
                f.write(json.dumps({"id": ma, "kieu": kieu, "b64": to_b64(values)}) + "\n")
            print(f"[{min(i + BATCH, len(jobs))}/{len(jobs)}] {DIM} chiều")
            time.sleep(1)
    print("Xong:", out_path)

    if args.nap:
        print("Đã nạp:", post_worker(args.nap, "/admin/vectors", open(out_path, "rb").read(), "application/x-ndjson"))


if __name__ == "__main__":
    main()
