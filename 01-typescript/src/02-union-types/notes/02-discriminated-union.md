# 2. Discriminated union

Union của các object có chung một thuộc tính **literal** (gọi là discriminant hoặc tag). Kiểm tra thuộc tính đó thì compiler biết chính xác bạn đang cầm nhánh nào.

```ts
type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "rect"; width: number; height: number };

function area(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return Math.PI * s.radius ** 2;   // s: { kind: "circle"; radius: number }
    case "rect":
      return s.width * s.height;        // s: { kind: "rect"; ... }
  }
}
```

## Ý chính

- Mỗi nhánh chỉ mang **đúng các trường có nghĩa với nhánh đó**. Đây là cách làm cho trạng thái bất hợp lệ không thể biểu diễn (xem ghi chú 4).
- Discriminant phải là kiểu literal (chuỗi, số, boolean, `null`, `undefined`). `kind: string` thì không narrow được.
- Tag là phần **duy nhất tồn tại lúc runtime**. Kiểu bị xoá khi build, còn giá trị `"circle"` thì còn, nên tag mới là thứ phân biệt nhánh khi dữ liệu đi qua JSON hay database.
- Đây là *sum type* (ADT) của TypeScript. PHP chưa có sum type mang dữ liệu; cách tương đương là hệ phân cấp class kèm `instanceof` hoặc `match`.

## Lý thuyết chi tiết

**Cơ chế narrowing.** Khi bạn kiểm tra `s.kind === "circle"`, compiler lọc union, chỉ giữ lại thành viên mà `kind` có thể bằng `"circle"`. Điều kiện cần là *mọi* thành viên đều có thuộc tính `kind` với kiểu literal. Chỉ cần một nhánh ghi `kind: string` là việc lọc hỏng.

**Các cách kiểm tra discriminant đều hoạt động:** `switch`, `if (s.kind === ...)`, `!==`, và cả `s.kind === "a" || s.kind === "b"` (thu về union hai nhánh).

**Discriminant kiểu boolean** rất hợp cho kết quả thành công hoặc thất bại:

```ts
type Res<T, E> = { ok: true; value: T } | { ok: false; error: E };

function unwrap<T>(r: Res<T, Error>): T {
  if (r.ok) return r.value;   // r: { ok: true; ... }
  throw r.error;              // r: { ok: false; ... }
}
```

Đây là nền tảng của `Result<T, E>` ở Bài 3 và Bài 10.

**Destructuring vẫn narrow** (TS 4.6+), với điều kiện destructure ra `const` hoặc tham số không bị gán lại:

```ts
function f(s: Shape) {
  const { kind } = s;
  if (kind === "circle") return s.radius;   // s đã được thu về circle
  return s.width;
}
```

**So với một object phẳng toàn trường optional**:

```ts
// Dễ sai: kiểu cho phép tổ hợp vô nghĩa
type Bad = { kind: "circle" | "rect"; radius?: number; width?: number; height?: number };
// Dùng được ở mọi nơi, nhưng phải kiểm tra undefined hoặc dùng `!`, và không có gì cấm { kind: "circle", width: 3 }.
```

Với discriminated union, `{ kind: "circle", width: 3 }` bị compiler từ chối, và trong nhánh circle không cần `!` hay kiểm tra thêm.

**Tách thành các kiểu có tên** giúp dùng lại và đặt chính xác kiểu hàm:

```ts
type Circle = Extract<Shape, { kind: "circle" }>;   // lấy lại một nhánh từ union
type Kinds = Shape["kind"];                         // "circle" | "rect"
```

Hoặc ngược lại, khai báo từng nhánh trước rồi hợp thành union (hay hơn khi mỗi nhánh có nhiều hàm riêng, xem ghi chú 4).

**Narrowing bằng `in`** là phương án khi union không có tag, nhưng mong manh hơn: thêm một thuộc tính trùng tên ở nhánh khác là logic hỏng. Ưu tiên thêm tag.

## Tricks & tips thực tế

- **Chọn một tên tag thống nhất cho cả codebase**: `kind`, `type`, `status`, hoặc `_tag`. Trộn lẫn khiến code khó đọc và khó viết helper chung. `type` dễ gây nhầm với từ khoá `type` của TypeScript; `kind` hay `status` rõ hơn.
- **Tag dùng chuỗi literal, không dùng `enum`**. Chuỗi serialize thẳng vào JSON, đọc được khi debug, và không sinh code runtime. Chuỗi cũng khớp với cột `status` trong database.
- **Bảng tra theo tag** thay cho chuỗi `if`: compiler bắt buộc đủ khoá (dùng mapped type, học kỹ ở Bài 5):
  ```ts
  type Handlers = { [S in Shape as S["kind"]]: (s: S) => number };

  const handlers: Handlers = {
    circle: (s) => s.radius,   // s tự suy ra đúng nhánh
    rect: (s) => s.width,
  };
  ```
- **Không lồng discriminant quá hai tầng**. Nếu thấy mình viết `switch` trong `switch` trong `switch`, hãy tách thành hàm nhỏ hoặc xem lại mô hình.
- **Đừng dựa vào truthiness để narrow union object**: `if (s.radius)` vừa không narrow đáng tin vừa loại luôn trường hợp `radius = 0`. Luôn kiểm tra tag.
- **Dữ liệu từ ngoài** (request body, message queue, webhook) chưa phải `Shape`; chỉ là `unknown` có vẻ giống. Bài 9 dạy `z.discriminatedUnion("kind", [...])` để validate rồi mới có kiểu.
- **Tag mới trong dữ liệu cũ**: khi đọc từ DB hay API đối tác, có thể gặp giá trị tag mà code chưa biết (xem chính sách xử lý ở ghi chú 3).
- **Tương đương trong Laravel**: một bảng với cột `status` kèm vài cột nullable (`paid_at`, `cancel_reason`) là dạng "object phẳng toàn optional". Discriminated union là cách mô hình hoá đúng hơn trong tầng domain, còn tầng persistence vẫn có thể giữ cột nullable, chuyển đổi ở repository.
- **Kiểm tra bằng compiler**: viết một dòng gán sai rồi để `// @ts-expect-error` ngay trên đó. Nếu một ngày kiểu bị nới lỏng, dòng này sẽ báo "unused directive" và nhắc bạn.

## Liên hệ bài tập

Trạng thái của Order và Payment trong bài lab Bài 2 là ứng viên điển hình cho discriminated union. Khi mô hình, chỉ định từng trạng thái cần dữ liệu gì (và không cần gì), thay vì gom mọi trường vào một object.

## Đọc thêm

- [Discriminated Unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)
- [Control flow analysis for destructured discriminated unions (TS 4.6)](https://devblogs.microsoft.com/typescript/announcing-typescript-4-6/)

## Ghi chú của bạn

