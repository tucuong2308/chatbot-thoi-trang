import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Test chạy trong runtime Workers (Miniflare) với D1/KV cục bộ; mỗi file test có kho dữ liệu riêng.
export default defineConfig(async () => {
  const migrations = await readD1Migrations("migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations, TELEGRAM_BOT_TOKEN: "123:abc" } },
      }),
    ],
    test: { include: ["tests/unit/**/*.test.ts"], setupFiles: ["tests/unit/setup.ts"] },
  };
});
