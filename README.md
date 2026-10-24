# Bloom Bakery MRP

Tài liệu mã nguồn: [Cấu trúc thư mục, chức năng từng file và luồng hoạt động](docs/PROJECT_STRUCTURE.md).

Ứng dụng quản lý nguyên vật liệu, thành phẩm và sản xuất cho tiệm bánh, gồm frontend React và backend Node.js/PostgreSQL. Ngôn ngữ tiếng Việt; ưu tiên desktop và tablet.

## Chạy cục bộ

Yêu cầu Node.js 24 (backend dùng TypeScript strip-types), PostgreSQL 18.

```sh
npm install
npm run api  # terminal 1
npm run dev  # terminal 2
```

Các lệnh kiểm tra: `npm run typecheck`, `npm test`, `npm run build`.

Định dạng mã nguồn: `npm run format`.

Mở http://127.0.0.1:5173 để đăng nhập bằng admin / manager / employee, mật khẩu ban đầu 12345. Chế độ API đã được cấu hình cục bộ; hướng dẫn môi trường, kiến trúc và API tại [backend/README.md](backend/README.md). Mock chỉ dùng khi VITE_DATA_SOURCE không phải api.

## Phạm vi

**Bản SQL chính thức hiện hành:** [database/bakery_mrp_official.sql](database/bakery_mrp_official.sql), dùng BOM có phiên bản và dòng lệnh tham chiếu bom_id. Có 25 bảng, 18 trigger và 11 hàm; không thêm trigger, không có bảng snapshot/tổng nhu cầu/migration, không đặt quy tắc xuất NVL một lần trong database. **Đã đạt 54 kiểm tra nghiệp vụ + 4 kiểm tra đồng thời trên PostgreSQL 18.6 và import vào database mới bloom_bakery tại 127.0.0.1:5432**, schema bakery_mrp. [Kết quả kiểm thử](docs/database-official-test-results.json), [kết quả import](docs/database-official-import-results.json), [hướng dẫn Backend](database/OFFICIAL_README.md). File nguồn Downloads giữ nguyên.

Các file bakery_mrp_fixed.sql, migration và báo cáo trước đó là bản thử nghiệm/lịch sử, không import kèm file chính thức. Kết quả 67 + 4 của bản trước không áp dụng cho file chính thức. Backend đã triển khai và kết nối database chính qua role ứng dụng riêng. Database bloom_bakery mới đã được tạo/import sau khi kiểm tra tên chưa tồn tại; không ghi đè các database cũ.

Phát triển cục bộ, chưa triển khai hosting. Dữ liệu giả lập không thay thế xác thực, phân quyền hoặc giao dịch tồn kho ở Backend. Tài liệu quyền tham chiếu: `C:/Users/My/Downloads/Module.txt` cùng các cập nhật của người dùng trong chat.

## Kiến trúc

Danh mục 28 bảng/48 trigger trước đây ở [docs/DATABASE_INVENTORY.md](docs/DATABASE_INVENTORY.md) thuộc bản thử nghiệm cũ. Bản chính thức dùng cấu trúc trong [database/OFFICIAL_README.md](database/OFFICIAL_README.md). Frontend đang dùng API; BOM có phiên bản/active và mỗi dòng lệnh lưu bom_id. Patch backend bổ sung 2 bảng quyền/idempotency và auth_version; không thêm trigger hoặc schema_migrations.

- `src/app`: router và providers.
- `src/layouts`: AdminLayout riêng với OperationsLayout.
- `src/features`: màn hình theo module, hooks và API truy cập dữ liệu.
- `src/shared/ui`: component giao diện dùng chung.
- `src/shared/domain`: types, quyền và quy tắc nghiệp vụ.
- `src/shared/api`: HTTP client, hợp đồng repository.
- `src/mocks`: fixtures và mock repository.
- `src/shared/styles`: design token, layout và responsive.

Luồng dữ liệu: UI → hooks/TanStack Query → repository → mock hoặc HTTP. Không gọi HTTP trực tiếp từ component trình bày. Bộ lọc danh sách lưu trên URL.

## Kế hoạch và nhật ký sprint

### Tiến độ triển khai Backend

- **Sprint 1 hoàn thành:** backend/src tách core HTTP/database/error; pool PostgreSQL, transaction rollback, health endpoint, proxy Vite. `npm run api:check` đạt, `npm run api:test` 1 test đạt; db-smoke kết nối bloom_bakery và rollback bảng TEMP thành công, không sửa dữ liệu nghiệp vụ. Cấu hình kết nối cục bộ ở backend/.env.local (không commit); không ghi mật khẩu vào README.
- **Sprint 2 hoàn thành:** login/me/logout bằng cookie HttpOnly, token có chữ ký/hết hạn và phiên vô hiệu sau logout; kiểm active, rate limit và bảo vệ yêu cầu ghi bằng header/origin. Khởi tạo đúng 3 tài khoản nguồn bằng hash mật khẩu 12345; chạy bootstrap lần hai khởi tạo 0 tài khoản, không reset mật khẩu đã đặt. SessionProvider có chế độ API/login thật, giữ mock để kiểm tra baseline. HTTP smoke trên bloom_backend_test_v1 xác nhận cả 3 tài khoản, sai mật khẩu, cookie và thu hồi phiên; unit hash/token/quyền và TypeScript đạt.
- **Sprint 3 hoàn thành:** Admin CRUD user/mật khẩu, ma trận checkbox và gán quyền nhiều tài khoản; user_permissions có cờ boolean, has_permission() đồng bộ với API, guard chống tự mất quyền quản trị. HTTP smoke trên DB test đạt: mật khẩu Admin đặt, bỏ tick → 403 không thay dữ liệu, parity quyền DB, bảo vệ tự khóa, đổi mật khẩu thu hồi phiên và xóa user chưa có lịch sử. UI dùng quyền hiệu lực ở route/sidebar và thao tác Admin.
- **Sprint 4 hoàn thành:** API danh mục và BOM phiên bản, chuyển active trong transaction, giữ phiên bản cũ; màn BOM thêm version/active và trạng thái khóa. HTTP smoke đạt tạo danh mục, định mức 6 số lẻ, trùng version, chuyển active và cờ deny. Mock được cập nhật để giữ BOM phiên bản khi kiểm tra baseline.
- **Sprint 5 hoàn thành:** API tạo/sửa lệnh gắn bom_id từng dòng, chọn BOM active và giữ version của lệnh cũ; UI thêm selector BOM. HTTP smoke đạt pin version, chuyển active không đổi lệnh, chặn inactive mới, idempotency, server giữ created_by/progress và scope Employee. TypeScript đạt.
- **Sprint 6–7 hoàn thành kiểm thử API:** 35 kiểm tra HTTP toàn luồng bổ sung/nhập/xuất/sản xuất/xuất TP trên DB test; kiểm một phiếu xuất bằng khóa PO, request đồng thời chỉ một thành công, quantity đủ BOM, nhận khác yêu cầu đạt tối thiểu, ngày nhập, trạng thái, phiên, ownership, retry/idempotency, timeline và thông báo. Kiểm thêm rollback sau khi trigger ghi tồn nhưng bước service sau đó lỗi: stock/status/ledger đều giữ nguyên. Quy tắc một lần chỉ nằm ở service Backend, không thêm trigger/index vào DB.
- **Sprint 8 hoàn thành:** báo cáo SQL theo business_date với ngày/tháng/quý/năm, frontend chart/bảng giữ nguyên và dùng API; snapshot có dashboard/thông báo thực, polling 15 giây; API lists phân trang/sắp xếp/tìm kiếm/lọc trạng thái/ngày và scope Employee. HTTP smoke đối chiếu nhập 12/xuất 10/tồn 2 theo 4 nhóm thời gian, ngày lỗi, phân trang sở hữu và thu hồi reports.read ngay trên phiên đang dùng.
- **Sprint 9 hoàn thành:** TypeScript frontend/backend đạt, 28 test frontend + 3 test unit backend đạt, 6 smoke suite HTTP đạt trên PostgreSQL test với role DML riêng; build production đạt. Kiểm tra trình duyệt đăng nhập, checkbox quyền và BOM/lệnh. Hướng dẫn chạy/API tại backend/README.md; biên bản tại docs/BACKEND_VERIFICATION.md.

### Kế hoạch Backend

[Kế hoạch 9 sprint Backend](docs/BACKEND_SPRINT_PLAN.md): nền tảng → auth → Admin/quyền tài khoản → danh mục/BOM → lệnh → bổ sung/nhập → xuất/sản xuất → báo cáo/thông báo → kiểm thử bàn giao. Giữ giao diện nghiệp vụ hiện có; chỉ mở rộng BOM, chọn phiên bản BOM trên lệnh, checkbox quyền theo tài khoản và các trường đăng nhập/mật khẩu cần thiết.

Đã khởi tạo mật khẩu **12345** một lần cho 3 tài khoản nguồn, lưu scrypt có salt; chạy lại không reset. Admin nhập mật khẩu khi tạo và có thể đặt lại khi sửa tài khoản. Mỗi sprint được cập nhật tại phần tiến độ phía trên.

Cờ phân quyền bắt buộc: mỗi module/action có quyền hiệu lực true/false. Chỉ true được phép đi tiếp; false hoặc không được cấp phải bị Backend từ chối bằng 403, kể cả gọi API trực tiếp. Override false thắng mặc định role; thu hồi quyền áp dụng ở request tiếp theo, không chỉ ẩn nút giao diện. Chi tiết và tiêu chí kiểm thử nằm trong kế hoạch Backend.

### Kiểm thử và import SQL chính thức vào PostgreSQL — Hoàn thành

- Restore file chính thức vào database thử nghiệm tách biệt, chạy bộ test dành riêng cho BOM phiên bản, không dùng test snapshot/migration cũ.
- **54 kiểm tra nghiệp vụ + 4 kiểm tra đồng thời đạt** trên PostgreSQL 18.6, gồm giữ BOM v1 cho lệnh cũ sau khi kích hoạt v2, trừ tồn/nhập TP đúng một lần và rollback toàn bộ khi lỗi giữa phiếu.
- Xác nhận quy tắc số lần xuất và timeline không có trigger mới; kiểm thử API cho các quy tắc Backend vẫn thuộc bước triển khai Backend sau.
- Theo yêu cầu người dùng, tạo mới/import database **bloom_bakery**, host **127.0.0.1**, port **5432**, schema **bakery_mrp** trên cụm PostgreSQL chính D:/PostgreSQL/18/data. Đã kiểm tra database chưa tồn tại trước khi tạo và trống trước import; không xóa/ghi đè dữ liệu cũ.
- Sau COMMIT, kiểm tra 25 bảng/18 trigger/11 hàm, constraint đã validate, số dòng từng bảng khớp seed. Chỉ import file chính thức, không đưa dữ liệu kiểm thử vào database chính.
- Lưu bằng chứng và hash SQL ở [database-official-test-results.json](docs/database-official-test-results.json), [database-official-import-results.json](docs/database-official-import-results.json). Không lưu mật khẩu người dùng vào dự án.

### SQL chính thức theo BOM phiên bản — Hoàn thành bàn giao file

- Tạo file SQL độc lập cho database PostgreSQL 18 trống, giữ dữ liệu nguồn và sửa định dạng/quan hệ dữ liệu; dùng INSERT chuẩn thay COPY để dễ import bằng SQL client.
- BOM nhiều phiên bản theo sản phẩm, tối đa một active; mỗi dòng lệnh gắn bom_id và FK kép đảm bảo đúng sản phẩm. Sửa guard_bom hiện có để phiên bản đã dùng bất biến nhưng được ngừng hoạt động; lệnh cũ vẫn dùng phiên bản đã chọn.
- Không tạo bảng snapshot, tổng nhu cầu hoặc schema migration. Chỉ thêm business_events rỗng cho Backend ghi timeline.
- Giữ 18 trigger/11 hàm nguồn, không thêm trigger. Không có index/trigger đếm số lần xuất NVL hoặc buộc xuất đủ BOM trong phiếu: để Backend xử lý theo chỉ đạo mới nhất.
- Chỉnh các hàm sẵn có: tính nhu cầu bằng BOM trên dòng lệnh, nhận lượng nhập khác yêu cầu, ghi ledger theo ngày nghiệp vụ; giữ trigger ghi tồn để API không ghi hai lần.
- Rà soát tĩnh 25 bảng, số cột/dữ liệu seed, 37 FK có dữ liệu đối chiếu, UNIQUE và phiên bản BOM. Không chạy PostgreSQL, không gọi bộ test SQL cũ. Ghi hash ở [database-official-static-review.json](docs/database-official-static-review.json).
- Hướng dẫn import, danh sách phần Backend phải xử lý và giới hạn dữ liệu lịch sử: [OFFICIAL_README.md](database/OFFICIAL_README.md). Giữ nguyên SQL nguồn.

### Sửa theo SQL nguồn mới nhất ngày 18/10/2026 — Hoàn thành

- Giữ cột completion_date, metadata duyệt và các ngày người dùng bổ sung; chỉ chuyển ngày nhập/hạn hoàn thành về DATE theo giờ Việt Nam, không ghi đè bằng ngày tạo.
- Sửa dấu TAB bị thiếu ở COPY BOM, phiếu nhập, lệnh; chuẩn hóa version BOM `1,0` thành `1.0`, số nguyên ledger và dấu phẩy dư trong bảng xuất TP. Script từ chối COPY còn lệch cột sau các sửa đã xác định.
- Migration riêng cho schema mới: [20261018_revised_source_alignment.sql](database/migrations/20261018_revised_source_alignment.sql). Không dùng migration của bản nguồn cũ hoặc chạy cả hai.
- Bổ sung snapshot BOM và nhu cầu gộp, từ chối BOM không hoạt động; khóa ngày nhập khi pending, cho nhập khác số yêu cầu theo mức thiếu hiện tại.
- Xuất từng phần hợp lệ; tổng pending + approved không vượt snapshot, phiếu rejected giải phóng lượng chờ. Khóa dòng lệnh/tồn khi xử lý đồng thời.
- Lưu timeline cùng giao dịch, chống tự chèn/sửa sự kiện; kiểm quyền ghi, người duyệt thực tế và quyền sở hữu ở cả header/chi tiết. Backend vẫn phải xác thực và lọc dữ liệu SELECT.
- **67 kiểm tra nghiệp vụ + 4 kiểm tra đồng thời đạt**; kiểm tra riêng dữ liệu nguồn giữ ngày nhập RN01, hạn/thời điểm hoàn thành PO01 và 3 BOM sau sửa định dạng. Chỉ thử trên cụm PostgreSQL tạm; không sửa database đang dùng.
- Dữ liệu lịch sử còn cần đối chiếu: RN01 được nguồn đặt ngày nhập 10/10 nhưng biến động xuất liên quan ghi 07/10. Giữ nguyên ngày nguồn, ghi rõ giới hạn báo cáo trong hướng dẫn database.

### Sửa database lần đầu ngày 18/10/2026 — Hoàn thành (lịch sử)

- Tạo bản SQL đầy đủ cho database trống và migration riêng cho schema hiện có; ghi SHA-256 nguồn để nhận diện phiên bản.
- Chuẩn hóa dữ liệu số nguyên trong dump để restore được; đối chiếu quyền bằng mã module. Bản nguồn mới nhất đã sửa các tham chiếu quyền sai được phát hiện ở lần rà soát trước.
- Thêm ngày nhập hàng, ngày cần hoàn thành, snapshot BOM/nhu cầu lệnh, timeline sự kiện và thông báo; đánh dấu dữ liệu lịch sử suy ra thay vì coi là lịch sử chính xác.
- Điều chỉnh lượng nhập khác số yêu cầu nhưng đủ mức tối thiểu; khóa quy trình theo trạng thái, quyền và người được giao; bảo vệ tồn, tiến độ và chứng từ đã kết thúc.
- Kiểm thử thực tế bổ sung → nhập → xuất NVL → sản xuất → nhập TP → xuất TP, rollback khi lỗi giữa giao dịch và hai yêu cầu duyệt đồng thời. Lần đầu đạt **57 kiểm tra nghiệp vụ + 4 kiểm tra đồng thời**; kết quả JSON hiện được thay bằng kết quả bản mới nhất ở trên.
- Giữ nguyên dữ liệu/mật khẩu nguồn; ba tài khoản có password_hash rỗng cần được thiết lập qua quy trình xác thực khi làm Backend. Không tạo mật khẩu mặc định.
- Hướng dẫn restore, migration, truyền người thao tác, báo cáo theo ngày nghiệp vụ và các phần Backend còn phải làm: [database/README.md](database/README.md). Giao diện tiếp tục dùng mock hiện tại.

### Cập nhật ngày 18/10/2026

- Bỏ lọc thời gian tại danh mục NVL, thành phẩm và BOM cho tất cả vai trò được truy cập. Các bộ lọc ngày cũ trên URL không còn tác dụng ở các màn này.
- Nút **Tạo định mức mới** luôn mở được cho Manager. Chỉ chọn thành phẩm chưa có BOM theo quy tắc mỗi sản phẩm một BOM; nếu đã đủ BOM thì hiển thị hướng dẫn tới danh mục thành phẩm để thêm sản phẩm mới. Không mở quyền tạo BOM cho Admin/Employee.
- Form nhập NVL: bỏ cột Nhận tối thiểu, đổi Đã yêu cầu thành **Số lượng yêu cầu**, Số lượng nhận thành **Số lượng nhập**. Quy tắc kiểm tra lượng nhập tối thiểu vẫn được giữ; ngày nhập hàng giữ nguyên.
- Bỏ nhãn môi trường, phiên bản ở sidebar và câu khẩu hiệu ở footer theo yêu cầu.
- Lệnh completed không còn nút xuất TP. Employee tạo xuất từ kho thành phẩm (có thể chọn mặt hàng sẵn từ chi tiết thành phẩm) hoặc màn phiếu xuất lấy từ kho; không tạo mới gắn PO, kể cả qua URL cũ. Phiếu cũ có PO vẫn xem được để giữ lịch sử.
- Các mô tả sprint và ảnh phía dưới ghi lại phiên bản trước; thay đổi hiện hành ưu tiên mục cập nhật này.
- Kiểm tra cập nhật: **26/26 tests đạt; TypeScript và production build thành công**. Đã kiểm tra trực tiếp tạo/lưu BOM mới, form nhập mới, không có nút xuất ở lệnh completed, chặn URL tạo xuất từ PO và mở phiếu xuất từ kho. Đối chiếu bỏ lọc ngày ở các màn dùng chung cho Manager, Employee và Admin.
- Ảnh form nhập mới: [receipt-update-2026-10-18.png](docs/screenshots/receipt-update-2026-10-18.png).

| Sprint | Nội dung                                   | Trạng thái |
| ------ | ------------------------------------------ | ---------- |
| 1      | Nền tảng, layout, router, quyền, component | Hoàn thành |
| 2      | Admin, tài khoản, ma trận quyền            | Hoàn thành |
| 3      | Nguyên liệu, thành phẩm, BOM               | Hoàn thành |
| 4      | Lệnh sản xuất                              | Hoàn thành |
| 5      | Bổ sung và nhập NVL, ngày nhập hàng        | Hoàn thành |
| 6      | Xuất NVL, xuất TP, luồng xuyên suốt        | Hoàn thành |
| 7      | Dashboard, báo cáo, thông báo              | Hoàn thành |
| 8      | Kiểm thử tổng thể và tài liệu tích hợp     | Hoàn thành |

### Sprint 1 — Hoàn thành

- Khởi tạo React, TypeScript, Vite và cấu trúc thư mục component-based.
- Chuẩn bị React Router, TanStack Query, Lucide và Vitest.
- Hai layout độc lập về nhận diện, router kiểm tra vai trò/module, tài khoản demo tại `/demo`.
- DataTable có tìm kiếm không dấu, bộ lọc ngày/trạng thái, sắp xếp, phân trang và state trên URL.
- Component dùng chung: Modal, CommandModal, Badge/StatusBadge, Card, Field, Timeline, Notice, Loading, ErrorState, EmptyState.
- Mock repository lưu localStorage; TanStack Query tách data state khỏi UI; HTTP adapter được chuẩn bị.
- Kiểm tra: production build thành công; 11 bài kiểm thử quyền và nghiệp vụ thành công. Vite/esbuild cần chạy ngoài sandbox trên môi trường hiện tại.

### Sprint 2 — Hoàn thành

- Trang quản lý tài khoản: tạo/sửa/xóa, role, active, tìm kiếm và phân trang.
- Chặn email trùng, tự xóa/tự khóa Admin, đổi role nhân viên còn lệnh đang chạy và xóa tài khoản có tham chiếu.
- Trang ma trận quyền cố định; gán role qua form tài khoản. Không tạo role tùy biến ngoài phạm vi.
- Admin có route xem nghiệp vụ, không có quyền sửa; các màn cụ thể tiếp tục được xây dựng ở sprint tương ứng.
- Kiểm tra quyền trong cả route/UI và mock command; có bài kiểm thử chặn thao tác trái vai trò.

### Sprint 3 — Hoàn thành

- NVL/TP: tìm kiếm, lọc tồn và ngày, sắp xếp, phân trang, chi tiết và CRUD theo quyền.
- Tồn không sửa trực tiếp; danh mục mới tồn bằng 0. Không đổi đơn vị danh mục đã có tham chiếu/tồn.
- Thành phẩm hỗ trợ chọn ảnh PNG/JPEG/WebP dưới 1,5 MB (lưu data URL trong mock).
- BOM nhiều dòng; kiểm tra nguyên liệu trùng, định mức dương, mỗi TP một BOM; khóa BOM đang dùng.
- Admin chỉ xem; Employee xem NVL/TP và có đường dẫn bổ sung từ tồn NVL.
- Kiểm tra: TypeScript thành công; bộ test khóa BOM thành công.

### Sprint 4 — Hoàn thành

- Lệnh nhiều thành phẩm, giao Employee, ngày cần hoàn thành và ghi chú.
- Chi tiết: sản lượng từng SP, nhu cầu BOM snapshot, đã xuất/chờ duyệt/còn cần/tồn, chứng từ liên quan, timeline.
- Employee chỉ xem lệnh được giao. Chỉ bắt đầu khi đã xuất đủ NVL được duyệt; progress chỉ cập nhật completed_quantity.
- Hoàn thành theo sản lượng thực tế; khóa lệnh và tăng tồn TP đúng một lần.
- Manager chỉ sửa lệnh pending chưa có phiếu chưa bị từ chối; không hủy khi đã xuất NVL hoặc còn phiếu pending. Đây là lựa chọn chặn xung đột của bản frontend.
- Kiểm tra: TypeScript thành công; test chặn start sai điều kiện đã thành công.

### Sprint 5 — Hoàn thành

- Bổ sung từ PO hoặc min_stock; khóa nguồn, hiển thị nhu cầu/tồn/tối thiểu và lượng gợi ý.
- Duyệt/từ chối kèm lý do, người duyệt, reviewed_at và timeline.
- Nhập chỉ từ bổ sung approved, kiểm tra duy nhất một phiếu nhập.
- Nhập có NCC, ngày nhập hàng (không ở tương lai), số lượng và ghi chú; khóa khi pending.
- Bắt buộc draft → pending → completed; tăng tồn và fulfill bổ sung cùng một mock transaction.
- Mức nhận tối thiểu tính lại theo thiếu hụt hiện tại của PO hoặc min_stock. Cho nhận khác lượng yêu cầu nếu đạt tối thiểu.
- Kiểm tra: TypeScript và test chống nhập nhảy bước, tạo trùng, nhập trùng, atomicity thành công.

### Sprint 6 — Hoàn thành

- Tạo phiếu xuất NVL từ PO pending; lượng còn có thể yêu cầu tính cả các phiếu pending khác.
- Có thể xuất từng phần; kiểm tra lại tồn, BOM và trạng thái PO lúc duyệt.
- Phiếu xuất TP lấy từ kho; duyệt trừ tồn, từ chối không trừ tồn. Tạo từ lệnh completed đã được bỏ trong cập nhật 18/10/2026.
- Phiếu của tôi gồm 3 tab, chỉ hiển thị phiếu của Employee hiện tại; sửa/xóa khi pending.
- Kiểm tra: 14 tests đạt, gồm toàn bộ bổ sung → nhập → xuất NVL → start → progress → complete → xuất TP; chống xử lý trùng và giao dịch một phần.

### Sprint 7 — Hoàn thành

- Dashboard Manager: phiếu cần duyệt, cảnh báo tồn thấp, lệnh đang chạy, tồn kho nhanh, liên kết có bộ lọc.
- Báo cáo 4 nhóm, chọn mặt hàng/đơn vị, nhóm ngày/tháng/quý/năm (tồn kho không có quý).
- Tồn lịch sử tính từ số dư đầu + biến động đến cuối kỳ; không dùng tồn hiện tại thay thế tồn quá khứ.
- Thông báo theo role/người nhận, đánh dấu đã đọc, liên kết ngữ cảnh, badge cập nhật sau thao tác.
- Dữ liệu báo cáo ban đầu có 14 ngày lịch sử tổng hợp giả lập; các số dư đầu được đối chiếu với tồn hiện tại. Reference DEMO-* là lịch sử mô phỏng, không phải chứng từ thực.
- Kiểm tra tổng hợp, tồn lịch sử, chuyển kỳ quý/năm và đầu vào ngày trên URL.

### Sprint 8 — Hoàn thành

- Rà soát 3 vai trò trên trình duyệt: Manager nhập kho; Employee xuất NVL, start/progress/complete, xuất TP; Admin xem danh mục; Employee bị chặn khi truy cập báo cáo trực tiếp.
- Sửa cache mock để đọc phiên bản lưu mới nhất sau HMR; làm mới giữa các tab qua storage event, làm mới khi mutation lỗi.
- Xử lý lỗi quota ảnh thay vì báo lưu thành công; thêm test persistence.
- Tăng cỡ chữ bảng/form, gắn label với input, dialog native quản lý focus, hỗ trợ giảm chuyển động.
- Chuẩn hóa mã bằng Prettier. Cập nhật Vitest lên 5.0.5; npm install báo 0 vulnerabilities sau cập nhật.
- Hợp đồng tích hợp: [docs/API_CONTRACT.md](docs/API_CONTRACT.md).
- Kết quả: **24 tests đạt (3 files), TypeScript + production build thành công, npm audit online: 0 vulnerabilities**. Chi tiết tại [docs/VERIFICATION.md](docs/VERIFICATION.md).
- Bộ lọc báo cáo giữ tab, mặt hàng, loại kho và nhóm thời gian trên URL; xử lý các thay đổi liên tiếp không ghi đè bộ lọc trước.
- Bản kiểm tra trình duyệt đã phát sinh dữ liệu demo: PN001, XN018, PO024 hoàn thành 190/200 và 95/100, XT010 chờ duyệt. Dữ liệu này chỉ nằm ở localStorage của trình duyệt kiểm tra; trình duyệt mới bắt đầu từ fixtures.

## Giới hạn bản Frontend

- Chưa có Backend, đăng nhập thật, upload service hoặc lưu dữ liệu dùng chung giữa các thiết bị.
- Mock localStorage phục vụ demo, không bảo đảm giao dịch nhiều người dùng như database. API adapter là hợp đồng dự kiến, chưa có server để kiểm thử.
- Nếu trình duyệt chặn storage thì dữ liệu chỉ tồn tại trong bộ nhớ phiên. Dữ liệu không chứa thông tin thật.
- Các biểu đồ là SVG có chú giải/tooltip và bảng số liệu đối chiếu. Chưa có xuất Excel/PDF vì ngoài phạm vi.
- Chưa có chức năng hoàn trả NVL; không hủy lệnh đã xuất NVL được duyệt.

## Quy tắc tích hợp cần lưu ý

- Admin xem nghiệp vụ, chỉ quản trị tài khoản và phân quyền; Manager không có màn ledger.
- Backend phải kiểm tra quyền, người sở hữu, trạng thái và số lượng; không tin kết quả kiểm tra từ UI.
- Nhập NVL: `draft → pending → completed`; chỉ tạo từ bổ sung approved, tối đa một phiếu nhập cho mỗi phiếu bổ sung.
- Theo yêu cầu UX, lượng nhận có thể khác lượng yêu cầu nhưng phải đạt mức tối thiểu. Bản SQL sửa đã điều chỉnh quy tắc này; xem hướng dẫn database trước khi tích hợp.
- Ngày nhập hàng khác thời điểm hoàn tất; báo cáo chỉ tính phiếu completed theo ngày nghiệp vụ.
- Cần giao dịch nguyên tử và chống gửi trùng ở Backend cho duyệt phiếu, nhập kho và hoàn thành sản xuất.

## Ảnh giao diện đã kiểm tra

Ảnh được chụp từ bản chạy cục bộ, ở kích thước preview thực tế.

![Dashboard Manager](docs/screenshots/dashboard.png)

![Admin chỉ xem nghiệp vụ](docs/screenshots/admin.png)

![Báo cáo tồn NVL](docs/screenshots/reports.png)
