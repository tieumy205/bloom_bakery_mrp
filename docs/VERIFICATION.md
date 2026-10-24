# Kiểm tra Frontend

Kết quả cập nhật 18/10/2026: **26 tests / 3 files đạt; TypeScript và production build thành công**. Lần audit online tại đợt triển khai ban đầu không ghi nhận lỗ hổng; đợt chỉnh sửa này không thay đổi thư viện.

## Kiểm tra cập nhật 18/10/2026

- Manager: nút Tạo định mức mới không bị khóa; khi tất cả TP đã có BOM, hiển thị hướng dẫn thêm TP. Đã thêm Bánh hạnh nhân và lưu thành công BOM định mức bột 0,08 kg.
- Các danh mục NVL/TP/BOM dùng chung không còn dateValue. Đối chiếu UI Manager BOM, Employee TP và Admin NVL: không có bộ lọc Từ ngày/Đến ngày.
- Form nhập: chỉ có Nguyên liệu, Tồn, Số lượng yêu cầu, Số lượng nhập; ngày nhập hàng vẫn có; không hiển thị cột tối thiểu. Validation tối thiểu vẫn hoạt động theo quy tắc cũ.
- Sidebar không còn nhãn môi trường/phiên bản; footer chỉ còn tên ứng dụng.
- Employee PO022 completed không có nút xuất TP; mở URL tạo từ PO hiển thị lỗi nghiệp vụ. Từ kho TP001 mở phiếu điền sẵn Croissant và không gắn PO.
- Thêm hai kiểm thử domain: tạo BOM mới/không trùng và chặn tạo phiếu xuất TP gắn PO. Luồng end-to-end tự động đã chuyển bước xuất TP sang nguồn kho.
- Kiểm tra bằng browser tại cổng 5174 riêng; giữ nguyên tiến trình có sẵn trên cổng 5173. Dữ liệu thử chỉ ở trình duyệt kiểm tra, không thêm vào fixtures.
- Các bước trình duyệt bên dưới là ghi nhận đợt triển khai ban đầu; bước tạo XT010 từ PO là hành vi cũ, nay đã thay bằng xuất từ kho.

## Tự động

- `npm run typecheck`: TypeScript strict, không phát sinh output JS.
- `npm run build`: TypeScript + Vite production bundle.
- `npm test`: Vitest, kiểm tra domain và mock persistence.
- `npm audit --offline=false`: kiểm tra advisory từ npm, không chỉ dựa vào kết quả offline.

Các nhóm kiểm thử: phân quyền, tự khóa Admin, CRUD danh mục/tài khoản, khóa BOM, quyền sở hữu, thiếu NVL, từ chối thiếu lý do, giới hạn BOM nhiều phiếu, nhập nhảy bước/trùng, ngày nhập tương lai, sản lượng vượt mục tiêu, giao dịch nguyên tử, nhập/xuất lặp, toàn luồng PO, tồn lịch sử, kỳ quý/năm, bộ lọc ngày không hợp lệ, đóng góp chứng từ vào báo cáo và cache/persistence.

## Kiểm tra thực tế trong trình duyệt

Đã thực hiện trên bản demo localhost:

1. Tìm NVL bằng `bot mi`: ra đúng Bột mì số 13, URL giữ bộ lọc.
2. Manager duyệt BS018: ghi người duyệt/thời điểm và hiện hành động tạo nhập.
3. Tạo PN001 từ BS018: nguồn khóa, có NCC/ngày nhập hàng, lượng nhận tối thiểu.
4. Lưu nháp → chờ hoàn tất → hoàn tất: không có nút hoàn tất trực tiếp từ nháp, không sửa khi pending; tồn bột 12 → 26, bơ 3 → 7; bổ sung fulfilled.
5. Employee Lan chỉ thấy PO024 và PO022, không thấy PO023 của Huy.
6. PO024 dù đã đủ tồn vẫn không có nút start khi chưa duyệt xuất NVL.
7. Tạo XN018 từ PO024; Manager duyệt: tồn giảm đúng số lượng.
8. Employee thấy nút start sau duyệt đủ; bắt đầu chuyển in_progress.
9. Cập nhật sản lượng 190/200 và 95/100; modal chỉ có completed quantity.
10. Hoàn thành: hiển thị chênh lệch, nhập TP thực tế (Croissant tồn 80 → 270), khóa progress.
11. Tạo XT010 từ PO024 completed: chọn xuất 30 Croissant, gửi pending.
12. Employee truy cập trực tiếp `/app/reports`: bị chặn quyền.
13. Admin: layout tối riêng, menu quản trị + xem nghiệp vụ; danh mục NVL có nhãn Chỉ xem và không có nút thêm.
14. Báo cáo: Admin xem nhập/xuất, tồn NVL theo tháng có đường min_stock; đổi tab và nhóm năm/tháng liên tiếp vẫn giữ bộ lọc.

Các thao tác trên chỉ thay đổi localStorage của trình duyệt demo, không có Backend hoặc dữ liệu thật. Bài test tự động dùng fixtures độc lập nên không phụ thuộc dữ liệu trình duyệt đã thao tác.

## Giới hạn xác minh

- Đã kiểm tra hiển thị ở vùng preview hẹp và vùng có sidebar; chưa có bộ tự động chụp ở mọi độ phân giải hoặc kiểm thử trên thiết bị tablet vật lý.
- Chưa kiểm thử Backend, xác thực thật, database transaction hoặc nhiều người dùng trên nhiều máy.
- Luồng xuất TP từ tạo đến duyệt/trừ tồn được kiểm tra tự động; kiểm tra trình duyệt xác nhận bước tạo và gửi chờ duyệt.
- Dữ liệu lịch sử DEMO-* dùng để minh họa biểu đồ. Số dư đầu được cân để khớp tồn hiện tại, kèm các biến động của chứng từ đã duyệt trong fixtures.
