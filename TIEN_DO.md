# Tiến độ dự án chatbot thời trang

Cập nhật: 18/10/2026. Nhánh đang làm: `agent` (chưa gộp vào `main`, chưa push).

## Trạng thái hiện tại

- Bot là một agent: DeepSeek V4.1 Flash (`deepseek-flash`) tự quyết từng bước — lọc bằng SQL do nó viết (chỉ được đọc),
  xếp hạng theo nghĩa (vector mô tả + vector ảnh, Gemini embedding), xem ảnh để kiểm tra lại khi cần, tra bảng size / tồn kho.
- Dữ liệu demo: 300 món quần áo từ bộ Kaggle "Fashion Product Images" (giấy phép MIT), ảnh độ phân giải cao (600x800),
  thuộc tính do DeepSeek gắn từ ảnh nét, giá / size / tồn kho là số giả cố định. 288 món đang bán và còn hàng.
- Chạy được hoàn toàn trên máy (`npm run dev`), chưa tạo gì trên Cloudflare, chưa deploy, chưa nối Messenger thật.
- Kết quả gần nhất trên bộ test tự nhiên 30 câu: trúng top 3 30/30 (tính cả câu tn_28 chạy lại), bao phủ top 3 0,78,
  trung vị 8,1 giây mỗi lượt, 90% dưới 19 giây.

## Những việc đã làm

### Cài đặt và nền tảng (12/10)
- Node.js 22 có sẵn; `npm install`, typecheck, wrangler 4.149 chạy được; đã đăng nhập Cloudflare CLI.
- Lưu khóa Gemini vào `.dev.vars` và `scripts/.env` (git bỏ qua). Xóa biến môi trường `GEMINI_API_KEY` cũ trên Windows
  (khóa hỏng, đè lên khóa đúng).
- Tải bộ Kaggle bản nhỏ (ảnh 60x80) vào `raw/`; gỡ bản sao `raw\myntradataset` vào Thùng rác.
- Tạo repo private `tucuong2308/chatbot-thoi-trang`, đẩy commit đầu.
- Gắn thuộc tính 300 món bằng `gemini-3.5-flash-lite` (model chính khi đó bị quá tải).

### Truy xuất bằng SQL do model viết (14/10, đã gộp main)
- Chuyển danh mục từ KV sang D1, chuẩn hóa giá trị gõ tay khi đồng bộ Google Sheets, có cảnh báo giá trị lạ.
- Model viết câu SELECT; ba lớp chặn chỉ cho đọc (một câu SELECT/WITH, chặn từ khóa ghi và bảng nội bộ,
  luôn bọc `SELECT * FROM (...) LIMIT n`). 15 câu tấn công đều bị chặn.
- Bỏ Vectorize: vector nằm trong D1, chấm điểm ngay trong Worker trên các món đã lọc.

### Kiến trúc agent (15/10, nhánh `agent`)
- Công cụ `tim_san_pham` với kênh `theo_mo_ta` / `theo_anh` tùy chọn, trả điểm từng kênh; `xem_anh` nhìn ảnh theo lô,
  nhắn khách chờ trước khi xem; `truy_van` cho câu hỏi khác.
- Lời nhắc dạy agent đổi nhu cầu mềm (che bụng, người thấp, đi chùa...) thành kiểu dáng cụ thể, không thêm cột dữ liệu.
- Chốt chặn bằng code: mã sản phẩm trong câu trả lời phải đến từ kết quả tra cứu (chống bịa sản phẩm).
- `truy_van` gắn cờ `dang_ban_va_con_hang` để bot không gợi ý món đã ngừng bán.
- Tin nhắn Messenger đi qua Cloudflare Queues (consumer có 15 phút; `waitUntil` chỉ có 30 giây).
- Lớp gọi model chung cho Gemini và API kiểu OpenAI; mặc định dùng DeepSeek. Xử lý lời gọi công cụ dạng chữ thô của
  DeepSeek (DSML, một hoặc hai dấu ｜).
- Xem ảnh với DeepSeek: tắt phần suy nghĩ (trước đó model nghĩ hết số token cho phép rồi trả về rỗng).
- Giảm thời gian chờ cảm nhận: tạo vector câu hỏi song song với SQL; bật lại "đang soạn tin" sau mỗi vòng tra cứu.

### Đo chất lượng
- Bộ 50 câu (`tests/eval/cases.json`) do một agent riêng viết, chỉ xem ảnh + nhãn gốc, không xem code.
- Bộ 30 câu tự nhiên (`tests/eval/cases_tu_nhien.json`): một agent khác chỉ xem ảnh các món đang bán rồi đặt câu hỏi
  như khách thật. Đây là bộ đang dùng để so sánh.
- Script chấm `tests/eval/run_eval.py`: trúng top 3, độ chính xác, bao phủ top 3, số câu bịa mã, số câu nhắc món
  không bán được, thời gian. Tranh chấp về test ghi ở `tests/eval/tranh_chap.md`. Kết quả từng lần ở `tests/eval/ket_qua/`.

### Ảnh độ phân giải cao (15/10)
- `scripts/tai_anh_hd.py` tải từng ảnh từ bản đầy đủ của bộ Kaggle (ảnh gốc khoảng 1080x1440), thu nhỏ 600x800 vào `public/anh`.
- Gắn lại thuộc tính 300 món bằng DeepSeek từ ảnh nét; tạo lại 600 vector.

### Chốt đơn (18/10)

- Quyết định với chủ shop: spec `docs/superpowers/specs/2026-10-18-chot-don.md`, thuật ngữ `GLOSSARY.md`.
- Bot soạn đơn nháp, khách bấm "Xác nhận đặt hàng" thì đơn vào D1 ngay (không duyệt, COD, không trừ kho), mã `DH-YYMMDD-NNN`,
  lưu kèm 40 tin hội thoại. Khách hủy bằng nút "Xác nhận hủy". Apps Script kéo đơn về trang `DonHang`, gửi email.
- Có test tự động (`npm test`, Vitest trong runtime Workers) cho phần đơn hàng; kịch bản thử thật `tests/eval/thu_dat_hang.py`.

## Kết quả đo trên bộ 30 câu tự nhiên

| Cấu hình | Trúng top 3 | Bao phủ top 3 | Giây/lượt (trung vị) |
|---|---|---|---|
| Bản cũ + gemini-3.1-flash-lite | 16/22 (8 lỗi hết giờ) | 0,62 | 18,3 |
| Agent + gemini-3.1-flash-lite | 21/25 (5 lỗi hết giờ) | 0,66 | 12,5 |
| Bản cũ + DeepSeek (2 lần) | 29/30, 29/30 | 0,83 / 0,75 | 6,0 / 5,8 |
| Agent + DeepSeek, bước xem ảnh hỏng (1 lần) | 30/30 | 0,81 | 10,9 |
| Agent + DeepSeek, ảnh mờ (2 lần) | 28/30, 28/30 | 0,77 / 0,69 | 8,3 / 8,7 |
| Agent + DeepSeek, ảnh nét (1 lần + chạy lại tn_28) | 30/30 | 0,78 | 8,1 |

Rút ra:
- Model quyết định nhiều nhất: DeepSeek hơn hẳn Gemini lite miễn phí.
- Với cùng DeepSeek, bản cũ và bản agent ngang nhau trong mức dao động (cùng cấu hình, bao phủ dao động 0,69-0,77).
- Bước xem ảnh với ảnh 60x80 làm hại; với ảnh nét thì không còn làm hỏng câu nào.

## Chi phí và hạn mức

- DeepSeek (khóa trả phí của bạn): đã dùng khoảng 0,80 USD trên 1,56 USD; còn 0,77 USD.
  Gắn thuộc tính 300 món khoảng 0,25 USD; mỗi lượt đo 30 câu khoảng 0,06 USD.
- Gemini miễn phí: gemini-3.8-flash chỉ 20 lượt/ngày, gemini-3.5-flash-lite 500 lượt/ngày, 5-15 lượt/phút. Hiện chỉ dùng cho embedding.
- NVIDIA (miễn phí): Kimi K3 mất 250-270 giây mỗi lần gọi, DeepSeek qua NVIDIA 40-57 giây; đã dừng dùng.

## Việc còn mở

- [ ] Quyết định: thử tắt / giảm phần suy nghĩ của DeepSeek ở vòng chính để trả lời nhanh hơn (cần 1 lượt đo, khoảng 0,06 USD).
- [ ] Gộp nhánh `agent` vào `main` và push (chờ bạn quyết).
- [ ] Bộ thuộc tính thiếu loại đồ truyền thống (kurta, áo dài kiểu Ấn Độ...), áo nỉ / hoodie / cardigan chưa tách rõ.
- [ ] Tạo tài nguyên Cloudflare (KV, D1, Queue), đặt secret, deploy; điền link CSV Google Sheets.
- [ ] Deploy (R2 để sau, chưa bật thì ảnh dùng link gốc trong Sheet); chạy migration 0003, 0004 lên D1 thật; đăng ký `messaging_postbacks` trên Meta.
- [x] Code nối Telegram (23/10): `/webhook/telegram`, `src/telegram.ts`, test `tests/unit/telegram.test.ts`. Còn: đặt `TELEGRAM_BOT_TOKEN`, `TELEGRAM_SECRET`, deploy, gọi `/admin/telegram/webhook` (README > Nối Telegram).
- [x] Sửa sau 20 kịch bản khách (23/10): trả lời tin ảnh / thoại, gộp tin liền nhau, chuyển nhân viên thật (trang HoTro). Cần chạy migration 0005 và dán lại Bot.gs.
- [ ] Nối Messenger thật; tìm theo ảnh khách gửi; nối Zalo OA (danh sách trong README).
- [ ] Đổi khóa: khóa Gemini, NVIDIA, DeepSeek và token bot Telegram đều đã dán dạng chữ trong cuộc trò chuyện; nên tạo khóa mới sau khi demo.
