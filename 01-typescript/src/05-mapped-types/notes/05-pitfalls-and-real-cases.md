# 5. Cạm bẫy và tình huống thực tế với keyof, indexed access và mapped types

Những chỗ người mới (và cả người có kinh nghiệm) hay vấp khi dẫn xuất kiểu: `Object.keys` không trả `keyof`, `interface` không gán được cho `Record<string, ...>`, `Omit` làm mất khoá, mapped type trong hàm generic bắt phải `as`. Mọi ví dụ và mã lỗi trong file này đã được `tsc` 7.0.2 kiểm chứng với cấu hình của repo.

```ts
interface Prices { apple: number; pear: number }
const prices: Prices = { apple: 1, pear: 2 };

for (const k of Object.keys(prices)) {
  prices[k];   // TS7053: Element implicitly has an 'any' type because expression of type 'string' can't be used to index type 'Prices'.
}
```

## Ý chính

- Phần lớn lỗi ở bài này đến từ hai sự thật: **`Object.keys/entries` trả `string`** (structural typing cho phép khoá thừa) và **`interface` không có index signature ngầm** (còn `type` alias object thì có).
- Mapped type trong thân hàm generic thường **không tự gán được**; ranh giới `as` nên nằm trong một hàm nhỏ có chữ ký công khai chính xác.
- `Omit`, `Pick`, `Readonly`, `Partial` đều **nông** và **không phân phối trên union** (trừ khi bạn tự viết).
- Mã lỗi hay gặp: TS7053, TS2536, TS2344, TS2345, TS2322, TS2540, TS4104, TS2493, TS1169, TS2741, TS2353, TS2339, TS2537.

## Lý thuyết chi tiết

**1. `interface` và `type` khác nhau ở việc gán cho `Record<string, T>`**

```ts
interface PricesI { apple: number; pear: number }
type PricesT = { apple: number; pear: number };

const r1: Record<string, number> = { apple: 1 } as PricesT;   // OK
const r2: Record<string, number> = {} as PricesI;
// TS2322: Type 'PricesI' is not assignable to type 'Record<string, number>'.
//   Index signature for type 'string' is missing in type 'PricesI'.
```

Lý do: `type` alias của object literal type được coi là "đóng", compiler biết mọi thuộc tính nên cho phép coi nó như có index signature. `interface` có thể bị **khai báo gộp (declaration merging)** thêm thuộc tính ở nơi khác, nên compiler không dám hứa. Hệ quả thực tế: hàm viết `(o: Record<string, unknown>)` nhận `type` nhưng từ chối `interface` (TS2345 cùng ghi chú "Index signature for type 'string' is missing"). Cách sửa: ràng buộc `T extends object` thay vì `Record<string, unknown>`.

Cùng nguyên nhân khiến `Object.entries` mất kiểu với interface:

```ts
const et = Object.entries({ apple: 1, pear: 2 } as PricesT);   // [string, number][]
const ei = Object.entries({ apple: 1, pear: 2 } as PricesI);   // [string, any][]   <- rơi về overload cũ trả any
```

Với interface bạn nhận `any` mà không có cảnh báo. Nếu repo bật `no-explicit-any`, kết quả này lén đưa `any` vào code.

**2. Duyệt khoá có kiểu: hai hàm nhỏ đáng có**

```ts
function typedEntries<T extends object>(o: T): { [K in keyof T]: [K, T[K]] }[keyof T][] {
  return Object.entries(o) as never;        // ranh giới ép kiểu nằm một chỗ
}
// typedEntries({ apple: 1, pear: 2 }) là (["apple", number] | ["pear", number])[]

function mapValues<T extends object, R>(o: T, f: (v: T[keyof T]) => R): { [K in keyof T]: R } {
  const out = {} as { [K in keyof T]: R };  // bắt buộc as: xem mục 5
  for (const k in o) out[k] = f(o[k]);
  return out;
}
// mapValues(pricesInterface, (v) => String(v)) là { apple: string; pear: string }
```

`{ [K in keyof T]: [K, T[K]] }[keyof T]` là mẫu "mapped type rồi index bằng `keyof`" (file 04, `KeysOfType`) dùng để biến object thành **union các cặp** thay vì một cặp chung chung `[keyof T, T[keyof T]]` (loại sau mất liên hệ khoá-giá trị).

**3. `Record<Union, V>` và `Record<string, V>` cho hành vi ngược nhau**

```ts
type Status = "draft" | "paid";
const labels: Record<Status, string> = { draft: "D" };
// TS2741: Property 'paid' is missing in type '{ draft: string; }' but required in type 'Record<Status, string>'.
const m: Record<Status, string> = { draft: "D", paid: "P", extra: "x" };
// TS2353: Object literal may only specify known properties, and 'extra' does not exist in type 'Record<Status, string>'.

const partial: Partial<Record<Status, string>> = { draft: "D" };
// partial["paid"] là string | undefined

const cache: Record<string, number> = {};
// cache["x"] là number | undefined   (do noUncheckedIndexedAccess của repo)
```

- `Record<Union, V>`: **bắt buộc đủ khoá** và **cấm khoá thừa** khi viết object literal. Đây là cách ép "bảng tra phải phủ hết union": thêm `"shipped"` vào `Status` thì mọi `Record<Status, ...>` báo TS2741 ngay.
- `Record<string, V>`: khoá mở, mọi đọc đều có thể `undefined`. Dùng cho cache/từ điển, không dùng cho tập khoá đã biết.
- Khi chỉ một số khoá có mặt: `Partial<Record<Union, V>>`.

**4. `Omit` và `Pick` với modifier, index signature, khoá sai**

```ts
type Q = { readonly id: string; name?: string; age: number };
// Omit<Q, "age"> giống hệt { readonly id: string; name?: string }   (modifier được giữ, vì Pick là homomorphic)
// Pick<Q, "id" | "name"> giống hệt { readonly id: string; name?: string }

type Bad = Pick<Q, "nme">;
// TS2344: Type '"nme"' does not satisfy the constraint 'keyof Q'.
type Quiet = Omit<Q, "nme">;      // KHÔNG lỗi: Omit nhận bất kỳ khoá nào (file 04)
```

Với kiểu có index signature, `Omit` **không loại được khoá cụ thể**:

```ts
type WithIdx = { id: string; [k: string]: string };
// Omit<WithIdx, "id"> là { [x: string]: string; [x: number]: string }   -> id biến mất nhưng chữ ký chỉ mục vẫn còn
// Pick<WithIdx, "id">  là { id: string }
```

Lý do: `keyof WithIdx` là `string | number`, và `Exclude<string | number, "id">` vẫn là `string | number`, nên `Omit` giữ lại chữ ký chỉ mục. Nghĩa là truy cập `x.id` sau `Omit` vẫn "hợp lệ" nhưng có kiểu `string` chung chung. Đừng thiết kế entity có index signature nếu định `Omit` nó.

**5. Mapped type trong hàm generic: gán `{}` bị từ chối**

```ts
function fill<T extends string>(keys: T[]): { [K in T]: number } {
  const out: { [K in T]: number } = {};
  // TS2322: Type '{}' is not assignable to type '{ [K in T]: number; }'.
  for (const k of keys) out[k] = 0;
  return out;
}
```

Lý do: `T` chưa biết, nên compiler không chứng minh `{}` có đủ mọi khoá của `T`. Đây là giới hạn thật của hệ kiểu, không phải bạn viết sai. Cách xử lý chuẩn: `const out = {} as { [K in T]: number };` và để thân hàm tự chịu trách nhiệm (vòng `for` điền đủ khoá). Quy tắc: `as` nằm bên trong, chữ ký bên ngoài đúng.

**6. Các lỗi khi truy cập kiểu**

```ts
function g<T, K>(o: T, k: K) { return o[k]; }
// TS2536: Type 'K' cannot be used to index type 'T'.      -> thiếu ràng buộc K extends keyof T

type Cfg = { db?: { host: string } };
type H = Cfg["db"]["host"];
// TS2339: Property 'host' does not exist on type '{ host: string; } | undefined'.   -> dùng NonNullable<Cfg["db"]>["host"]

type People = { name: string; age: number };
let lkey = "name";
type Nm2 = People[typeof lkey];
// TS2537: Type 'People' has no matching index signature for type 'string'.   -> let widen thành string; dùng const hoặc literal

const t: [string, number] = ["a", 1];
t[2];
// TS2493: Tuple type '[string, number]' of length '2' has no element at index '2'.
```

**7. Mapped type KHÔNG thể đặt trong `interface`**

```ts
interface Bad { [K in "a" | "b"]: number }
// TS1169: A computed property name in an interface must refer to an expression whose type is a literal type or a 'unique symbol' type.
// (kèm vài lỗi phụ vô nghĩa như TS2304 "Cannot find name 'K'" vì cú pháp bị đọc thành computed property)
```

Cú pháp `[K in ...]` chỉ hợp lệ trong `type`. Khi thấy chùm lỗi lạ ngay tại dòng `[K in ...]` trong `interface`, nguyên nhân gần như chắc chắn là dùng nhầm `interface`.

**8. Khoá không phải chuỗi: number và symbol**

```ts
type N = { 1: "a"; two: "b" };      // keyof N là 1 | "two"   (khoá số là literal số, không phải "1")
// keyof any là string | number | symbol
const sym = Symbol("s");
type S = { [sym]: 1; a: 2 };        // keyof S là typeof sym | "a"
```

Hệ quả với `Getters<T>`: viết `Capitalize<K & string>` **âm thầm bỏ** khoá số và symbol (không báo lỗi):

```ts
type G1<T> = { [K in keyof T as `get${Capitalize<K & string>}`]: () => T[K] };
// keyof G1<{ name: string; 1: boolean }> là "getName"          <- khoá 1 biến mất
type G2<T> = { [K in keyof T as `get${Capitalize<`${K & (string | number)}`>}`]: () => T[K] };
// keyof G2<{ name: string; 1: boolean }> là "getName" | "get1"
```

Chọn theo ý định: bỏ qua khoá không phải chuỗi (G1) hay đưa số về chuỗi (G2). Điều quan trọng là **biết** mình đang chọn.

**9. `as` làm hai khoá trùng nhau: giá trị bị gộp thành union**

```ts
type Col = { [K in "a" | "A" as Lowercase<K>]: K };
// Col là { a: "a" | "A" }
```

Hai khoá nguồn trỏ về cùng một khoá đích thì kiểu giá trị là **union** của cả hai, không lỗi. Với DB, đổi `userId` và `user_id` cùng về một khoá sẽ che giấu xung đột; cần chắc khoá nguồn không trùng sau khi đổi tên.

**10. Hai kiểu `readonly` chỉ bảo vệ nông**

```ts
type Cart = { items: { sku: string; qty: number }[]; owner: { id: string } };
const cart: Readonly<Cart> = { items: [], owner: { id: "1" } };
cart.items.push({ sku: "a", qty: 1 });   // OK: Readonly chỉ khoá thuộc tính cấp 1
cart.owner.id = "x";                      // OK
cart.items = [];                          // TS2540: Cannot assign to 'items' because it is a read-only property.

const ro: readonly string[] = ["a"];
const mu: string[] = ro;                  // TS4104: The type 'readonly string[]' is 'readonly' and cannot be assigned to the mutable type 'string[]'.
ro.push("b");                             // TS2339: Property 'push' does not exist on type 'readonly string[]'.
```

Cùng bẫy với `as const`: mảng `as const` là `readonly [...]` nên truyền cho hàm nhận `string[]` bị TS4104. Sửa **ở chữ ký hàm** (nhận `readonly string[]`) thay vì ép kiểu ở nơi gọi: lý do là hàm không sửa mảng thì nên hứa điều đó, và mọi người gọi đều hưởng lợi. Nhắc lại: `Object.freeze` cũng chỉ nông và giữ literal (`Object.freeze({ a: 1 })` ra `Readonly<{ a: 1 }>`); xem notes Bài 1, file 07.

**11. `as const` chỉ nhận literal**

```ts
const dyn = ["a", "b"].map((s) => s) as const;
// TS1355: A 'const' assertion can only be applied to references to enum members, or string, number, boolean, array, or object literals.
const lv = "x" as string; const o = { lv } as const;   // { readonly lv: string }   (biến đã widen thì as const không cứu được)
```

## Tricks & tips thực tế

- **Sự kiện có nhiều tham số: dùng tuple có nhãn.** `interface Events { "order.paid": [orderId: string, amount: number] }` rồi `emit<K extends keyof Events>(name: K, ...args: Events[K])`. Lý do: tham số hàm là tuple nên đếm đúng số lượng và tên hiện trong hover; `emit("order.paid", "o1")` báo TS2554 "Expected 3 arguments, but got 2".
- **Registry của handler: cần một `as` có chủ ý.** Với `const registry: { [K in keyof Events]?: Handler<K>[] }`, viết `registry[name].push(fn)` trong hàm generic gây TS2345 kiểu "Argument of type '(...args: Events[K]) => void' is not assignable to parameter of type 'never'". Lý do: compiler thu hẹp phần tử mảng thành giao của mọi handler, mà các handler không tương thích nên ra `never`. Cách sửa gọn: `(registry[name] ??= []) as Handler<K>[]` (đã kiểm chứng), đặt trong đúng một hàm `on`.
- **Bảng luật validate cho DTO: `Rules<T>`.** `type Rules<T> = { [K in keyof T]-?: (v: T[K]) => string | null }`. Lý do: `-?` buộc phải viết luật cho cả khoá optional, và mỗi hàm luật nhận đúng kiểu giá trị (`age` là `number | undefined`, nên luật phải xử lý `undefined`). Thêm cột vào DTO thì object luật báo thiếu khoá ngay. Đây là tương đương kiểu của mảng `rules()` trong Laravel FormRequest, nhưng có kiểm tra đủ khoá lúc biên dịch.
- **Mô tả kiểu JSON trả về từ API: `Date` thành `string`.** Giá trị đi qua `JSON.stringify` mất `Date` (thành chuỗi ISO) và mất method. Một mapped type đệ quy mô tả đúng phần này (đã kiểm chứng):

  ```ts
  type Jsonify<T> = T extends Date ? string
    : T extends (...a: never[]) => unknown ? never
    : T extends readonly (infer U)[] ? Jsonify<U>[]
    : T extends object ? { [K in keyof T as T[K] extends (...a: never[]) => unknown ? never : K]: Jsonify<T[K]> }
    : T;
  // Jsonify<{ id: string; issuedAt: Date; lines: { sku: string; at: Date }[]; calc(): number }>
  //   là { id: string; issuedAt: string; lines: { sku: string; at: string }[] }
  ```

  Lý do dùng: kiểu `Invoice` ở server (có `Date`) khác kiểu mà client thật sự nhận. Nếu client dùng chung kiểu server, bạn sẽ gọi `.getTime()` trên một chuỗi và lỗi chỉ lộ ra lúc chạy. Đây là bản rút gọn: các kiểu như `Map`, `bigint`, `undefined` trong mảng cần thêm nhánh; thư viện thật (tRPC, type-fest `Jsonify`) xử lý đủ.
- **Khi `Object.keys` trả `string[]`, đừng ép tràn lan `as (keyof T)[]`.** Lý do: một object có thêm khoá lạ (structural typing, Bài 1) sẽ làm `obj[k]` thành `undefined` mà kiểu bảo là có. Ép trong `typedKeys` có tên và dùng cho object **bạn tự tạo** (không phải dữ liệu từ ngoài).
- **`for (const k in o)` cho `k: Extract<keyof T, string>` trong hàm generic nhưng chỉ `string` với kiểu cụ thể**; hover để biết bạn đang ở trường hợp nào trước khi quyết định có cần ép kiểu.
- **Dẫn xuất DTO bằng `Pick` khi muốn chặt, `Omit` khi muốn gọn.** `Pick` bắt lỗi chính tả khoá (TS2344), `Omit` thì không. Với DTO công khai (response), nên `Pick` danh sách trắng để **cột mới thêm vào entity không lọt ra API** (ví dụ `password_hash`). Lý do: `Omit` danh sách đen tự động lộ mọi cột mới. Ở Laravel đây giống `$hidden` (danh sách đen, dễ quên) so với `JsonResource` chọn từng trường (danh sách trắng).
- **Debug mapped type ra kết quả lạ: thay vế phải bằng kiểu đơn giản nhất** (`{ [K in keyof T]: 0 }`) để tách lỗi do tập khoá hay do vế giá trị; rồi dùng thủ thuật in kiểu: `const probe: Show<X> = 1 as 1;` sẽ có thông báo `Type '1' is not assignable to type '...'` in kiểu đầy đủ (với `Show<T> = T extends infer O ? { [K in keyof O]: O[K] } : never`). Lý do: hover đôi khi chỉ hiện tên alias, còn thông báo lỗi in cấu trúc.
- **`satisfies Record<Union, V>` thay cho chú thích `: Record<Union, V>`** khi muốn vừa ép đủ khoá vừa giữ literal: `const ROUTES = { home: "/", users: "/users" } as const satisfies Record<string, `/${string}`>` cho `(typeof ROUTES)[keyof typeof ROUTES]` là `"/" | "/users"` (`satisfies` cần TS 4.9+).

## Tình huống mở để tự suy nghĩ

1. `Object.entries(order)` trả `[string, any][]` nếu `Order` là `interface` nhưng `[string, number][]` nếu là `type`. Bạn sẽ ghi quy ước nào cho team: luôn dùng `type` cho object dữ liệu, hay luôn ép qua `typedEntries`? Mỗi lựa chọn mất gì?
2. Một hàm `mapValues` trả `{ [K in keyof T]: R }`. Nếu `T` là mảng thì kết quả là gì (đoán trước, rồi thử bằng `Equal`)? Khi nào hành vi này gây bất ngờ?
3. `Partial<Record<Status, string>>` và `Record<Status, string | undefined>` khác nhau ở đâu khi gán object literal và khi đọc? Khi nào chọn cái nào cho cột "ghi chú" của bảng trạng thái?
4. `Omit<Union, K>` mất khoá, còn `Pick<Union, K>` thì sao nếu `K` là khoá chung? Thử với hai nhánh có khoá chung `kind`.
5. Entity của bạn thêm cột `internalNote`. Với DTO response dẫn xuất bằng `Omit` thì điều gì xảy ra, và bằng `Pick`? Bạn muốn compiler báo gì khi cột mới xuất hiện?

## Liên hệ bài tập

Ba hàm lab đều đụng ít nhất một bẫy ở trên: `MyPick` (mục 4: chặn khoá sai bằng ràng buộc), `MyReadonly` (mục 10: chỉ nông; hãy tự kiểm xem bài yêu cầu nông hay sâu), `Getters<T>` (mục 8 và 9: khoá số/symbol và va chạm tên). Viết `Equal` cho một kiểu có khoá số và một khoá `readonly`, và quyết định cho từng trường hợp xem kết quả có đúng với ý định của bạn.

## Đọc thêm

- [Mapped Types](https://www.typescriptlang.org/docs/handbook/2/mapped-types.html)
- [Indexed Access Types](https://www.typescriptlang.org/docs/handbook/2/indexed-access-types.html)
- [Differences Between Type Aliases and Interfaces](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#differences-between-type-aliases-and-interfaces)
- [Object.entries (MDN)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/entries)

## Ghi chú của bạn
