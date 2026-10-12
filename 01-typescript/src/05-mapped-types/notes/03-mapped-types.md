# 3. Mapped types: biến đổi từng thuộc tính của một kiểu

Mapped type duyệt qua một tập khoá và tạo kiểu object mới, giống `array_map` nhưng cho các thuộc tính của kiểu.

```ts
type Nullable<T> = { [K in keyof T]: T[K] | null };

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

type OnlyStrings<T> = { [K in keyof T as T[K] extends string ? K : never]: T[K] };
```

## Ý chính

- Cú pháp: `{ [K in <tập khoá>]: <kiểu giá trị> }`. `K` lần lượt là từng khoá; vế phải được tính cho mỗi `K`.
- **Homomorphic** (duyệt `keyof T` của một kiểu `T`) thì **giữ nguyên `readonly` và `?`** của thuộc tính gốc.
- Modifier: thêm/bớt bằng `+readonly`/`-readonly` và `+?`/`-?` (`+` có thể bỏ).
- **Key remapping** `as` (TS 4.1+): đổi tên khoá, hoặc **loại khoá** bằng cách trả `never`.
- Mapped type không dùng được trong `interface`; viết bằng `type`.

## Lý thuyết chi tiết

**Hai kiểu tập khoá.**

```ts
// 1. Duyệt khoá của một kiểu đã có
type Same<T> = { [K in keyof T]: T[K] };

// 2. Duyệt một union tuỳ ý (không phụ thuộc kiểu nào)
type Flags = { [K in "read" | "write" | "admin"]: boolean };
// { read: boolean; write: boolean; admin: boolean }
```

Dạng 2 rất tiện làm "bảng tra phải đủ khoá": `satisfies { [S in Status]: string }` ép object có đủ khoá của union `Status` (xem Bài 2, exhaustive).

**Homomorphic giữ modifier, và còn hơn thế.** Khi vế phải của `in` là `keyof T` (hoặc một tham số kiểu `K extends keyof T`, đây chính là cách `Pick` được viết), compiler biết khoá đến từ `T` và sao chép `readonly`/`?` từ `T`:

```ts
interface Product { readonly id: string; name: string; price?: number; tags: string[] }

// type Same<Product> giống hệt Product (kể cả readonly id và price?)
```

Trái lại, `{ [K in keyof Product & string]: Product[K] }` (có giao với `string`) **mất** modifier: `id` không còn `readonly`, `price` thành `price: number | undefined` bắt buộc. Mapped type trên union literal viết tay cũng vậy. Đã kiểm chứng. Hệ quả: đừng giao `& string` ở vế phải `in` nếu muốn giữ modifier; thay vào đó lọc ở `as` (xem dưới).

**Homomorphic còn xử lý đặc biệt mảng, tuple và union.**

```ts
type Stringify<T> = { [K in keyof T]: string };
// Stringify<[number, boolean]> là [string, string]   (tuple giữ cấu trúc)
// Stringify<number[]> là string[]                    (mảng vẫn là mảng, không thành object)

// Nullable<{ a: 1 } | { b: 2 }> là { a: 1 | null } | { b: 2 | null }
// (phân phối lên từng thành viên union khi T là tham số kiểu "trần")
```

**Modifier.**

```ts
type Complete<T> = { [K in keyof T]-?: T[K] };       // bỏ ?, và bỏ cả undefined khỏi giá trị
type Loose<T> = { [K in keyof T]+?: T[K] };          // thêm ?  (giống Partial)
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
```

`-?` loại `undefined` thêm bởi `?`; với `{ a?: string | undefined }`, `Required` cho `{ a: string }`.

**Key remapping `as` (TS 4.1+).** Mệnh đề `as` tính *tên mới* của khoá. Quy tắc:
- Trả về một chuỗi/literal: đổi tên.
- Trả về `never`: **bỏ khoá đó**, tức lọc.
- Trả về union: một khoá gốc sinh nhiều khoá.
- Vẫn homomorphic: modifier được giữ (`readonly x_a`, `x_b?`).

```ts
type Renamed<T> = { [K in keyof T as `x_${string & K}`]: T[K] };
// Renamed<{ readonly a: 1; b?: 2 }> là { readonly x_a: 1; x_b?: 2 }

type OmitByName<T, N extends keyof T> = { [K in keyof T as Exclude<K, N>]: T[K] };

type OnlyStrings<T> = { [K in keyof T as T[K] extends string ? K : never]: T[K] };
// OnlyStrings<{ a: string; b: number; c: string }> là { a: string; c: string }
```

**`as` còn biến union tagged thành bảng tra theo tag.** Ở đây `K` không phải khoá mà là từng *thành viên* của union:

```ts
type Ev = { type: "created"; id: string } | { type: "deleted"; at: number };
type Handlers = { [E in Ev as E["type"]]: (e: E) => void };
// { created: (e: { type: "created"; id: string }) => void; deleted: (e: ...) => void }
const handlers: Handlers = { created: (e) => void e.id, deleted: (e) => void e.at };
```

Mẫu này tạo bảng handler cho webhook/event: thêm một thành viên vào `Ev` thì `handlers` bị báo thiếu khoá.

**Giới hạn: khoá phải là `string | number | symbol`.** Khi dùng `${K}` trong template literal, `K` (đến từ `keyof T`) có thể là `symbol` và compiler từ chối với lỗi "Type 'symbol' is not assignable to type 'string | number | bigint | boolean | null | undefined'". Giải pháp: `${K & string}`, hoặc `K extends string ? ... : K` trong `as`.

**So sánh với PHP/Laravel.** Không có tương đương ngôn ngữ. Gần nhất về ý tưởng: `$fillable`/`$casts` của Eloquent ánh xạ cột sang kiểu, hoặc `array_map` + `array_filter` trên `$model->getAttributes()`. Khác biệt cốt lõi: PHP làm ở runtime trên dữ liệu; mapped type làm ở compile time trên **kiểu** và biến mất khi chạy.

## Tricks & tips thực tế

- **Bắt đầu từ `{ [K in keyof T]: T[K] }` rồi sửa từng bước.** Đây là "identity" an toàn; thay từng phần nhỏ và hover để thấy kiểu. Lý do: viết một lần cả cấu trúc phức tạp thì không biết lỗi ở đâu.
- **Giữ modifier bằng cách giữ `keyof T` ở vế phải; lọc/đổi tên ở `as`.** Lý do: nếu bạn làm `in Exclude<keyof T, "x">` thì mất modifier (khoá không còn "đến từ T" trực tiếp), còn `in keyof T as Exclude<K, "x">` giữ nguyên.
- **Đừng lạm dụng `as` bằng điều kiện phức tạp.** Một mapped type dài ba dòng điều kiện lồng nhau khó đọc, khó debug. Nếu cần, tách thành các helper nhỏ có tên (`KeysOfType`).
- **Biến object cấu hình thành kiểu "đã giải quyết"**: `type Resolved = Complete<typeof defaults>`. Lý do: kiểu sau khi merge với giá trị mặc định thì không còn optional.
- **Camel ↔ snake cho cột DB**: khi ORM trả hàng `created_at` nhưng domain dùng `createdAt`, kiểu hoá phép đổi key bằng `as` và template literal (Bài 6, file 03). Lý do: bắt lỗi quên đổi tên ngay lúc biên dịch.
- **Cạm bẫy: mapped type không phải là kiểm tra runtime.** `Complete<T>` không làm dữ liệu thật hết `undefined`. Dữ liệu từ ngoài vào vẫn phải được validate (Zod, Bài 9).
- **Debug kiểu in ra xấu (`Omit<...> & Partial<...>`)**: bọc bằng `type Simplify<T> = { [K in keyof T]: T[K] } & {}` để ép compiler "làm phẳng" khi hiển thị. Lý do: giao kiểu giữ nguyên dạng giao, thông báo lỗi và hover khó đọc. (Xem thêm file 04.)
- **Đo bằng `Equal`**: viết `const _: Equal<Kết_quả, Mong_đợi> = true;` cho từng ví dụ, và `// @ts-expect-error` cho trường hợp phải lỗi. Lý do: kiểu bạn nghĩ ra không phải kiểu compiler tính; chỉ có test mới chắc chắn. Hàm `Equal` viết thế này:

  ```ts
  type Equal<A, B> =
    (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
  ```

## Liên hệ bài tập

Cả ba hàm lab (`MyPick`, `MyReadonly`, `Getters<T>`) là mapped type. Câu hỏi để tự kiểm tra: (1) `MyPick` duyệt tập khoá nào, và ràng buộc nào ngăn nhập khoá không tồn tại? (2) `MyReadonly` cần modifier nào? (3) `Getters<T>` cần `as` để làm gì, và vì sao `K` có thể không phải chuỗi? Hãy thử bằng `Equal` với thuộc tính `readonly` và `?` trước khi cho là xong.

## Đọc thêm

- [Mapped Types](https://www.typescriptlang.org/docs/handbook/2/mapped-types.html)
- [Key Remapping via `as`](https://www.typescriptlang.org/docs/handbook/2/mapped-types.html#key-remapping-via-as)

## Ghi chú của bạn

