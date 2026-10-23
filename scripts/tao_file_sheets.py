"""Tạo file Excel để tải lên Google Sheets: đúng mẫu data/bo-cot-thuoc-tinh-thoi-trang.xlsx (dòng 1 tên cột,
dòng 2 giải thích, dữ liệu từ dòng 3, giữ danh sách chọn và trang DanhMuc), điền sẵn 300 món demo bot đang bán.

Ảnh để dạng /anh/<ma_sp>.jpg (Worker tự phục vụ) và nội dung giữ nguyên như lúc nạp demo, nên lần đồng bộ đầu
dùng lại vector đã có, không tốn tiền tạo lại.

Đầu vào: data/bo-cot-thuoc-tinh-thoi-trang.xlsx, scripts/out/demo/*.csv (của tao_du_lieu_demo.py)
Đầu ra:  data/du-lieu-shop-demo.xlsx
Chạy:    python scripts/tao_file_sheets.py
"""
import csv
import os

from openpyxl import load_workbook
from openpyxl.styles import Alignment, Font, PatternFill

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAU = os.path.join(ROOT, "data", "bo-cot-thuoc-tinh-thoi-trang.xlsx")
DEMO = os.path.join(ROOT, "scripts", "out", "demo")
OUT = os.path.join(ROOT, "data", "du-lieu-shop-demo.xlsx")
SO = {"gia_ban", "gia_goc", "ton_kho", "gia_rieng"}


def doc(ten):
    with open(os.path.join(DEMO, ten), encoding="utf-8") as f:
        return list(csv.DictReader(f))


def dien(ws, rows, mac_dinh=None):
    """Xóa dòng mẫu từ dòng 3 rồi điền rows theo đúng thứ tự cột ở dòng 1 của trang."""
    cols = [c.value for c in ws[1] if c.value]
    for r in ws.iter_rows(min_row=3):
        for c in r:
            c.value = None
    for ri, row in enumerate(rows, 3):
        for ci, col in enumerate(cols, 1):
            v = row.get(col) or (mac_dinh or {}).get(col) or None
            if v is not None and col in SO:
                v = int(v)
            ws.cell(row=ri, column=ci, value=v)
    return len(rows)


wb = load_workbook(MAU)
n_sp = dien(wb["SanPham"], doc("san_pham.csv"), {"gan_boi": "ai"})
n_bt = dien(wb["BienThe"], doc("bien_the.csv"))
n_bs = dien(wb["BangSize"], doc("bang_size.csv"))

# ThongTinShop: bot trả lời câu hỏi về shop theo đúng trang này. Ô noi_dung để trống thì bot nói chưa có thông tin.
THONG_TIN = [
    ("Thanh toán", "Chỉ nhận thanh toán khi nhận hàng (COD)."),
    ("Phí ship", "Chưa gồm trong giá, khách trả cho bên giao hàng khi nhận; nhân viên shop báo phí cụ thể."),
    ("Thời gian giao hàng", "Khoảng 1-2 ngày sau khi đặt."),
    ("Đổi trả", ""),
    ("Địa chỉ cửa hàng", ""),
    ("Giờ làm việc", ""),
    ("Hotline", ""),
    ("Khuyến mãi đang chạy", ""),
]
tt = wb.create_sheet("ThongTinShop", 4)
for ci, (ten, ghi_chu, rong) in enumerate([("chu_de", "", 26), ("noi_dung", "Mỗi dòng một chủ đề. Để trống thì bot nói chưa có thông tin và nhờ nhân viên trả lời.", 90)], 1):
    h = tt.cell(row=1, column=ci, value=ten)
    h.fill, h.font = PatternFill("solid", fgColor="1F4E78"), Font(bold=True, color="FFFFFF")
    n = tt.cell(row=2, column=ci, value=ghi_chu or None)
    n.font, n.alignment = Font(italic=True, color="666666", size=9), Alignment(wrap_text=True)
    tt.column_dimensions["AB"[ci - 1]].width = rong
for ri, (chu_de, noi_dung) in enumerate(THONG_TIN, 3):
    tt.cell(row=ri, column=1, value=chu_de)
    tt.cell(row=ri, column=2, value=noi_dung or None).alignment = Alignment(wrap_text=True)
tt.freeze_panes = "A3"

wb.save(OUT)
print(f"{OUT}: {n_sp} sản phẩm, {n_bt} biến thể, {n_bs} dòng bảng size, {len(THONG_TIN)} chủ đề thông tin shop")
