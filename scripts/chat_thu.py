"""Nhắn tin với bot như khách thật, ngay trên terminal: thấy thẻ sản phẩm, bấm nút, hội thoại tự lưu lại.

Gọi endpoint /chat của Worker (cần ADMIN_KEY trong biến môi trường, .dev.vars hoặc scripts/.env).
Địa chỉ bot: --url, hoặc biến môi trường BOT_URL, mặc định http://localhost:8787.

Chat liên tục (gõ tin, Enter để gửi):
    python scripts/chat_thu.py
    Lệnh: /1 /2 ... bấm nút theo số   /moi khách mới   /thoat thoát

Từng lượt một (để script hoặc agent khác điều khiển):
    python scripts/chat_thu.py --khach kh01 "shop ơi có váy đi biển không"
    python scripts/chat_thu.py --khach kh01 --bam 2

Hội thoại lưu ở tests/eval/hoi_thoai/<khach>.md (nút bấm được nhớ trong <khach>.json).
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

from common import load_admin_key

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THU_MUC = os.path.join(ROOT, "tests", "eval", "hoi_thoai")


def goi_bot(url, khach, text=None, payload=None):
    body = {"user": khach, **({"payload": payload} if payload else {"text": text})}
    req = urllib.request.Request(
        url.rstrip("/") + "/chat", data=json.dumps(body, ensure_ascii=False).encode(), method="POST",
        headers={"content-type": "application/json", "x-admin-key": load_admin_key()},
    )
    t = time.time()
    try:
        with urllib.request.urlopen(req, timeout=300) as res:
            return json.load(res), time.time() - t
    except urllib.error.HTTPError as e:
        return {"loi": f"HTTP {e.code}: {e.read().decode()[:300]}"}, time.time() - t
    except (urllib.error.URLError, TimeoutError) as e:
        return {"loi": f"không gọi được bot: {e}"}, time.time() - t


def tom_tat_cong_cu(trace):
    """Một dòng cho mỗi lần bot gọi công cụ, để biết bot đã tra cứu gì."""
    out = []
    for b in trace or []:
        kq = b.get("ket_qua") or {}
        if kq.get("loi"):
            ket = f"lỗi: {kq['loi']}"
        elif "tong_so_khop" in kq:
            ket = f"{kq['tong_so_khop']} món khớp: " + ", ".join(s["ma_sp"] for s in kq.get("san_pham", []))
        elif "da_xem" in kq:
            ket = f"xem {kq['da_xem']} ảnh, hợp: " + ", ".join(h["ma_sp"] for h in kq.get("hop", []))
        elif "so_dong" in kq:
            ket = f"{kq['so_dong']} dòng"
        elif kq.get("ok"):
            ket = "ok"
        else:
            ket = json.dumps(kq, ensure_ascii=False)[:120]
        out.append(f"{b['cong_cu']} -> {ket}")
    return out


def hien_thi(res):
    """Đổi phản hồi của /chat thành các dòng chữ như khách thấy, kèm danh sách nút đánh số."""
    dong, nut = [], []
    if res.get("loi"):
        return [f"[LỖI] {res['loi']}"], []
    for m in res.get("interim") or []:
        dong.append(f"(nhắn tạm) {m}")
    for t in res.get("tin", []):
        if t["loai"] == "chu":
            dong.append(t["chu"])
        elif t["loai"] == "the":
            for c in t["the"]:
                dong.append(f"  [thẻ] [{c['ma_sp']}] {c['ten_sp']} · {c['gia']} · {('Size ' + c['size']) if c['size'] else 'Tạm hết hàng'}")
                for tieu_de, p in (("Hỏi thêm món này", f"Cho em hỏi thêm về mẫu [{c['ma_sp']}]"),
                                   ("Muốn mua món này", f"Em muốn mua mẫu [{c['ma_sp']}]")):
                    nut.append({"tieu_de": f"{tieu_de} [{c['ma_sp']}]", "payload": p})
                    dong.append(f"      ({len(nut)}) {tieu_de}")
        else:
            dong.append(t["chu"])
            for n in t["nut"]:
                nut.append(n)
                dong.append(f"      ({len(nut)}) {n['tieu_de']}")
    return dong, nut


def duong_dan(khach, duoi):
    os.makedirs(THU_MUC, exist_ok=True)
    return os.path.join(THU_MUC, f"{khach}.{duoi}")


def doc_trang_thai(khach):
    p = duong_dan(khach, "json")
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {"ma_bot": None, "nut": []}


def mot_luot(url, khach, text=None, bam=None):
    """Gửi một tin hoặc bấm một nút; in ra và ghi vào file hội thoại."""
    tt = doc_trang_thai(khach)
    if tt["ma_bot"] is None:
        tt["ma_bot"] = f"{khach}-{uuid.uuid4().hex[:6]}"  # mỗi khách mới là một cuộc chat mới phía bot
    if bam is not None:
        if not 1 <= bam <= len(tt["nut"]):
            print(f"Không có nút số {bam} (đang có {len(tt['nut'])} nút)")
            return
        n = tt["nut"][bam - 1]
        khach_noi = f"*(bấm: {n['tieu_de']})*"
        res, giay = goi_bot(url, tt["ma_bot"], payload=n["payload"])
    else:
        khach_noi = text
        res, giay = goi_bot(url, tt["ma_bot"], text=text)

    dong, nut = hien_thi(res)
    cong_cu = tom_tat_cong_cu(res.get("trace"))
    tt["nut"] = nut
    json.dump(tt, open(duong_dan(khach, "json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    print(f"\nKHÁCH: {khach_noi}")
    for c in cong_cu:
        print(f"   · {c}")
    print(f"BOT ({giay:.1f}s):")
    for d in dong:
        print(d)

    md = duong_dan(khach, "md")
    with open(md, "a", encoding="utf-8") as f:
        if os.path.getsize(md) == 0:
            f.write(f"# Hội thoại {khach}\n\nBot: {url} · mã khách phía bot: `{tt['ma_bot']}`\n\n")
        f.write(f"**Khách:** {khach_noi}\n\n")
        if cong_cu:
            f.write("".join(f"> công cụ: {c}\n" for c in cong_cu) + "\n")
        f.write(f"**Bot** ({giay:.1f}s):\n\n```\n" + "\n".join(dong) + "\n```\n\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("tin", nargs="?", help="Tin nhắn gửi bot (bỏ trống để chat liên tục)")
    ap.add_argument("--khach", help="Tên cuộc hội thoại, VD kh01 (mặc định tạo mới)")
    ap.add_argument("--bam", type=int, help="Bấm nút số N trong câu trả lời gần nhất")
    ap.add_argument("--url", default=os.environ.get("BOT_URL", "http://localhost:8787"))
    a = ap.parse_args()

    if a.tin or a.bam:
        if not a.khach:
            sys.exit("Chạy từng lượt thì cần --khach để nối các lượt với nhau")
        mot_luot(a.url, a.khach, text=a.tin, bam=a.bam)
        return

    khach = a.khach or time.strftime("chat-%m%d-%H%M%S")
    print(f"Đang nói chuyện với {a.url} (hội thoại: {khach}). /1 /2... bấm nút, /moi khách mới, /thoat thoát.")
    while True:
        try:
            s = input("\nBạn: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not s:
            continue
        if s == "/thoat":
            break
        if s == "/moi":
            khach = time.strftime("chat-%m%d-%H%M%S")
            print(f"Khách mới: {khach}")
            continue
        if s[0] == "/" and s[1:].isdigit():
            mot_luot(a.url, khach, bam=int(s[1:]))
        else:
            mot_luot(a.url, khach, text=s)
    print(f"\nĐã lưu: {duong_dan(khach, 'md')}")


if __name__ == "__main__":
    main()
