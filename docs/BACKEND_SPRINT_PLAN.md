# Kế hoạch Backend Bloom Bakery MRP

Ngày lập: 18/10/2026. Trạng thái cập nhật: **đã triển khai 9 sprint**. Nhật ký tại README.md và kết quả thực tế tại BACKEND_VERIFICATION.md. Nội dung bên dưới lưu phạm vi và tiêu chí kế hoạch ban đầu.

Nền hiện tại: React/TypeScript, repository API đã có GET `/api/snapshot` và POST `/api/commands`; database chính `bloom_bakery` trên PostgreSQL 18.6, schema `bakery_mrp`. File SQL chính thức dùng BOM phiên bản, không có snapshot BOM/tổng nhu cầu/schema_migrations. Kiểm thử SQL chính thức trước đây đạt 54 nghiệp vụ + 4 đồng thời; kiểm thử HTTP/auth sẽ bổ sung khi có Backend.

## Phạm vi giao diện và kiến trúc

- Giữ layout, màu sắc, dashboard, bảng, bộ lọc, báo cáo và các luồng nghiệp vụ hiện có. Kết nối dữ liệu thật qua repository/hooks, không gọi database/API trực tiếp trong component trình bày.
- BOM: thêm phiên bản, trạng thái hoạt động, tạo phiên bản mới và chế độ xem định mức đã được sử dụng.
- Lệnh sản xuất: thêm chọn/hiển thị phiên bản BOM trên từng dòng thành phẩm, giữ bom_id đã lưu khi xem lệnh cũ. Lệnh nhiều thành phẩm có thể dùng các phiên bản khác nhau của đúng từng sản phẩm.
- Admin/Phân quyền: chọn một/nhiều tài khoản và tick module × action rồi lưu quyền cho các tài khoản đã chọn.
- Bổ sung trường mật khẩu khi Admin tạo user và chức năng Admin đặt lại mật khẩu; đăng nhập thật thay bộ chọn tài khoản demo trong chế độ API. Không thiết kế lại các trang nghiệp vụ khác.
- Backend TypeScript tổ chức theo modules: auth, users, permissions, catalogs, boms, production-orders, replenishments, receipts, material-issues, product-issues, reports, notifications và events. Tách controller/DTO, service nghiệp vụ và repository PostgreSQL; quản lý transaction ở service.
- Giữ endpoint snapshot/commands để kết nối frontend hiện tại; auth/users/permissions có endpoint chuyên biệt. Command được phân loại và validate tại server, không dùng một handler bỏ qua quyền/DTO.

## Quy ước cần giữ xuyên suốt

1. **Mật khẩu:** các tài khoản đang có lúc bắt đầu triển khai được khởi tạo một lần với `12345`, lưu bằng hàm băm mật khẩu có salt. Không lưu plaintext hoặc ghi mật khẩu vào log. Không reset lại khi server khởi động hoặc chạy lại patch. User mới dùng mật khẩu Admin nhập; Admin được đặt lại mật khẩu. Đổi mật khẩu/khóa tài khoản phải vô hiệu phiên cũ. Không lấy email/full_name/ID người tạo từ client làm bằng chứng danh tính.
2. **Quyền:** role giữ layout và phạm vi nghiệp vụ đã thống nhất; quyền tài khoản bật/tắt các hành động hợp lệ trong phạm vi đó. Admin vẫn quản trị tài khoản/quyền và xem nghiệp vụ; Employee không có quyền duyệt. Sidebar, route, nút và API dùng cùng quyền hiệu lực do server trả về, thay vì bảng quyền role cố định trong frontend.
3. **Mô hình quyền tài khoản:** thêm `user_permissions(user_id, permission_id, is_allowed, updated_by, updated_at)`, khóa chính `(user_id, permission_id)`, `is_allowed BOOLEAN NOT NULL`. Không có override thì lấy mặc định role; override false phải thắng mặc định role true. Server tính đầy đủ bản đồ quyền hiệu lực theo module/action, mỗi cờ true hoặc false; quyền không có trong cả cấu hình tài khoản và mặc định role, hoặc quyền không nhận diện được, đều là false. Bỏ tick phải thực sự thu hồi quyền, không chỉ cộng thêm quyền. Chỉ quyền hiệu lực true mới được thực hiện, không dùng kiểm tra role đơn thuần để bỏ qua cờ false. Cập nhật `has_permission()` hiện có để các trigger duyệt nhận cùng quyền hiệu lực với API. Bảo vệ Admin hiện tại/khả năng quản trị còn lại, kiểm hợp lệ từng tài khoản khi lưu hàng loạt; lỗi thì rollback cả batch.
4. **Thay đổi schema:** bổ sung SQL patch có kiểm tra trước/sau, ghi lại trong README; không tạo schema_migrations. Cơ chế vô hiệu phiên có thể dùng token_version trên users nếu chọn token đăng nhập. Patch chỉ chạm đối tượng cần thiết, không import lại dump lên database đã có dữ liệu.
5. **BOM:** mỗi sản phẩm tối đa một phiên bản active; phiên bản đã được lệnh tham chiếu không sửa nội dung/xóa. Chọn BOM active khi tạo/đổi kế hoạch; phiên bản inactive vẫn hiển thị và được lệnh cũ sử dụng. Chuyển phiên bản active không đổi bom_id của lệnh đã lưu.
6. **Xuất NVL một lần:** chỉ Backend kiểm tra. Khóa dòng lệnh, kiểm chưa có phiếu pending/approved và đủ toàn bộ NVL/số lượng theo BOM, rồi tạo/duyệt cùng transaction. Rejected cho tạo thay thế. Không thêm index/trigger đếm số lần xuất.
7. **Ghi sổ:** các trigger hiện có vẫn cập nhật tồn/ledger/fulfilled và nhập TP khi hoàn thành. Backend chỉ cập nhật trạng thái sau kiểm tra, không ghi tồn thêm lần nữa; sự kiện/thông báo do Backend ghi cùng transaction.
8. **Kiểm thử:** dùng database riêng. Không chạy fixture/mutation test trên bloom_bakery chính. Mỗi sprint có kiểm thử API/quyền/transaction liên quan, README và thông báo hoàn thành kèm kết quả thực tế.

## Cờ quyền bắt buộc và điểm kiểm tra

- Mỗi permission gắn với cặp module/action, ví dụ `bom.create`, `material_issue_requests.approve`. Checkbox Admin lưu allow/deny của tài khoản; API phiên đăng nhập trả bản đồ quyền hiệu lực cho frontend.
- `true`: cho phép đi tiếp tới kiểm quyền sở hữu, trạng thái và nghiệp vụ. `false` hoặc không có quyền hiệu lực: từ chối. Có quyền không đồng nghĩa được bỏ qua điều kiện người được giao/chủ phiếu/trạng thái.
- Mọi API được bảo vệ phải khai báo quyền tương ứng; Guard kiểm tài khoản hoạt động và cờ quyền trước khi chạy service. Service kiểm lại quyền đối tượng và dữ liệu dùng để thực hiện command. Command API kiểm theo loại command/action cụ thể, không chỉ kiểm quyền truy cập endpoint `/commands`.
- API thiếu quyền trả 403 và không thay dữ liệu/tồn/ledger/timeline/thông báo. Chưa đăng nhập trả 401. Endpoint công khai như login/health phải được đánh dấu công khai tường minh; endpoint bảo vệ thiếu khai báo quyền không được mặc nhiên cho qua.
- Giao diện dùng cùng bản đồ quyền để ẩn/khóa action và chặn route. Người dùng sửa frontend hoặc gọi API trực tiếp vẫn bị Backend chặn.
- Khi Admin thu hồi quyền, request tiếp theo phải dùng quyền mới; không tin cờ quyền cũ nhúng trong token hoặc dữ liệu client. Cache quyền cần vô hiệu ngay khi cập nhật.
- Nghiệm thu bắt buộc: gọi thẳng API khi cờ false/missing, override false trên role có quyền, command đổi action để vượt quyền và token/phiên cũ sau khi thu hồi. Tất cả phải bị chặn, không có tác dụng phụ.

## Sprint 1 — Nền tảng Backend và kết nối PostgreSQL

**Thực hiện:** tạo backend độc lập trong repository; cấu hình môi trường, pool kết nối, transaction helper, health check, DTO validation, lỗi tiếng Việt và cấu trúc module. Chuẩn hóa map snake_case → DTO frontend, DATE/timestamptz, số thập phân. Chuẩn bị database kiểm thử và cấu hình proxy API.

**Nghiệm thu:** server chạy cục bộ, health/database check thành công; exception rollback transaction; không lộ thông tin kết nối; smoke test API chạy trên database riêng. UI hiện tại vẫn hoạt động ở chế độ mock.

## Sprint 2 — Đăng nhập và khởi tạo mật khẩu

**Thực hiện:** triển khai login/me/logout bằng cookie HttpOnly; kiểm tra tài khoản active, hết hạn và vô hiệu phiên. Viết bước khởi tạo một lần cho các tài khoản hiện có với mật khẩu 12345 đã băm; chạy có ghi nhận, không ghi mật khẩu vào tài liệu kết quả. Nối SessionProvider vào auth thật trong chế độ API; giữ layout theo role.

**Nghiệm thu:** các tài khoản hiện có đăng nhập được bằng 12345; sai mật khẩu/tài khoản khóa/hết phiên bị chặn; logout vô hiệu phiên; chạy lại bước khởi tạo không reset mật khẩu đã thay. Frontend không được tự chọn userId để đổi danh tính.

## Sprint 3 — Admin: tài khoản, mật khẩu và phân quyền bằng checkbox

**Thực hiện:** CRUD user, Admin nhập mật khẩu khi tạo và đặt lại mật khẩu. Tạo mô hình override quyền tài khoản, cập nhật has_permission(), API đọc/lưu quyền một hoặc nhiều user. Thay ma trận chỉ xem thành danh sách tài khoản + checkbox quyền; dùng quyền hiệu lực ở route/sidebar/action trên frontend. Vô hiệu cache/quyền phiên khi Admin thay quyền.

**Nghiệm thu:** tạo user đăng nhập đúng mật khẩu Admin đặt; mật khẩu mới thay thế mật khẩu cũ và phiên cũ bị thu hồi; cờ false/missing chặn cả UI lẫn gọi API trực tiếp, role không vượt được override false; quyền bị thu hồi có hiệu lực ở request tiếp theo; thay quyền duyệt có tác dụng trong trigger; batch lỗi không lưu một phần; không tự khóa mất quyền quản trị.

## Sprint 4 — Danh mục và BOM phiên bản

**Thực hiện:** API NVL/TP/NCC/đơn vị theo phạm vi màn hình hiện có; phân trang/tìm kiếm/sắp xếp/lọc phía server. Tồn không sửa trực tiếp; xử lý ảnh thành phẩm theo hợp đồng đang dùng. API BOM nhiều phiên bản, tạo/sửa phiên bản chưa dùng, chuyển active trong transaction và đọc phiên bản cũ. Chỉnh duy nhất màn BOM để hiển thị version/active và trạng thái khóa nội dung.

**Nghiệm thu:** một sản phẩm lưu được nhiều phiên bản, không trùng version hoặc có hai active; BOM đã dùng không sửa/xóa nhưng được ngừng hoạt động; không tạo lệnh/BOM sai đơn vị hoặc thiếu định mức. Không xuất hiện lại bộ lọc ngày đã bỏ ở NVL/TP/BOM.

## Sprint 5 — Lệnh sản xuất và chọn phiên bản BOM

**Thực hiện:** tạo lệnh nhiều thành phẩm, giao Employee, hạn/ghi chú và chọn BOM cho từng dòng; mặc định phiên bản active, hiện rõ version/trạng thái, khóa khi lệnh không còn được phép sửa. API lưu bom_id, tính requirements từ đúng phiên bản và map sang DTO hiện tại. Backend lọc lệnh theo người được giao và kiểm điều kiện sửa/hủy.

**Nghiệm thu:** đổi active sang v2 không thay nhu cầu lệnh đã chọn v1; không chọn BOM của sản phẩm khác; lệnh cũ xem được BOM inactive; Employee không xem/sửa lệnh người khác; lệnh có chứng từ được khóa đúng quy tắc.

## Sprint 6 — Bổ sung và nhập NVL

**Thực hiện:** tạo bổ sung từ PO hoặc minStock; Manager duyệt/từ chối bắt buộc lý do. Nhập từ approved, tối đa một phiếu nhập mỗi bổ sung; đúng draft → pending → completed. Backend kiểm ngày nhập, khóa field khi pending và tính mức nhập tối thiểu hiện tại dưới khóa tồn/lệnh. Ghi timeline và thông báo cùng transaction; giữ form và nhãn hiện tại.

**Nghiệm thu:** từ chối sai quyền/thiếu lý do; không tạo nhập trùng/nhảy bước; nhận khác requested hợp lệ khi đạt tối thiểu; hoàn tất tăng tồn/fulfilled đúng một lần; lỗi giữa command rollback cả trạng thái, tồn, timeline và thông báo.

## Sprint 7 — Xuất NVL một lần, tiến độ sản xuất và xuất TP

**Thực hiện:** Backend áp dụng quy tắc một phiếu xuất NVL pending/approved mỗi lệnh, đủ BOM; kiểm đồng thời bằng khóa PO, không thêm quy tắc vào DB. Duyệt xuất kiểm lại tồn; start chỉ sau đủ lượng đã duyệt; progress chỉ đổi completed_quantity; complete nhập TP thực tế qua trigger. Xuất TP chỉ từ kho, kiểm tồn và quyền duyệt; timeline/thông báo đi cùng transaction.

**Nghiệm thu:** hai request tạo xuất cùng lệnh chỉ một thành công; hai request duyệt tranh tồn không âm tồn; không bỏ dòng/đổi lượng BOM để xuất từng phần; phiếu rejected cho tạo thay thế; start/progress/complete đúng trạng thái; gửi lặp không ghi sổ hai lần; lỗi dòng thứ hai rollback toàn bộ.

## Sprint 8 — Dashboard, báo cáo và thông báo dữ liệu thật

**Thực hiện:** API dashboard/cảnh báo/chờ duyệt; báo cáo nhập/xuất, NVL sử dụng, TP xuất và tồn NVL theo kỳ. Tổng hợp theo business_date và số dư đầu kỳ, không dùng tồn hiện tại thay tồn quá khứ. API thông báo/read_at, badge pending và timeline theo quyền; kết nối các component sẵn có, giữ nguyên giao diện.

**Nghiệm thu:** đối chiếu chart/bảng bằng SQL trên dữ liệu kiểm thử; kỳ ngày/tháng/quý/năm đúng phạm vi từng báo cáo; lọc đúng quyền, không trộn đơn vị; ngày nhập khác thời điểm hoàn tất được tổng hợp đúng; thông báo tài khoản khác không đọc/đánh dấu được.

## Sprint 9 — Tích hợp hoàn chỉnh và bàn giao

**Thực hiện:** bật VITE_DATA_SOURCE=api cho các module đã hoàn thiện; rà soát ba vai trò và quyền tài khoản, lỗi 401/403/409/422, loading/empty/error; kiểm thử toàn luồng và đồng thời. Đối chiếu các màn giữ nguyên với ảnh/baseline, chỉ chấp nhận thay đổi đã nêu. Hoàn thiện tài liệu API, biến môi trường, chạy local, patch schema và khôi phục dữ liệu.

**Nghiệm thu:** luồng nhiều thành phẩm từ tạo lệnh → bổ sung → nhập → xuất → sản xuất → xuất TP → báo cáo chạy qua API; các tài khoản hiện có đăng nhập và quyền tài khoản hoạt động; build/typecheck/API integration/E2E đạt. Không còn dữ liệu demo thay dữ liệu thật khi ở chế độ API; không có dữ liệu kiểm thử trong database chính. README ghi kết quả thực tế và phần còn hạn chế.

## Cách báo cáo tiến độ

Cuối mỗi sprint: cập nhật README với nội dung đã làm, thay đổi schema/API/UI, lệnh kiểm thử và kết quả, rồi thông báo cho người dùng ngay trong chat. Chỉ đánh dấu hoàn thành khi tiêu chí nghiệm thu đạt; không dùng kết quả SQL cũ làm bằng chứng cho API/auth mới.

Triển khai lần lượt Sprint 1 → 9. Ưu tiên chốt auth/quyền ở Sprint 2–3 trước khi nối ghi dữ liệu nghiệp vụ, và chốt BOM phiên bản ở Sprint 4–5 trước các phiếu/sản xuất.
