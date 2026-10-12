"""Tạo embedding cho từng sản phẩm và xuất file để nạp vào Cloudflare Vectorize.

Đầu vào: CSV sheet SanPham (đã gắn thuộc tính).
Đầu ra:  scripts/out/vectors.ndjson
Nạp:     npx wrangler vectorize insert san-pham --file scripts/out/vectors.ndjson

Phải dùng cùng EMBED_MODEL và EMBED_DIM với wrangler.toml, không thì vector không so được với câu hỏi.

Chạy:  python scripts/embed_products.py duong_dan/san_pham_da_gan.csv
"""
import csv
import json
import os
import sys
import time

from common import gemini, load_env

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL = os.environ.get("EMBED_MODEL", "gemini-embedding-2")
DIM = int(os.environ.get("EMBED_DIM", "768"))
ATTRS = ["danh_muc", "kieu_sp", "kieu_co", "tay_ao", "do_dai", "dang", "chat_lieu",
         "hoa_tiet", "mau_chinh", "phong_cach", "dip", "chi_tiet"]


def product_text(row):
    parts = [row.get("ten_sp", "")]
    parts += [f"{a}: {row[a]}" for a in ATTRS if row.get(a)]
    parts.append(row.get("mo_ta_tu_do", ""))
    return ". ".join(p for p in parts if p)


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    key = load_env()
    rows = [r for r in csv.DictReader(open(sys.argv[1], encoding="utf-8-sig")) if r.get("ma_sp", "").startswith("SP")]
    os.makedirs(os.path.join(ROOT, "scripts", "out"), exist_ok=True)
    out_path = os.path.join(ROOT, "scripts", "out", "vectors.ndjson")

    with open(out_path, "w", encoding="utf-8") as f:
        for i, row in enumerate(rows, 1):
            res = gemini(MODEL, "embedContent", {
                "content": {"parts": [{"text": product_text(row)}]},
                "outputDimensionality": DIM,
            }, key)
            values = res["embedding"]["values"]
            f.write(json.dumps({"id": row["ma_sp"], "values": values,
                                "metadata": {"danh_muc": row.get("danh_muc", "")}}, ensure_ascii=False) + "\n")
            print(f"[{i}/{len(rows)}] {row['ma_sp']} ({len(values)} chiều)")
            time.sleep(1)
    print("Xong:", out_path)


if __name__ == "__main__":
    main()
