# Bài 1 — Type system cơ bản: `calculateOrderTotal`

## Đề bài

Viết hàm `calculateOrderTotal(order)` cho Order Management System.

Tạo file `order.ts` (type + hàm) và `order.test.ts` (test) trong thư mục này. Không sửa `index.ts` ngoài ghi chú của bạn.

## Yêu cầu

1. Định nghĩa type cho `Order` và `OrderItem`. Mỗi item có tối thiểu: id sản phẩm, đơn giá, số lượng.
2. Không dùng `any`.
3. Không mutate dữ liệu đầu vào (kể cả khi `order` được `Readonly`).
4. Đơn không có item trả về tổng 0, không throw.
5. Không ghi type trả về cho hàm một cách tường minh ở lần viết đầu, rồi dùng editor hover xem TypeScript suy luận ra gì. Sau đó quyết định có nên ghi tường minh không và giải thích lý do.
6. Test (Vitest) cho: trường hợp thường, đơn rỗng, các giá trị biên (số lượng 0 hoặc 1, đơn giá 0, số lượng lớn, số thập phân).

## Câu hỏi cần tự trả lời khi nộp

- `type` hay `interface` cho `Order`? Vì sao?
- Tiền nên là `number` hay kiểu khác? Rủi ro của `0.1 + 0.2` ảnh hưởng thế nào đến thiết kế của bạn?
- TypeScript suy luận kiểu trả về như thế nào? Khi nào nên ghi tường minh?
- Nếu truyền object có thêm thuộc tính thừa vào hàm thì xảy ra gì? Khác nhau thế nào giữa object literal và biến trung gian?

## Tiêu chí đạt

- [ ] `npm run type-check` sạch.
- [ ] `npm test` pass.
- [ ] Không có `any`, không mutate input.
- [ ] Trả lời được 4 câu hỏi trên bằng lời của bạn.

## Nộp bài

Báo "xong Bài 1" kèm câu trả lời cho các câu hỏi. Tôi sẽ review code và test, rồi hỏi thêm vài câu kiểm tra trước khi cập nhật `PROGRESS.md`.
