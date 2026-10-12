# 1. Type inference

TypeScript tự suy ra kiểu từ giá trị, nên không cần ghi kiểu ở mọi chỗ.

```ts
const price = 100;        // kiểu literal: 100 (const → kiểu hẹp)
let qty = 2;              // kiểu number (let → kiểu rộng)
const items = [1, 2, 3];  // number[]

function double(n: number) {   // kiểu trả về suy ra là number
  return n * 2;
}
```

## Ý chính

- `const` giữ kiểu hẹp (literal), `let` mở rộng ra kiểu gốc (*widening*).
- Tham số hàm phải ghi kiểu. Kiểu trả về có thể để TypeScript suy ra.
- Quy ước trong backend:
  - Ghi kiểu tường minh ở **ranh giới** (hàm export, public API) để làm hợp đồng và để lỗi báo đúng chỗ.
  - Để suy luận cho biến cục bộ.
- Kiểu trả về suy ra là hợp (union) của mọi nhánh `return`.

## Lý thuyết chi tiết

**Widening và narrowing literal**

```ts
const a = "x";            // "x"
let b = "x";              // string
const o = { status: "ok" };  // { status: string }  ← thuộc tính object bị widen dù khai báo bằng const
```

`const` chỉ cố định biến, không cố định thuộc tính bên trong object. Vì vậy `o.status` là `string`, không phải `"ok"`.

**Contextual typing**: kiểu của tham số callback được suy ra từ nơi truyền vào.

```ts
[1, 2, 3].map((n) => n * 2);   // n: number, không cần ghi
```

**Best common type**: mảng hỗn hợp suy ra union.

```ts
const mixed = [1, "a"];   // (string | number)[]
```

**Kiểu trả về suy ra** là union của mọi nhánh `return`. Thiếu một nhánh (hàm kết thúc mà không `return`) thì thêm `undefined` vào union; `noImplicitReturns` (đã bật trong repo) sẽ báo lỗi chỗ này.

**Array rỗng**: `const xs = []` có kiểu `any[]` tiến hoá (evolving), TypeScript chốt kiểu theo các lần `push`. Dễ gây khó hiểu, nên ghi kiểu: `const xs: string[] = []`.

**Inference theo hướng ngược**: tham số kiểu generic cũng được suy ra từ đối số (`identity("a")` → `T = "a"`). Sẽ học kỹ ở Bài generics.

## Tricks & tips thực tế

- **`as const`** để giữ literal và `readonly` cho cả cây object:
  ```ts
  const ROLES = ["admin", "user"] as const;   // readonly ["admin", "user"]
  type Role = (typeof ROLES)[number];         // "admin" | "user"
  ```
  Một nguồn sự thật duy nhất cho cả giá trị runtime lẫn kiểu.
- **`satisfies`** (TS 4.9+): kiểm tra khớp kiểu mà không làm mất kiểu hẹp.
  ```ts
  const config = { port: 3000, env: "dev" } satisfies Record<string, string | number>;
  config.port.toFixed();   // vẫn là number, không bị đổi thành string | number
  ```
- **`ReturnType<typeof fn>`** và **`Awaited<...>`** để lấy kiểu từ hàm có sẵn, tránh khai báo lặp.
- **Hover và "Go to type definition"** trong editor là công cụ debug kiểu nhanh nhất. Khi không hiểu một kiểu, gán nó vào biến rồi hover.
- **Ghi kiểu trả về cho hàm export**: lỗi sẽ báo ở thân hàm (nơi sai) thay vì ở chỗ gọi. Với hàm `async`, ghi `Promise<T>` để không vô tình trả về `Promise<Promise<...>>` hay `undefined`.
- **Đừng ghi kiểu thừa cho biến cục bộ** (`const n: number = 1`): ồn mà còn làm mất literal type.
- **Lỗi phổ biến**: `let status = "ok"` rồi truyền vào hàm nhận `"ok" | "fail"` sẽ lỗi vì đã widen. Sửa bằng `const`, `as const`, hoặc ghi kiểu cho biến.

## Liên hệ bài tập

Viết `calculateOrderTotal` không ghi kiểu trả về, hover xem editor suy ra gì, rồi quyết định có ghi tường minh không.

## Đọc thêm

- [Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html)
- [Type Inference](https://www.typescriptlang.org/docs/handbook/type-inference.html)

## Ghi chú của bạn

