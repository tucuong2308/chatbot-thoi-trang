-- Đơn nháp mới nhất của mỗi khách (trước đây ở KV). Để trong D1 vì KV đọc ở nơi khác có thể trễ tới 60 giây:
-- bấm Xác nhận trên tóm tắt cũ ngay sau khi soạn lại vẫn phải bị từ chối. Hết hạn 7 ngày tính theo cap_nhat.
CREATE TABLE don_nhap (
  khach    TEXT PRIMARY KEY,
  du_lieu  TEXT NOT NULL,  -- JSON DonNhap
  cap_nhat INTEGER NOT NULL
);
