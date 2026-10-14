"""Cho Gemini nhìn ảnh từng sản phẩm và điền cột thuộc tính.

Đầu vào: CSV có ít nhất cột ma_sp, ten_sp và anh (đường dẫn file ảnh trong máy hoặc link http).
Đầu ra:  scripts/out/san_pham_da_gan.csv, mở bằng Excel để kiểm tra rồi dán vào sheet SanPham.

Chạy:  python scripts/tag_products.py duong_dan/san_pham.csv
"""
import base64
import csv
import json
import mimetypes
import os
import sys
import time
import urllib.request

from common import gemini, load_env

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMA = json.load(open(os.path.join(ROOT, "data", "gemini-schema-thuoc-tinh.json"), encoding="utf-8"))
MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
COLUMNS = list(SCHEMA["properties"].keys())

PROMPT = """Bạn là nhân viên nhập liệu của một shop thời trang ở Việt Nam.
Nhìn ảnh sản phẩm và điền thuộc tính theo schema. Chỉ chọn giá trị có trong danh sách cho phép.
- Không nhìn rõ thì chọn giá trị gần nhất. Với quần, chân váy: kieu_co và tay_ao chọn "không áp dụng".
- dip: chọn mọi dịp phù hợp theo chuẩn ăn mặc ở Việt Nam. Đi chùa hay gặp gia đình: không hở vai, không ngắn trên gối.
- mo_ta_tu_do: 2-3 câu tiếng Việt tả kiểu dáng, màu, chất liệu, dịp mặc.
Tên sản phẩm (tham khảo): {ten}"""


def read_image(src):
    if src.startswith("http"):
        with urllib.request.urlopen(src, timeout=60) as r:
            return r.read(), r.headers.get_content_type()
    return open(src, "rb").read(), mimetypes.guess_type(src)[0] or "image/jpeg"


def tag(row, key):
    data, mime = read_image(row["anh"])
    body = {
        "contents": [{"role": "user", "parts": [
            {"inline_data": {"mime_type": mime, "data": base64.b64encode(data).decode()}},
            {"text": PROMPT.format(ten=row.get("ten_sp", ""))},
        ]}],
        "generationConfig": {"responseMimeType": "application/json", "responseSchema": SCHEMA, "temperature": 0},
    }
    res = gemini(MODEL, "generateContent", body, key)
    return json.loads(res["candidates"][0]["content"]["parts"][0]["text"])


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    key = load_env()
    rows = list(csv.DictReader(open(sys.argv[1], encoding="utf-8-sig")))
    os.makedirs(os.path.join(ROOT, "scripts", "out"), exist_ok=True)
    out_path = os.path.join(ROOT, "scripts", "out", "san_pham_da_gan.csv")
    fields = list(rows[0].keys()) + [c for c in COLUMNS if c not in rows[0]] + ["gan_boi"]

    with open(out_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for i, row in enumerate(rows, 1):
            print(f"[{i}/{len(rows)}] {row['ma_sp']} {row.get('ten_sp', '')}")
            attrs = tag(row, key)
            for k, v in attrs.items():
                row[k] = ", ".join(v) if isinstance(v, list) else v
            row["gan_boi"] = "ai"
            w.writerow(row)
            time.sleep(4)  # gói miễn phí giới hạn số lượt mỗi phút
    print("Xong:", out_path)


if __name__ == "__main__":
    main()
