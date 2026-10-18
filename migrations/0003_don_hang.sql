-- Đơn hàng khách đã xác nhận trên Messenger. Không bị xóa khi đồng bộ Sheets (catalog.ts chỉ nạp lại
-- san_pham, bien_the, bang_size). Thời gian lưu dạng mili giây.
CREATE TABLE don_hang (
  ma_don     TEXT PRIMARY KEY,           -- DH-YYMMDD-NNN, ngày theo giờ Việt Nam
  khach      TEXT NOT NULL,              -- VD fb:<PSID>
  nhap_id    TEXT NOT NULL UNIQUE,       -- đơn nháp đã xác nhận: chống tạo trùng khi bấm nút hai lần
  ten        TEXT NOT NULL,
  sdt        TEXT NOT NULL,
  dia_chi    TEXT NOT NULL,
  ghi_chu    TEXT NOT NULL DEFAULT '',
  tien_hang  INTEGER NOT NULL,
  trang_thai TEXT NOT NULL DEFAULT 'Mới', -- 'Mới' hoặc 'Khách hủy'
  hoi_thoai  TEXT NOT NULL,              -- JSON: các tin trước lúc đặt [{vai, chu, luc}]
  tao_luc    INTEGER NOT NULL,
  huy_luc    INTEGER,
  cap_nhat   INTEGER NOT NULL            -- để Sheets kéo các đơn mới / vừa hủy
);
CREATE INDEX don_hang_khach ON don_hang (khach);
CREATE INDEX don_hang_cap_nhat ON don_hang (cap_nhat);

CREATE TABLE don_hang_mon (
  ma_don   TEXT NOT NULL,
  stt      INTEGER NOT NULL,
  ma_sp    TEXT NOT NULL,
  ten_sp   TEXT NOT NULL,
  size     TEXT NOT NULL,
  mau      TEXT NOT NULL,
  so_luong INTEGER NOT NULL,
  don_gia  INTEGER NOT NULL,
  PRIMARY KEY (ma_don, stt)
);
