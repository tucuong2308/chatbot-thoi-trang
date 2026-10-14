-- Bản sao danh mục từ Google Sheets. Worker xóa và nạp lại toàn bộ mỗi lần đồng bộ,
-- nên đừng sửa tay ở đây: sửa trong Sheets.

CREATE TABLE san_pham (
  ma_sp         TEXT PRIMARY KEY,
  ten_sp        TEXT NOT NULL,
  anh_chinh_url TEXT,
  gia_ban       INTEGER NOT NULL,
  gia_goc       INTEGER,
  gioi_tinh     TEXT,
  danh_muc      TEXT,
  kieu_sp       TEXT,
  kieu_co       TEXT,
  tay_ao        TEXT,
  do_dai        TEXT,
  dang          TEXT,
  chat_lieu     TEXT,
  hoa_tiet      TEXT,
  mau_chinh     TEXT,
  phong_cach    TEXT,
  mua           TEXT,
  co_gian       TEXT,
  dip           TEXT,  -- nhiều giá trị, cách nhau dấu phẩy (để hiển thị; lọc bằng bảng san_pham_dip)
  chi_tiet      TEXT,  -- như trên, lọc bằng bảng san_pham_chi_tiet
  mo_ta_tu_do   TEXT,
  trang_thai    TEXT
);

-- Cột nhiều giá trị tách thành từng dòng để lọc chính xác.
CREATE TABLE san_pham_dip (ma_sp TEXT NOT NULL, dip TEXT NOT NULL, PRIMARY KEY (ma_sp, dip));
CREATE TABLE san_pham_chi_tiet (ma_sp TEXT NOT NULL, chi_tiet TEXT NOT NULL, PRIMARY KEY (ma_sp, chi_tiet));

CREATE TABLE bien_the (
  ma_bien_the TEXT,
  ma_sp       TEXT NOT NULL,
  mau         TEXT,
  size        TEXT,
  ton_kho     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX bien_the_ma_sp ON bien_the (ma_sp);

CREATE TABLE bang_size (
  size         TEXT,
  can_nang_kg  TEXT,
  chieu_cao_cm TEXT,
  vong_1_cm    TEXT,
  vong_2_cm    TEXT,
  vong_3_cm    TEXT
);

-- Vector embedding của sản phẩm: kieu = 'mo_ta' (từ chữ) hoặc 'anh' (từ ảnh).
-- v là Float32 dạng base64. Nạp bằng scripts/embed_products.py, không bị xóa khi đồng bộ Sheets.
CREATE TABLE vec (
  ma_sp TEXT NOT NULL,
  kieu  TEXT NOT NULL,
  v     TEXT NOT NULL,
  PRIMARY KEY (ma_sp, kieu)
);

CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);
