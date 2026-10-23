# Chatbot thời trang (bản demo)

Trợ lý AI tư vấn quần áo trên Facebook Messenger và Telegram. Bot hiểu câu như "váy trễ vai đi biển dưới 500k", tìm đúng món còn hàng trong kho của shop và gửi ảnh kèm lời tư vấn.

## Kiến trúc

```
Khách nhắn Messenger
   → Facebook gọi webhook → Worker trả 200 ngay, đẩy tin nhắn vào hàng đợi (Cloudflare Queues)
   → Consumer của hàng đợi (tối đa 15 phút) chạy agent (src/agent.ts):
        Gemini tự quyết từng bước, tối đa 6 vòng / 90 giây:
          - tim_san_pham: lọc cứng bằng SQL do nó viết, rồi xếp hạng theo nghĩa qua kênh mô tả (vector chữ)
            và/hoặc kênh ảnh (vector ảnh), kèm điểm từng kênh để nó tự đánh giá độ chắc (src/tools.ts)
          - xem_anh: tự nhìn ảnh từng sản phẩm theo lô 16 ảnh khi thuộc tính không đủ để quyết
            ("che bụng", "nhìn sang"...); trước đó nhắn khách chờ một chút (src/images.ts)
          - truy_van: SELECT bất kỳ (bảng size, tồn kho từng size, đếm mẫu...)
          - soan_don / xem_don / yeu_cau_huy_don: soạn đơn nháp (kiểm tra kho, size, màu, số điện thoại, địa chỉ),
            tra đơn của khách, xin hủy (src/donhang/)
        Nhu cầu mềm được agent tự đổi thành kiểu dáng cụ thể như người bán hàng (src/prompt.ts),
        không cần thêm cột dữ liệu.
   → Gửi tin nhắn tạm (nếu có), câu trả lời, thẻ sản phẩm (ảnh, giá, size, nút), rồi tóm tắt đơn kèm nút
     "Xác nhận đặt hàng" nếu vừa soạn đơn, qua Send API (src/messenger.ts, src/tinnhan.ts)
   → Khách bấm nút DON:... (xác nhận đặt / xác nhận hủy): code tạo / hủy đơn trong D1, không qua model.
     Đơn lưu kèm 40 tin hội thoại gần nhất; thanh toán COD, không trừ kho (src/donhang/don.ts)

Google Sheets (bản gốc, chủ shop sửa, riêng tư)
   → Apps Script trong bảng tính gửi lên /admin/import (apps-script/) → chuẩn hóa → ghi đè bản sao trong D1 (src/catalog.ts)
   → hàng đợi chatbot-viec-nen: món mới / vừa sửa được tải ảnh (lưu bản riêng trên R2 nếu đã bật) và tạo vector (src/dongbo.ts)
   ← cùng lịch 5 phút, Apps Script kéo đơn mới / vừa hủy từ /admin/don-hang về trang DonHang và gửi email báo shop
Vector sản phẩm (từ mô tả và từ ảnh) → bảng vec trong D1 (bộ demo nạp bằng scripts/embed_products.py)
Lịch sử chat → KV (7 ngày, 10 lượt gần nhất)
```

**Vì sao cần hàng đợi**: xử lý bằng `waitUntil` chỉ có 30 giây sau khi trả lời webhook, không đủ cho
nhiều vòng tra cứu và xem ảnh. Queues có trong gói miễn phí (10.000 thao tác/ngày, khoảng 3.000 tin nhắn).

**SQL do model viết chỉ được đọc** (src/sql.ts): chỉ một câu SELECT/WITH, chặn từ khóa ghi và bảng nội bộ,
và luôn chạy trong dạng `SELECT * FROM (...) LIMIT n` nên lệnh ghi lọt vào cũng là lỗi cú pháp.
Dữ liệu trong D1 chỉ là bản sao, lần đồng bộ sau sẽ dựng lại từ Sheets. Lịch sử chat nằm ở KV, model không chạm tới.

**Xếp hạng theo nghĩa chạy ngay trong Worker**: vector nằm trong D1 và được giữ trong bộ nhớ;
SQL lọc trước rồi mới chấm điểm, nên không cần Vectorize (đủ nhanh tới vài nghìn sản phẩm).

**Xem ảnh**: Gemini nhận tối đa 3.600 ảnh và 20 MB dữ liệu đính kèm mỗi request; lô 16 ảnh (2-6 MB với ảnh shop thật)
nằm xa giới hạn đó. Mỗi lần xem tối đa 32 ảnh, vì gói Workers miễn phí chỉ cho 50 lượt gọi ra ngoài mỗi lần chạy.

**Model**: mặc định dùng DeepSeek V4.1 Flash (`deepseek-flash`) qua API kiểu OpenAI cho phần suy nghĩ, gọi công cụ
và xem ảnh; khóa đặt ở `OPENAI_API_KEY`. Trên bộ test tự nhiên 30 câu (`tests/eval/ket_qua/`), bản agent với DeepSeek
trúng 30/30, bao phủ top 3 là 0,81, so với 21/25 và 0,66 khi dùng `gemini-3.1-flash-lite`; chi phí khoảng 0,4 xu Mỹ mỗi cuộc hội thoại.
Đặt `LLM_NHA_CUNG_CAP = "gemini"` để quay lại Gemini (`GEMINI_MODEL` chính, `GEMINI_MODEL_DU_PHONG` dự phòng; gói miễn phí
chỉ cho 20 lượt/ngày với gemini-3.8-flash). Embedding luôn dùng Gemini.

| Thư mục | Nội dung |
| --- | --- |
| `src/` | Code Worker (TypeScript) |
| `migrations/` | Cấu trúc bảng D1 |
| `apps-script/` | Apps Script dán vào Google Sheets: menu Bot, đồng bộ, tô ô lỗi, danh sách thả xuống |
| `scripts/tag_products.py` | Cho Gemini nhìn ảnh, tự điền cột thuộc tính |
| `scripts/embed_products.py` | Tạo vector sản phẩm (chữ, và ảnh với `--anh`) rồi nạp vào Worker |
| `scripts/tao_du_lieu_demo.py` | Dựng bộ dữ liệu demo (giá, size, tồn kho giả) khi chưa có Google Sheets |
| `scripts/hoi_thu.py` | Hỏi thử bot và xem bot đã chạy SQL gì |
| `tests/eval/` | Bộ test độc lập (`cases.json`) và script chấm `run_eval.py`, kết quả trong `ket_qua/` |
| `public/` | Ảnh sản phẩm tự host (`public/anh/`, chỉ cho bản demo, không đưa lên git) |
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
npx wrangler queues create chatbot-tin-nhan
npx wrangler queues create chatbot-viec-nen
npx wrangler r2 bucket create chatbot-thoi-trang-anh   # không bắt buộc, xem ghi chú [[r2_buckets]] trong wrangler.toml
```

Sau khi deploy, đặt `DIA_CHI_CONG_KHAI` trong `wrangler.toml` thành địa chỉ Worker để gửi được ảnh `/anh/...` qua Messenger.

## Chuẩn bị dữ liệu

1. Tải lên Google Sheets file `data/bo-cot-thuoc-tinh-thoi-trang.xlsx`, điền sản phẩm.
2. Chưa có thuộc tính? Xuất sheet SanPham ra CSV (thêm cột `anh` là đường dẫn ảnh), rồi chạy
   `python scripts/tag_products.py san_pham.csv`. Kiểm tra file kết quả, sửa dòng sai, dán lại vào sheet.
3. Cài Apps Script theo `apps-script/README.md`, rồi bấm **Bot > Đồng bộ ngay**. Ô gõ sai được tô đỏ kèm ghi chú;
   ảnh được tải về (lưu R2 nếu đã bật) và vector được tạo tự động cho món mới / vừa sửa (xem **Bot > Xem tiến độ**).

Cách cũ vẫn dùng được: Công bố lên web từng sheet dạng CSV, dán link vào `SHEET_CSV_*`, cron đọc 15 phút một lần.

Chưa có Google Sheets thì thay bước 3-4 bằng bộ demo từ ảnh Kaggle:
`python scripts/tao_du_lieu_demo.py --nap http://localhost:8787`.

Script Python đọc key từ `scripts/.env` (dòng `GEMINI_API_KEY=...`) và `ADMIN_KEY` từ `.dev.vars`.

## Chạy thử không cần Facebook

```bash
npm run dev
python scripts/hoi_thu.py "đầm đi biển dưới 400k, không lấy màu đen" "mẫu đầu còn size M không" "mình 52kg cao 158 mặc size gì"
```

Mọi câu trong một lần chạy là một cuộc hội thoại. Script in ra từng câu SQL bot đã viết, điểm từng kênh,
các lần xem ảnh và tin nhắn tạm.
Hoặc gọi thẳng `POST /chat` với `{"user":"test","text":"..."}` và header `x-admin-key`: kết quả có `trace` là các bước tra cứu,
`tin` là các tin bot sẽ gửi. Bấm nút thì gửi `{"user":"test","payload":"DON:XAC_NHAN:<id>"}`.
Thử trọn một lần đặt hàng: `python tests/eval/thu_dat_hang.py` (gọi model thật, vài lượt).

Test tự động (D1, KV chạy cục bộ, không gọi model): `npm test`.

## Đưa lên mạng và nối Messenger

```bash
npx wrangler secret put GEMINI_API_KEY   # tương tự cho FB_PAGE_TOKEN, FB_VERIFY_TOKEN, FB_APP_SECRET, ADMIN_KEY
npm run deploy
```

Trong Meta for Developers > Messenger > Webhooks: URL `https://<worker>.workers.dev/webhook/messenger`, verify token = `FB_VERIFY_TOKEN`, đăng ký sự kiện `messages` và `messaging_postbacks` (nút bấm).
Trước khi deploy bản có đặt hàng: `npx wrangler d1 migrations apply chatbot-thoi-trang --remote` (bảng `don_hang`).

Messenger chỉ trả lời người có vai trò trong app cho tới khi Meta duyệt quyền `pages_messaging`.

## Nối Telegram

Telegram không cần xét duyệt: ai có link `t.me/<ten_bot>` cũng chat được. Dùng chung kho, đơn hàng và Google Sheets với Messenger (khách Telegram có mã `tg:<chat id>`).

1. Nhắn @BotFather trên Telegram: `/newbot`, đặt tên, nhận token.
2. `npx wrangler secret put TELEGRAM_BOT_TOKEN` (dán token khi được hỏi).
3. Nối webhook (một lần, làm lại khi đổi token hoặc địa chỉ Worker):
   `curl -X POST -H "x-admin-key: <ADMIN_KEY>" https://<worker>.workers.dev/admin/telegram-webhook`
   Kết quả đúng: `{"ok":true,"result":true,...}`.

Thẻ sản phẩm gửi thành ảnh kèm tên, giá, size và hai nút; tóm tắt đơn có nút Xác nhận đặt hàng / Sửa lại như Messenger. Webhook kiểm tra mã bí mật suy ra từ token, chỉ trả lời chat riêng (bỏ qua nhóm).

## Việc còn lại

- [x] Nhận đặt hàng trên Messenger, đơn về trang DonHang của Google Sheets
- [ ] Gửi trạng thái giao hàng từ Sheet về bot (hiện bot luôn trả lời "khoảng 1-2 ngày")
- [ ] Nhớ người nhận cho lần đặt sau
- [ ] Tìm theo ảnh khách gửi (vector ảnh sản phẩm đã có trong bảng vec, chỉ cần nhận ảnh từ Messenger và embed)
- [ ] Gợi ý cả bộ từ sheet PhoiDo
- [ ] Chuyển sang nhân viên khi khách cần (tắt bot cho cuộc chat đó)
- [ ] Nối Zalo OA

## Đo chất lượng

Bộ `tests/eval/cases_tu_van.json` (38 hội thoại) đo phần tư vấn bán hàng thay vì tìm hàng: chào hỏi, kiến thức thời trang
(phối đồ, chất liệu, bảo quản: phải trả lời ngay, không tra cứu), chính sách (không bịa đổi trả, địa chỉ, khuyến mãi),
hỏi rõ nhu cầu, gỡ băn khoăn (chê đắt, sợ mua online, phân vân), gợi ý phối kèm, chốt đơn, khiếu nại, ngoài phạm vi, size,
nhớ ngữ cảnh. Case có `cong_cu_khong_goi` / `cong_cu_phai_goi` còn được kiểm tra công cụ bot đã gọi ở lượt cuối.
`python tests/eval/run_eval.py --url http://localhost:8787 --ten tu-van --bo cases_tu_van.json`

Thông tin shop (đổi trả, địa chỉ, giờ làm việc...) ghi ở trang `ThongTinShop` của Google Sheets (cột `chu_de`, `noi_dung`);
bot đưa nguyên trang này vào prompt. Ô nội dung để trống thì bot nói chưa có thông tin.

`tests/eval/cases.json` gồm 50 câu hỏi do một agent riêng viết: agent đó không được xem code, lời nhắc hay thuộc tính
do Gemini gắn, chỉ có ảnh, nhãn gốc, giá và tồn kho, và tự nhìn ảnh để quyết định món nào đúng. Coi file này là cố định:
không sửa để bot "đậu"; case nào thật sự sai thì ghi vào `tests/eval/tranh_chap.md`.

```bash
npm run dev
python tests/eval/run_eval.py --url http://localhost:8787 --ten ten_lan_chay
```

## Lưu ý

- `gemini-2.5-flash` không còn mở cho khóa mới. Khi dùng Gemini: `gemini-3.8-flash` (chính) và `gemini-3.5-flash-lite` (dự phòng).
- Gói Workers miễn phí giới hạn 50 truy vấn D1 và 50 lần gọi ra ngoài mỗi tin nhắn; một tin nhắn thường dùng dưới 15.
- Gói miễn phí của Gemini dùng dữ liệu gửi lên để cải thiện sản phẩm. Khi chạy cho khách thật nên bật gói trả phí.
- Link CSV "Công bố lên web" là công khai: hợp cho demo, không hợp cho dữ liệu thật của khách.
- Trong chat, bot tự giới thiệu là trợ lý AI (theo Luật AI Việt Nam).
