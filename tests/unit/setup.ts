import { applyD1Migrations, env } from "cloudflare:test";
import type { Env } from "../../src/types";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

/** Hai món mẫu: SP1 nhiều màu (M/Đỏ 3, M/Xanh 0, L/Đỏ 10), SP2 một màu (S 2). */
export async function napMau(e: Env) {
  await e.DB.batch([
    e.DB.prepare("DELETE FROM san_pham"),
    e.DB.prepare("DELETE FROM bien_the"),
    e.DB.prepare(`INSERT INTO san_pham (ma_sp, ten_sp, gia_ban, trang_thai) VALUES
      ('SP1', 'Đầm hoa', 300000, 'đang bán'), ('SP2', 'Áo trơn', 200000, 'đang bán')`),
    e.DB.prepare(`INSERT INTO bien_the (ma_bien_the, ma_sp, mau, size, ton_kho) VALUES
      ('SP1-M-DO', 'SP1', 'Đỏ', 'M', 3), ('SP1-M-XANH', 'SP1', 'Xanh', 'M', 0), ('SP1-L-DO', 'SP1', 'Đỏ', 'L', 10),
      ('SP2-S', 'SP2', '', 'S', 2)`),
  ]);
}
