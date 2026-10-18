import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { napMau } from "./setup";

it("D1 có đủ bảng và dữ liệu mẫu", async () => {
  await napMau(env);
  expect((await env.DB.prepare("SELECT count(*) c FROM bien_the WHERE ma_sp = 'SP1'").first())?.c).toBe(3);
  expect((await env.DB.prepare("SELECT count(*) c FROM don_hang").first())?.c).toBe(0);
});
