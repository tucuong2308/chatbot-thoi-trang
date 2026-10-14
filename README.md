# Chatbot thời trang (bản demo)

Trợ lý AI tư vấn quần áo trên Facebook Messenger. Bot hiểu câu như "váy trễ vai đi biển dưới 500k", tìm đúng món còn hàng trong kho của shop và gửi ảnh kèm lời tư vấn.

## Kiến trúc

```
Khách nhắn Messenger
   → Facebook gọi webhook → Cloudflare Worker (src/index.ts)
        Gemini đọc tin nhắn và tự gọi công cụ (src/agent.ts, function calling, tối đa 4 vòng):
          - tim_san_pham: Gemini viết câu SELECT lọc cứng (loại, giá, size, màu, phủ định...),
            Worker bỏ món hết hàng/ngừng bán rồi xếp hạng theo nghĩa (src/tools.ts, src/vectors.ts)
          - truy_van: câu SELECT bất kỳ (bảng size, tồn kho từng size, đếm mẫu...)
          SQL sai hoặc ra 0 món thì Gemini đọc kết quả, sửa và gọi lại
        Gemini viết câu trả lời chỉ dựa trên kết quả tra cứu, kèm mã [SP...] để gửi ảnh
   → Worker gọi Send API trả lời khách (src/messenger.ts)

Google Sheets (bản gốc, chủ shop sửa)
   → cron 15 phút đọc CSV → chuẩn hóa giá trị → ghi đè bản sao trong D1 (src/catalog.ts)
Vector sản phẩm (từ mô tả và từ ảnh) → scripts/embed_products.py → bảng vec trong D1
Lịch sử chat → KV (7 ngày, 10 lượt gần nhất)
```

**SQL do model viết chỉ được đọc** (src/sql.ts): chỉ một câu SELECT/WITH, chặn từ khóa ghi và bảng nội bộ,
và luôn chạy trong dạng `SELECT * FROM (...) LIMIT n` nên lệnh ghi lọt vào cũng là lỗi cú pháp.
Dữ liệu trong D1 chỉ là bản sao, lần đồng bộ sau sẽ dựng lại từ Sheets. Lịch sử chat nằm ở KV, model không chạm tới.

**Xếp hạng theo nghĩa chạy ngay trong Worker**: vector nằm trong D1 và được giữ trong bộ nhớ;
SQL lọc trước rồi mới chấm điểm, nên không cần Vectorize (đủ nhanh tới vài nghìn sản phẩm).
Có cả vector chữ lẫn vector ảnh thì gộp hai bảng xếp hạng bằng RRF.

**Model**: `GEMINI_MODEL` là model chính, `GEMINI_MODEL_DU_PHONG` dùng khi model chính quá tải;
model lỗi tạm thời bị bỏ qua 5 phút để khách không phải chờ.

| Thư mục | Nội dung |
| --- | --- |
| `src/` | Code Worker (TypeScript) |
| `migrations/` | Cấu trúc bảng D1 |
| `scripts/tag_products.py` | Cho Gemini nhìn ảnh, tự điền cột thuộc tính |
| `scripts/embed_products.py` | Tạo vector sản phẩm (chữ, và ảnh với `--anh`) rồi nạp vào Worker |
| `scripts/tao_du_lieu_demo.py` | Dựng bộ dữ liệu demo (giá, size, tồn kho giả) khi chưa có Google Sheets |
| `scripts/hoi_thu.py` | Hỏi thử bot và xem bot đã chạy SQL gì |
| `data/bo-cot-thuoc-tinh-thoi-trang.xlsx` | Mẫu bảng tính: SanPham, BienThe, BangSize, DanhMuc |
| `data/gemini-schema-thuoc-tinh.json` | Danh sách giá trị cho phép, dùng chung cho script và bot |

## Cài đặt lần đầu

Cần Node.js 20+ và Python 3.10+.

```bash
npm install
cp .dev.vars.example .dev.vars                                   # điền key thật
npx wrangler d1 migrations apply chatbot-thoi-trang --local      # tạo bảng trong D1 trên máy
```

Chạy trên máy không cần tạo gì trên Cloudflare. Khi đưa lên mạng mới cần:

```bash
npx wrangler login
npx wrangler kv namespace create SHOP_KV                # dán id vào wrangler.toml
npx wrangler d1 create chatbot-thoi-trang               # dán database_id vào wrangler.toml
npx wrangler d1 migrations apply chatbot-thoi-trang --remote
```

## Chuẩn bị dữ liệu

1. Tải lên Google Sheets file `data/bo-cot-thuoc-tinh-thoi-trang.xlsx`, điền sản phẩm.
2. Chưa có thuộc tính? Xuất sheet SanPham ra CSV (thêm cột `anh` là đường dẫn ảnh), rồi chạy
   `python scripts/tag_products.py san_pham.csv`. Kiểm tra file kết quả, sửa dòng sai, dán lại vào sheet.
3. Trong Google Sheets: Tệp > Chia sẻ > Công bố lên web, chọn từng sheet dạng CSV, dán link vào `SHEET_CSV_*` trong `wrangler.toml`.
4. Đồng bộ: `curl -X POST localhost:8787/admin/sync -H "x-admin-key: <ADMIN_KEY>"` (trên mạng thì cron tự chạy 15 phút một lần).
   Kết quả có danh sách `canh_bao` cho giá trị gõ sai danh sách (VD "Trễ vai " đã tự sửa, "trễ vai xinh" thì báo).
5. Tạo vector: `python scripts/embed_products.py san_pham_da_gan.csv --anh --nap http://localhost:8787`.
   Chỉ cần chạy lại khi thêm sản phẩm hoặc đổi mô tả.

Chưa có Google Sheets thì thay bước 3-4 bằng bộ demo từ ảnh Kaggle:
`python scripts/tao_du_lieu_demo.py --nap http://localhost:8787`.

Script Python đọc key từ `scripts/.env` (dòng `GEMINI_API_KEY=...`) và `ADMIN_KEY` từ `.dev.vars`.

## Chạy thử không cần Facebook

```bash
npm run dev
python scripts/hoi_thu.py "đầm đi biển dưới 400k, không lấy màu đen" "mẫu đầu còn size M không" "mình 52kg cao 158 mặc size gì"
```

Mọi câu trong một lần chạy là một cuộc hội thoại. Script in ra từng câu SQL bot đã viết và số món tìm được.
Hoặc gọi thẳng `POST /chat` với `{"user":"test","text":"..."}` và header `x-admin-key`: kết quả có `trace` là các bước tra cứu.

## Đưa lên mạng và nối Messenger

```bash
npx wrangler secret put GEMINI_API_KEY   # tương tự cho FB_PAGE_TOKEN, FB_VERIFY_TOKEN, FB_APP_SECRET, ADMIN_KEY
npm run deploy
```

Trong Meta for Developers > Messenger > Webhooks: URL `https://<worker>.workers.dev/webhook/messenger`, verify token = `FB_VERIFY_TOKEN`, đăng ký sự kiện `messages`.

## Việc còn lại

- [ ] Nhận đặt hàng (hiện bot chỉ xin mã, size, màu rồi hẹn nhân viên nhắn lại)
- [ ] Ghi đơn hàng ngược vào Google Sheets khi khách chốt (kiểm tra tồn kho trực tiếp từ Sheet trước khi ghi)
- [ ] Tìm theo ảnh khách gửi (vector ảnh sản phẩm đã có trong bảng vec, chỉ cần nhận ảnh từ Messenger và embed)
- [ ] Gợi ý cả bộ từ sheet PhoiDo
- [ ] Chuyển sang nhân viên khi khách cần (tắt bot cho cuộc chat đó)
- [ ] Nối Zalo OA

## Lưu ý

- `gemini-2.5-flash` không còn mở cho khóa mới; đang dùng `gemini-3.8-flash` (chính) và `gemini-3.5-flash-lite` (dự phòng).
- Messenger: Worker trả lời trong nền (`waitUntil`), chỉ có khoảng 30 giây. Model chính chậm hoặc quá tải ở tin nhắn đầu có thể làm lỡ câu trả lời;
  nếu hay gặp thì đổi `GEMINI_MODEL` sang model nhanh hơn hoặc chuyển phần xử lý sang Cloudflare Queues.
- Gói Workers miễn phí giới hạn 50 truy vấn D1 và 50 lần gọi ra ngoài mỗi tin nhắn; một tin nhắn thường dùng dưới 15.
- Gói miễn phí của Gemini dùng dữ liệu gửi lên để cải thiện sản phẩm. Khi chạy cho khách thật nên bật gói trả phí.
- Link CSV "Công bố lên web" là công khai: hợp cho demo, không hợp cho dữ liệu thật của khách.
- Trong chat, bot tự giới thiệu là trợ lý AI (theo Luật AI Việt Nam).
