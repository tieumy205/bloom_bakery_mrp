# Nghiệm thu Backend — 18/10/2026

Phạm vi: 9 sprint trong BACKEND_SPRINT_PLAN.md; UI giữ bố cục hiện có, bổ sung BOM phiên bản, chọn BOM trên lệnh và quyền/mật khẩu tài khoản.

## Kết quả đã chạy

| Nhóm          | Kết quả và bằng chứng                                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript    | Frontend và backend đạt `npm run typecheck`                                                                                                                      |
| Frontend      | 28 test / 3 file đạt bằng Vitest                                                                                                                                 |
| Backend unit  | 3 test đạt: hash/password, token/quyền, ánh xạ lỗi an toàn                                                                                                       |
| Auth HTTP     | 3 tài khoản nguồn, sai mật khẩu, cookie HttpOnly, logout thu hồi phiên                                                                                           |
| Admin HTTP    | Mật khẩu tạo user/đặt lại, phiên cũ bị thu hồi, deny → 403 không tác dụng phụ, parity has_permission, chặn tự mất quyền                                          |
| Catalog HTTP  | CRUD, định mức 6 số thập phân, trùng version, đổi active, deny create                                                                                            |
| Orders HTTP   | Lưu bom_id, thay active không đổi lệnh, chặn chọn inactive mới, server giữ người tạo/tiến độ, idempotency, scope Employee                                        |
| Workflow HTTP | 35 kiểm tra: MR → receipt → issue → start/progress/complete → xuất TP, timeline/thông báo, quyền sở hữu, ngày nhập, trạng thái và rollback                       |
| Đồng thời     | Hai request tạo xuất NVL cùng PO: một 204, một 409; không ghi trùng                                                                                              |
| Rollback      | Cố ý lỗi service sau trigger ghi tồn: stock/status/ledger đều rollback                                                                                           |
| Reports HTTP  | Đối chiếu nhập 12/xuất 10/tồn 2 theo ngày/tháng/quý/năm; ngày/nhóm sai → 422; employee → 403; phân trang đúng người sở hữu; thu hồi quyền có hiệu lực request kế |
| Build         | Vite production build thành công                                                                                                                                 |

Sáu smoke suite HTTP chạy tuần tự trên database mới `bloom_backend_test_v3`, PostgreSQL 18.6 cổng 55439, role DML riêng `bloom_backend_test_api` (không superuser/DDL). Không chạy mutation test hoặc import fixture vào database chính.

Database chính `bloom_bakery`: đã áp dụng patch bổ sung và khởi tạo hash cho đúng 3 tài khoản nguồn; chạy bootstrap lại khởi tạo 0 tài khoản. Role API riêng kết nối và kiểm rollback bảng TEMP thành công. Các kiểm thử SQL cũ 54 nghiệp vụ + 4 đồng thời thuộc baseline chính thức, không cộng gộp với bộ HTTP này.

## Kiểm tra trình duyệt

Đăng nhập thực trên http://127.0.0.1:5173; Admin hiển thị đủ ba tài khoản, ma trận checkbox theo tài khoản và khóa các quyền ngoài vai trò. Chọn Manager để kiểm tra quyền hiển thị, không bấm lưu thay đổi quyền trên database chính. Manager: kiểm bảng BOM có version/active và nút tạo; form lệnh chọn Croissant bơ Pháp tự gắn 1.0 · BOM01. Đóng form không lưu dữ liệu nghiệp vụ. Employee chỉ thấy lệnh được giao/phiếu của mình; lệnh completed hiển thị BOM 1.0 và không có nút xuất thành phẩm hoặc duyệt. Ảnh bổ sung: screenshots/backend-employee-completed.png. Ảnh: `screenshots/backend-admin-permissions.png`, `screenshots/backend-order-bom.png`.

## Giới hạn bàn giao

Chạy cục bộ, chưa đưa lên hosting. Bảng hiện dùng snapshot và phân trang UI; endpoint phân trang SQL đã có, chưa thay toàn bộ bảng sang truy vấn từng trang. Báo cáo dùng SQL. Quyền backend đọc lại mỗi request, UI làm mới định kỳ 15 giây. Lịch sử nguồn được giữ nguyên; ledger có ngày nghiệp vụ cũ khác ngày chứng từ thì báo cáo phản ánh ledger, không tự điều chỉnh dữ liệu.
