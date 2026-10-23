-- Tin khách chờ bot trả lời. Webhook ghi vào đây rồi hẹn hàng đợi xử lý sau vài giây, để các tin nhắn liền nhau
-- của cùng một khách được gộp thành một lượt (xem src/gomtin.ts).
CREATE TABLE tin_cho (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  khach   TEXT NOT NULL,     -- VD fb:<PSID>, tg:<chat id>
  du_lieu TEXT NOT NULL,     -- JSON TinNhanMessenger
  luc     INTEGER NOT NULL
);
CREATE INDEX tin_cho_khach ON tin_cho (khach, id);

-- Khách đang được bot trả lời: mỗi khách chỉ một lượt chạy tại một thời điểm. Hết hạn thì coi như đã nhả
-- (phòng khi lượt trước bị dừng giữa chừng).
CREATE TABLE khach_dang_xu_ly (
  khach   TEXT PRIMARY KEY,
  het_han INTEGER NOT NULL
);

-- Khách cần nhân viên (đổi trả, phí ship, mua sỉ, khiếu nại...). Apps Script kéo về trang HoTro và gửi email.
CREATE TABLE ho_tro (
  ma        TEXT PRIMARY KEY,  -- HT-YYMMDD-NNN, ngày theo giờ Việt Nam
  khach     TEXT NOT NULL,
  ly_do     TEXT NOT NULL,
  sdt       TEXT NOT NULL DEFAULT '',
  hoi_thoai TEXT NOT NULL,     -- JSON: các tin gần nhất [{vai, chu, luc}]
  tao_luc   INTEGER NOT NULL,
  cap_nhat  INTEGER NOT NULL
);
CREATE INDEX ho_tro_khach ON ho_tro (khach, tao_luc);
CREATE INDEX ho_tro_cap_nhat ON ho_tro (cap_nhat);
