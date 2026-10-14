export interface Env {
  SHOP_KV: KVNamespace;
  DB: D1Database;
  SHOP_NAME: string;
  GEMINI_MODEL: string;
  GEMINI_MODEL_DU_PHONG?: string;
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
