# Backend Bloom Bakery MRP

Đã triển khai 9 sprint, ngày 18/10/2026. Dùng Node.js 24, TypeScript và PostgreSQL 18; giao diện React giữ cấu trúc hiện có.

## Chạy trên máy hiện tại

Mở hai terminal tại `D:\bloomBakery`:

```sh
npm run api
npm run dev
```

Truy cập http://127.0.0.1:5173. Tài khoản nguồn: `admin`, `manager`, `employee`; mật khẩu ban đầu `12345`. Admin nhập mật khẩu khi tạo tài khoản và có thể đặt lại mật khẩu khi sửa tài khoản. Mật khẩu lưu bằng scrypt có salt; bootstrap chỉ khởi tạo những tài khoản nguồn chưa có hash, không reset khi chạy lại.

Frontend chọn API bằng `VITE_DATA_SOURCE=api` trong `.env.local`. Cấu hình PostgreSQL và SESSION_SECRET ở `backend/.env.local`, không commit. Backend đang dùng role riêng `bloom_bakery_api` chỉ được thao tác dữ liệu; thông tin bootstrap có quyền DDL ở `backend/.env.admin.local`, không dùng để chạy API.

Máy mới: import `database/bakery_mrp_official.sql` vào database trống trước; tạo file môi trường quản trị theo `backend/.env.example`, chạy `npm run api:bootstrap` để áp dụng patch bổ sung, rồi cấu hình tài khoản PostgreSQL riêng cho API. `backend/src/configure-app-role.ts` hỗ trợ thiết lập role ứng dụng từ cấu hình quản trị. Không import lại dump lên database đang có dữ liệu.

## Cấu trúc và trách nhiệm

- `src/core`: HTTP/validation/lỗi tiếng Việt, pool và transaction PostgreSQL.
- `src/modules/auth`: đăng nhập, cookie HttpOnly có chữ ký, kiểm active và phiên, quyền hiệu lực.
- `src/modules/users`: user/mật khẩu và quyền boolean theo tài khoản; gán hàng loạt trong một transaction.
- `src/modules/catalog`: nguyên liệu, thành phẩm, BOM phiên bản; BOM đã tham chiếu bị khóa nội dung.
- `src/modules/production`: bom_id từng dòng lệnh, người được giao, bắt đầu/tiến độ/hoàn thành/hủy.
- `src/modules/documents`: bổ sung/nhập/xuất nguyên liệu/xuất thành phẩm và chuyển trạng thái hợp lệ.
- `src/modules/events`: timeline và thông báo cùng transaction nghiệp vụ.
- `src/modules/data`: DTO snapshot theo quyền/người sở hữu và truy vấn danh sách SQL.
- `src/modules/reports`: báo cáo SQL theo ngày/tháng/quý/năm.

Luồng: React → hooks/repository → HTTP route → guard/validation → service → transaction PostgreSQL. Danh tính lấy từ phiên; dữ liệu người tạo do client gửi không được tin cậy.

## Quyền và giao dịch

Chỉ cờ hiệu lực `true` cho phép thực hiện. Role giới hạn phạm vi; override false thu hồi quyền mặc định. Backend và hàm `has_permission()` cùng cách tính. Quyền được đọc lại mỗi request, không nhúng quyền cũ vào cookie. Đổi mật khẩu/role/active hoặc logout thu hồi phiên bằng auth_version. API tiếp tục kiểm quyền sở hữu, trạng thái và dữ liệu nghiệp vụ sau guard.

Xuất NVL một lần được kiểm tại service bằng khóa dòng lệnh, kiểm phiếu pending/approved và đầy đủ định mức; phiếu rejected cho tạo thay thế. Không thêm trigger/index đếm phiếu xuất. API ghi dùng idempotency key; retry cùng nội dung không ghi lại. Trigger hiện có ghi tồn/ledger và fulfilled; backend không cộng/trừ tồn lần hai. Lỗi sau khi trigger chạy vẫn rollback toàn bộ transaction.

Patch `database/001_auth_permissions.sql` thêm user_permissions, api_request_keys, auth_version, quyền dashboard/thông báo và chỉ mục phục vụ tra cứu. Không tạo schema_migrations, snapshot BOM hoặc trigger nghiệp vụ mới.

## API

| Endpoint                                                      | Mục đích                                                  |
| ------------------------------------------------------------- | --------------------------------------------------------- |
| GET /api/health                                               | Kiểm kết nối database                                     |
| POST /api/auth/login; GET /api/auth/me; POST /api/auth/logout | Phiên đăng nhập                                           |
| GET /api/snapshot                                             | Dữ liệu DTO đã giới hạn quyền và người sở hữu             |
| GET/POST /api/permissions                                     | Đọc/lưu checkbox quyền nhiều tài khoản                    |
| POST /api/commands                                            | Các thao tác ghi được phân loại và kiểm quyền từng action |
| GET /api/lists/:module                                        | Tìm kiếm/lọc/sắp xếp/phân trang SQL                       |
| GET /api/reports                                              | Số liệu biểu đồ/bảng từ SQL                               |

Các yêu cầu ghi cần header `X-Bloom-Request: 1`; commands cần `Idempotency-Key`. Cookie cùng origin qua proxy Vite; backend kiểm Origin khi có. Lỗi trả message tiếng Việt và mã 401/403/409/422 thích hợp.

Để giữ UI, các bảng hiện tại vẫn dùng snapshot theo quyền rồi phân trang phía frontend; endpoint lists đã hỗ trợ phân trang SQL để chuyển từng bảng sau này. Báo cáo đã truy vấn SQL trực tiếp. Snapshot/thông báo làm mới mỗi 15 giây, quyền API có hiệu lực ở request tiếp theo.

## Kiểm tra

```sh
npm run typecheck
npm test
npm run api:test
npm run build
```

Các smoke HTTP cần database riêng có tên bắt đầu `bloom_backend_test`, không chạy trên bloom_bakery. `tests/setup.ts` chỉ cho cluster tạm `.tmp/sql-fix-pg` cổng 55439, từ chối schema đã tồn tại. Sau setup, chạy lần lượt auth-smoke, admin-smoke, catalog-smoke, orders-smoke, workflow-smoke, reports-smoke bằng Node strip-types và role `bloom_backend_test_api`. Workflow tạo dữ liệu đối chiếu cho reports nên phải giữ thứ tự. Xem [biên bản nghiệm thu](../docs/BACKEND_VERIFICATION.md).

Hệ thống hiện chạy cục bộ; chưa triển khai hosting. Báo cáo sử dụng business_date của ledger và tồn đầu kỳ suy ra từ dữ liệu hiện có; không tự sửa lịch sử nguồn thiếu/khác ngày chứng từ.
