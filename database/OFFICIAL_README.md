# SQL chính thức — Bloom Bakery MRP

File bàn giao: [bakery_mrp_official.sql](bakery_mrp_official.sql). Dành cho **database PostgreSQL 18 trống**, tạo schema `bakery_mrp`, toàn bộ cấu trúc và dữ liệu nguồn trong một transaction. Đây là bản độc lập, không chạy kèm các file migration/bakery_mrp_fixed.sql trước đó.

**Đã kiểm thử và import thành công trên PostgreSQL 18.6 theo yêu cầu tiếp theo của người dùng.** File chính thức vượt qua **54 kiểm tra nghiệp vụ + 4 kiểm tra đồng thời** trên cụm tạm, sau đó import vào database mới **bloom_bakery**, server **127.0.0.1:5432**, schema **bakery_mrp**, tài khoản import **postgres**. Không lưu mật khẩu kết nối vào file dự án.

Đã xác nhận sau import: 25 bảng, 18 trigger, 11 hàm, toàn bộ constraint được validate và số dòng từng bảng khớp nguồn; không đưa fixture kiểm thử vào database chính. [Kết quả kiểm thử](../docs/database-official-test-results.json), [kết quả import](../docs/database-official-import-results.json). Hash SQL trong hai kết quả trùng nhau. Kết quả 67 + 4 của bản thử nghiệm cũ vẫn không áp dụng cho file chính thức này.

## Nội dung

- 25 bảng: 24 bảng trong nguồn và `business_events`.
- Giữ nguyên tập **18 trigger, 11 hàm** của nguồn; sửa nội dung các hàm cần thiết, không thêm trigger.
- Không có bảng snapshot, bảng tổng nhu cầu, bảng schema_migration/schema_migrations hoặc metadata migration khác.
- Không có unique index/trigger giới hạn số phiếu xuất NVL theo lệnh. Quy tắc xuất một lần do Backend xử lý.
- Dữ liệu được chuyển từ COPY sang INSERT chuẩn để chạy bằng psql hoặc Query Tool hỗ trợ toàn bộ SQL script. Không còn lệnh riêng `\restrict`, `\unrestrict`, `COPY FROM stdin`.
- Bỏ chỉ định OWNER TO postgres để đối tượng thuộc tài khoản thực hiện import. Tài khoản import cần quyền tạo schema trong database được chọn.

## BOM có phiên bản

`bom.version_code` dùng varchar(20), không rỗng, duy nhất theo `(product_id, version_code)`. Một sản phẩm được lưu nhiều BOM; unique partial index `idx_active_bom` chỉ cho **tối đa một phiên bản hoạt động**.

`production_order_details` có thêm `bom_id NOT NULL`, giữ `product_id` và có FK kép `(bom_id, product_id)` để không thể chọn BOM của sản phẩm khác.

- Backend chọn BOM đang hoạt động khi tạo dòng lệnh và lưu rõ bom_id.
- Khi bắt đầu/chạy/xem lại lệnh, luôn JOIN `bom_details` bằng bom_id của dòng lệnh; không chọn lại theo active/product_id.
- BOM được bất kỳ dòng lệnh nào tham chiếu thì không sửa nội dung/version hoặc xóa, kể cả lệnh đã hoàn thành/hủy. `guard_bom()` hiện có đã được sửa theo quy tắc này.
- Được đổi riêng is_active để ngừng BOM cũ và kích hoạt BOM mới. Lệnh cũ tiếp tục dùng phiên bản cũ, dù phiên bản đó inactive.
- Chuyển phiên bản trong transaction: khóa sản phẩm/BOM cần thiết, ngừng phiên bản cũ, tạo/kích hoạt phiên bản mới. Unique index không cho hai active cùng lúc.
- Nhu cầu NVL tính trực tiếp bằng `SUM(target_quantity * bom_details.quantity)`, nhóm theo lệnh và NVL, dựa trên bom_id đã lưu.

Hai dòng lịch sử được gắn BOM duy nhất của từng sản phẩm trong nguồn: POD01 → BOM01, POD02 → BOM02. Đây là suy luận từ dữ liệu hiện có, không khôi phục được một phiên bản lịch sử đã mất. Script từ chối tự gán nếu có nhiều ứng viên.

## Phần Backend phải xử lý

1. Xác thực, role, active và quyền sở hữu/được giao ở mọi API; lọc SELECT theo quyền. Không tin created_by/approved_by do client tự khai. `has_permission()` hiện có chỉ kiểm ID người duyệt, không thay thế đăng nhập.
2. Quy tắc một lần xuất NVL: khóa dòng lệnh trong transaction, kiểm phiếu pending/approved đã tồn tại và kiểm đủ tập NVL/số lượng theo BOM được chọn. Đây là trách nhiệm Backend; SQL này không bảo đảm số lần xuất hoặc lượng xuất đúng BOM khi gọi trực tiếp.
3. Kiểm BOM active, đơn vị khớp sản phẩm, có đủ dòng định mức khi chọn cho lệnh mới; chỉ đổi kế hoạch khi được phép. Backend phải khóa BOM khi chọn/thay đổi kế hoạch để phối hợp với bảo vệ phiên bản.
4. Ngày nhập không ở tương lai và không sửa khi phiếu pending; hạn hoàn thành bắt buộc khi tạo lệnh mới. due_date/receipt_date là DATE, completion_date/created_at/reviewed_at là timestamptz.
5. Nhập từ phiếu bổ sung approved, kiểm lượng nhận tối thiểu dưới khóa tồn/lệnh. Cho số lượng nhập khác requested; `post_receipt()` hiện có chỉ còn kiểm nguồn/tập NVL và ghi sổ, không buộc lượng nhập bằng yêu cầu.
6. Ghi business_events và notifications cùng transaction nghiệp vụ. Không có trigger tự tạo/bảo vệ timeline mới; API cần cấm sửa/xóa sự kiện và kiểm đúng object_type/object_id/actor_user_id.
7. Không sửa tồn trực tiếp hoặc đổi đơn vị danh mục đã sử dụng; giới hạn quyền kết nối DB của ứng dụng. Bản này không bổ sung các trigger danh mục từ bản thử nghiệm cũ.
8. Chống gửi lặp, khóa theo thứ tự thống nhất, xử lý deadlock/xung đột và trả lỗi tiếng Việt.

## Các thao tác database vẫn tự xử lý

Giữ các trigger nguồn về vòng đời chứng từ, khóa chi tiết/chứng từ kết thúc, bảo vệ ledger/BOM và ghi sổ:

- `post_mi`: duyệt xuất NVL → trừ tồn và ghi ledger; không kiểm số lần xuất hoặc tổng BOM.
- `post_pi`: duyệt xuất TP → trừ tồn và ghi ledger.
- `post_rn`: hoàn tất nhập → tăng tồn, ghi ledger và fulfilled phiếu bổ sung.
- `production_flow`: kiểm đủ NVL đã duyệt theo BOM gắn trên lệnh khi start; hoàn thành → nhập TP thực tế và ghi completion_date. Việc kiểm này không áp đặt số lần xuất.

**Backend không tự cộng/trừ tồn, ghi ledger hoặc fulfilled thêm lần nữa** khi đã cập nhật status để các trigger trên thực hiện. Transaction API phải bao trùm cập nhật trạng thái, kiểm đầu vào và ghi timeline/thông báo.

## Dữ liệu và định dạng được sửa

- Khôi phục các TAB bị thiếu trong BOM, RN01, PO01; sửa version `1,0`, dấu phẩy dư và chuỗi số nguyên dạng `100.0000`.
- NVL/BOM/ledger dùng numeric(16,6); thành phẩm/sản lượng dùng integer.
- requirement_quantity là nhu cầu tham chiếu, không phải lượng còn thiếu; requested_quantity/request_quantity phải dương, không ép lớn hơn toàn bộ nhu cầu. Backend kiểm lượng thực tế theo từng luồng.
- Thêm business_date vào ledger: nhập NVL lấy receipt_date, các biến động còn lại suy từ timestamp nguồn theo giờ Việt Nam. Số dư before/after vẫn theo thứ tự ghi sổ.
- Giữ ngày nhập RN01 10/10/2026; PO01 hạn 08/10/2026, hoàn thành 07/10/2026 14:57:19.213438+07. Nguồn có xuất NVL ngày 07/10 trước ngày nhập đã khai 10/10; cần đối chiếu lịch sử thật khi dùng báo cáo theo ngày nghiệp vụ. Không tự sửa ngày nguồn.
- created_at được thêm cho users/materials/products: dữ liệu lịch sử NULL, bản ghi mới có default timestamp. Không tạo ngày lịch sử giả.
- Ba password_hash nguồn vẫn NULL, không tạo mật khẩu mặc định. Backend cần quy trình thiết lập mật khẩu trước khi dùng đăng nhập thật. reviewed_at/rejection_reason cũ chưa biết vẫn NULL.
- business_events khởi tạo rỗng; không dựng timeline lịch sử giả.

## Import và tạo lại file

Database bloom_bakery trên máy hiện đã import xong. Không chạy lại file vào database này; ví dụ dưới chỉ dùng khi chuẩn bị một database trống khác:

```powershell
& 'D:\PostgreSQL\18\bin\psql.exe' -X -h localhost -U postgres -d bloom_bakery -v ON_ERROR_STOP=1 -f 'D:\bloomBakery\database\bakery_mrp_official.sql'
```

Chọn database trống đã tạo trước; không chạy cùng file SQL/migration cũ. Schema bakery_mrp đã tồn tại thì CREATE SCHEMA sẽ báo lỗi, file không tự xóa dữ liệu hiện có.

Tạo lại file và chạy kiểm tra tĩnh, không kết nối PostgreSQL:

```powershell
node scripts/build-official-database.mjs 'C:\Users\My\Downloads\bakery_mrp (5).sql'
```

[Kết quả kiểm tra tĩnh](../docs/database-official-static-review.json) lưu hash nguồn/file bàn giao, số bảng/hàm/trigger, số dòng seed, đối chiếu FK/UNIQUE, BOM và danh sách gán bom_id lịch sử. Kiểm tra PostgreSQL thực tế đã bổ sung ở bước tiếp theo, bằng bộ test riêng cho schema chính thức.

## Phạm vi kiểm thử thực tế

- Restore toàn bộ file vào database mới trên PostgreSQL 18.6, dừng khi có lỗi.
- Kiểm BOM nhiều phiên bản, duy nhất một active, chặn BOM sai sản phẩm, khóa phiên bản đã được dùng, ngừng BOM cũ và tiếp tục chạy lệnh cũ theo phiên bản đã gắn.
- Luồng nhiều thành phẩm: bổ sung → duyệt → nhập khác lượng yêu cầu → xuất NVL → start → progress → complete → xuất TP; kiểm trạng thái, ledger, thời điểm hoàn thành và chống ghi tồn hai lần khi lặp trạng thái.
- Kiểm rollback khi dòng thứ hai của phiếu xuất thiếu tồn: cả dòng đầu, status và ledger đều rollback.
- Hai phiên duyệt cùng tranh tồn: chỉ một thành công, không âm tồn; hai phiên tạo BOM active cùng sản phẩm: chỉ một thành công.
- Xác nhận SQL không áp đặt số lần xuất NVL và không tự tạo timeline. Việc xác thực/người sở hữu, một lần xuất, mức nhận tối thiểu, ngày nhập pending và timeline vẫn cần được kiểm thử ở API khi Backend được xây dựng.

Các mutation của bài test nghiệp vụ rollback; fixture đồng thời chỉ ở database tạm. Chỉ import cấu trúc và dữ liệu nguồn vào bloom_bakery chính. Không chạy bộ test mutation trên database chính.
