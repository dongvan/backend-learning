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

**Khi nào hai `interface` trùng tên thực sự bị gộp?** Chỉ khi chúng nằm trong **cùng một scope**:

| Tình huống | Gộp? |
|---|---|
| Hai khai báo trong cùng một file (cùng module hoặc cùng global) | Có |
| Hai file đều là *script* (không có `import`/`export`, không bị ép thành module), cùng khai báo ở global scope | Có, và đây là nguồn gây bug khó thấy |
| Hai file là *module* (có `export`/`import`) mỗi file khai báo `interface Order` riêng | **Không**, mỗi file có `Order` riêng |
| Dùng `declare module "x" { interface Y {…} }` hoặc `declare global { … }` | Có, đó là *module augmentation* chủ ý |

Trong repo này, `module: NodeNext` làm `moduleDetection` mặc định là `force`, nghĩa là **mọi file đều được coi là module** kể cả khi không có `import`/`export` (đã kiểm chứng: hai file khai báo `interface Order` riêng không gộp và không xung đột). Vì vậy ở đây merge ngầm giữa các file chỉ xảy ra khi bạn chủ động dùng `declare global`/`declare module`. Trong project cấu hình khác (`moduleDetection: "auto"`, hay file `.d.ts` toàn cục), nguy cơ có thật.

Merge trong cùng scope vẫn có kiểm tra: cùng tên thuộc tính khác kiểu báo `TS2717 Subsequent property declarations must have the same type`; `type` trùng tên báo `TS2300 Duplicate identifier`.

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

**Khác biệt tinh tế: index signature ngầm.** Alias `type` của object literal gán được cho `Record<string, unknown>`, còn `interface` thì không:

```ts
interface I { a: number }
type T = { a: number };

const r1: Record<string, unknown> = {} as T;   // OK
const r2: Record<string, unknown> = {} as I;   // Lỗi: interface không có index signature ngầm
```

Lý do: `interface` có thể bị merge thêm thuộc tính ở nơi khác nên compiler không dám coi nó "đóng", còn `type` thì đóng. Gặp khi truyền kiểu domain vào hàm nhận `Record<string, unknown>` (ví dụ logger, serializer).

**Khi nào `interface` là lựa chọn tốt thật sự**
- Mô tả contract cho `class … implements` (cả `type` cũng implements được, nhưng quy ước thường dùng `interface`).
- Cần module augmentation (thêm `user` vào `Express.Request`).
- Cây kế thừa rộng (`extends` báo lỗi xung đột ngay).

**Khi nào `type` bắt buộc**: union, tuple, mapped/conditional/template literal type, hoặc alias cho primitive.

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

