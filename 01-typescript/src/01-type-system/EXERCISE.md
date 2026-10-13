# Bài 1 — Type system cơ bản: `calculateOrderTotal`

## Đề bài

Viết hàm `calculateOrderTotal(order)` cho Order Management System.

Tạo file `order.ts` (type + hàm) và `order.test.ts` (test) trong thư mục này. Không sửa `index.ts` ngoài ghi chú của bạn.

## Yêu cầu

1. Định nghĩa type cho `Order` và `OrderItem`. Mỗi item có tối thiểu: id sản phẩm, đơn giá, số lượng.
2. Không dùng `any`.
3. Không mutate dữ liệu đầu vào (kể cả khi `order` được `Readonly`).
4. Đơn không có item trả về tổng 0, không throw.
5. Không ghi type trả về cho hàm một cách tường minh ở lần viết đầu, rồi dùng editor hover xem TypeScript suy luận ra gì. Sau đó quyết định có nên ghi
   tường minh không và giải thích lý do.
6. Test (Vitest) cho: trường hợp thường, đơn rỗng, các giá trị biên (số lượng 0 hoặc 1, đơn giá 0, số lượng lớn, số thập phân).

## Câu hỏi cần tự trả lời khi nộp

Mỗi câu gồm: **câu hỏi**, **bản gốc** (câu trả lời bạn nộp, giữ nguyên), **bản đã sửa** (đã chỉnh theo review ngày 2026-10-13) và **ghi chú sửa** (nêu
rõ đã đổi gì và vì sao). Đọc kèm `notes/`.

### 1. `type` hay `interface` cho `Order`? Vì sao?

**Bản gốc**

> có thể dùng type hoặc interface đều được nhưng trong trường hợp này tôi sử dụng interface vì thự thể nghiệp vụ Order chọn interface tối ưu hơn về
> khả năng mở rộng sau này, ví dụ muốn bổ sung thêm trường như status, paymentId thì có thể cho phép tự gộp khi khai báo trùng tên, không phải sửa
> interface gốc hoặc kế thừa, khả năng biên dịch nhanh hơn vì có thể cache cấu trúc,

**Bản đã sửa**

Với data shape thuần như `Order`, `type` và `interface` đều dùng được; tôi chọn `interface` vì (1) `extends` báo lỗi ngay nếu mở rộng bị xung đột kiểu
(`&` thì có thể âm thầm ra `never`), (2) thông báo lỗi và hover của `interface` thường gọn, (3) hợp với quy ước "entity domain là `interface`, kiểu
dẫn xuất/union là `type`". Điều quan trọng là dùng nhất quán trong project.

Khi cần thêm trường (ví dụ `status`, `paymentId`), tôi **sửa trực tiếp `interface Order`** hoặc tạo kiểu dẫn xuất (`extends`, `Omit`/`Pick`), không
dựa vào declaration merging. Merging chỉ có ích để *bổ sung từ bên ngoài* kiểu của thư viện (ví dụ thêm `user` vào `Express.Request`), còn với kiểu
của chính mình thì chỉ làm khó biết một kiểu được định nghĩa ở đâu.

**Ghi chú sửa**

- Bỏ lý do "tự gộp khi khai báo trùng tên" làm ưu điểm: với kiểu do mình sở hữu, đó là rủi ro (hai chỗ cùng khai báo `Order` mà không biết). Trong
  repo này `moduleDetection` mặc định là `force` nên file nào cũng là module và hai file không gộp vào nhau; merge chỉ xảy ra trong cùng một file hoặc
  qua `declare global`/`declare module` (xem `notes/03`).
- "Biên dịch nhanh hơn nhờ cache" là điểm có thật nhưng nhỏ (đáng kể ở codebase lớn với kiểu phức tạp), không nên là lý do chính.
- Thêm lý do mạnh hơn: `extends` kiểm tra xung đột ngay tại khai báo.

### 2. Tiền nên là `number` hay kiểu khác? Rủi ro của `0.1 + 0.2` ảnh hưởng thế nào đến thiết kế của bạn?

**Bản gốc**

> tiền có thể để là number nhưng cần lưu ý rủi ro khi 0.1+0.2=0.300000000000001 của số thực, có thể ảnh hưởng đến so sánh ví dụ === , tổng tiền. có
> thể xử lý ở backend khi đẩy dữ liệu lên server hoặc tự làm tròn theo nhu cầu của business, như hiện tại mình đang để làm tròn đến thập phân thứ 2

**Bản đã sửa**

`number` thập phân không phù hợp cho tiền thật: `0.1 + 0.2 === 0.30000000000000004` vì số thực nhị phân không biểu diễn chính xác `0.1`. Rủi ro là so
sánh bằng `===` sai và tổng bị lệch cộng dồn qua nhiều dòng. Làm tròn bằng `Math.round(x * 100) / 100` **không đủ**:
`1.005 * 100 = 100.49999999999999` nên `price: 1.005` ra `1.00` thay vì `1.01`.

Thiết kế đúng hướng: lưu tiền bằng **số nguyên đơn vị nhỏ nhất** (cent, đồng), đặt tên rõ như `priceMinor`, cộng/trừ/nhân số nguyên thì chính xác
tuyệt đối (an toàn tới `Number.MAX_SAFE_INTEGER`). Chỉ phần chia và phần trăm mới cần làm tròn, và làm ở **một hàm duy nhất** theo quy tắc business
(làm tròn từng dòng hay tổng, hướng làm tròn). Chuyển đổi từ/đến số thập phân hoặc chuỗi chỉ ở biên (parse đầu vào, định dạng khi hiển thị). Cần số
rất lớn thì `bigint`; tính toán thuế/tỷ giá phức tạp thì dùng thư viện decimal. Ở bài này tôi giữ `number` thập phân với làm tròn từng dòng đến 2 chữ
số vì mục tiêu là học type system, và biết rõ giới hạn của nó.

**Ghi chú sửa**

- Sửa lỗi gõ: `0.300000000000001` thành `0.30000000000000004`.
- Bỏ ý "xử lý ở backend khi đẩy dữ liệu lên server" (code này chính là backend; ý này mơ hồ).
- Bổ sung các phương án thay thế (số nguyên minor units, `bigint`, thư viện decimal) và lý do không chọn làm tròn thập phân làm giải pháp lâu dài.
- Bổ sung ví dụ biên cụ thể `1.005` mà cách làm tròn hiện tại xử lý sai. Chi tiết ở `notes/06`.

### 3. TypeScript suy luận kiểu trả về như thế nào? Khi nào nên ghi tường minh?

**Bản gốc**

> ts suy luận kiểu theo dữ liệu trả về, ngữ cảnh để trả về đúng type. để tường minh khi ép kiểu, hàm đệ quy hoặc hàm công khai (public api)

**Bản đã sửa**

TypeScript suy ra kiểu trả về là **hợp (union) kiểu của mọi biểu thức `return`** trong thân hàm. Với `calculateOrderTotal`, hover thấy `number`, vì
`reduce` có giá trị khởi tạo `0`. Hàm `async` được suy ra là `Promise<…>`; nhánh `return;` thêm `undefined`; hàm `function` luôn throw ra `void`, còn
arrow function luôn throw ra `never`.

Nên ghi tường minh khi: hàm export/public API (khoá hợp đồng, để sửa thân hàm không đổi kiểu âm thầm và lỗi báo ngay trong thân hàm thay vì ở nơi
gọi), hàm đệ quy, hàm luôn throw (`: never`), hàm `async` export (`Promise<T>`), type predicate. Không ghi cho callback ngắn và biến cục bộ. Quyết
định ở bài này: **ghi `: number`** cho `calculateOrderTotal` vì là hàm export; nếu ai đó sửa thân hàm làm nó trả `string`, lỗi báo ngay tại hàm.

**Ghi chú sửa**

- Bỏ "khi ép kiểu": ép kiểu (`as`) không phải lý do để ghi kiểu trả về.
- Bổ sung kiểu cụ thể mà hover cho thấy (`number`) và cơ chế (union của mọi `return`).
- Bổ sung lý do cốt lõi cho hàm export: kiểu suy luận đổi âm thầm khi sửa thân hàm. Chi tiết ở `notes/01`.

### 4. Nếu truyền object có thêm thuộc tính thừa vào hàm thì xảy ra gì? Khác nhau thế nào giữa object literal và biến trung gian?

**Bản gốc**

> nếu truền object có thêm thuộc tính thừa thì tùy vào truyền vào biến sẽ không lỗi (đủ các đối tượng còn lại) hoặc truyền trực tiếp giá trị sẽ cảnh
> báo lỗi excess property

**Bản đã sửa**

- Truyền **object literal trực tiếp** (`calculateOrderTotal({ id: 1, items: [...], note: "x" })`): TypeScript báo lỗi *excess property*
  (`Object literal may only specify known properties`). Lý do: literal vừa được viết ra tại chỗ, thuộc tính thừa gần như chắc chắn là gõ nhầm. Kiểm
  tra này áp dụng cả cho literal lồng nhau, trong mảng, và ở `return`.
- Truyền **qua biến trung gian** (`const o = {...}; calculateOrderTotal(o)`): không lỗi, vì TypeScript dùng *structural typing* (chỉ cần đủ thuộc tính
  cần thiết với kiểu tương thích), và một biến có thể được dùng ở nhiều nơi nên thừa thuộc tính là bình thường.
- Cả `as Order` lẫn spread (`{ ...x }`) cũng qua mặt được kiểm tra này; `satisfies` thì không.
- Lưu ý: ở runtime thuộc tính thừa vẫn **tồn tại** (kiểu bị xoá khi build), nên dữ liệu từ ngoài vào cần được validate hoặc map tay sang DTO.

**Ghi chú sửa**

- Bổ sung *vì sao* kiểm tra chỉ áp dụng cho literal (literal tươi so với biến), khái niệm structural typing và các trường hợp qua mặt (`as`, spread).
  Bản gốc nêu đúng ý chính.
- Sửa chính tả (`truền`).

### Câu hỏi kiểm tra (do agent hỏi sau khi nộp)

Các câu trả lời bản gốc đã được review. Dưới đây là bản chuẩn để tự đối chiếu; phần "Ghi chú của bạn" trong `notes/` nên bổ sung bằng lời của bạn.

1. **`1.005 * 100` ra gì và `{ qty: 1, price: 1.005 }` cho ra bao nhiêu?** `100.49999999999999` vì `1.005` không biểu diễn chính xác trong nhị phân.
   Hàm hiện tại làm `Math.round(100.49999999999999) / 100 = 1`, tức `1` chứ không phải `1.01`. Hướng sửa: lưu giá bằng số nguyên minor units (đổi
   **kiểu dữ liệu**, không chỉ đổi cách làm tròn).
2. **Hai `interface Order` trùng tên:** gộp lại thành một nếu ở cùng scope (cùng file, hoặc script toàn cục, hoặc augmentation); khác module thì không
   gộp. Với kiểu của chính mình, merge ngầm thường là hại vì khó biết trường nằm ở đâu.
3. **Bỏ `: number`:** TypeScript suy ra `number`. Rủi ro: sửa thân hàm (ví dụ nối thêm chuỗi) thì kiểu trả về đổi thành `string` âm thầm và lỗi nổ ở
   nơi gọi.
4. **`readonly OrderItem[]`:** ngăn `push`/`pop`/`splice`/`sort`/gán theo chỉ số. **Không** ngăn sửa thuộc tính của phần tử
   (`const first = order.items[0]; if (first) first.qty = 5` vẫn hợp lệ, vì `readonly` chỉ áp dụng nông), và không có tác dụng lúc chạy (cần
   `Object.freeze`, cũng nông). Lưu ý ví dụ `items[0].status = "new"` trong bản gốc báo lỗi vì `status` không tồn tại, không phải vì readonly.

## Tiêu chí đạt

- [x] `npm run type-check` sạch.
- [x] `npm test` pass.
- [x] Không có `any`, không mutate input.
- [x] Trả lời được 4 câu hỏi trên bằng lời của bạn.

## Nộp bài

Báo "xong Bài 1" kèm câu trả lời cho các câu hỏi. Tôi sẽ review code và test, rồi hỏi thêm vài câu kiểm tra trước khi cập nhật `PROGRESS.md`.
