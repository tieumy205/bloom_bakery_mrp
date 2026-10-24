# Hợp đồng API dự kiến

Đây là đề xuất tích hợp cho frontend, chưa phải API đã triển khai. Các schema TypeScript nằm trong `src/shared/domain/types.ts` và `commands.ts`.

## Adapter đang có

- Mặc định `VITE_DATA_SOURCE=mock`: dữ liệu localStorage, session demo, không gọi Backend.
- `VITE_DATA_SOURCE=api`: `GET /api/snapshot` và `POST /api/commands` đã có HTTP adapter nhưng cần Backend thực sự trả dữ liệu đúng hợp đồng.
- `VITE_API_BASE_URL` thay đổi prefix API.
- HTTP dùng cookie (`credentials: include`). Backend cần cơ chế auth, CSRF, session expiry và giới hạn dữ liệu theo vai trò. Trang `/demo` phải được loại khỏi bản tích hợp auth thật.

## Snapshot

`GET /snapshot` → `Database` đã lọc theo session. Admin xem nghiệp vụ; Manager xem dữ liệu quản lý; Employee chỉ nhận lệnh được giao, phiếu của mình và dữ liệu tồn được phép xem.

Snapshot là giao diện đơn giản cho mock/prototype. Khi dữ liệu lớn, thay repository bằng endpoint theo module (materials, products, boms, orders, documents, reports, notifications), truy vấn phân trang/lọc/sắp xếp trên server. Không tải toàn database ở production.

## Commands

`POST /commands` nhận union `Command`, trả `204` khi thành công. Các command hiện có:

| Command                                                  | Ý nghĩa                                          |
| -------------------------------------------------------- | ------------------------------------------------ |
| save-user / delete-user                                  | Quản trị tài khoản                               |
| save-material / save-product / save-bom / delete-catalog | Danh mục                                         |
| save-order                                               | Tạo/sửa lệnh hợp lệ                              |
| order-action                                             | start, progress, complete, cancel                |
| save-document / delete-document                          | Tạo/sửa/xóa phiếu theo quyền/trạng thái          |
| document-action                                          | approve, reject, submit, complete                |
| read-notification                                        | Đánh dấu một hoặc tất cả thông báo được phép đọc |

Ví dụ:

```json
{
  "type": "order-action",
  "payload": {
    "id": "PO024",
    "action": "progress",
    "quantities": { "TP001": 190, "TP002": 95 }
  }
}
```

Backend nên chuyển command thành endpoint REST theo module hoặc giữ command API theo lựa chọn kiến trúc. Các ID, created_by, reviewed_by, reviewed_at, status và timeline phải do Backend xác định; không chấp nhận các giá trị client tự khai làm bằng chứng quyền.

## Lỗi

Trả `{ "message": "Thông báo tiếng Việt", "code": "BUSINESS_RULE", "details": {} }`.

- `401`: hết session / chưa xác thực.
- `403`: sai quyền hoặc ngoài phạm vi được giao.
- `404`: đối tượng không tồn tại hoặc không được phép biết.
- `409`: trạng thái/version đã thay đổi, phiếu nhập trùng, xung đột tồn.
- `422`: form hoặc số lượng không hợp lệ.

HTTP client hiện hiển thị message và cho thử lại. Tích hợp auth thật cần xử lý 401 toàn cục; xung đột 409 cần tải lại chi tiết và hiển thị dữ liệu mới trước khi thao tác lại.

## Ràng buộc bắt buộc phía Backend

Bản SQL chính thức và phân chia trách nhiệm: [OFFICIAL_README.md](../database/OFFICIAL_README.md). Database giữ các trigger nguồn về vòng đời, bảo vệ BOM/ledger và ghi tồn. Backend xử lý xác thực, quyền sở hữu, khóa ngày nhập pending, quy tắc xuất NVL một lần, kiểm đủ BOM, timeline và thông báo. Không ghi tồn/ledger hai lần. Không dùng app.user_id, snapshot hoặc các migration của bản thử nghiệm cũ cho schema chính thức này.

1. Quyền role + quyền sở hữu + trạng thái, kiểm tra tại thời điểm commit.
2. Chống tạo hai phiếu nhập cho cùng bổ sung bằng unique constraint.
3. Lock dòng lệnh/transaction khi tạo và duyệt xuất NVL: Backend bảo đảm một phiếu pending/approved mỗi lệnh, đúng toàn bộ tập nguyên liệu/số lượng BOM đã chọn. Database không đặt ràng buộc số lần xuất; phiếu rejected cho phép tạo thay thế.
4. Idempotency key và optimistic version/row lock khi duyệt, hoàn tất nhập, hoàn thành PO; không chỉ dựa vào disable nút ở UI.
5. Hoàn tất nhập đồng thời tăng tồn, ghi biến động, fulfill bổ sung; hoàn thành PO đồng thời tăng tồn TP theo sản lượng thực tế.
6. Theo SQL chính thức: mỗi dòng lệnh lưu bom_id thuộc đúng sản phẩm. Phiên bản BOM đã được dùng không sửa/xóa; được đổi riêng is_active. Không dùng bảng snapshot. Frontend mock còn lưu requirements; API tính từ bom_id đã chọn.
7. Ngày nhập hàng là ngày nghiệp vụ; completed_at/reviewed_at là timestamp thực. Múi giờ hiển thị Asia/Ho_Chi_Minh.
8. Cho nhập khác requested nhưng không dưới mức tối thiểu theo luồng đã yêu cầu. SQL chính thức bỏ kiểm bằng requested; Backend tính và kiểm mức thiếu hiện tại dưới khóa dòng trước khi hoàn tất nhập.
9. Báo cáo NVL sử dụng hiện lấy phiếu xuất đã duyệt, chưa có số liệu tiêu hao thực tế. Báo cáo tồn dùng số dư đầu và biến động đến cuối ngày/tháng/năm.
10. Ảnh TP mock dùng data URL. Production cần upload service và trả URL đã kiểm tra, thay validation mock tương ứng.

## Quy ước cần thống nhất

- Cập nhật 18/10/2026: phiếu xuất TP mới không nhận `orderId`, chỉ xuất từ tồn kho. Phiếu cũ liên kết PO vẫn được đọc; không xóa lịch sử. Backend cần từ chối tạo mới gắn PO tương tự mock command.
- Form nhập NVL chỉ ẩn cột tối thiểu, không bỏ validation mức nhập tối thiểu. Nhãn hiện hành là Số lượng yêu cầu và Số lượng nhập.

- Bản hiện tại chỉ sửa PO pending chưa có phiếu liên quan chưa bị từ chối; pending chứng từ phải được xử lý trước khi hủy PO.
- Mức nhận tối thiểu tính lại ở thời điểm tạo/sửa và hoàn tất phiếu nhập. Nếu nhu cầu tăng sau khi phiếu bị khóa, Backend cần quy trình xử lý xung đột hợp lệ; frontend hiện báo lỗi rõ và giữ phiếu pending, không tự mở khóa.
- Báo cáo stock so sánh với min_stock hiện tại; chưa có lịch sử cấu hình min_stock.
- Các đơn vị thành phẩm hiện là đơn vị đếm; số lượng sản xuất là số nguyên. Cần mở rộng precision nếu có TP tính theo kg/lít.
