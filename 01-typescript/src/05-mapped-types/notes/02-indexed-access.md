# 2. Indexed access `T[K]`: lấy kiểu của một thuộc tính

Viết `T[K]` để lấy kiểu của thuộc tính `K` trong `T`, giống truy cập `obj[key]` nhưng ở thế giới kiểu.

```ts
interface Order {
  id: string;
  customer: { id: string; address: { city: string; zip?: string } };
  items: { sku: string; qty: number }[];
  status: "draft" | "paid" | "shipped";
}

type Status = Order["status"];                       // "draft" | "paid" | "shipped"
type City = Order["customer"]["address"]["city"];    // string
type Item = Order["items"][number];                  // { sku: string; qty: number }
```

## Ý chính

- `T[K]` với `K` là **một kiểu** (literal, union, `keyof T`, `number`, `string`), không phải giá trị.
- Có thể xâu chuỗi để đi sâu: `T["a"]["b"]`.
- `T[number]` lấy kiểu phần tử của mảng/tuple; `T[keyof T]` lấy union mọi giá trị.
- Đây là "lookup type": dùng nó để **không khai báo trùng** kiểu con đã có trong kiểu cha.
- Khoá không tồn tại là lỗi biên dịch, nên nó cũng là cách kiểm tra khoá.

## Lý thuyết chi tiết

**Khoá là union thì kết quả là union.** `Order["id" | "status"]` là `string` (vì `string | "draft" | ...` gộp về `string`). `T[keyof T]` gom giá trị của mọi thuộc tính:

```ts
type ValueOf<T> = T[keyof T];
// ValueOf<{ a: 1; b: "x" }> là 1 | "x"
```

**Thuộc tính optional cho thêm `| undefined`.** `Order["customer"]["address"]["zip"]` là `string | undefined`. Chú ý: đó là kiểu *thuộc tính*, nên nếu bạn muốn kiểu "đã chắc chắn có", dùng `NonNullable<...>` hoặc `-?` (file 03).

**Tuple và mảng.**

```ts
type Pair = [string, number];
// Pair[0]        là string
// Pair[number]   là string | number
// Pair["length"] là 2           (tuple có độ dài literal; mảng thường là number)
// string[][number] là string
```

**`noUncheckedIndexedAccess` chỉ tác động lên biểu thức, không lên kiểu `T[number]`.** Repo đang bật cờ này, nên:

```ts
const arr: string[] = ["a"];
const first = arr[0];        // string | undefined  (biểu thức truy cập)
// type E = string[][number] vẫn là string  (indexed access type)
```

Tương tự với index signature: `const v = dict["x"]` ra `number | undefined`, nhưng `Dict[string]` là `number`. Vì vậy `T[number]` an toàn khi bạn chỉ cần *kiểu phần tử*; còn khi đọc giá trị thật vẫn phải xử lý `undefined`.

**Union của object: chỉ truy cập được khoá có ở mọi thành viên.**

```ts
type Ev = { type: "a"; x: number } | { type: "b"; y: string };
// Ev["type"] là "a" | "b"      -> OK, khoá chung
// Ev["x"]                      -> lỗi: x không có ở nhánh "b"
```

Muốn lấy theo nhánh, dùng `Extract<Ev, { type: "a" }>` rồi mới truy cập.

**Chỉ dùng kiểu làm khoá, không dùng giá trị.** `Order[key]` với `key` là biến sẽ lỗi; viết `Order[typeof key]` nếu `key` là `const key = "id"`. Biến `let key = "id"` có kiểu `string`, không dùng được.

**Với generic: hai biến `T` và `K extends keyof T`.** Đây là mẫu trung tâm của lập trình kiểu ở cấp mapped:

```ts
function pluck<T, K extends keyof T>(rows: T[], key: K): T[K][] {
  return rows.map((r) => r[key]);
}
const emails = pluck([{ email: "a", n: 1 }], "email");   // string[]
```

**So sánh với PHP/Laravel.** Giống phép đọc `$order['customer']['address']['city']` nhưng trên *kiểu*. PHP không có lookup type; docblock `@return Order['status']` không tồn tại, bạn phải dùng enum riêng hoặc PHPStan `key-of<>`/`value-of<>` (công cụ ngoài, không phải ngôn ngữ).

**Kết hợp indexed access với hàm.** `Parameters<F>[1]` lấy kiểu tham số thứ hai, `Parameters<F>["length"]` cho số tham số:

```ts
function send(to: string, subject: string, urgent?: boolean) { return { to, subject, urgent }; }
// Parameters<typeof send>[1]        là string
// Parameters<typeof send>["length"] là 2 | 3     (tham số optional làm độ dài có thể là 2 hoặc 3)
```

**Index vào union của mảng.** `(string[] | number[])[number]` là `string | number`: kết quả là union các kiểu phần tử, nên trả về giá trị đọc ra có thể là một trong hai.

**Đi sâu qua mảng.** `Order["items"][number]["sku"]` đọc từ trái sang phải: thuộc tính `items`, rồi phần tử, rồi thuộc tính `sku`. Dùng khi chỉ cần một trường của phần tử mà không muốn khai báo `interface Item` riêng.

**Các lỗi hay gặp khi viết `T[K]` (đã kiểm chứng, tsc 7.0.2).**
- `function g<T, K>(o: T, k: K) { return o[k]; }` lỗi **TS2536: Type 'K' cannot be used to index type 'T'**: thêm ràng buộc `K extends keyof T`.
- `Cfg["nope"]` lỗi **TS2339: Property 'nope' does not exist on type 'Cfg'**: khoá không tồn tại.
- `People[typeof lkey]` với `let lkey = "name"` lỗi **TS2537: Type 'People' has no matching index signature for type 'string'**: `let` bị widen thành `string`, dùng `const`.
- Truy cập qua thuộc tính optional (`Cfg["db"]["host"]` khi `db?:`) lỗi TS2339 vì kiểu trung gian có `undefined`: dùng `NonNullable<Cfg["db"]>["host"]`.

Danh sách đầy đủ kèm ví dụ nằm ở file 05 của bài này.

## Tricks & tips thực tế

- **Bản đồ sự kiện → payload (rất hợp backend).** Một interface làm nguồn sự thật, hàm generic ép payload đúng theo tên:

  ```ts
  interface EventMap {
    "user.created": { id: string };
    "order.paid": { orderId: string; amount: number };
  }
  function emit<K extends keyof EventMap>(name: K, payload: EventMap[K]): void {
    void name; void payload;
  }
  emit("order.paid", { orderId: "1", amount: 5 });   // OK
  // emit("order.paid", { id: "1" });                // lỗi: payload sai cho event này
  ```

  Lý do: compiler bắt trường hợp gửi nhầm payload của event khác; thêm event mới chỉ cần thêm một dòng vào `EventMap`. Đây là nền cho cách `EventEmitter` có kiểu được dùng trong Node.js (Phase 02).
- **`typeof ARR[number]["field"]` để lấy union từ mảng object `as const`.**

  ```ts
  const ROUTES = [
    { method: "GET", path: "/users" },
    { method: "POST", path: "/users" },
  ] as const;
  type Route = (typeof ROUTES)[number];     // union các object
  type Method = Route["method"];            // "GET" | "POST"
  ```

  Lý do: cấu hình khai báo bằng dữ liệu, kiểu tự sinh theo; không phải bảo trì hai nơi.
- **Dẫn xuất kiểu con thay vì đặt tên lặp.** `type Address = Order["customer"]["address"]` tốt hơn tự gõ lại cấu trúc: đổi trong `Order` thì `Address` tự theo. Nhưng nếu kiểu con được dùng độc lập ở nhiều nơi, tách thành `interface Address` rõ ràng và để `Order` tham chiếu nó: dễ đọc hơn chuỗi `["a"]["b"]["c"]` dài.
- **Cẩn trọng với `Order["items"][number]` khi `items` optional.** Khi thuộc tính là `items?: Item[]`, `Order["items"]` là `Item[] | undefined` và `[number]` lên một union có `undefined` sẽ lỗi. Dùng `NonNullable<Order["items"]>[number]`.
- **Debug "Property does not exist on type" khi truy cập chuỗi**: tách từng bước ra `type S1 = Order["customer"]; type S2 = S1["address"];` và hover từng alias để thấy chỗ nào kiểu thật khác điều bạn nghĩ (thường là thiếu `NonNullable` hoặc là union).
- **Đừng lạm dụng chuỗi truy cập sâu trong chữ ký hàm công khai.** Người dùng hover hàm sẽ thấy `Order["customer"]["address"]["city"]` thay vì `string`. Đặt alias có tên cho kiểu quan trọng; lý do là thông điệp lỗi và hover dễ đọc hơn.

## Liên hệ bài tập

`MyPick` và `Getters<T>` cần đọc kiểu của từng thuộc tính khi dựng kiểu mới: bạn sẽ dùng `T[K]` bên trong mapped type. Thử trước trên giấy: với `K` là khoá hiện tại đang duyệt, kiểu giá trị tương ứng ở `T` viết thế nào?

## Đọc thêm

- [Indexed Access Types](https://www.typescriptlang.org/docs/handbook/2/indexed-access-types.html)
- [noUncheckedIndexedAccess](https://www.typescriptlang.org/tsconfig/#noUncheckedIndexedAccess)

## Ghi chú của bạn

