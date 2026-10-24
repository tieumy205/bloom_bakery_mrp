# Bloom Bakery MRP

Tài liệu mã nguồn: [Cấu trúc thư mục, chức năng từng file và luồng hoạt động](docs/PROJECT_STRUCTURE.md).

Ứng dụng quản lý nguyên vật liệu, thành phẩm và sản xuất cho tiệm bánh, gồm frontend React và backend Node.js/PostgreSQL. Ngôn ngữ tiếng Việt; ưu tiên desktop và tablet.

## Phạm vi

**Bản SQL chính thức hiện hành:** [database/bakery_mrp_official.sql](database/bakery_mrp_official.sql), dùng BOM có phiên bản và dòng lệnh tham chiếu bom_id. Có 25 bảng, 18 trigger và 11 hàm.



Phát triển cục bộ, chưa triển khai hosting. Dữ liệu giả lập không thay thế xác thực, phân quyền hoặc giao dịch tồn kho ở Backend. Tài liệu quyền tham chiếu: `C:/Users/My/Downloads/Module.txt` cùng các cập nhật của người dùng trong chat.

## Kiến trúc

- `src/app`: router và providers.
- `src/layouts`: AdminLayout riêng với OperationsLayout.
- `src/features`: màn hình theo module, hooks và API truy cập dữ liệu.
- `src/shared/ui`: component giao diện dùng chung.
- `src/shared/domain`: types, quyền và quy tắc nghiệp vụ.
- `src/shared/api`: HTTP client, hợp đồng repository.
- `src/mocks`: fixtures và mock repository.
- `src/shared/styles`: design token, layout và responsive.

Luồng dữ liệu: UI → hooks/TanStack Query → repository → mock hoặc HTTP. Không gọi HTTP trực tiếp từ component trình bày. Bộ lọc danh sách lưu trên URL.


