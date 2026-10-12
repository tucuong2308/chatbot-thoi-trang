export interface Env {
  SHOP_KV: KVNamespace;
  VECTORS: VectorizeIndex;
  SHOP_NAME: string;
  GEMINI_MODEL: string;
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

/** Một dòng trong sheet SanPham (tên cột giữ nguyên như bảng tính). */
export interface Product {
  ma_sp: string;
  ten_sp: string;
  anh_chinh_url: string;
  gia_ban: number;
  gia_goc?: number;
  gioi_tinh?: string;
  danh_muc?: string;
  kieu_sp?: string;
  kieu_co?: string;
  tay_ao?: string;
  do_dai?: string;
  dang?: string;
  chat_lieu?: string;
  hoa_tiet?: string;
  mau_chinh?: string;
  phong_cach?: string;
  dip: string[];
  mua?: string;
  chi_tiet: string[];
  co_gian?: string;
  mo_ta_tu_do?: string;
  trang_thai?: string;
}

export interface Variant {
  ma_bien_the: string;
  ma_sp: string;
  mau: string;
  size: string;
  ton_kho: number;
}

export interface SizeRow {
  size: string;
  can_nang_kg: string;
  chieu_cao_cm: string;
  vong_1_cm: string;
  vong_2_cm: string;
  vong_3_cm: string;
}

export interface Catalog {
  updatedAt: string;
  products: Product[];
  variants: Variant[];
  sizes: SizeRow[];
}

/** Bộ lọc Gemini tách ra từ câu hỏi của khách. */
export interface SearchIntent {
  muc_dich: "tim_san_pham" | "hoi_size" | "hoi_chung" | "chao_hoi";
  cau_tim_kiem: string;
  danh_muc?: string;
  kieu_sp?: string;
  kieu_co?: string;
  tay_ao?: string;
  do_dai?: string;
  dang?: string;
  mau_chinh?: string;
  chat_lieu?: string;
  phong_cach?: string;
  dip?: string;
  gia_max?: number;
  gia_min?: number;
  size?: string;
}

export interface ChatTurn {
  role: "user" | "model";
  text: string;
}
