export interface Env {
  SHOP_KV: KVNamespace;
  DB: D1Database;
  /** Ảnh trong thư mục public/ (Workers Static Assets), VD /anh/SP0001.jpg */
  ASSETS: Fetcher;
  /** Hàng đợi tin nhắn Messenger: xử lý ở consumer để có đủ thời gian (xem ảnh, nhiều vòng tra cứu). */
  HANG_DOI: Queue<TinNhanMessenger>;
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

/** Số token của một lần gọi model (theo trường usage của API kiểu OpenAI). */
export interface TokenUsage {
  vao: number;
  ra: number;
  suy_nghi: number;
  vao_cache: number;
}

export interface TinNhanMessenger {
  senderId: string;
  text: string;
}
