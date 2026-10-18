import { vnd } from "../dinhdang";
import type { DonNhap } from "../types";

/** Bỏ dấu, chữ thường, chỉ giữ chữ và số cách nhau một dấu cách: "TP.Hồ Chí Minh" -> "tp ho chi minh". */
export function boDau(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
}

/** Số di động Việt Nam: 10 số bắt đầu bằng 0; nhận +84 / 84 ở đầu, dấu cách, dấu chấm, gạch ngang. */
export function chuanHoaSdt(s: string): string | null {
  const raw = s.trim();
  if (/[^\d\s.+\-()]/.test(raw)) return null;
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("84") && d.length === 11) d = "0" + d.slice(2);
  return /^0\d{9}$/.test(d) ? d : null;
}

// 63 tỉnh/thành trước 7/2025 và 34 tỉnh/thành hiện hành (đã bỏ dấu), cùng vài cách viết tắt hay gặp.
const TINH = [
  "an giang", "ba ria vung tau", "vung tau", "brvt", "bac giang", "bac kan", "bac can", "bac lieu", "bac ninh", "ben tre",
  "binh dinh", "binh duong", "binh phuoc", "binh thuan", "ca mau", "cao bang", "dak lak", "dac lac", "daklak", "dak nong",
  "dien bien", "dong nai", "dong thap", "gia lai", "ha giang", "ha nam", "ha tinh", "hai duong", "hau giang", "hoa binh",
  "hung yen", "khanh hoa", "kien giang", "kon tum", "lai chau", "lam dong", "lang son", "lao cai", "long an", "nam dinh",
  "nghe an", "ninh binh", "ninh thuan", "phu tho", "quang binh", "quang nam", "quang ngai", "quang ninh", "quang tri",
  "soc trang", "son la", "tay ninh", "thai binh", "thai nguyen", "thanh hoa", "thua thien hue", "hue", "tien giang",
  "tra vinh", "tuyen quang", "vinh long", "vinh phuc", "yen bai", "phu yen", "can tho", "da nang", "hai phong",
  "ha noi", "hn", "ho chi minh", "hcm", "tphcm", "tp hcm", "sai gon", "sg",
];
const DUONG = ["duong", "pho", "ngo", "ngach", "hem", "kiet", "thon", "xom", "ap", "ban", "khu", "to"];

/** null nếu địa chỉ dùng được; ngược lại là câu nêu chỗ thiếu. Địa chỉ gõ tự do, chỉ chặn trường hợp thiếu rõ ràng. */
export function loiDiaChi(s: string): string | null {
  const a = ` ${boDau(s)} `;
  if (!TINH.some((t) => a.includes(` ${t} `))) return "thiếu tỉnh/thành phố";
  const bo = a.replace(/ thanh pho /g, " ");
  if (!/\d/.test(bo) && !DUONG.some((w) => bo.includes(` ${w} `))) return "thiếu số nhà hoặc tên đường / thôn, xóm";
  return null;
}

/** YYMMDD theo giờ Việt Nam (UTC+7). */
export function ngayVN(ms: number): string {
  return new Date(ms + 7 * 3600_000).toISOString().slice(2, 10).replace(/-/g, "");
}

export function maDon(ngay: Date, stt: number): string {
  return `DH-${ngayVN(ngay.getTime())}-${String(stt).padStart(3, "0")}`;
}

/** Tin tóm tắt đơn nháp gửi khách trước khi bấm xác nhận. */
export function tomTatDon(d: DonNhap): string {
  return [
    "Đơn của anh/chị:",
    ...d.mon.map((m) => `- [${m.ma_sp}] ${[m.ten_sp, m.size, m.mau].filter(Boolean).join(" · ")} × ${m.so_luong} = ${vnd(m.don_gia * m.so_luong)}`),
    `Tiền hàng: ${vnd(d.tien_hang)}`,
    "Chưa gồm phí ship, anh/chị trả phí ship cho bên giao hàng khi nhận.",
    `Người nhận: ${d.ten} · ${d.sdt} · ${d.dia_chi}`,
    ...(d.ghi_chu ? [`Ghi chú: ${d.ghi_chu}`] : []),
  ].join("\n");
}
