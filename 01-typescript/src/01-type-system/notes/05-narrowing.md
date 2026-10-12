# 5. Narrowing

TypeScript thu hẹp kiểu theo luồng điều khiển.

```ts
function format(v: string | number | null) {
  if (v === null) return "n/a";           // v: null
  if (typeof v === "string") return v;    // v: string
  return v.toFixed(2);                    // v: number
}
```

## Công cụ narrowing

- `typeof`, `instanceof`, `in`
- So sánh `===`, truthiness
- Type guard tự viết: `function isString(x: unknown): x is string`

## Ý chính

- Narrowing hoạt động theo luồng: sau `return` hoặc `throw`, kiểu ở nhánh còn lại bị loại bớt.
- Với `unknown`, narrow trước rồi mới dùng.
- Type guard tự viết là lời hứa của bạn với compiler; nếu viết sai, compiler không bắt được.

## Lý thuyết chi tiết

**Các dạng narrowing**

| Công cụ | Ví dụ | Lưu ý |
|---|---|---|
| `typeof` | `typeof v === "string"` | Trả về: `string`, `number`, `boolean`, `bigint`, `symbol`, `undefined`, `object`, `function`. `typeof null === "object"` (lỗi lịch sử) |
| Truthiness | `if (v) {...}` | Loại `null`/`undefined` nhưng cũng loại `0`, `""`, `NaN`, `false` |
| So sánh | `v === null`, `v == null` | `== null` bắt cả `null` lẫn `undefined` |
| `instanceof` | `e instanceof Error` | Chỉ cho class/constructor, không dùng cho kiểu `type`/`interface` |
| `in` | `"email" in obj` | Thu hẹp union theo sự có mặt của thuộc tính |
| Discriminant | `shape.kind === "circle"` | Nền tảng của discriminated union (Bài 2) |
| `Array.isArray` | `Array.isArray(x)` | `typeof []` là `"object"`, nên dùng hàm này |
| Type predicate | `x is Foo` | Hàm tự viết, compiler tin tuyệt đối |
| Assertion function | `asserts x is Foo` | Throw nếu sai, sau đó kiểu được thu hẹp |

**Control flow analysis**: compiler theo dõi gán, `return`, `throw`, `&&`, `||`, `??`, `?.` để biết kiểu tại từng điểm.

```ts
function len(s?: string) {
  if (!s) return 0;
  return s.length;       // s: string
}
```

**Narrowing bị mất** khi:
- Biến được gán lại trong closure/callback, hoặc là `let` bị hàm khác sửa.
- Thuộc tính object có thể bị thay đổi giữa hai lần truy cập (đặc biệt sau lời gọi hàm).
- Dùng trong callback bất đồng bộ.

```ts
function f(v: string | null) {
  if (v === null) return;
  [1, 2].forEach(() => v.length);   // OK nếu v là tham số/const không bị gán lại
}

let w: string | null = getValue();
if (w !== null) {
  setTimeout(() => w.length, 0);    // Lỗi: w là let, có thể bị gán lại trước khi callback chạy
}
```

Cách chắc ăn: gán vào `const` cục bộ rồi narrow trên biến đó (`const name = w; if (name !== null) {...}`).

**Type predicate sai là lỗi thầm lặng**:

```ts
function isUser(x: unknown): x is User {
  return typeof x === "object";   // sai, nhưng compiler vẫn tin
}
```

**Discriminated union**: union các object có chung một thuộc tính literal (`kind`/`type`/`status`). Kiểm tra thuộc tính đó là narrow được cả object. Sẽ làm kỹ ở Bài 2.

## Tricks & tips thực tế

- **Early return** (guard clause) thay cho `if` lồng nhau: sau mỗi guard kiểu hẹp dần, code phẳng, dễ đọc.
  ```ts
  if (!order) throw new NotFoundError();
  if (order.status !== "paid") return;
  // order: Order với status "paid"
  ```
- **Lọc mảng bỏ `null`** cần type predicate, nếu không kiểu vẫn còn `null`:
  ```ts
  const ids = list.filter((x): x is string => x !== null);
  ```
  (TS 5.5+ tự suy ra predicate trong nhiều trường hợp đơn giản, nhưng vẫn nên biết cách viết tay.)
- **Optional chaining + nullish coalescing**: `user?.profile?.name ?? "N/A"`. Dùng `??` thay `||` khi `0` hoặc `""` là giá trị hợp lệ (ví dụ `qty ?? 1`, nếu dùng `||` thì `0` bị thay bằng `1`).
- **Truthiness trap với số**: `if (quantity)` loại cả `0`. Viết `if (quantity !== undefined)` khi `0` hợp lệ.
- **`in` để phân biệt union không có discriminant**, nhưng ưu tiên thêm trường `kind` vào kiểu hơn là dựa vào `in`.
- **Validate ở ranh giới rồi tin kiểu ở bên trong**: narrow `unknown` bằng Zod (`schema.parse` / `safeParse`) một lần ở controller, phần còn lại của code dùng kiểu đã chắc chắn, đừng narrow lặp lại khắp nơi.
- **`assertNever` ở nhánh `default` của `switch`** để compiler nhắc khi thêm trường hợp mới vào union (xem ghi chú 4).
- **Debug narrowing**: hover biến ở từng dòng để xem kiểu thay đổi; hoặc gán tạm `const _check: never = v;` để biết còn khả năng nào chưa được loại.

## Liên hệ bài tập

Dùng khi xử lý đầu vào có thể rỗng hoặc thiếu. Narrowing là nền tảng cho discriminated union ở Bài 2.

## Đọc thêm

- [Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)

## Ghi chú của bạn

