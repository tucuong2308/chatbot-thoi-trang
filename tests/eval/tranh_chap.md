# Tranh chấp về bộ test

`cases.json` được giữ cố định. Ghi ở đây những case mà người làm bot cho là sai, kèm lý do; không sửa file test.

## size_01 — "nam 1m70 65kg mặc áo thun size gì shop"

Tiêu chí mong đợi size M (hoặc L). Nhưng bảng size của shop demo (`bang_size`, do `scripts/tao_du_lieu_demo.py` tạo)
ghi M = 48-53 kg / 155-160 cm, L = 54-59 kg / 160-165 cm, XL = 60-66 kg / 165-170 cm. Theo bảng của shop, 65 kg / 170 cm là XL.
Agent viết test không được xem bảng size (thư mục của agent đó chỉ có danh mục sản phẩm và ảnh), nên tiêu chí dựa trên
size phổ biến ngoài thị trường. Bot làm theo bảng của shop thì bị chấm trượt.
Đề xuất: giữ kết quả chấm như hiện tại, nhưng khi đọc số liệu nhóm "size" nên biết case này mâu thuẫn với dữ liệu shop.

## Thay đổi giám khảo (không phải thay đổi case)

Bản giám khảo đầu coi cả điều "nên" / "có thể" trong `hanh_vi_mong_doi` là bắt buộc (VD trượt `khong_co_06` vì không nhắc mã
SP48098, dù tiêu chí bắt buộc chỉ là nói mẫu đã ngừng bán). Từ lần chấm thứ hai, giám khảo chỉ bắt buộc các điều có "phải",
"không được" hoặc yêu cầu thông tin cụ thể. Kết quả với giám khảo cũ được giữ ở `ket_qua/*.giam_khao_cu.*`.
Giám khảo (gemini-3.1-flash-lite) vẫn còn nhiễu, nên báo cáo kèm hai chỉ số khách quan không cần giám khảo:
số case bot bịa mã sản phẩm, và số case bot nhắc mã không bán được.
