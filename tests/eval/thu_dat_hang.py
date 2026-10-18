"""Thử trọn một lần đặt hàng qua /chat (gọi model thật, tốn vài lượt DeepSeek, dưới 0,01 USD).

Bot phải đang chạy (npm run dev). Kịch bản: hỏi mua SP10002 size M -> đưa người nhận -> bấm Xác nhận ->
hỏi đơn tới đâu -> xin hủy -> bấm Xác nhận hủy. Kiểm tra: có nút xác nhận, bot không nói "đã đặt" trước khi bấm,
trả lời "1-2 ngày", đơn cuối cùng ở trạng thái Khách hủy.

Chạy:  python tests/eval/thu_dat_hang.py --url http://localhost:8787
"""
import argparse
import os
import re
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "scripts"))
from common import post_worker  # noqa: E402

DA_DAT = re.compile(r"đã (đặt|lên đơn|nhận đơn|tạo đơn)", re.I)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8787")
    url = ap.parse_args().url
    user = "dat-hang-" + uuid.uuid4().hex[:6]
    loi = []

    def gui(**kw):
        r = post_worker(url, "/chat", {"user": user, **kw})
        print(f"\n>>> {kw.get('text') or kw.get('payload')}")
        for t in r["tin"]:
            if t["loai"] == "chu":
                print(t["chu"])
            elif t["loai"] == "the":
                print("[thẻ]", ", ".join(c["ma_sp"] for c in t["the"]))
            else:
                print(f"[nút] {t['chu']} ->", ", ".join(f"{n['tieu_de']} ({n['payload']})" for n in t["nut"]))
        return r["tin"]

    def nut(tin, tien_to):
        return next((n["payload"] for t in tin if t["loai"] == "nut" for n in t["nut"] if n["payload"].startswith(tien_to)), None)

    def chu(tin):
        return "\n".join(t.get("chu", "") for t in tin)

    tin = gui(text="mình muốn mua [SP10002] size M")
    tin += gui(text="Nguyễn Thị Lan, 0912 345 678, 12 Lê Lợi, phường Thuận Hóa, Huế")
    xac_nhan = nut(tin, "DON:XAC_NHAN:")
    if not xac_nhan:
        tin += gui(text="đúng rồi, lên đơn giúp mình")
        xac_nhan = nut(tin, "DON:XAC_NHAN:")
    if DA_DAT.search(chu(tin)):
        loi.append("bot nói đã đặt trước khi khách bấm xác nhận")
    if not xac_nhan:
        loi.append("không có nút Xác nhận đặt hàng")
    else:
        tin = gui(payload=xac_nhan)
        ma = re.search(r"DH-\d{6}-\d{3}", chu(tin))
        if not ma:
            loi.append("bấm xác nhận mà không ra mã đơn")
        else:
            ma = ma.group(0)
            if "1-2 ngày" not in chu(gui(text="đơn của mình tới đâu rồi shop")):
                loi.append("câu trả lời 'đơn tới đâu' không có '1-2 ngày'")
            huy = nut(gui(text=f"mình muốn hủy đơn {ma}"), "DON:HUY:")
            if not huy:
                loi.append("không có nút Xác nhận hủy")
            else:
                gui(payload=huy)
                don = post_worker(url, "/admin/don-hang", {"tu": 0})["don"]
                trang_thai = next((d["trang_thai"] for d in don if d["ma_don"] == ma), None)
                if trang_thai != "Khách hủy":
                    loi.append(f"đơn {ma} có trạng thái {trang_thai}, cần Khách hủy")

    print("\n" + ("ĐẠT" if not loi else "KHÔNG ĐẠT:\n- " + "\n- ".join(loi)))
    sys.exit(1 if loi else 0)


if __name__ == "__main__":
    main()
