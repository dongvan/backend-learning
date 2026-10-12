# 1. Union và intersection

Union (`|`) nghĩa là "một trong các kiểu". Intersection (`&`) nghĩa là "đồng thời tất cả các kiểu".

```ts
type Id = string | number;                       // union
type UserRow = User & { createdAt: Date };       // intersection
```

## Ý chính

- Với union, bạn chỉ dùng được những gì **chung cho mọi thành viên**; muốn dùng phần riêng thì phải narrow trước (xem Bài 1, ghi chú 5).
- Với intersection của object, kiểu kết quả có **nhiều thuộc tính hơn** (gộp của cả hai). Union thì ngược lại: ít thứ dùng chung được hơn.
- Intersection của hai kiểu không thể cùng đúng (ví dụ `string & number`) cho ra `never`.
- Thứ tự trong union và intersection không quan trọng.

## Lý thuyết chi tiết

**Tư duy theo tập hợp.** Một kiểu là tập các giá trị hợp lệ. `A | B` là phép hợp tập, `A & B` là phép giao tập. Điều khiến người mới hay nhầm: với object, giao tập nghĩa là giá trị phải thoả cả hai kiểu, tức phải có đủ thuộc tính của cả hai, nên kiểu trông "to hơn".

```ts
type Id = string | number;

function show(id: Id) {
  id.toFixed(0);                                  // Lỗi: string không có toFixed
  return typeof id === "string" ? id.toUpperCase() : id.toFixed(0);
}
```

**Union của literal** là cách mô hình "tập giá trị cố định", thay cho enum trong hầu hết trường hợp:

```ts
type Status = "draft" | "sent" | "paid";
```

**Union của object và excess property check.** Với union không có discriminant, object literal được kiểm tra thuộc tính thừa theo *tất cả* thành viên gộp lại, nên có thể gán một object mang thuộc tính của cả hai nhánh:

```ts
type A = { a: string } | { b: number };
const both: A = { a: "1", b: 2 };   // OK, dù ý định là "một trong hai"
```

Nếu cần loại trừ lẫn nhau (XOR), thêm thuộc tính optional kiểu `never` vào nhánh kia:

```ts
type Xor =
  | { a: string; b?: never }
  | { b: number; a?: never };

const bad: Xor = { a: "1", b: 2 };   // Lỗi
const ok: Xor = { a: "1" };          // OK
```

Cách tốt hơn trong đa số trường hợp là thêm discriminant (ghi chú 2).

**Subtype reduction.** Compiler có thể gộp bớt thành viên thừa: `"a" | string` thu về `string`. Hệ quả là mất gợi ý autocomplete cho literal. Xem trick `string & {}` bên dưới.

**Intersection xung đột.**

```ts
type X = { kind: "a" } & { kind: "b" };   // thu về never, vì kind không thể đồng thời là "a" và "b"
```

Khi hai thuộc tính trùng tên khác kiểu nhưng không phải literal đơn vị (ví dụ `{ id: string } & { id: number }`), thuộc tính `id` có kiểu `never` thay vì cả object thu về `never`. Rất khó phát hiện vì không có lỗi ở chỗ khai báo. Đây là lý do `interface extends` (báo lỗi ngay) an toàn hơn `&` khi mở rộng (xem Bài 1, ghi chú 3).

**Phân phối.** `(A | B) & C` bằng `(A & C) | (B & C)`. Compiler tự khai triển, nên union và intersection kết hợp được mà không cần suy nghĩ về thứ tự.

**Mảng.** `string[] | number[]` (mảng thuần một kiểu) khác `(string | number)[]` (mảng trộn):

```ts
function f(a: string[] | number[]) {
  a.push("x");   // Lỗi: không biết đang là mảng nào, nên đối số phải vừa string vừa number
}
```

## Tricks & tips thực tế

- **Autocomplete cho literal nhưng vẫn nhận chuỗi tự do**: dùng `string & {}` để chặn subtype reduction.
  ```ts
  type Color = "red" | "blue" | (string & {});
  const c: Color = "green";   // OK; editor vẫn gợi ý "red" và "blue"
  ```
  Dùng khi API nhận "giá trị phổ biến hoặc tuỳ ý" (tên header, mã quốc gia), không dùng cho dữ liệu cần chặt.
- **Dùng `&` để thêm trường chung**, đừng copy:
  ```ts
  type WithTimestamps = { createdAt: Date; updatedAt: Date };
  type UserRow = User & WithTimestamps;
  ```
  Tương tự trait/mixin trong Laravel, nhưng chỉ ở mức kiểu.
- **Đừng dùng `&` để "ghi đè" thuộc tính**. `Omit<A, "id"> & { id: number }` mới là cách đúng; `A & { id: number }` khi `A.id` là `string` cho ra `id: never`.
- **Thay bộ cờ boolean bằng union**. `isPaid` + `isCancelled` cho 4 tổ hợp, trong đó có tổ hợp vô nghĩa. Union literal `"paid" | "cancelled" | "open"` chỉ có đúng các trạng thái hợp lệ.
- **Kiểu tham số hàm nên nhận union rộng, kiểu trả về nên hẹp**. Ví dụ nhận `string | number`, nhưng nội bộ chuẩn hoá thành một kiểu rồi trả về kiểu đó.
- **So với PHP**: union type của PHP 8 được kiểm tra lúc chạy và có thể ép kiểu ngầm (nếu không `strict_types`). Union của TypeScript bị xoá hoàn toàn khi build, nên không có gì bảo vệ lúc runtime. Dữ liệu ngoài vào vẫn là `unknown` cho đến khi validate.
- **Lọc union bằng utility type**: `Exclude<Status, "draft">`, `Extract<Status, "paid" | "sent">`. Học kỹ ở Bài 4.
- **Khi lỗi "Property X does not exist on type A | B"**: đừng ép `as`; thêm bước narrow (`in`, `typeof`, hoặc discriminant).

## Liên hệ bài tập

Bài lab Bài 2 (xem `PLAN.md`) yêu cầu mô hình trạng thái bằng union. Trước khi làm, tự hỏi: trạng thái nào của hệ thống thực sự tồn tại, và tổ hợp nào của dữ liệu là vô nghĩa?

## Đọc thêm

- [Union Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#union-types)
- [Intersection Types](https://www.typescriptlang.org/docs/handbook/2/objects.html#intersection-types)

## Ghi chú của bạn

