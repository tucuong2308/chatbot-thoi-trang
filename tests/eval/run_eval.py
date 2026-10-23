"""Chấm bot bằng bộ test độc lập tests/eval/cases.json (do một agent riêng viết, không xem code của bot).

Bot phải đang chạy (npm run dev). Mỗi case là một cuộc hội thoại mới.
- kieu_cham "san_pham": lấy các mã [SP...] bot gợi ý ở câu trả lời cuối (tối đa 3 mã đầu).
    trung_3: ít nhất một mã nằm trong chap_nhan.  chinh_xac: tỷ lệ mã gợi ý nằm trong chap_nhan.
- kieu_cham "hanh_vi": một model chấm (Gemini, nhiệt độ 0) chỉ thấy hội thoại, hanh_vi_mong_doi và câu trả lời, trả đạt / không đạt.
    Thêm (không bắt buộc) cong_cu_khong_goi / cong_cu_phai_goi: công cụ bot không được gọi / phải gọi ít nhất một ở lượt cuối,
    VD câu hỏi kiến thức chung thì không được tim_san_pham. Case chỉ đạt khi cả giám khảo lẫn phần này đều đạt.

Chạy:  python tests/eval/run_eval.py --url http://localhost:8787 --ten baseline [--bo cases_tu_nhien.json]
Kết quả: tests/eval/ket_qua/<ten>.json và <ten>.md
"""
import argparse
import json
import os
import re
import statistics
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "scripts"))
from common import gemini, load_env, post_worker  # noqa: E402

# Model chấm khác model của bot (và có hạn mức gọi riêng ở gói miễn phí).
JUDGE_MODELS = [os.environ.get("JUDGE_MODEL", "gemini-3.1-flash-lite")]
JUDGE_SCHEMA = {
    "type": "OBJECT",
    "properties": {"dat": {"type": "BOOLEAN"}, "ly_do": {"type": "STRING"}},
    "required": ["dat", "ly_do"],
}


def codes_in(text):
    seen = []
    for m in re.findall(r"\bSP[\w-]+", text):
        if m not in seen:
            seen.append(m)
    return seen


def judge(case, transcript, key):
    prompt = f"""Bạn là giám khảo nghiêm khắc chấm câu trả lời của một chatbot bán quần áo.
Chỉ dựa vào hội thoại và tiêu chí dưới đây; không suy đoán điều chatbot không nói.

Hội thoại:
{transcript}

Tiêu chí cho câu trả lời CUỐI của bot:
{case.get('hanh_vi_mong_doi', '')}

Cách chấm:
- Điều BẮT BUỘC: câu có "phải", "không được", hoặc yêu cầu nêu một thông tin cụ thể mà không kèm "nên"/"có thể".
- Điều KHUYẾN KHÍCH: câu có "nên", "có thể", "ví dụ". Thiếu điều khuyến khích KHÔNG làm trượt.
- dat = true khi đáp ứng mọi điều bắt buộc và không vi phạm điều "không được" nào.
- Đọc kỹ câu trả lời trước khi kết luận là vi phạm; trích đúng câu của bot trong ly_do."""
    body = {"contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json", "responseSchema": JUDGE_SCHEMA, "temperature": 0}}
    last = None
    for model in JUDGE_MODELS:
        try:
            res = gemini(model, "generateContent", body, key, retries=3)
            parts = res["candidates"][0]["content"]["parts"]
            return json.loads("".join(p.get("text", "") for p in parts if not p.get("thought")))
        except (SystemExit, Exception) as e:  # common.gemini báo lỗi bằng SystemExit; lỗi khác cũng không được dừng cả lần chạy
            last = str(e)
    return {"dat": False, "ly_do": f"không chấm được: {last}"}


def run_case(case, url, key, cho=0):
    """Chạy một case; Gemini báo vượt hạn mức (429) thì chờ rồi chạy lại cả case, tối đa 3 lần."""
    for attempt in range(4):
        out = run_case_once(case, url, key)
        if "loi" not in out or "429" not in out["loi"] or attempt == 3:
            break
        print(f"  {case['id']}: vượt hạn mức gọi Gemini, chờ 60s rồi chạy lại", flush=True)
        time.sleep(60)
    out["so_lan_chay"] = attempt + 1
    time.sleep(cho)
    return out


def kiem_tra_cong_cu(case, da_goi):
    """Lỗi dùng công cụ ở lượt cuối so với cong_cu_khong_goi / cong_cu_phai_goi của case (rỗng là đạt)."""
    loi = []
    cam = sorted({c for c in da_goi if c in case.get("cong_cu_khong_goi", [])})
    if cam:
        loi.append("không được gọi " + ", ".join(cam))
    phai = case.get("cong_cu_phai_goi", [])
    if phai and not any(c in phai for c in da_goi):
        loi.append("phải gọi một trong " + ", ".join(phai))
    return loi


def cham_hanh_vi(case, transcript, da_goi, key):
    v = judge(case, transcript, key)
    loi = kiem_tra_cong_cu(case, da_goi)
    return {"dat": bool(v.get("dat")) and not loi, "dat_giam_khao": bool(v.get("dat")), "ly_do_cham": v.get("ly_do", ""),
            "cong_cu_da_goi": da_goi, "loi_cong_cu": loi}


def compact_trace(t):
    """Một lần gọi công cụ ở lượt cuối, rút gọn kết quả để phân tích vì sao bot sai."""
    res = t.get("ket_qua")
    text = json.dumps(res, ensure_ascii=False)
    return {"cong_cu": t.get("cong_cu"), "tham_so": t.get("tham_so"), "ma_trong_ket_qua": codes_in(text)[:20], "ket_qua_rut_gon": text[:400]}


def run_case_once(case, url, key):
    user = f"eval-{uuid.uuid4().hex[:8]}"
    transcript, t0, steps, last, token = [], time.time(), 0, None, []
    try:
        for msg in case["hoi_thoai"]:
            t = time.time()
            last = post_worker(url, "/chat", {"user": user, "text": msg})
            last["_giay"] = round(time.time() - t, 1)
            steps += len(last.get("trace", []))
            token += last.get("token", [])
            transcript.append(f"Khách: {msg}")
            for m in last.get("interim", []):
                transcript.append(f"Bot (nhắn tạm): {m}")
            transcript.append(f"Bot: {last['text']}")
    except SystemExit as e:
        return {"id": case["id"], "loai": case.get("loai", "tu_nhien"), "loi": str(e)[:300], "giay": round(time.time() - t0, 1)}

    out = {"id": case["id"], "loai": case.get("loai", "tu_nhien"), "kieu_cham": case["kieu_cham"], "giay": round(time.time() - t0, 1),
           "giay_luot_cuoi": last["_giay"], "so_buoc_cong_cu": steps, "model": last.get("model"),
           "token": token, "cong_cu": [compact_trace(t) for t in last.get("trace", [])], "tra_loi": last["text"], "hoi_thoai_day_du": transcript, "da_xem_anh": any(s["cong_cu"] == "xem_anh" for s in last.get("trace", []))}
    if case["kieu_cham"] == "san_pham":
        ok = set(case.get("chap_nhan", []))
        top = codes_in(last["text"])[:3]
        out.update(goi_y=top, trung_3=bool(set(top) & ok),
                   chinh_xac=round(len([c for c in top if c in ok]) / len(top), 2) if top else 0.0)
    else:
        out.update(cham_hanh_vi(case, "\n".join(transcript), [t.get("cong_cu") for t in last.get("trace", [])], key))
    return out


def load_catalog():
    """Mã nào có thật và mã nào bán được (đang bán + còn hàng), lấy từ dữ liệu demo đang nạp vào bot."""
    import csv
    demo = os.path.join(HERE, "..", "..", "scripts", "out", "demo")
    sp = {r["ma_sp"]: r for r in csv.DictReader(open(os.path.join(demo, "san_pham.csv"), encoding="utf-8"))}
    stock = {r["ma_sp"] for r in csv.DictReader(open(os.path.join(demo, "bien_the.csv"), encoding="utf-8")) if int(r["ton_kho"]) > 0}
    sellable = {m for m, r in sp.items() if r["trang_thai"] == "đang bán" and m in stock}
    return set(sp), sellable


def objective_checks(results):
    """Kiểm tra không cần giám khảo: mã bịa (không có trong danh mục) và mã không bán được, trong câu trả lời cuối."""
    exists, sellable = load_catalog()
    for r in results:
        if "tra_loi" not in r:
            continue
        codes = codes_in(r["tra_loi"])
        r["ma_bia"] = [c for c in codes if c not in exists]
        r["ma_khong_ban_duoc"] = [c for c in codes if c in exists and c not in sellable]


def add_recall(results, cases):
    """bao_phu_3: số món đúng trong 3 món đầu / số món đúng tối đa có thể (min(3, số món chấp nhận)).
    Bù cho chinh_xac, vốn thưởng cho việc gợi ý ít món (gợi ý 1 món đúng được 1.0, gợi ý 3 món có 2 đúng chỉ được 0.67)."""
    by_id = {c["id"]: c for c in cases}
    for r in results:
        if r.get("kieu_cham") == "san_pham" and "goi_y" in r:
            ok = set(by_id[r["id"]]["chap_nhan"])
            r["bao_phu_3"] = round(len([c for c in r["goi_y"] if c in ok]) / min(3, len(ok)), 2) if ok else 0.0


def summarize(results):
    by = {}
    for r in results:
        by.setdefault(r["loai"], []).append(r)
    rows = []
    for loai, rs in sorted(by.items()):
        sp = [r for r in rs if r.get("kieu_cham") == "san_pham"]
        hv = [r for r in rs if r.get("kieu_cham") == "hanh_vi"]
        rows.append({
            "loai": loai, "so_case": len(rs), "loi_chay": len([r for r in rs if "loi" in r]),
            "trung_3": f"{sum(r['trung_3'] for r in sp)}/{len(sp)}" if sp else "",
            "chinh_xac_tb": round(statistics.mean(r["chinh_xac"] for r in sp), 2) if sp else "",
            "bao_phu_3_tb": round(statistics.mean(r["bao_phu_3"] for r in sp), 2) if sp else "",
            "hanh_vi_dat": f"{sum(r['dat'] for r in hv)}/{len(hv)}" if hv else "",
            "giay_tb": round(statistics.mean(r["giay"] for r in rs), 1),
            "case_bia_ma": len([r for r in rs if r.get("ma_bia")]),
        })
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8787")
    ap.add_argument("--ten", required=True, help="tên lần chạy, VD baseline hoặc agent")
    ap.add_argument("--song-song", type=int, default=1)
    ap.add_argument("--cho", type=int, default=15, help="số giây nghỉ sau mỗi case (gói Gemini miễn phí giới hạn lượt gọi mỗi phút)")
    ap.add_argument("--chi", help="chỉ chạy các id bắt đầu bằng chuỗi này")
    ap.add_argument("--bo", default="cases.json", help="file test trong tests/eval (VD cases_tu_nhien.json)")
    ap.add_argument("--tiep", action="store_true",
                    help="chạy tiếp lần --ten bị dừng giữa chừng: bỏ qua các case đã có trong ket_qua/<ten>.dang_chay.jsonl")
    ap.add_argument("--cham-lai", action="store_true",
                    help="không gọi bot: chấm lại các case hanh_vi của lần chạy --ten đã lưu bằng giám khảo hiện tại")
    args = ap.parse_args()

    key = load_env()
    cases = json.load(open(os.path.join(HERE, args.bo), encoding="utf-8"))
    if args.chi:
        cases = [c for c in cases if c["id"].startswith(args.chi)]
    if args.cham_lai:
        old = json.load(open(os.path.join(HERE, "ket_qua", f"{args.ten}.json"), encoding="utf-8"))["chi_tiet"]
        by_id = {c["id"]: c for c in cases}
        results = []
        for r in old:
            if r.get("kieu_cham") == "hanh_vi":
                c = by_id[r["id"]]
                transcript = r.get("hoi_thoai_day_du") or [f"Khách: {m}" for m in c["hoi_thoai"]] + [f"Bot: {r['tra_loi']}"]
                r.update(dat_cu=r.get("dat"), **cham_hanh_vi(c, "\n".join(transcript), [t["cong_cu"] for t in r.get("cong_cu", [])], key))
            results.append(r)
    else:
        # Ghi từng case ngay khi xong: lần chạy bị dừng giữa chừng thì --tiep chạy nốt, không trả tiền chạy lại.
        os.makedirs(os.path.join(HERE, "ket_qua"), exist_ok=True)
        dang_chay = os.path.join(HERE, "ket_qua", f"{args.ten}.dang_chay.jsonl")
        xong = {}
        if args.tiep and os.path.exists(dang_chay):
            for line in open(dang_chay, encoding="utf-8"):
                r = json.loads(line)
                if "loi" not in r:
                    xong[r["id"]] = r
            print(f"Chạy tiếp: {len(xong)} case đã xong, còn {len([c for c in cases if c['id'] not in xong])}", flush=True)
        elif os.path.exists(dang_chay):
            os.remove(dang_chay)

        def chay(c):
            if c["id"] in xong:
                return xong[c["id"]]
            r = run_case(c, args.url, key, args.cho)
            with open(dang_chay, "a", encoding="utf-8") as f:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
            print(f"  xong {c['id']}", flush=True)
            return r

        with ThreadPoolExecutor(args.song_song) as ex:
            results = list(ex.map(chay, cases))
    for r in results:
        mark = "LỖI" if "loi" in r else ("ĐÚNG" if r.get("trung_3", r.get("dat")) else "SAI")
        chi_tiet = r.get("goi_y") or "; ".join(r.get("loi_cong_cu", []) + [r.get("ly_do_cham", r.get("loi", ""))])
        print(f"{mark:4s} {r['id']:28s} {r['giay']:5.1f}s {chi_tiet!s:.140}")

    objective_checks(results)
    add_recall(results, cases)
    rows = summarize(results)
    ok = [r for r in results if "loi" not in r]
    sp = [r for r in ok if r["kieu_cham"] == "san_pham"]
    hv = [r for r in ok if r["kieu_cham"] == "hanh_vi"]
    times = sorted(r["giay_luot_cuoi"] for r in ok)
    tong = {
        "trung_3": f"{sum(r['trung_3'] for r in sp)}/{len(sp)}",
        "chinh_xac_tb": round(statistics.mean(r["chinh_xac"] for r in sp), 2) if sp else None,
        "bao_phu_3_tb": round(statistics.mean(r["bao_phu_3"] for r in sp), 2) if sp else None,
        "hanh_vi_dat": f"{sum(r['dat'] for r in hv)}/{len(hv)}",
        "loi_chay": len(results) - len(ok),
        "giay_moi_luot_trung_vi": statistics.median(times) if times else None,
        "giay_moi_luot_p90": times[int(len(times) * 0.9)] if times else None,
        "giay_moi_luot_max": times[-1] if times else None,
        "so_case_xem_anh": len([r for r in ok if r.get("da_xem_anh")]),
        "case_bia_ma": len([r for r in ok if r.get("ma_bia")]),
        "case_nhac_ma_khong_ban_duoc": len([r for r in ok if r.get("ma_khong_ban_duoc")]),
        "model": sorted({r["model"] for r in ok if r.get("model")}),
    }
    calls = [t for r in ok for t in r.get("token", [])]
    if calls:
        tong.update(
            so_lan_goi_model=len(calls),
            token_vao=sum(t["vao"] for t in calls), token_vao_cache=sum(t["vao_cache"] for t in calls),
            token_ra=sum(t["ra"] for t in calls), token_suy_nghi=sum(t["suy_nghi"] for t in calls),
        )

    os.makedirs(os.path.join(HERE, "ket_qua"), exist_ok=True)
    json.dump({"tong": tong, "theo_loai": rows, "chi_tiet": results},
              open(os.path.join(HERE, "ket_qua", f"{args.ten}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    md = [f"# Kết quả: {args.ten}", "", "| Loại | Số case | Trúng top 3 | Chính xác TB | Bao phủ top 3 TB | Hành vi đạt | Bịa mã | Giây TB | Lỗi chạy |", "|---|---|---|---|---|---|---|---|---|"]
    md += [f"| {r['loai']} | {r['so_case']} | {r['trung_3']} | {r['chinh_xac_tb']} | {r['bao_phu_3_tb']} | {r['hanh_vi_dat']} | {r['case_bia_ma']} | {r['giay_tb']} | {r['loi_chay']} |" for r in rows]
    md += ["", "Tổng: " + ", ".join(f"{k} = {v}" for k, v in tong.items())]
    open(os.path.join(HERE, "ket_qua", f"{args.ten}.md"), "w", encoding="utf-8").write("\n".join(md) + "\n")
    print("\n".join(md))


if __name__ == "__main__":
    main()
