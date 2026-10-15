"""Tải ảnh độ phân giải cao (bản đầy đủ của bộ Kaggle "Fashion Product Images Dataset", giấy phép MIT)
cho các sản phẩm demo, rồi thu nhỏ còn 600x800 cho Worker phục vụ và cho model nhìn.

Đầu vào: CSV có cột ma_sp dạng SP<id Kaggle> (VD scripts/out/mau_300.csv)
Đầu ra:  raw/images_hd/<id>.jpg (ảnh gốc, khoảng 1080x1440) và public/anh/<ma_sp>.jpg (600x800)

Chạy:  python scripts/tai_anh_hd.py scripts/out/mau_300.csv
"""
import csv
import os
import sys
import time
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HD = os.path.join(ROOT, "raw", "images_hd")
PUBLIC = os.path.join(ROOT, "public", "anh")
URL = "https://www.kaggle.com/api/v1/datasets/download/paramaggarwal/fashion-product-images-dataset/fashion-dataset%2Fimages%2F{id}.jpg"


def fetch(ma):
    kid = ma[2:]
    src = os.path.join(HD, f"{kid}.jpg")
    for attempt in range(4):
        if os.path.exists(src) and os.path.getsize(src) > 1000:
            break
        try:
            with urllib.request.urlopen(URL.format(id=kid), timeout=60) as r, open(src, "wb") as f:
                f.write(r.read())
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                return ma, f"lỗi tải: {e}"
            time.sleep(2 ** attempt)
    # Kaggle đôi khi trả ảnh nén trong một file zip: giải nén ra ảnh.
    if open(src, "rb").read(2) == b"PK":
        with zipfile.ZipFile(src) as z:
            data = z.read(z.namelist()[0])
        with open(src, "wb") as f:
            f.write(data)
    with Image.open(src) as im:
        im = im.convert("RGB")
        im.thumbnail((600, 800))
        im.save(os.path.join(PUBLIC, f"{ma}.jpg"), "JPEG", quality=85)
        return ma, f"{im.width}x{im.height}"


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    os.makedirs(HD, exist_ok=True)
    os.makedirs(PUBLIC, exist_ok=True)
    codes = [r["ma_sp"] for r in csv.DictReader(open(sys.argv[1], encoding="utf-8-sig")) if r["ma_sp"].startswith("SP")]
    with ThreadPoolExecutor(6) as ex:
        results = list(ex.map(fetch, codes))
    bad = [(m, s) for m, s in results if s.startswith("lỗi")]
    print(f"Xong {len(results) - len(bad)}/{len(results)} ảnh; lỗi: {bad[:10]}")


if __name__ == "__main__":
    main()
