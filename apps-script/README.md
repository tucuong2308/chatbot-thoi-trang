# Apps Script: nối Google Sheets với bot

Google Sheets là bản gốc của danh mục. Apps Script trong bảng tính gửi dữ liệu lên Worker; Worker kiểm tra,
ghi vào D1, rồi chạy nền việc tải ảnh (lưu bản riêng trên R2 nếu đã bật) và tạo vector cho món mới / vừa sửa. Bảng tính giữ ở chế độ riêng tư,
không cần "Công bố lên web".

```
Sheets ──(Bot > Đồng bộ ngay, hoặc 5 phút/lần nếu có sửa)──▶ POST /admin/import
   ▲                                                            │ ghi D1, trả về ô lỗi
   └──────────── tô đỏ ô lỗi, ghi trang NhatKy ◀────────────────┘
                                                                 └▶ hàng đợi chatbot-viec-nen:
                                                                    tải ảnh, tạo vector (Gemini)
```

## Cài đặt (một lần)

1. Tải `data/bo-cot-thuoc-tinh-thoi-trang.xlsx` lên Google Drive, mở bằng Google Sheets
   (Tệp > Lưu dưới dạng Google Trang tính). Giữ nguyên tên trang `SanPham`, `BienThe`, `BangSize`
   và tên cột ở dòng 1. Dòng 2 là giải thích, dữ liệu bắt đầu từ dòng 3.
2. Tiện ích > Apps Script. Xóa nội dung `Code.gs`, dán toàn bộ `Bot.gs` vào.
   Cài đặt dự án (biểu tượng bánh răng) > bật "Hiển thị tệp kê khai appsscript.json", rồi dán `appsscript.json`.
3. Lưu, tải lại bảng tính. Menu **Bot** hiện ra.
4. **Bot > Cài đặt kết nối**: dán địa chỉ Worker (VD `https://chatbot-thoi-trang.hidden-gems.workers.dev`)
   và `ADMIN_KEY`. Lần đầu Google sẽ hỏi quyền: đọc/sửa bảng tính này, gọi ra ngoài, tạo lịch chạy.
5. **Bot > Cập nhật danh sách giá trị**: dựng lại trang `DanhMuc` và danh sách thả xuống từ danh sách của bot.
6. **Bot > Đồng bộ ngay**, rồi **Bot > Bật tự đồng bộ (5 phút)** (lấy đơn mới và gửi danh mục khi có sửa).

## Chủ shop dùng hằng ngày

- **Thêm món**: gõ tên ở cột `ten_sp`, mã `ma_sp` tự điền. Chọn thuộc tính trong danh sách thả xuống.
  Cột `dip`, `chi_tiet` gõ nhiều giá trị cách nhau dấu phẩy.
- **Ảnh**: dán link ảnh vào `anh_chinh_url`. Link Google Drive được, nhưng file phải chia sẻ
  "Bất kỳ ai có đường liên kết". Bot tự tải ảnh về (tối đa 10 MB), không phụ thuộc link gốc nữa.
- **Ô tô đỏ**: di chuột vào xem ghi chú "Bot: ..." (VD giá trị không có trong danh sách, thiếu giá, trùng mã).
  Món thiếu giá hoặc trùng mã bị bỏ qua; giá trị lạ vẫn được nạp nhưng bot lọc theo thuộc tính đó sẽ không ra món.
- **Bot > Xem tiến độ**: số món đang chờ tải ảnh / tạo vector (món mới chỉ được tìm theo nghĩa khi đã có vector,
  thường trong vòng 1-2 phút) và các món bị lỗi ảnh.
- Trang `NhatKy`: mỗi lần đồng bộ một dòng, mới nhất ở trên.

## Đơn hàng

Khách đặt hàng trên Messenger (bấm "Xác nhận đặt hàng" trên tóm tắt đơn) thì đơn được lưu ngay trong bot, không cần duyệt.
Cứ 5 phút (cùng lịch tự đồng bộ), hoặc khi bấm **Bot > Lấy đơn mới ngay**, script kéo đơn về trang `DonHang`:

- Mỗi đơn một dòng, đơn mới nhất ở trên. Cột `hoi_thoai` là đoạn chat trước lúc đặt (tối đa 40 tin).
- Cột `trang_thai` là của nhân viên (VD ghi "Đang giao", "Hoàn thành"): bot chỉ ghi "Mới" lúc thêm dòng, không đọc
  và không ghi đè cột này. Khách hỏi đơn tới đâu thì bot luôn trả lời khoảng 1-2 ngày.
- **Dòng đỏ** là đơn khách đã hủy (cột `khach_huy` là lúc hủy). Nếu hàng đã gửi đi, nhân viên liên hệ khách.
- Mỗi đơn mới gửi một email tới Gmail đang cài script (đổi trong **Bot > Cài đặt kết nối**).
- Đơn không trừ tồn kho: nhân viên tự sửa cột `ton_kho` ở trang `BienThe`.

Lần đầu sau khi dán bản script mới, Google hỏi thêm quyền gửi email và xem địa chỉ email của bạn.

## Ghi chú kỹ thuật

- Mỗi lần đồng bộ ghi đè toàn bộ `san_pham`, `bien_the`, `bang_size` trong một transaction của D1;
  lỗi giữa chừng thì dữ liệu cũ vẫn còn. Vector và ảnh R2 không bị xóa, chỉ món đổi chữ hoặc đổi link ảnh mới làm lại
  (bảng `dong_bo`, migration `0002_dong_bo.sql`). Món xóa khỏi Sheets thì vector cũng bị xóa.
- Món đã lỗi (VD link ảnh chưa mở quyền) không bị thử lại ở các lần tự đồng bộ; "Đồng bộ ngay" thì thử lại.
- `ADMIN_KEY` và địa chỉ Worker nằm trong Script Properties (chỉ người sửa được script mới xem được).
- Vẫn dùng được cách cũ: đặt `SHEET_CSV_*` trong `wrangler.toml`, cron 15 phút đọc CSV đã công bố.
