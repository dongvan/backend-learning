# 4. Dựng và mở rộng utility types: những helper hay dùng ở backend

Utility types có sẵn (`Partial`, `Pick`, `Omit`, `Readonly`, `Record`, …) đều chỉ là mapped/conditional type; hiểu cơ chế thì tự viết được thứ còn thiếu.

```ts
type Simplify<T> = { [K in keyof T]: T[K] } & {};

type SetOptional<T, K extends keyof T> = Simplify<Omit<T, K> & Partial<Pick<T, K>>>;

type CreateCustomer = SetOptional<Customer, "id">;   // id thành optional, phần còn lại giữ nguyên
```

## Ý chính

- Utility có sẵn không có sự "ma thuật": chúng là mapped type (file 03) cộng indexed access (file 02).
- Thứ hay thiếu trong backend: đổi chỉ **một số** khoá sang optional/required, `DeepPartial`/`DeepReadonly`, lấy khoá theo kiểu giá trị, `Omit` cho union.
- `Omit`/`Pick` được định nghĩa qua `keyof`, nên **không phân phối** trên union.
- `Simplify` chỉ để hiển thị gọn; không đổi ngữ nghĩa kiểu.

## Lý thuyết chi tiết

**Quan hệ giữa các utility có sẵn (chỉ mô tả, không viết lại đề).**
- `Partial<T>`/`Required<T>`/`Readonly<T>`: mapped type homomorphic với modifier tương ứng.
- `Pick<T, K>`: mapped type chạy trên `K` (một tập con của `keyof T`) thay vì cả `keyof T`.
- `Omit<T, K>`: chọn các khoá còn lại rồi `Pick`; nó dùng `Exclude<keyof T, K>` và `K extends keyof any` nên **không báo lỗi khi `K` không tồn tại** trong `T` (khác `Pick`). Đây là cạm bẫy: gõ sai tên khoá trong `Omit` không bị bắt.
- `Record<K, V>`: `{ [P in K]: V }`.

Bạn có thể xem định nghĩa thật bằng cách "Go to definition" trên `Pick` trong editor (nằm trong các file `lib.*.d.ts` đi kèm TypeScript).

**Đổi một số khoá thành optional / required.**

```ts
interface Customer { id: string; name: string; email?: string; phone: string | null }

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type SetOptional<T, K extends keyof T> = Simplify<Omit<T, K> & Partial<Pick<T, K>>>;
type SetRequired<T, K extends keyof T> = Simplify<Omit<T, K> & Required<Pick<T, K>>>;

// SetOptional<Customer, "id">    -> { name: string; phone: string | null; id?: string; email?: string }
// SetRequired<Customer, "email"> -> { id: string; name: string; phone: string | null; email: string }
```

Không có `Simplify`, kết quả là giao kiểu `Omit<...> & Partial<...>`; nó *tương đương* khi gán giá trị nhưng khác kiểu về hình dạng (`Equal` cho `false`), và hiển thị khó đọc.

**Lấy các khoá có giá trị thuộc một kiểu.** Kỹ thuật "mapped type rồi index bằng `keyof`":

```ts
type KeysOfType<T, V> = { [K in keyof T]-?: T[K] extends V ? K : never }[keyof T];
// KeysOfType<{ a: string; b: number; c?: string }, string | undefined> là "a" | "c"
```

Giải thích từng bước: mapped type tạo ra object mà mỗi giá trị là *tên khoá* nếu khớp, ngược lại `never`; `[keyof T]` gom các giá trị lại thành union, `never` tự biến mất khỏi union. `-?` bảo đảm khoá optional không để lại `undefined` trong kết quả.

**`DeepPartial` và `DeepReadonly`.** Đệ quy trên mapped type:

```ts
type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

interface Cfg { db: { host: string; port: number }; tags: string[] }
const patch: DeepPartial<Cfg> = { db: { port: 1 } };    // OK: host không bắt buộc

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
// DeepReadonly: cfg.db.host = "x" lỗi, và mảng thành readonly array (không push được)
```

Điều kiện `infer U` (Bài 6) ở `DeepPartial` dành cho mảng; nếu không, mảng bị coi là `object` và duyệt như object (đã làm đúng nhờ homomorphic trên mảng, nhưng tách rõ dễ hiểu hơn). Với `DeepReadonly`, nhánh hàm ngăn hàm bị biến thành object rỗng.

**Giá trị và khoá dưới dạng union.**

```ts
type ValueOf<T> = T[keyof T];
// ValueOf<{ a: 1; b: "x" }> là 1 | "x"
```

**`Object.keys` trả về `string[]`, không phải `(keyof T)[]`.** Lý do: structural typing (Bài 1) cho phép object có **thêm** thuộc tính, nên compiler không dám hứa. Nếu bạn chắc object không có khoá thừa, tự bọc một hàm:

```ts
function typedKeys<T extends object>(obj: T): (keyof T)[] {
  return Object.keys(obj) as (keyof T)[];
}
```

**`Omit` trên union làm mất khoá.** Vì `keyof` của union là giao khoá (file 01):

```ts
type Sh = { kind: "c"; r: number } | { kind: "s"; w: number };
// Omit<Sh, "kind"> là {}      -> mất sạch cả r và w
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
// DistOmit<Sh, "kind"> là { r: number } | { w: number }
```

`T extends unknown ? ... : never` chính là kỹ thuật **conditional phân phối** (Bài 6, file 01). Tương tự `Partial` không đệ quy: `Partial<{ db: { host: string } }>` cho phép `db` vắng mặt, nhưng nếu có `db` thì `host` vẫn bắt buộc.

**So sánh với PHP/Laravel.** Đây là phần tương ứng với việc tách Form Request / DTO khỏi Model: `CreateCustomer` (bỏ `id`, thêm default) khác `Customer`. Ở Laravel bạn tách bằng class và `$request->validated()`; ở TS dẫn xuất từ một entity để không lệch (nhưng validation runtime vẫn riêng, Bài 9).

**Yêu cầu ít nhất một trong các khoá (kiểu `RequireAtLeastOne`).** Rất hợp form liên hệ ("email hoặc phone"):

```ts
type RequireAtLeastOne<T, K extends keyof T = keyof T> =
  K extends keyof T ? Omit<T, K> & Required<Pick<T, K>> : never;

type Contact = { email?: string; phone?: string };
const c1: RequireAtLeastOne<Contact> = { email: "a" };   // OK
const c2: RequireAtLeastOne<Contact> = {};               // lỗi TS2322: '{}' không gán được cho union (Omit<..> & Required<Pick<..>>) | (...)
```

Cơ chế: `K extends keyof T ? ... : never` là conditional phân phối trên `K` (Bài 6), nên với mỗi khoá nó sinh một biến thể "khoá này bắt buộc", rồi gộp bằng union. Kết quả là union, nên cần ít nhất một nhánh thoả. Đây không thay thế validate runtime, chỉ buộc code gọi truyền đủ.

**`StrictOmit` bắt lỗi chính tả khoá:**

```ts
type StrictOmit<T, K extends keyof T> = Omit<T, K>;
type SO = StrictOmit<{ a: 1 }, "b">;
// TS2344: Type '"b"' does not satisfy the constraint '"a"'.
```

## Tricks & tips thực tế

- **Dẫn xuất DTO từ entity một lần, đặt tên rõ**: `type CreateOrderInput = SetOptional<Omit<Order, "createdAt">, "status">`. Lý do: đổi entity thì DTO theo, compiler chỉ ra mọi chỗ cần sửa; nhưng đừng chồng quá 2–3 lớp vì thông báo lỗi sẽ khó đọc.
- **Luôn bọc kết quả `A & B` bằng `Simplify` khi xuất ra API công khai.** Lý do: hover/lỗi hiển thị `{ id?: string; name: string; ... }` thay vì `Omit<..> & Partial<Pick<..>>`.
- **Cẩn thận `Omit` với khoá sai.** `Omit<Customer, "emial">` vẫn hợp lệ (gõ nhầm không bị bắt). Nếu muốn chặt, tự viết `StrictOmit<T, K extends keyof T> = Omit<T, K>`. Lý do: bắt lỗi chính tả ngay khi viết.
- **`Partial` cho PATCH, không cho CREATE.** Dùng `Partial<T>` cho body PATCH nhưng `DeepPartial` chỉ khi thực sự merge sâu. Lý do: `Partial` nông làm bạn nghĩ có thể gửi `{ db: {} }` mà kiểu cho phép thiếu `host` bên trong *sai*; `DeepPartial` khớp ý định "merge sâu".
- **Đừng dùng `DeepPartial`/`DeepReadonly` trên kiểu có `Date`, `Map`, class.** Chúng bị coi là `object` và bị duyệt qua từng thuộc tính (method của `Date` thành optional…). Lý do: nhánh `T extends object` không phân biệt. Thêm nhánh riêng cho `Date | Map | Set` nếu cần.
- **Khi kiểu quá phức tạp, test từng helper riêng** với `Equal` + `@ts-expect-error` (file 03). Lý do: không có runtime để chạy thử; test kiểu là cách duy nhất.
- **Đừng phát minh lại những thứ đã có**: thư viện `type-fest` có sẵn `SetOptional`, `Simplify`, `PartialDeep`, … nhưng với repo học tập này chưa thêm dependency; tự viết để hiểu, rồi mới nên cân nhắc dùng thư viện ở dự án thật.

## Liên hệ bài tập

Lab yêu cầu tự viết `MyPick`, `MyReadonly`, `Getters<T>`. Sau khi làm, so sánh với `Pick`/`Readonly` có sẵn: ba thuộc tính cần giống nhau là (a) khoá không tồn tại bị chặn, (b) giữ `readonly`/`?`, (c) hoạt động đúng trên mảng và tuple (hoặc bạn biết chỗ nó khác). Dùng `Equal` để chứng minh, không chỉ nhìn bằng mắt. Các ví dụ trong notes này (`SetOptional`, `DeepPartial`, …) cố ý không phải đáp án: đừng chép.

## Đọc thêm

- [Utility Types](https://www.typescriptlang.org/docs/handbook/utility-types.html)
- [Mapped Types](https://www.typescriptlang.org/docs/handbook/2/mapped-types.html)

## Ghi chú của bạn

