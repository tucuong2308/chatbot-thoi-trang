import { describe, expect, it } from "vitest";
import { vnd } from "../../src/dinhdang";
import { chuanHoaSdt, loiDiaChi, maDon, ngayVN, tomTatDon } from "../../src/donhang/kiemtra";

describe("chuanHoaSdt", () => {
  it("nhận +84, 84, dấu cách, dấu chấm", () => {
    expect(chuanHoaSdt("+84 912 345 678")).toBe("0912345678");
    expect(chuanHoaSdt("0912.345.678")).toBe("0912345678");
    expect(chuanHoaSdt("84912345678")).toBe("0912345678");
  });
  it("từ chối số sai độ dài hoặc không bắt đầu bằng 0", () => {
    expect(chuanHoaSdt("091234567")).toBeNull();
    expect(chuanHoaSdt("02412345678")).toBeNull();
    expect(chuanHoaSdt("1912345678")).toBeNull();
    expect(chuanHoaSdt("09123abc78")).toBeNull();
  });
});

describe("loiDiaChi", () => {
  it("chấp nhận địa chỉ có số nhà / tên đường và tỉnh, kể cả viết không dấu, tên cũ, viết tắt", () => {
    expect(loiDiaChi("12 Lê Lợi, Quận 1, TP.HCM")).toBeNull();
    expect(loiDiaChi("thôn Đông, xã Yên Phong, bac ninh")).toBeNull();
    expect(loiDiaChi("số 5 ngõ 3, Thủ Dầu Một, Bình Dương")).toBeNull();
    expect(loiDiaChi("45 Trần Phú, HN")).toBeNull();
  });
  it("báo thiếu tỉnh/thành", () => {
    expect(loiDiaChi("12 Lê Lợi, Quận 1")).toMatch(/tỉnh|thành/);
  });
  it("báo thiếu số nhà / tên đường", () => {
    expect(loiDiaChi("Hà Nội")).toMatch(/số nhà|đường/);
  });
});

describe("mã đơn, ngày, giá", () => {
  it("ngày theo giờ Việt Nam", () => {
    expect(maDon(new Date("2026-10-18T20:00:00Z"), 7)).toBe("DH-261019-007");
    expect(ngayVN(Date.parse("2026-10-18T16:59:00Z"))).toBe("261018");
  });
  it("vnd", () => expect(vnd(1250000)).toBe("1.250.000đ"));
});

describe("tomTatDon", () => {
  const base = {
    id: "x", tao_luc: 0, ten: "Lan", sdt: "0912345678", dia_chi: "12 Lê Lợi, Huế", ghi_chu: "", tien_hang: 800000,
    mon: [
      { ma_sp: "SP1", ten_sp: "Đầm hoa", size: "M", mau: "Đỏ", so_luong: 2, don_gia: 300000 },
      { ma_sp: "SP2", ten_sp: "Áo trơn", size: "S", mau: "", so_luong: 1, don_gia: 200000 },
    ],
  };
  it("liệt kê món, tiền hàng, dòng phí ship, người nhận", () => {
    const t = tomTatDon(base);
    expect(t).toContain("[SP1] Đầm hoa · M · Đỏ × 2 = 600.000đ");
    expect(t).toContain("[SP2] Áo trơn · S × 1 = 200.000đ");
    expect(t).toContain("Tiền hàng: 800.000đ");
    expect(t).toContain("Chưa gồm phí ship, anh/chị trả phí ship cho bên giao hàng khi nhận.");
    expect(t).toContain("Lan · 0912345678 · 12 Lê Lợi, Huế");
    expect(t).not.toContain("Ghi chú");
  });
  it("có ghi chú thì thêm dòng ghi chú", () => {
    expect(tomTatDon({ ...base, ghi_chu: "giao giờ hành chính" })).toContain("Ghi chú: giao giờ hành chính");
  });
});
