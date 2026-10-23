import { appendHistory, type BotReply, handleUserMessage } from "./agent";
import { huyDon, xacNhanDon } from "./donhang/don";
import { tomTatDon } from "./donhang/kiemtra";
import { ghiHoiThoai } from "./hoithoai";
import type { DinhKem, DonNhap, Env, TinGui } from "./types";

/** Tên gọi từng loại đính kèm, để bot nói đúng thứ khách gửi. */
const TEN_DINH_KEM: Record<DinhKem, string> = { anh: "ảnh", thoai: "tin nhắn thoại", video: "video", tep: "tệp", sticker: "sticker" };

/** Trả lời tin chỉ có ảnh / thoại / video / tệp, không cần gọi model (bot chưa xem, nghe được). */
function traLoiDinhKem(dk: DinhKem): string {
  if (dk === "anh") {
    return "Dạ em chưa xem được ảnh ạ. Anh/chị tả giúp em kiểu dáng, màu, chất liệu hoặc tầm giá, " +
      "hoặc gửi mã sản phẩm nếu có, em tìm mẫu giống nhất cho mình nhé.";
  }
  return `Dạ em chưa ${dk === "thoai" ? "nghe" : "mở"} được ${TEN_DINH_KEM[dk]} ạ, anh/chị nhắn chữ giúp em nhé.`;
}

/**
 * Câu chữ đưa cho model khi tin có đính kèm: sticker coi như một câu cảm thán; ảnh / thoại kèm chú thích thì báo
 * model là bot không xem được phần đính kèm. null: chỉ có đính kèm, trả lời cố định bằng traLoiDinhKem.
 */
function chuChoModel(text: string, dk?: DinhKem): string | null {
  if (!dk) return text;
  if (dk === "sticker") return text || "(Khách gửi một sticker)";
  if (!text) return null;
  return `(Khách gửi kèm ${TEN_DINH_KEM[dk]}, em không xem được) ${text}`;
}

/** Nút "Sửa lại" gửi câu chữ này như khách tự nhắn, để model hỏi khách muốn đổi gì. */
export const SUA_LAI = "Em muốn sửa lại đơn";

function nutXacNhan(nhap: DonNhap): TinGui[] {
  return [
    { loai: "chu", chu: tomTatDon(nhap) },
    {
      loai: "nut",
      chu: "Anh/chị kiểm tra đơn giúp em ạ",
      nut: [{ tieu_de: "Xác nhận đặt hàng", payload: `DON:XAC_NHAN:${nhap.id}` }, { tieu_de: "Sửa lại", payload: SUA_LAI }],
    },
  ];
}

/** Khách bấm nút DON:...: tạo / hủy đơn bằng code, không qua model, để đơn chỉ ra đời khi khách thật sự bấm. */
async function xuLyNut(env: Env, khach: string, payload: string): Promise<{ bam: string; tin: TinGui[] }> {
  const [, lenh, thamSo = ""] = payload.match(/^DON:([A-Z_]+):(.*)$/) ?? [];
  if (lenh === "XAC_NHAN") {
    const r = await xacNhanDon(env, khach, thamSo);
    const bam = "Bấm: Xác nhận đặt hàng";
    if (r.kq === "da_tao") {
      return { bam, tin: [{ loai: "chu", chu: `Dạ shop đã nhận đơn ${r.ma_don}, thanh toán khi nhận hàng. Hàng sẽ tới trong khoảng 1-2 ngày ạ. Cảm ơn anh/chị!` }] };
    }
    if (r.kq === "da_co") return { bam, tin: [{ loai: "chu", chu: `Dạ đơn ${r.ma_don} đã được ghi nhận rồi ạ.` }] };
    if (r.kq === "cu") {
      return {
        bam,
        tin: [
          { loai: "chu", chu: "Dạ tóm tắt này đã cũ, anh/chị xác nhận giúp em đơn mới nhất nhé." },
          ...(r.nhap ? nutXacNhan(r.nhap) : [{ loai: "chu" as const, chu: "Anh/chị nhắn em món cần đặt nhé." }]),
        ],
      };
    }
    return {
      bam,
      tin: [
        { loai: "chu", chu: ["Dạ có thay đổi so với lúc nãy:", ...r.loi.map((l) => `- ${l}`)].join("\n") },
        ...(r.nhap ? nutXacNhan(r.nhap) : [{ loai: "chu" as const, chu: "Anh/chị chọn giúp em món khác nhé." }]),
      ],
    };
  }
  if (lenh === "HUY") {
    const r = await huyDon(env, khach, thamSo);
    return {
      bam: "Bấm: Xác nhận hủy",
      tin: [{
        loai: "chu",
        chu: r.ok ? `Dạ em đã hủy đơn ${thamSo}. Nếu hàng đã được gửi đi, nhân viên shop sẽ liên hệ anh/chị ạ.` : `Dạ ${r.loi} ạ.`,
      }],
    };
  }
  return { bam: `Bấm: ${payload}`, tin: [{ loai: "chu", chu: "Dạ em chưa hiểu, anh/chị nhắn lại giúp em nhé." }] };
}

function tinTuTraLoi(reply: BotReply): TinGui[] {
  const tin: TinGui[] = [{ loai: "chu", chu: reply.text }];
  if (reply.the_san_pham.length) tin.push({ loai: "the", the: reply.the_san_pham });
  if (reply.don_nhap) tin.push(...nutXacNhan(reply.don_nhap.nhap));
  if (reply.yeu_cau_huy) {
    tin.push({
      loai: "nut",
      chu: `Anh/chị chắc chắn muốn hủy đơn ${reply.yeu_cau_huy}?`,
      nut: [{ tieu_de: "Xác nhận hủy", payload: `DON:HUY:${reply.yeu_cau_huy}` }],
    });
  }
  return tin;
}

const chuCuaTin = (t: TinGui) => (t.loai === "the" ? `[thẻ] ${t.the.map((c) => c.ma_sp).join(", ")}` : t.chu);

/**
 * Một tin khách gửi tới (chữ, hoặc nút bấm). Nút có payload "DON:..." do code xử lý; mọi thứ khác (kể cả nút
 * trên thẻ sản phẩm, nút Sửa lại) là câu chữ cho model. Trả về các tin cần gửi theo thứ tự; ghi cả hai chiều vào
 * nhật ký hội thoại để lưu kèm đơn.
 */
export async function handleIncoming(
  env: Env, khach: string, vao: { text?: string; payload?: string; dinh_kem?: DinhKem },
  hooks: { send?: (text: string) => Promise<void>; typing?: () => Promise<void> } = {},
): Promise<{ tin: TinGui[]; reply?: BotReply }> {
  if (vao.payload?.startsWith("DON:")) {
    const { bam, tin } = await xuLyNut(env, khach, vao.payload);
    await ghiHoiThoai(env, khach, "khach", bam);
    for (const t of tin) await ghiHoiThoai(env, khach, "bot", chuCuaTin(t));
    // Để lượt sau model biết đơn đã tạo / đã hủy.
    await appendHistory(env, khach, [{ role: "user", text: `(${bam})` }, { role: "model", text: tin.map(chuCuaTin).join("\n") }]);
    return { tin };
  }
  const goc = (vao.text ?? vao.payload ?? "").trim();
  const text = chuChoModel(goc, vao.dinh_kem);
  if (text === null) {
    const tl = traLoiDinhKem(vao.dinh_kem!);
    const khachGui = `(gửi ${TEN_DINH_KEM[vao.dinh_kem!]})`;
    await ghiHoiThoai(env, khach, "khach", khachGui);
    await ghiHoiThoai(env, khach, "bot", tl);
    // Để lượt sau model biết "mẫu này" là ảnh khách vừa gửi mà bot không xem được.
    await appendHistory(env, khach, [{ role: "user", text: khachGui }, { role: "model", text: tl }]);
    return { tin: [{ loai: "chu", chu: tl }] };
  }
  await ghiHoiThoai(env, khach, "khach", text);
  const reply = await handleUserMessage(env, khach, text, async (msg) => {
    await ghiHoiThoai(env, khach, "bot", msg);
    await hooks.send?.(msg);
  }, hooks.typing);
  const tin = tinTuTraLoi(reply);
  for (const t of tin) await ghiHoiThoai(env, khach, "bot", chuCuaTin(t));
  return { tin, reply };
}
