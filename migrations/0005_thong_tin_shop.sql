-- Thông tin shop do chủ shop ghi ở trang ThongTinShop của Google Sheets (đổi trả, địa chỉ, giờ làm việc...).
-- Bot đưa nguyên bảng này vào prompt để trả lời câu hỏi về shop mà không phải tra cứu.
CREATE TABLE thong_tin_shop (
  stt INTEGER PRIMARY KEY,
  chu_de TEXT NOT NULL,
  noi_dung TEXT NOT NULL
);
