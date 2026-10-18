-- Theo dõi từng món giữa các lần đồng bộ từ Google Sheets, để chỉ tạo lại vector / tải lại ảnh khi món thay đổi.
-- Bảng này không bị xóa khi đồng bộ (khác san_pham, bien_the...).
CREATE TABLE dong_bo (
  ma_sp          TEXT PRIMARY KEY,
  chu_mong_muon  TEXT,  -- mã băm của đoạn chữ mô tả món ở lần đồng bộ gần nhất
  chu_da_tao     TEXT,  -- mã băm của đoạn chữ đã tạo vector mo_ta
  anh_mong_muon  TEXT,  -- link ảnh chủ shop ghi trong Sheet
  anh_da_luu     TEXT,  -- link ảnh đã tải về R2 và tạo vector anh
  anh_duong_dan  TEXT,  -- đường dẫn phục vụ ảnh đã lưu, VD /r2/anh/SP0001-1a2b3c4d.jpg
  loi            TEXT,  -- lỗi của lần xử lý gần nhất (tải ảnh, tạo vector), rỗng nếu ổn
  cap_nhat       TEXT
);
