# Chatbot thời trang

Trợ lý tư vấn quần áo trên Messenger cho một shop: tìm món hợp ý khách trong danh mục và nhận đơn đặt hàng.

## Đặt hàng

**Đơn nháp**:
Nội dung của tóm tắt đơn mới nhất mà khách chưa xác nhận: các món (mã sản phẩm, size, màu, số lượng) và người nhận. Khách muốn thêm, bớt, đổi gì thì bot soạn lại đơn nháp mới.
_Avoid_: giỏ, giỏ hàng, cart

**Tóm tắt đơn**:
Tin bot gửi cho khách trình bày một đơn nháp và tiền hàng, kèm nút xác nhận. Khách chưa bấm xác nhận thì chưa có đơn.
_Avoid_: hóa đơn, bill

**Đơn hàng**:
Một đơn nháp đã được khách xác nhận. Có hiệu lực ngay, shop không duyệt lại; thanh toán khi nhận hàng (COD). Không sửa được: muốn đổi thì hủy và đặt đơn mới.
_Avoid_: order, đơn chờ duyệt

**Khách hủy**:
Trạng thái của đơn hàng khi khách yêu cầu hủy. Bot không biết hàng đã gửi đi chưa, nên nhân viên tự liên hệ nếu đã gửi.
_Avoid_: đã hủy (dành cho việc shop tự hủy)

**Người nhận**:
Họ tên, số điện thoại và địa chỉ giao hàng ghi trên một đơn hàng.
_Avoid_: khách hàng (khách là người nhắn tin, có thể đặt cho người khác)

**Hội thoại của đơn**:
Bản lưu các tin nhắn giữa khách và bot dẫn tới đơn hàng, giữ cùng đơn để shop xem lại khi có tranh chấp.
_Avoid_: lịch sử chat
