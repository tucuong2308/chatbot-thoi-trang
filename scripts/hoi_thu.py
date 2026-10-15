"""Hỏi thử bot qua endpoint /chat (không cần Facebook) và in ra bot đã tra cứu những gì.

Chạy:  python scripts/hoi_thu.py "đầm đi biển dưới 400k" "mẫu đầu còn size M không"
       (mọi câu trong cùng một lần chạy là một cuộc hội thoại)
Tuỳ chọn: --url http://localhost:8787  --user ten_khach
"""
import argparse
import json
import time
import uuid

from common import post_worker


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cau", nargs="+")
    ap.add_argument("--url", default="http://localhost:8787")
    ap.add_argument("--user", default=f"thu-{uuid.uuid4().hex[:6]}")
    args = ap.parse_args()

    for cau in args.cau:
        t = time.time()
        res = post_worker(args.url, "/chat", {"user": args.user, "text": cau})
        print(f"\n>>> KHÁCH: {cau}")
        for step in res.get("trace", []):
            kq = step["ket_qua"]
            if kq.get("loi"):
                tom_tat = kq["loi"]
            elif "tong_so_khop" in kq:
                tom_tat = f"{kq['tong_so_khop']} món khớp, trả {len(kq.get('san_pham', []))}, điểm kênh {kq.get('diem_cac_kenh')}"
            elif "da_xem" in kq:
                tom_tat = f"xem {kq['da_xem']} ảnh, hợp {[h['ma_sp'] for h in kq.get('hop', [])]}"
            else:
                tom_tat = f"{kq.get('so_dong')} dòng"
            print(f"    [{step['cong_cu']}] {json.dumps(step['tham_so'], ensure_ascii=False)}")
            print(f"        -> {tom_tat}")
        for msg in res.get("interim", []):
            print(f"<<< BOT (nhắn tạm): {msg}")
        print(f"<<< BOT ({res.get('model')}, {time.time() - t:.1f}s): {res['text']}")


if __name__ == "__main__":
    main()
