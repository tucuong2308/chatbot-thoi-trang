"""Dựng bộ dữ liệu demo (SanPham, BienThe, BangSize) từ file đã gắn thuộc tính, rồi nạp vào Worker.

Dùng khi chưa có Google Sheets thật. Giá, size, tồn kho là số giả nhưng cố định (chạy lại vẫn ra như cũ).

Đầu vào: scripts/out/san_pham_da_gan.csv (kết quả của tag_products.py)
Đầu ra:  scripts/out/demo/san_pham.csv, bien_the.csv, bang_size.csv
Nạp:     python scripts/tao_du_lieu_demo.py --nap http://localhost:8787
"""
import argparse
import csv
import hashlib
import os

from common import post_worker

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "scripts", "out", "demo")

# Khoảng giá (nghìn đồng) theo danh mục
GIA = {"áo": (149, 399), "đầm": (259, 699), "chân váy": (199, 449), "quần": (199, 499),
       "áo khoác": (299, 899), "set đồ": (299, 699), "đồ ngủ": (149, 349), "đồ bơi": (199, 459)}
SIZES = ["S", "M", "L", "XL"]
BANG_SIZE = [
    ["S", "40-47", "148-155", "78-82", "60-64", "84-88"],
    ["M", "48-53", "155-160", "82-86", "64-68", "88-92"],
    ["L", "54-59", "160-165", "86-90", "68-72", "92-96"],
    ["XL", "60-66", "165-170", "90-95", "72-77", "96-101"],
    ["Freesize", "40-58", "150-165", "", "", ""],
]


def so(seed, mod):
    """Số giả ổn định theo mã sản phẩm."""
    return int(hashlib.md5(seed.encode()).hexdigest(), 16) % mod


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("vao", nargs="?", default=os.path.join(ROOT, "scripts", "out", "san_pham_da_gan.csv"))
    ap.add_argument("--nap", help="URL của Worker, VD http://localhost:8787")
    args = ap.parse_args()

    rows = list(csv.DictReader(open(args.vao, encoding="utf-8-sig")))
    os.makedirs(OUT, exist_ok=True)
    products, variants = [], []
    for r in rows:
        ma = r["ma_sp"]
        lo, hi = GIA.get(r.get("danh_muc", ""), (199, 499))
        gia = (lo + so(ma, hi - lo + 1)) // 10 * 10 * 1000 + 9000  # VD 289000
        gia_goc = gia + (so(ma + "goc", 3) + 1) * 50000 if so(ma + "sale", 4) == 0 else ""
        trang_thai = "ngừng bán" if so(ma + "tt", 40) == 0 else "đang bán"
        products.append({
            **{k: v for k, v in r.items() if not k.startswith("kaggle_") and k not in ("anh", "gan_boi")},
            "anh_chinh_url": r.get("anh", ""), "gia_ban": gia, "gia_goc": gia_goc, "trang_thai": trang_thai,
        })
        sizes = ["Freesize"] if r.get("dang") == "rộng/oversize" and so(ma + "fs", 3) == 0 else SIZES
        for s in sizes:
            ton = so(ma + s, 9) - 2  # khoảng 1/4 biến thể hết hàng
            variants.append({"ma_bien_the": f"{ma}-{s}", "ma_sp": ma, "mau": r.get("mau_chinh", ""),
                             "size": s, "ton_kho": max(ton, 0)})

    files = {}
    for name, data, fields in [
        ("san_pham", products, list(products[0].keys())),
        ("bien_the", variants, list(variants[0].keys())),
        ("bang_size", [dict(zip(["size", "can_nang_kg", "chieu_cao_cm", "vong_1_cm", "vong_2_cm", "vong_3_cm"], b))
                       for b in BANG_SIZE], ["size", "can_nang_kg", "chieu_cao_cm", "vong_1_cm", "vong_2_cm", "vong_3_cm"]),
    ]:
        path = os.path.join(OUT, f"{name}.csv")
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            w.writerows(data)
        files[name] = open(path, encoding="utf-8").read()
        print(f"{name}: {len(data)} dòng -> {path}")

    if args.nap:
        res = post_worker(args.nap, "/admin/import", files)
        print("Đã nạp:", {k: v for k, v in res.items() if k != "canh_bao"})
        for w in res.get("canh_bao", [])[:20]:
            print("  cảnh báo:", w)


if __name__ == "__main__":
    main()
