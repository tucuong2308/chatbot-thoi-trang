import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { docHoiThoai, ghiHoiThoai } from "../../src/hoithoai";

it("chỉ giữ 40 tin cuối", async () => {
  for (let i = 0; i < 45; i++) await ghiHoiThoai(env, "fb:1", i % 2 ? "bot" : "khach", `tin ${i}`);
  const h = await docHoiThoai(env, "fb:1");
  expect(h).toHaveLength(40);
  expect(h[0]).toMatchObject({ vai: "bot", chu: "tin 5" });
  expect(h[39].chu).toBe("tin 44");
  expect(await docHoiThoai(env, "fb:khac")).toEqual([]);
});
