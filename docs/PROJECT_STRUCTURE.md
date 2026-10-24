# Cấu trúc mã nguồn và luồng hoạt động Bloom Bakery MRP

Đối chiếu mã nguồn tại `D:\bloomBakery`, ngày 18/10/2026. Tài liệu này mô tả cách triển khai hiện có, không phải kiến trúc dự kiến.

## 1. Tổng quan

Ứng dụng có ba phần chạy độc lập: frontend React/TypeScript qua Vite, backend Node.js/TypeScript qua HTTP, database PostgreSQL. Giao diện không kết nối PostgreSQL trực tiếp.

```text
D:\bloomBakery
├── src/                         Frontend
│   ├── app/                     Khởi tạo phiên, router, đồng bộ
│   ├── layouts/                 Khung Admin và khung vận hành
│   ├── features/                Màn hình theo nghiệp vụ, repository và hooks
│   ├── shared/                  Component, kiểu dữ liệu, quyền, HTTP, CSS
│   ├── mocks/                   Dữ liệu giả và xử lý chế độ mock
│   └── main.tsx                 Điểm bắt đầu React
├── backend/
│   ├── src/
│   │   ├── core/                HTTP, validation, lỗi, transaction PostgreSQL
│   │   ├── modules/             Auth và các service nghiệp vụ
│   │   ├── server.ts            HTTP server và các route API
│   │   ├── bootstrap.ts         Patch schema, khởi tạo hash tài khoản nguồn
│   │   └── configure-app-role.ts Tạo/cấp quyền role PostgreSQL ứng dụng
│   ├── database/                SQL patch backend
│   └── tests/                   Unit và kiểm thử HTTP/database
├── database/                    SQL baseline và kiểm thử SQL
├── scripts/                     Công cụ rà soát/tạo/kiểm thử SQL
├── docs/                        Hợp đồng API, kế hoạch, kết quả, ảnh nghiệm thu
├── dist/                        Kết quả build frontend tự sinh
└── node_modules/                Thư viện cài bằng npm
```

Mỗi feature có trang riêng nhưng dùng chung DataTable, Modal, Button, repository và Query cache. Backend hiện dùng route tập trung và service theo module; câu SQL nằm trong service và các file data. Chưa có tầng controller/repository riêng cho từng module. Kiểu dữ liệu/Command được dùng chung giữa backend và frontend qua `src/shared/domain`.

## 2. Các file cấu hình gốc

| File                                  | Chức năng                                                         |
| ------------------------------------- | ----------------------------------------------------------------- |
| `package.json`                        | Dependency và lệnh dev/api/typecheck/test/build/bootstrap/format. |
| `package-lock.json`                   | Khóa phiên bản dependency được cài.                               |
| `index.html`                          | HTML có phần tử root để React render.                             |
| `vite.config.ts`                      | Plugin React; proxy `/api` sang backend cổng 3001 khi phát triển. |
| `tsconfig.json`                       | Cấu hình TypeScript frontend.                                     |
| `src/vite-env.d.ts`                   | Khai báo kiểu môi trường Vite.                                    |
| `.env.example`                        | Mẫu biến môi trường frontend.                                     |
| `.env.local`                          | Cấu hình cục bộ: chọn API/mock và địa chỉ API; không commit.      |
| `.gitignore`                          | Bỏ qua dependency, build, file môi trường riêng, thư mục tạm.     |
| `.prettierrc.json`, `.prettierignore` | Quy tắc định dạng và các file bỏ qua.                             |
| `README.md`                           | Hướng dẫn chạy và nhật ký các sprint.                             |
| `tsconfig.tsbuildinfo`                | Cache TypeScript tự sinh.                                         |

## 3. Frontend: từng file và chức năng

### Khởi tạo, router và layouts

| File trong `src/`                    | Chức năng                                                                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.tsx`                           | Khởi tạo React, QueryClient, BrowserRouter, SessionProvider, DataSyncProvider và AppRouter; nạp CSS.                                                       |
| `app/providers/SessionProvider.tsx`  | Lưu user/flags trong state; login, logout, gọi `/auth/me`; kiểm lại phiên mỗi 15 giây/khi focus; xóa cache khi mất phiên. Chế độ mock dùng sessionStorage. |
| `app/providers/DataSyncProvider.tsx` | Nghe sự kiện localStorage để cập nhật cache khi dữ liệu mock thay đổi ở tab khác; không phải websocket/API realtime.                                       |
| `app/router/Router.tsx`              | Hiển thị login nếu chưa xác thực; tách `/admin` và `/app`; kiểm role layout và quyền đọc module; ánh xạ URL sang trang; giữ màn chọn tài khoản cho mock.   |
| `layouts/AdminLayout.tsx`            | Khung quản trị riêng.                                                                                                                                      |
| `layouts/OperationsLayout.tsx`       | Khung vận hành, sidebar/topbar, nhãn module và menu theo quyền; dùng cho Manager/Employee.                                                                 |

### Màn hình và truy cập dữ liệu

| File trong `src/features/`                       | Chức năng                                                                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth/LoginPage.tsx`                             | Form tài khoản/email + mật khẩu, gọi login và hiển thị lỗi.                                                                                        |
| `dashboard/pages/DashboardPage.tsx`              | Tổng quan tồn kho, NVL thấp, phiếu chờ, lệnh đang sản xuất từ snapshot.                                                                            |
| `catalog/pages/CatalogPage.tsx`                  | Trang dùng chung cho NVL và thành phẩm: danh sách/chi tiết/form, tồn, min_stock, ảnh, tạo phiếu theo ngữ cảnh.                                     |
| `boms/pages/BomsPage.tsx`                        | Danh sách/chi tiết/form định mức; version, active, tạo phiên bản mới và khóa BOM đã dùng.                                                          |
| `production-orders/pages/OrdersPage.tsx`         | Lệnh theo vai trò; chọn thành phẩm/BOM/người được giao; nhu cầu NVL; action theo trạng thái; tiến độ và timeline.                                  |
| `documents/pages/DocumentsPage.tsx`              | Dùng chung cho bổ sung NVL, nhập NVL, xuất NVL, xuất TP; form/chi tiết, ngày nhập, duyệt/từ chối, timeline và action theo trạng thái/quyền.        |
| `users/pages/UsersPage.tsx`                      | Admin tạo/sửa/xóa user, role/active, nhập mật khẩu khi tạo hoặc đặt lại khi sửa.                                                                   |
| `permissions/pages/PermissionsPage.tsx`          | Trang phân quyền; chọn trình chỉnh quyền thật khi chạy API, giữ ma trận vai trò cho mock.                                                          |
| `permissions/pages/AccountPermissionsEditor.tsx` | Tải ma trận từ API, chọn nhiều tài khoản, tick quyền hợp lệ và lưu hàng loạt.                                                                      |
| `reports/pages/ReportsPage.tsx`                  | Bộ lọc thời gian/nhóm, biểu đồ và bảng; API mode lấy số liệu `/reports`.                                                                           |
| `reports/model.ts`                               | Hàm xử lý báo cáo phía frontend, đặc biệt phục vụ dữ liệu mock và hiển thị.                                                                        |
| `notifications/pages/NotificationsPage.tsx`      | Danh sách thông báo, trạng thái đọc và điều hướng tới nội dung liên quan.                                                                          |
| `data/api/repository.ts`                         | Cùng hợp đồng getSnapshot/execute cho API và mock; API gửi command có Idempotency-Key.                                                             |
| `data/hooks/useDatabase.ts`                      | `useDatabase()` tải/cache snapshot; `useCommand()` gửi thao tác ghi và làm mới cache database/report sau thành công. API snapshot polling 15 giây. |

### Thành phần dùng chung và mock

| File trong `src/`                | Chức năng                                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `shared/api/client.ts`           | Wrapper fetch, cookie, base URL, header yêu cầu ghi, parse lỗi; phát sự kiện mất phiên khi nhận 401 ngoài login. |
| `shared/domain/types.ts`         | Kiểu User, Bom, ProductionOrder, StockDocument, Database, trạng thái và dữ liệu giao diện.                       |
| `shared/domain/commands.ts`      | Danh sách thao tác ghi và payload có kiểu: save-user, save-bom, save-order, document-action…                     |
| `shared/domain/permissions.ts`   | Nhãn role, trang chính và kiểm flags để hiện menu/nút/route.                                                     |
| `shared/domain/rules.ts`         | Quy tắc hỗ trợ UI/mock: nhu cầu NVL, điều kiện thao tác, khóa BOM… Backend vẫn kiểm độc lập.                     |
| `shared/domain/format.ts`        | Định dạng số, ngày và dữ liệu hiển thị.                                                                          |
| `shared/ui/primitives.tsx`       | Button, Card, Modal, Notice, badge, timeline, loading, empty/error và thành phần nền.                            |
| `shared/ui/DataTable.tsx`        | Bảng dùng chung: tìm kiếm, lọc, sắp xếp, phân trang, mở chi tiết.                                                |
| `shared/ui/CommandModal.tsx`     | Form modal gửi command, khóa nút khi chờ, hiển thị lỗi và đóng sau thành công.                                   |
| `shared/styles/global.css`       | Token màu, typography, layout, component và responsive.                                                          |
| `mocks/fixtures.ts`              | Dữ liệu giả ban đầu.                                                                                             |
| `mocks/storage.ts`               | Đọc/ghi dữ liệu mock ở trình duyệt.                                                                              |
| `mocks/commands.ts`              | Thực thi command mô phỏng, không dùng để ghi PostgreSQL.                                                         |
| `shared/domain/rules.test.ts`    | Test quy tắc nghiệp vụ frontend.                                                                                 |
| `mocks/storage.test.ts`          | Test lưu/khởi tạo dữ liệu mock.                                                                                  |
| `features/reports/model.test.ts` | Test tính báo cáo phía frontend.                                                                                 |

## 4. Backend: từng file và chức năng

### Cấu hình và core

| File trong `backend/`               | Chức năng                                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                         | Hướng dẫn môi trường/chạy API, quyền, API và kiểm thử.                                                                                  |
| `tsconfig.json`                     | Kiểm tra TypeScript backend và test.                                                                                                    |
| `.env.example`                      | Mẫu biến PGHOST/PGPORT/PGDATABASE/PGUSER, SESSION_SECRET, cổng và origin.                                                               |
| `.env.local`                        | Cấu hình role ứng dụng để chạy API; chứa thông tin riêng, không commit.                                                                 |
| `.env.admin.local`                  | Cấu hình quản trị phục vụ bootstrap/DDL; tách khỏi role API, không commit.                                                              |
| `src/server.ts`                     | HTTP server: health, auth, snapshot, permissions, reports, lists, commands; kiểm header/origin và trả lỗi.                              |
| `src/bootstrap.ts`                  | Áp dụng patch; khởi tạo hash cho ba tài khoản nguồn chưa có hash; chuẩn bị secret khi cần.                                              |
| `src/configure-app-role.ts`         | Thiết lập role PostgreSQL ứng dụng và quyền DML; không chạy API bằng superuser.                                                         |
| `src/core/db.ts`                    | Pool kết nối, search_path/timezone, đọc DATE, helper transaction/rollback, helper truy vấn và sinh ID.                                  |
| `src/core/http.ts`                  | Đọc JSON có giới hạn dung lượng, trả response JSON và header.                                                                           |
| `src/core/validation.ts`            | Kiểm text/số/ngày/dòng chi tiết; giới hạn precision và dữ liệu hợp lệ.                                                                  |
| `src/core/errors.ts`                | HttpError/ensure; chuyển lỗi SQL/kết nối thành HTTP và thông báo tiếng Việt, không trả chi tiết nhạy cảm.                               |
| `database/001_auth_permissions.sql` | Bổ sung user_permissions, api_request_keys, auth_version, quyền/index cần thiết, đồng bộ has_permission(); không tạo schema_migrations. |

### Các module

| File trong `backend/src/modules/` | Chức năng                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `auth/routes.ts`                  | Login/me/logout, giới hạn số lần đăng nhập sai, kiểm password/active.                                                       |
| `auth/password.ts`                | Hash scrypt có salt và so sánh mật khẩu.                                                                                    |
| `auth/session.ts`                 | Tạo/kiểm token HMAC, cookie HttpOnly, hạn 8 giờ; auth_version; đọc quyền hiệu lực và requirePermission().                   |
| `commands.ts`                     | Phân loại command, kiểm permission theo action, idempotency, gọi đúng service; chặn command không hỗ trợ.                   |
| `users/service.ts`                | CRUD user, mật khẩu/thu hồi phiên, ma trận quyền, gán quyền hàng loạt và bảo vệ tự mất quyền Admin.                         |
| `catalog/service.ts`              | CRUD NVL/TP/đơn vị/BOM, active/version, bảo vệ dữ liệu đã tham chiếu, không sửa tồn trực tiếp từ form.                      |
| `production/service.ts`           | Tạo/sửa lệnh và pin BOM, giao nhân viên, kiểm chủ sở hữu, start/progress/complete/cancel.                                   |
| `documents/service.ts`            | Tạo/sửa/xóa/duyệt/từ chối/chuyển trạng thái các loại phiếu, tồn khả dụng, ngày nhập và quy tắc xuất một lần; đọc thông báo. |
| `data/snapshot.ts`                | Đọc DB, map snake_case → DTO frontend, số/ngày, dữ liệu theo quyền/owner, nhu cầu NVL và timeline.                          |
| `data/lists.ts`                   | Danh sách SQL có count/search/filter/sort/pagination và scope Employee.                                                     |
| `reports/service.ts`              | Tổng hợp báo cáo từ ledger theo business_date, ngày/tháng/quý/năm.                                                          |
| `events/service.ts`               | Ghi business_events và notifications trong transaction nghiệp vụ.                                                           |

Không có Express/Nest, ORM hoặc repository backend riêng ở hiện trạng. HTTP dùng Node, SQL dùng thư viện pg; SQL được tham số hóa trong service/data.

### Kiểm thử backend

| File trong `backend/tests/` | Chức năng                                                                  |
| --------------------------- | -------------------------------------------------------------------------- |
| `foundation.test.ts`        | Ánh xạ lỗi HTTP an toàn, thông báo lỗi kết nối DB.                         |
| `auth.test.ts`              | Hash mật khẩu, token và cờ quyền.                                          |
| `db-smoke.ts`               | Kết nối DB, transaction và rollback bảng tạm.                              |
| `setup.ts`                  | Chuẩn bị database test mới, kiểm tên/cổng/cluster để tránh database chính. |
| `auth-smoke.ts`             | Login, cookie, sai mật khẩu, logout/thu hồi phiên.                         |
| `admin-smoke.ts`            | User/mật khẩu, deny, quyền DB/API, bảo vệ Admin.                           |
| `catalog-smoke.ts`          | Danh mục, BOM phiên bản/precision/active và quyền.                         |
| `orders-smoke.ts`           | Pin BOM, inactive, quyền sở hữu, idempotency.                              |
| `workflow-smoke.ts`         | Luồng chứng từ/sản xuất đầy đủ, đồng thời, rollback, timeline.             |
| `reports-smoke.ts`          | Đối chiếu báo cáo SQL, lọc/ngày, phân trang scope và thu hồi quyền.        |

## 5. SQL, scripts và tài liệu

| Đường dẫn                                                                | Chức năng                                                                                                               |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `database/bakery_mrp_official.sql`                                       | Baseline chính thức import database trống: bảng, ràng buộc, trigger/hàm hiện có, BOM version và bom_id trên dòng lệnh.  |
| `database/OFFICIAL_README.md`                                            | Hướng dẫn baseline chính thức và trách nhiệm backend.                                                                   |
| `database/tests/official-workflows.sql`                                  | Kiểm nghiệp vụ SQL baseline chính thức.                                                                                 |
| `database/tests/official-concurrency.sql`                                | Kiểm đồng thời baseline chính thức.                                                                                     |
| `scripts/build-official-database.mjs`                                    | Công cụ tạo SQL chính thức từ quá trình chỉnh schema.                                                                   |
| `scripts/prepare-official-import-check.mjs`                              | Chuẩn bị kiểm tra trước import chính thức.                                                                              |
| `scripts/test-official-database.mjs`                                     | Chạy bộ kiểm SQL chính thức.                                                                                            |
| `scripts/review-database.mjs`                                            | Rà soát cấu trúc SQL.                                                                                                   |
| `docs/API_CONTRACT.md`                                                   | Tài liệu hợp đồng frontend/API từ quá trình phát triển; đối chiếu server.ts và backend/README.md cho endpoint hiện tại. |
| `docs/BACKEND_SPRINT_PLAN.md`                                            | Phạm vi/tiêu chí 9 sprint backend.                                                                                      |
| `docs/BACKEND_VERIFICATION.md`, `docs/backend-verification-results.json` | Biên bản và kết quả backend.                                                                                            |
| `docs/VERIFICATION.md`                                                   | Biên bản kiểm giao diện trong các giai đoạn trước.                                                                      |
| `docs/database-official-test-results.json`                               | Kết quả kiểm thử baseline SQL chính thức.                                                                               |
| `docs/database-official-import-results.json`                             | Kết quả import database chính.                                                                                          |
| `docs/database-official-static-review.json`                              | Kết quả rà soát tĩnh SQL chính thức.                                                                                    |
| `docs/screenshots/`                                                      | Ảnh nghiệm thu giao diện.                                                                                               |

Nhóm lịch sử: `database/bakery_mrp_fixed.sql`, `database/README.md`, `database/migrations/20261018_frontend_alignment.sql`, `20261018_revised_source_alignment.sql`, `20261018_single_material_issue.sql`; các test `workflows.sql`, `concurrency-setup.sql`, `concurrency-restock.sql`; scripts `build-fixed-database.mjs`, `test-fixed-database.mjs`; docs `DATABASE_REVIEW.md`, `DATABASE_RECHECK_20261018.md`, `DATABASE_INVENTORY.md`, `database-audit-summary.json`, `database-test-results.json`, `database-recheck-20261018.json`. Chúng lưu phương án/rà soát cũ, không import kèm baseline chính thức và không mô tả đầy đủ schema hiện tại.

`dist/`, `node_modules/`, `.tmp/` và các file cache là dữ liệu tự sinh/phụ thuộc/thử nghiệm; không chỉnh chúng để thay đổi chức năng ứng dụng.

## 6. Luồng chạy và tải trang

1. PostgreSQL chính cần chạy và nhận kết nối. `npm run api` khởi động server cổng 3001; `npm run dev` chạy Vite ở 5173.
2. Trình duyệt tải index.html → main.tsx → providers → AppRouter.
3. API mode: SessionProvider gọi GET `/api/auth/me`; chưa có phiên hợp lệ thì AppRouter hiển thị LoginPage.
4. Khi có user, LayoutGuard chọn Admin/Operations; ModuleGuard kiểm flags.read trước khi hiện trang.
5. Trang gọi useDatabase → repository → HTTP GET `/api/snapshot`; Vite proxy sang server.
6. Backend kiểm phiên/active/auth_version, đọc quyền hiện tại; snapshot chỉ trả dữ liệu được phép và thuộc phạm vi người dùng. Mật khẩu/hash không trả về frontend.
7. TanStack Query cache theo user; component render. Snapshot làm mới 15 giây; DataSyncProvider chỉ phục vụ đồng bộ mock qua storage.

## 7. Luồng đăng nhập và quyền

1. LoginPage gửi POST `/auth/login` với login/password qua client.ts.
2. Server kiểm origin/header, đọc JSON; auth/routes.ts tìm username/email và xác minh scrypt, active/rate limit.
3. actorById tải role và bản đồ flags bằng has_permission(); cookie có chữ ký chứa ID/auth_version/thời hạn, không chứa quyền cũ để bỏ qua DB.
4. Server trả DTO user + Set-Cookie HttpOnly. SessionProvider lưu user trong bộ nhớ và chuyển trang theo role.
5. Mỗi request bảo vệ đọc lại user/active/auth_version và quyền hiệu lực. Không có flag hoặc false → 403; phiên không hợp lệ → 401.
6. Admin chọn tài khoản và tick quyền → POST `/permissions`; service kiểm quyền gán, giới hạn role và bảo vệ Admin, ghi cả batch trong transaction.
7. Override false thắng role mặc định true. Thu hồi quyền chặn request kế tiếp; UI làm mới định kỳ. Đổi password/role/active tăng auth_version làm phiên cũ mất hiệu lực.

## 8. Luồng ghi dữ liệu và transaction

```text
Người dùng bấm Lưu / Duyệt / Hoàn thành
  → Page hoặc CommandModal
  → useCommand → repository.execute → client.ts
  → POST /api/commands + cookie + Idempotency-Key
  → server.ts mở transaction, authenticate()
  → commands.ts kiểm loại command và permission
  → service kiểm owner, trạng thái, số lượng; khóa dòng cần thiết
  → INSERT/UPDATE bằng SQL tham số hóa
  → trigger DB hiện có xử lý tồn/ledger khi đủ điều kiện
  → service ghi timeline/thông báo
  → COMMIT → HTTP 204
  → frontend invalidate database/report cache → tải lại → render
```

Nếu có lỗi ở bất kỳ bước trong transaction thì ROLLBACK: phiếu/trạng thái/tồn/ledger/sự kiện/thông báo cùng quay về trước thao tác. API trả lỗi, modal hiển thị message. Khóa dòng ngăn hai request cùng vượt điều kiện; cùng idempotency key và nội dung đã thành công thì không chạy lại. Repository hiện tạo key mỗi lần execute; chống retry chỉ có hiệu lực khi tái sử dụng đúng key, không phải mọi lần bấm độc lập dùng cùng key.

## 9. Luồng sản xuất và tồn kho

1. Manager tạo lệnh nhiều sản phẩm, mỗi dòng chọn BOM active và target, giao Employee. production/service.ts lưu bom_id; BOM đã tham chiếu không sửa nội dung/xóa. Đổi active không đổi lệnh cũ.
2. Employee mở lệnh pending. Nếu thiếu NVL, tạo bổ sung từ lệnh hoặc từ min_stock; Manager duyệt/từ chối, từ chối phải có lý do.
3. Manager tạo tối đa một phiếu nhập từ bổ sung approved, nhập NCC/ngày nhập/số lượng. Chỉ sửa draft; draft → pending → completed, không bỏ bước. Số lượng nhập có thể khác yêu cầu nhưng phải đạt tối thiểu cần thiết. Khi pending khóa nội dung theo rule.
4. Completed receipt: trigger hiện có tăng tồn NVL/ghi ledger và fulfilled bổ sung. Backend ghi event/notification cùng transaction.
5. Employee tạo xuất NVL từ lệnh pending. Backend khóa PO, chặn phiếu thứ hai nếu đã có pending/approved; rejected cho tạo thay thế. Vì chỉ xuất một lần, phiếu phải đủ toàn bộ định mức.
6. Manager duyệt xuất NVL khi đủ tồn. Trigger trừ NVL/ghi ledger. Quy tắc số lần xuất nằm ở backend, không thêm trigger/index đếm phiếu.
7. Khi NVL đã xuất đủ và duyệt, Employee bắt đầu → in_progress; chỉ cập nhật actual trong khoảng 0..target hoặc hoàn thành.
8. Complete: trigger nhập TP theo actual; backend ghi event/thông báo. Lệnh completed không có nút xuất TP.
9. Employee tạo xuất TP từ kho, Manager duyệt khi đủ tồn; trigger trừ kho TP. Không tạo xuất TP từ lệnh completed.

Hủy lệnh chỉ khi pending và chưa có NVL đã xuất; service còn kiểm các phiếu liên quan đang chờ. Không tự cho nhảy qua hoàn trả chưa có trong hệ thống.

## 10. Báo cáo, bảng và thông báo

- ReportsPage gọi GET `/api/reports` → kiểm reports.read → service SQL tổng hợp ledger theo business_date → DTO points → biểu đồ/bảng hiện có. Lọc và nhóm ngày/tháng/quý/năm; tồn đầu kỳ được suy ra từ dữ liệu hiện có.
- Danh sách hiện dùng snapshot và phân trang/lọc/sắp xếp ở DataTable frontend. GET `/api/lists/:module` đã hỗ trợ phân trang SQL, chưa chuyển toàn bộ bảng UI sang endpoint này.
- Events service ghi business_events để timeline chi tiết hiển thị ai/lúc nào/thao tác gì. Dữ liệu lịch sử nguồn thiếu event chỉ hiển thị thông tin có thể suy ra, không bịa lịch sử.
- Notifications chỉ tải của actor; service ghi cùng transaction, trang/badge đọc từ snapshot, làm mới 15 giây. Đánh dấu đọc là command có kiểm người sở hữu.

## 11. Điểm sửa khi phát triển tiếp

- Đổi bố cục/màu: layouts, primitives.tsx, global.css.
- Đổi một màn hình: features/<module>/pages.
- Thêm command: shared/domain/commands.ts + service backend + modules/commands.ts; bổ sung permission/validation và kiểm thử phù hợp.
- Đổi nghiệp vụ: service backend tương ứng; rules.ts hỗ trợ UI cần đồng bộ nhưng không thay thế bảo vệ backend.
- Đổi dữ liệu hiển thị: types.ts + snapshot.ts; báo cáo dùng reports/service.ts.
- Đổi schema: SQL bổ sung được rà soát, không import lại baseline lên database đã có dữ liệu.

Lỗi đăng nhập được kiểm tra gần nhất do dịch vụ PostgreSQL chính dừng, API không kết nối cổng 5432. Thông báo lỗi DB đã được bổ sung trong mã nguồn; đây là thay đổi sau bộ nghiệm thu 9 sprint. Lần khởi động dịch vụ có quyền quản trị chưa được thực hiện vì yêu cầu nâng quyền đã bị từ chối. Không coi đăng nhập đã được khôi phục chỉ dựa trên việc sửa message.
