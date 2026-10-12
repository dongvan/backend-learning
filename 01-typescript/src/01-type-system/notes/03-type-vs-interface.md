# 3. `type` vs `interface`

| | `type` | `interface` |
|---|---|---|
| Object shape | ✅ | ✅ |
| Union, tuple, primitive alias | ✅ | ❌ |
| Mở rộng | `&` (intersection) | `extends`, và declaration merging |
| Gộp khai báo trùng tên | ❌ | ✅ |

```ts
type OrderItem = { productId: string; unitPrice: number; quantity: number };

interface Order {
  readonly id: string;
  readonly items: readonly OrderItem[];
}
```

## Ý chính

- Chọn một kiểu làm mặc định cho cả project và dùng nhất quán.
- Dùng `type` khi cần union hoặc kiểu dẫn xuất.
- Dùng `interface` khi cần declaration merging hoặc mô tả contract mà class sẽ `implements`.
- Với data shape thuần như `Order`, cả hai đều dùng được. Điều quan trọng là giải thích được lựa chọn.
- `readonly` và `readonly T[]` giúp compiler bắt việc mutate.

## Lý thuyết chi tiết

**Declaration merging**: hai `interface` trùng tên trong cùng scope được gộp thành một. `type` trùng tên thì báo lỗi.

```ts
interface Window { appVersion: string }   // bổ sung vào interface Window có sẵn
```

Đây là lý do thư viện (Express, global `Window`) dùng `interface`: bạn mở rộng được từ bên ngoài (module augmentation). Trong backend, ví dụ kinh điển là thêm `user` vào `Express.Request`.

**Mở rộng**

```ts
interface A { a: string }
interface B extends A { b: number }     // lỗi báo ngay nếu xung đột kiểu

type A2 = { a: string };
type B2 = A2 & { b: number };           // xung đột thì ra `never` âm thầm, khó phát hiện
```

`extends` kiểm tra xung đột ngay tại khai báo; `&` thì không.

**Chỉ `type` làm được**: union (`A | B`), tuple, alias primitive, mapped type, conditional type, template literal type.

```ts
type Status = "pending" | "paid" | "cancelled";
type Keys = keyof Order;
type Readonlyify<T> = { readonly [K in keyof T]: T[K] };
```

**Chỉ `interface` làm được**: declaration merging.

**`readonly`** chỉ có tác dụng lúc compile (không `Object.freeze`). `readonly T[]` cấm `push`, `pop`, gán theo chỉ số. Nó là *shallow*: `readonly items: OrderItem[]` vẫn cho phép sửa từng phần tử.

**Hiệu năng**: `interface extends` được compiler cache tốt hơn `&` trên kiểu phức tạp. Chỉ đáng quan tâm ở codebase lớn.

## Tricks & tips thực tế

- **Quy ước đơn giản dễ nhớ**: `type` cho mọi thứ, `interface` chỉ khi cần merging hoặc `class implements`. Hoặc ngược lại, miễn nhất quán và có lint rule (`@typescript-eslint/consistent-type-definitions`).
- **Đặt tên**: không dùng tiền tố `I` (`IUser`) trong TS hiện đại; kiểu đặt theo khái niệm (`User`, `CreateUserInput`).
- **Tách kiểu theo vai trò**, đừng một kiểu cho tất cả: `Order` (domain), `CreateOrderInput` (đầu vào), `OrderResponse` (đầu ra). Dùng `Omit`/`Pick` để dẫn xuất thay vì copy tay.
- **Dùng `readonly` mặc định cho dữ liệu domain** và tham số mảng (`readonly OrderItem[]`) để báo hiệu hàm không mutate đầu vào. Tham số `readonly T[]` nhận được cả `T[]` lẫn `readonly T[]`, ngược lại thì không.
- **Hover xem kiểu "mở phẳng"**: nếu kiểu hiện ra khó đọc, dùng helper
  ```ts
  type Prettify<T> = { [K in keyof T]: T[K] } & {};
  ```
- **`import type { Order } from "./order"`**: đánh dấu import chỉ dùng cho kiểu, bị xoá hoàn toàn khi build. Có ích khi bật `verbatimModuleSyntax`/`isolatedModules`.
- **Union thay cho enum**: ưu tiên `type Status = "a" | "b"` hơn `enum`. Không sinh code runtime, dễ serialize JSON, tương thích structural typing tốt hơn.

## Liên hệ bài tập

Câu hỏi 1 trong `EXERCISE.md`: chọn `type` hay `interface` cho `Order`, và giải thích vì sao.

## Đọc thêm

- [Type Aliases vs Interfaces](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#differences-between-type-aliases-and-interfaces)
- [Object Types](https://www.typescriptlang.org/docs/handbook/2/objects.html)

## Ghi chú của bạn

