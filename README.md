# Chatbot thời trang (bản demo)

Trợ lý AI tư vấn quần áo trên Facebook Messenger. Bot hiểu câu như "váy trễ vai đi biển dưới 500k", tìm đúng món còn hàng trong kho của shop và gửi ảnh kèm lời tư vấn.

## Kiến trúc

```
Khách nhắn Messenger
   → Facebook gọi webhook → Cloudflare Worker (src/index.ts)
        1. Gemini tách câu hỏi thành bộ lọc (src/agent.ts)
        2. Lọc cứng theo thuộc tính + giá + tồn kho (src/search.ts)
        3. Xếp hạng theo nghĩa bằng Vectorize (embedding Gemini)
        4. Gemini viết lời tư vấn, chỉ dựa trên các món tìm được
   → Worker gọi Send API trả lời khách (src/messenger.ts)

Google Sheets (bản gốc, chủ shop sửa)
   → cron 15 phút đọc CSV → bản sao JSON trong KV (src/catalog.ts)
```

| Thư mục | Nội dung |
| --- | --- |
| `src/` | Code Worker (TypeScript) |
| `scripts/tag_products.py` | Cho Gemini nhìn ảnh, tự điền cột thuộc tính |
| `scripts/embed_products.py` | Tạo vector sản phẩm để nạp vào Vectorize |
| `data/bo-cot-thuoc-tinh-thoi-trang.xlsx` | Mẫu bảng tính: SanPham, BienThe, BangSize, DanhMuc |
| `data/gemini-schema-thuoc-tinh.json` | Danh sách giá trị cho phép, dùng chung cho script và bot |

## Cài đặt lần đầu

Cần Node.js 20+ và Python 3.10+.

```bash
npm install
npx wrangler login
npx wrangler kv namespace create SHOP_KV          # dán id vào wrangler.toml
npx wrangler vectorize create san-pham --dimensions=768 --metric=cosine
cp .dev.vars.example .dev.vars                    # điền key thật
```

## Chuẩn bị dữ liệu

1. Tải lên Google Sheets file `data/bo-cot-thuoc-tinh-thoi-trang.xlsx`, điền sản phẩm.
2. Chưa có thuộc tính? Xuất sheet SanPham ra CSV (thêm cột `anh` là đường dẫn ảnh), rồi chạy
   `python scripts/tag_products.py san_pham.csv`. Kiểm tra file kết quả, sửa dòng sai, dán lại vào sheet.
3. Tạo vector: `python scripts/embed_products.py san_pham_da_gan.csv`
   rồi `npx wrangler vectorize insert san-pham --file scripts/out/vectors.ndjson`.
4. Trong Google Sheets: Tệp > Chia sẻ > Công bố lên web, chọn từng sheet dạng CSV, dán link vào `SHEET_CSV_*` trong `wrangler.toml`.

Script Python đọc key từ `scripts/.env` (dòng `GEMINI_API_KEY=...`).

## Chạy thử không cần Facebook

```bash
npm run dev
curl -X POST localhost:8787/admin/sync -H "x-admin-key: <ADMIN_KEY>"
curl -X POST localhost:8787/chat -H "x-admin-key: <ADMIN_KEY>" \
     -H "content-type: application/json" \
     -d '{"user":"test","text":"tư vấn em áo trễ vai đi biển dưới 400k"}'
```

## Đưa lên mạng và nối Messenger

```bash
npx wrangler secret put GEMINI_API_KEY   # tương tự cho FB_PAGE_TOKEN, FB_VERIFY_TOKEN, FB_APP_SECRET, ADMIN_KEY
npm run deploy
```

Trong Meta for Developers > Messenger > Webhooks: URL `https://<worker>.workers.dev/webhook/messenger`, verify token = `FB_VERIFY_TOKEN`, đăng ký sự kiện `messages`.

## Việc còn lại

- [ ] Ghi đơn hàng ngược vào Google Sheets khi khách chốt (kiểm tra tồn kho trực tiếp từ Sheet trước khi ghi)
- [ ] Tìm theo ảnh khách gửi (embedding ảnh với cùng model)
- [ ] Gợi ý cả bộ từ sheet PhoiDo
- [ ] Chuyển sang nhân viên khi khách cần (tắt bot cho cuộc chat đó)
- [ ] Nối Zalo OA

## Lưu ý

- `GEMINI_MODEL` đang để `gemini-2.5-flash`; kiểm tra model mới nhất trên Google AI Studio rồi đổi trong `wrangler.toml`.
- Gói miễn phí của Gemini dùng dữ liệu gửi lên để cải thiện sản phẩm. Khi chạy cho khách thật nên bật gói trả phí.
- Link CSV "Công bố lên web" là công khai: hợp cho demo, không hợp cho dữ liệu thật của khách.
- Trong chat, bot tự giới thiệu là trợ lý AI (theo Luật AI Việt Nam).
