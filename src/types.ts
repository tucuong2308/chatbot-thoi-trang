export interface Env {
  SHOP_KV: KVNamespace;
  DB: D1Database;
  /** Ảnh trong thư mục public/ (Workers Static Assets), VD /anh/SP0001.jpg */
  ASSETS: Fetcher;
  /** Hàng đợi tin nhắn Messenger / Telegram: xử lý ở consumer để có đủ thời gian (xem ảnh, nhiều vòng tra cứu). */
  HANG_DOI: Queue<TinNhanVao>;
  /** Việc chạy nền sau mỗi lần đồng bộ Sheets: tải ảnh về R2, tạo vector cho món mới / vừa sửa. */
  VIEC_NEN: Queue<ViecNen>;
  /** Ảnh sản phẩm tải từ link trong Sheets, phục vụ ở /r2/<key>. Không bắt buộc: chưa bật R2 thì dùng link gốc. */
  ANH?: R2Bucket;
  SHOP_NAME: string;
  GEMINI_MODEL: string;
  GEMINI_MODEL_DU_PHONG?: string;
  /** "openai" (API kiểu OpenAI: DeepSeek, NVIDIA...) hoặc "gemini". */
  LLM_NHA_CUNG_CAP?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  OPENAI_MODEL_DU_PHONG?: string;
  /** Khóa của API kiểu OpenAI (VD DeepSeek); không có thì dùng NVIDIA_API_KEY. */
  OPENAI_API_KEY?: string;
  NVIDIA_API_KEY?: string;
  /** "tat" để tắt suy nghĩ của DeepSeek ở vòng trò chuyện chính; mặc định bật (bước xem ảnh luôn tắt). */
  DEEPSEEK_SUY_NGHI?: string;
  /** Số ảnh mỗi lần gửi model nhìn (mặc định 16 với Gemini, 8 với API kiểu OpenAI). */
  ANH_MOI_LO?: string;
  /** Địa chỉ Worker trên mạng, để đổi ảnh dạng /anh/... thành link đầy đủ khi gửi Messenger. */
  DIA_CHI_CONG_KHAI?: string;
  EMBED_MODEL: string;
  EMBED_DIM: string;
  SHEET_CSV_SANPHAM: string;
  SHEET_CSV_BIENTHE: string;
  SHEET_CSV_BANGSIZE: string;
  GEMINI_API_KEY: string;
  FB_PAGE_TOKEN: string;
  FB_VERIFY_TOKEN: string;
  FB_APP_SECRET: string;
  /** Token bot Telegram (lấy từ @BotFather). Không có thì kênh Telegram tắt. */
  TELEGRAM_BOT_TOKEN?: string;
  ADMIN_KEY: string;
}

export interface ChatTurn {
  role: "user" | "model";
  text: string;
}

/** Một lần bot gọi công cụ, trả về ở /chat để kiểm tra bot đã tra cứu gì. */
export interface ToolTrace {
  cong_cu: string;
  tham_so: Record<string, unknown>;
  ket_qua: unknown;
}

/** Một món bot gợi ý, gửi qua Messenger dạng thẻ có ảnh. */
export interface ProductCard {
  ma_sp: string;
  ten_sp: string;
  /** VD "389.000đ (giảm từ 439.000đ)" */
  gia: string;
  /** Các size còn hàng, VD "S, M, L"; rỗng nếu hết hàng. */
  size: string;
  /** Link ảnh đầy đủ (http...), rỗng nếu không có. */
  anh: string;
}

/** Số token của một lần gọi model (theo trường usage của API kiểu OpenAI). */
export interface TokenUsage {
  vao: number;
  ra: number;
  suy_nghi: number;
  vao_cache: number;
}

/** Một món cần tải ảnh và/hoặc tạo vector (xem src/dongbo.ts). */
export interface ViecNen {
  loai: "san_pham";
  ma_sp: string;
}

export interface TinNhanMessenger {
  senderId: string;
  text: string;
  /** Payload của nút khách bấm (postback). */
  payload?: string;
}

export interface TinNhanTelegram {
  kenh: "tg";
  chatId: string;
  text: string;
  /** Có khi khách bấm nút (callback_query), đã mở lại thành payload đầy đủ. */
  payload?: string;
  /** Id lần bấm nút, để tắt vòng xoay trên nút. */
  callbackId?: string;
}

export type TinNhanVao = TinNhanMessenger | TinNhanTelegram;

/** Một dòng trong đơn: một biến thể (mã, size, màu) kèm số lượng và giá lúc soạn. */
export interface MonDat {
  ma_sp: string;
  ten_sp: string;
  size: string;
  /** Rỗng khi món chỉ có một màu. */
  mau: string;
  so_luong: number;
  don_gia: number;
}

export interface NguoiNhan {
  ten: string;
  sdt: string;
  dia_chi: string;
}

/** Nội dung tóm tắt đơn mới nhất khách chưa xác nhận (xem GLOSSARY.md). */
export interface DonNhap extends NguoiNhan {
  id: string;
  mon: MonDat[];
  ghi_chu: string;
  tien_hang: number;
  tao_luc: number;
}

/** Một tin trong nhật ký hội thoại, lưu kèm đơn hàng. */
export interface DongHoiThoai {
  vai: "khach" | "bot";
  chu: string;
  luc: number;
}

/** Một tin cần gửi cho khách, theo thứ tự. */
export type TinGui =
  | { loai: "chu"; chu: string }
  | { loai: "the"; the: ProductCard[] }
  | { loai: "nut"; chu: string; nut: { tieu_de: string; payload: string }[] };
