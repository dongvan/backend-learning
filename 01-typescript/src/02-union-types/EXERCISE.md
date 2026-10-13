# Bài 2 — Union & discriminated union: trạng thái Order và Payment

## Đề bài

Mô hình hoá vòng đời của **Order** và **Payment** bằng discriminated union, sao cho trạng thái sai không thể biểu diễn, và các bước chuyển trạng thái được compiler kiểm tra.

Tạo các file trong thư mục này (tên gợi ý, bạn có thể tách khác nếu giải thích được):

- `order-state.ts`: type các trạng thái Order, các hàm chuyển trạng thái, `describeOrder`, `parseOrderRow`.
- `payment-state.ts`: type các trạng thái Payment và các hàm chuyển trạng thái.
- `order-state.test.ts` (và `payment-state.test.ts` nếu cần): test Vitest.

Đọc `notes/` của bài này trước. Bài 1 vẫn áp dụng: không `any`, không mutate đầu vào, tiền là số nguyên đơn vị nhỏ nhất (đã nêu ở review Bài 1, xem `01-type-system/notes/06`).

## Nghiệp vụ

**Order** đi qua các trạng thái:

1. `draft`: khách đang chọn hàng. Có danh sách món (có thể rỗng). Chưa chốt tổng tiền.
2. `placed`: khách đã đặt. Phải có ít nhất một món; ghi nhận thời điểm đặt và tổng tiền đã chốt.
3. `paid`: đã thanh toán thành công; gắn với thanh toán tương ứng.
4. `shipped`: đã giao cho đơn vị vận chuyển; có mã vận đơn.
5. `cancelled`: đã huỷ; có lý do và thời điểm huỷ.

Luật chuyển: `draft → placed → paid → shipped`. Huỷ được từ `draft`, `placed`, `paid`; **không** huỷ được khi đã `shipped`. `cancelled` là trạng thái cuối.

**Payment** đi qua các trạng thái:

1. `pending`: chờ xử lý, có số tiền cần thanh toán.
2. `succeeded`: thanh toán thành công, có thời điểm thành công.
3. `failed`: thất bại, có lý do.
4. `refunded`: đã hoàn tiền (chỉ từ `succeeded`), có số tiền hoàn và thời điểm.

Bạn tự quyết định **mỗi trạng thái mang dữ liệu gì** (ngoài những gì đề nêu) và quan hệ giữa Order và Payment (Order `paid` giữ gì từ Payment?).

## Yêu cầu

1. Mỗi trạng thái của Order và Payment là một `type`/`interface` riêng được `export`, hợp thành union có discriminant là chuỗi literal (không `enum`).
2. Không dùng `any`, `!`, hay `as` (nếu bắt buộc dùng `as` thì ghi comment lý do). Không dùng trường optional để biểu diễn dữ liệu "chỉ có ở một số trạng thái".
3. Mỗi bước chuyển trạng thái là một hàm có kiểu tham số hẹp (nhận đúng trạng thái nguồn) và trả về đúng trạng thái đích, ví dụ chuyển từ `draft` sang `placed`. Thao tác không hợp lệ (ví dụ `ship` một `draft`) phải là **lỗi biên dịch**.
4. Không mutate đầu vào; mỗi lần chuyển trả object mới. Khi chuyển sang nhánh khác, liệt kê tường minh trường của nhánh đích (đừng chỉ spread rồi đổi tag).
5. `describeOrder(order: Order): string` trả mô tả cho từng trạng thái, có exhaustive check bằng `never` (`assertNever`).
6. `parseOrderRow(row)` chuyển một bản ghi kiểu database (ví dụ `status: string` cùng các cột nullable) thành `Order`. Dữ liệu không nhất quán (ví dụ `status = "shipped"` nhưng thiếu mã vận đơn) hoặc `status` lạ thì ném lỗi có thông điệp rõ.
7. Test (Vitest):
   - Mỗi hàm chuyển trạng thái: trường hợp hợp lệ.
   - Không mutate đầu vào.
   - `describeOrder` cho từng trạng thái.
   - `parseOrderRow`: dữ liệu hợp lệ cho từng trạng thái, thiếu dữ liệu, `status` lạ.
   - Các chuyển trạng thái **sai** được kiểm tra bằng `// @ts-expect-error` (nhớ rằng `npm test` không kiểm tra kiểu, `npm run type-check` mới kiểm tra; xem `notes/04`).
8. Thí nghiệm (không nộp code): tạm thêm một trạng thái mới vào union Order (ví dụ `delivered`), chạy `npm run type-check`, ghi vào "Ghi chú của bạn" (trong `notes/`) hoặc vào câu trả lời bên dưới compiler báo lỗi ở những chỗ nào, rồi hoàn tác.

## Câu hỏi cần tự trả lời khi nộp

- Vì sao không dùng một object duy nhất với các trường optional (`paidAt?`, `trackingCode?`, …)? Nêu ít nhất hai tổ hợp vô nghĩa mà cách đó cho phép, và chi phí khi dùng (code phải làm gì mỗi khi đọc các trường đó).
- `{ ...order, status: "shipped", trackingCode }` có gì rủi ro? Tự thử với một đơn đang ở trạng thái khác và xem object kết quả lúc chạy.
- Huỷ đơn `paid` thì Payment tương ứng phải xử lý thế nào (hoàn tiền)? Luật đó nằm ở kiểu, ở hàm `cancel`, hay ở tầng cao hơn (service)? Vì sao bạn đặt ở đó?
- `cancelled` có cần nhớ trạng thái trước khi huỷ không? Nếu cần, bạn mô hình thế nào (một trường, nhiều nhánh `cancelled…`, hay bảng lịch sử)? Nêu đánh đổi.
- Dữ liệu đọc từ database/webhook có `status` mà code chưa biết: bạn xử lý khác nhau ra sao cho (a) đọc DB nội bộ, (b) sự kiện webhook của đối tác? Vì sao?
- Kiểu của bạn có ngăn được `total` là số âm hoặc số lẻ không? Nếu không, việc đó thuộc về đâu (gợi ý: Bài 9)?
- Hai request đồng thời cùng gọi chuyển trạng thái `placed → paid` cho một đơn: kiểu bảo vệ được gì, không bảo vệ được gì, và cần gì ở tầng database?

## Tiêu chí đạt

- [ ] `npm run type-check` sạch (gồm cả các dòng `@ts-expect-error`).
- [ ] `npm test` pass.
- [ ] Không có `any`, `!`, không có trường optional dùng sai mục đích, không mutate input.
- [ ] Mọi hàm xử lý theo trạng thái đều có exhaustive check.
- [ ] Trả lời được các câu hỏi trên bằng lời của bạn.

## Nộp bài

Báo "xong Bài 2" kèm câu trả lời cho các câu hỏi. Tôi sẽ review code và test, rồi hỏi thêm vài câu kiểm tra trước khi cập nhật `PROGRESS.md`.
