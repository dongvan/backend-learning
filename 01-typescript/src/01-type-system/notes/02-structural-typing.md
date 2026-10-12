# 2. Structural typing

TypeScript so sánh kiểu theo **hình dạng**, không theo tên.

```ts
type Point = { x: number; y: number };
const p = { x: 1, y: 2, label: "a" };
const q: Point = p;  // OK: p có đủ x, y

const r: Point = { x: 1, y: 2, label: "a" };  // Lỗi: excess property check
```

## Ý chính

- Giá trị có thừa thuộc tính vẫn gán được, miễn là đủ các thuộc tính cần.
- Riêng **object literal** gán trực tiếp thì bị kiểm tra thuộc tính thừa (*excess property check*).
- Hai kiểu khác tên nhưng cùng hình dạng thì dùng thay nhau được. Ví dụ `UserId` và `OrderId` cùng là `string` sẽ không bị phân biệt. Cách xử lý (branded types) học ở Bài 9.

## Lý thuyết chi tiết

**Structural vs nominal**: Java/C#/PHP (class) so sánh theo tên khai báo; TypeScript chỉ hỏi "giá trị này có đủ thành viên cần thiết không?" (còn gọi là *duck typing* lúc compile).

**Vì sao excess property check chỉ áp dụng cho object literal?** Literal được tạo ngay tại chỗ nên thuộc tính thừa gần như chắc chắn là lỗi gõ sai. Biến có sẵn thì có thể được dùng ở nhiều nơi khác, nên thừa thuộc tính là bình thường.

```ts
const extra = { x: 1, y: 2, z: 3 };
const ok: Point = extra;                      // OK
const bad: Point = { x: 1, y: 2, z: 3 };      // Lỗi
```

**Quy tắc gán cho object**: `S` gán được cho `T` nếu `S` có mọi thuộc tính của `T` với kiểu tương thích. Thuộc tính optional (`?`) của `T` thì `S` không cần có.

**Hàm: tham số là contravariant** (về lý thuyết). Hàm nhận kiểu rộng hơn thì dùng được ở chỗ cần hàm nhận kiểu hẹp hơn, không có chiều ngược lại. Với method (cú pháp `foo(x: T): void`), TypeScript nới lỏng thành bivariant nên có lỗ hổng; `strictFunctionTypes` (nằm trong `strict`) chỉ siết với thuộc tính kiểu hàm (`foo: (x: T) => void`).

**Class cũng structural**: hai class khác tên nhưng cùng thành viên public thì gán cho nhau được. Thêm thành viên `private`/`protected` sẽ khiến class trở nên gần nominal.

**Weak type detection**: kiểu mà mọi thuộc tính đều optional, gán giá trị không có thuộc tính nào trùng sẽ báo lỗi.

```ts
type Opts = { retry?: number };
const o: Opts = { timeout: 1 };   // Lỗi, dù không có thuộc tính nào bắt buộc
```

## Tricks & tips thực tế

- **Cạm bẫy "thừa thuộc tính lọt qua"**: truyền object qua biến trung gian thì không báo lỗi, nên dữ liệu thừa (ví dụ `password`) có thể bị trả ra response hay lưu vào DB. Với dữ liệu từ ngoài, dùng Zod `.strict()`/`.strip()` hoặc map tay sang DTO, đừng tin vào compiler.
- **Branded types** (Bài 9) để phân biệt `UserId` và `OrderId`:
  ```ts
  type UserId = string & { readonly __brand: "UserId" };
  ```
- **`Pick`, `Omit`, `Partial`, `Required`** tạo kiểu mới theo hình dạng, rất hợp với structural typing: `type CreateOrder = Omit<Order, "id">`.
- **Kiểu "đủ dùng" cho tham số hàm**: hàm chỉ cần `{ id: string }` thì khai báo đúng như vậy, không cần nhận cả `User`. Dễ test (truyền object nhỏ), dễ tái sử dụng.
- **`Object.keys(obj)` trả về `string[]`** chứ không phải `(keyof T)[]`, chính vì structural typing: object có thể có thêm key mà kiểu không biết. Đừng vội ép `as (keyof T)[]` nếu chưa chắc nguồn gốc object.
- **Mock trong test**: nhờ structural typing, chỉ cần dựng object có đúng phần mà code dưới test dùng, không cần tạo instance của class thật.

## Liên hệ bài tập

Câu hỏi 4 trong `EXERCISE.md`: truyền object thừa thuộc tính vào `calculateOrderTotal`, so sánh object literal với biến trung gian.

## Đọc thêm

- [Type Compatibility](https://www.typescriptlang.org/docs/handbook/type-compatibility.html)
- [Object Types: Excess Property Checks](https://www.typescriptlang.org/docs/handbook/2/objects.html#excess-property-checks)

## Ghi chú của bạn

