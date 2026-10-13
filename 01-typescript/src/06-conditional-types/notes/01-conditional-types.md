# 1. Conditional types và tính phân phối

`T extends U ? X : Y` là phép `if` ở cấp kiểu: chọn kiểu `X` nếu `T` gán được cho `U`, ngược lại `Y`.

```ts
type IsString<T> = T extends string ? true : false;
// IsString<"a"> là true, IsString<number> là false

type NonNull<T> = T extends null | undefined ? never : T;
// NonNull<string | null | undefined> là string
```

## Ý chính

- `extends` ở đây là phép kiểm tra **"gán được cho"** (assignable), không phải "bằng nhau".
- Khi `T` là tham số kiểu "trần" (naked) và được truyền vào một union, conditional **phân phối**: chạy riêng cho từng thành viên rồi gộp kết quả bằng union.
- Muốn **tắt** phân phối, bọc cả hai vế trong tuple: `[T] extends [U]`.
- `never` là union rỗng nên conditional phân phối trên `never` ra `never`. Đây là nguồn bug kinh điển.
- `Exclude`, `Extract`, `NonNullable` là các conditional phân phối có sẵn.

## Lý thuyết chi tiết

**Quan hệ `extends` là gán được.**

```ts
type Ext = { a: 1; b: 2 } extends { a: 1 } ? "sub" : "no";   // "sub"
```

Object có nhiều thuộc tính hơn vẫn "extends" object có ít hơn (structural typing, Bài 1). Nếu cần kiểm tra bằng nhau chính xác cần mẹo `Equal` như trong notes Bài 5 file 03.

**Phân phối.** Điều kiện kích hoạt: kiểu được kiểm tra ở vế trái `extends` là **một tham số kiểu trần** (`T`, không phải `T[]`, `[T]`, `Promise<T>`).

```ts
type ToArray<T> = T extends unknown ? T[] : never;
// ToArray<string | number> là string[] | number[]        (phân phối)

type ToArrayAll<T> = [T] extends [unknown] ? T[] : never;
// ToArrayAll<string | number> là (string | number)[]     (tắt phân phối)
```

Nên nhớ `T extends unknown ? ... : never` là thủ thuật chuẩn để *ép* phân phối cho một kiểu bất kỳ (mọi `T` đều extends `unknown`). Cũng vì thế `Exclude<Role, "admin">` loại được một thành viên: nó chạy điều kiện riêng cho `"admin"`, `"editor"`, `"viewer"` rồi gộp.

```ts
type Role = "admin" | "editor" | "viewer";
// Exclude<Role, "admin">          là "editor" | "viewer"
// Extract<Role | number, string>  là Role
```

`boolean` cũng bị phân phối vì thực chất là `true | false`: `T extends true ? "yes" : "no"` với `boolean` cho `"yes" | "no"`.

**Khi phân phối KHÔNG xảy ra.** Nếu vế trái không phải tham số trần:

```ts
type Wrapped<T> = T[] extends unknown[] ? true : false;
// Wrapped<string | number> là true  (một lần kiểm tra duy nhất trên (string|number)[])
```

**Vấn đề `never`.**

```ts
// IsString<never> là never           (phân phối trên union rỗng -> không có kết quả)
type IsStringS<T> = [T] extends [string] ? true : false;
// IsStringS<never> là true           (tắt phân phối: never gán được cho mọi kiểu)

type IsNever<T> = [T] extends [never] ? true : false;
// IsNever<never> là true, IsNever<string> là false
```

Quy tắc dùng: viết helper "IsX" thì bọc `[T]`; viết helper biến đổi từng thành viên của union (lọc, ánh xạ) thì để phân phối.

**`any` làm hỏng điều kiện.** Với `any`, conditional trả về **union của cả hai nhánh**. Phát hiện `any`:

```ts
type IsAny<T> = 0 extends 1 & T ? true : false;
// IsAny<any> là true, IsAny<unknown> là false
```

(`1 & any` là `any`, còn `1 & unknown` là `1`, và `0` không gán được cho `1`.)

**Nhánh lồng nhau.** Như `if/else if`:

```ts
type Kind<T> = T extends string ? "text"
  : T extends number ? "numeric"
  : T extends boolean ? "flag"
  : "other";
// Kind<42> là "numeric", Kind<Date> là "other"
```

**Conditional trong chữ ký hàm: kiểu chưa được giải quyết.** Bên trong thân hàm generic, kiểu trả về dạng `T extends string ? A : B` **không được narrow** theo `typeof x === "string"`; trả giá trị là lỗi (đã kiểm chứng):

```ts
function wrap<T extends string | number>(x: T): T extends string ? string[] : number[] {
  return typeof x === "string" ? [x] : [x];   // lỗi: không gán được cho kiểu conditional chưa resolve
}
```

Cách thông thường: dùng **overload** (Bài 7) cho chữ ký ngoài, hoặc một `as` có chủ ý bên trong. Overload tách chữ ký công khai (chính xác) khỏi thân (rộng).

**So sánh với PHP/Laravel.** PHP 8 có union type và `static`/template qua docblock PHPStan (`@template T`, `@return T is string ? ... : ...` kiểu conditional trong PHPStan/Psalm). Trong ngôn ngữ PHP không có. TS là ngôn ngữ chính thức hỗ trợ phép này.

**Bảng ba hành vi đặc biệt của `T extends U ? X : Y`** (đã kiểm chứng):

| `T` | `T extends string ? true : false` | Vì sao |
|---|---|---|
| `never` | `never` | union rỗng, không có thành viên nào để chạy |
| `boolean` | `false` | `true` và `false` đều không extends `string` |
| `any` | `boolean` | `any` cho cả hai nhánh: `true \| false` |
| `string \| number` | `boolean` | phân phối: `true \| false` |
| `unknown` | `false` | `unknown` không gán được cho `string` |

Với `T extends true ? "y" : "n"`, `boolean` cho `"y" | "n"` vì `boolean` là `true | false` bị phân phối.

**Trong nhánh true, `T` được thu hẹp.** `T extends string ? Uppercase<T> : never` hợp lệ vì trong nhánh true `T` được coi là `T & string`; tương tự `T extends { id: unknown } ? T["id"] : never`. Không cần `infer` chỉ để lấy một thuộc tính. Nhánh false thì không thu hẹp ngược.

**Điều kiện `extends` là gán được: `readonly` không đổi kết quả, optional thì có.** `{ readonly a: 1 } extends { a: 1 }` là true, `{ a?: 1 } extends { a: 1 }` là false, `readonly string[] extends string[]` là false (chiều ngược lại true). `{}` nghĩa là "không phải null/undefined": `string extends {}` là true, `null extends {}` là false. Kiểm tra khoá optional: `{} extends Pick<T, K> ? true : false` (true khi `K` optional). Chi tiết và ví dụ ở file 05.

## Tricks & tips thực tế

- **Phân biệt "biến đổi từng thành viên" và "kiểm tra cả union".** Lý do: cùng một chữ `extends` nhưng kết quả khác hẳn. Nếu thấy kết quả là union mà bạn tưởng là một giá trị, hoặc ngược lại, suspect đầu tiên là phân phối.
- **Với helper kiểm tra, luôn thử `never`, `any`, `unknown`, union và `boolean`** trước khi tin nó đúng. Lý do: năm giá trị đó phá nhiều conditional "nhìn có vẻ đúng". Viết sẵn mỗi giá trị một dòng `Equal`.
- **Đừng dùng conditional để rẽ nhánh hành vi runtime của hàm.** Kiểu bị xoá khi chạy; cùng một thân hàm phải xử lý cả hai nhánh. Dùng overload hoặc hai hàm riêng. Lý do: bạn sẽ phải `as` trong thân và mất toàn bộ an toàn.
- **Ưu tiên union tagged (Bài 2) hơn conditional cho domain model.** Conditional hợp với thư viện/tiện ích kiểu; nghiệp vụ (Order, Payment) rõ ràng hơn với discriminated union. Lý do: dễ đọc, narrowing hoạt động đầy đủ, thông báo lỗi tốt hơn.
- **Khi phân phối ra kết quả lạ, thử bọc/tháo `[T]`** để xem sự khác biệt. Lý do: cách nhanh nhất để biết có phải do phân phối.
- **Cạm bẫy: `T extends X ? ... : ...` trong kiểu trả về không "đóng" kiểu `T` chưa biết.** Khi `T` còn là tham số kiểu chưa gán, compiler trì hoãn (defer) conditional; vì vậy bạn thấy thông báo dài khó hiểu có chứa chính conditional đó. Nghĩa là đừng cố tìm lỗi trong thân hàm; cung cấp kiểu cụ thể bằng cách gọi thử (`wrap("a")`) để xem kiểu ra.
- **Ở hàm tiện ích công khai, đặt tên rõ**: `IsNever`, `IsAny` đặt trong một file `type-utils.ts` có test `Equal`. Lý do: kiểu helper là code, cần test và cần tên.

## Liên hệ bài tập

`UnwrapPromise` dựa trên conditional type kết hợp `infer` (file 02). Câu hỏi để tự đặt: kiểu của bạn xử lý thế nào với `Promise<Promise<X>>`, với kiểu không phải Promise, với union `Promise<A> | B`, và với `never`? Hãy viết sẵn các dòng `Equal` cho từng trường hợp trước khi viết kiểu. Đối chiếu với `Awaited<T>` có sẵn để thấy khác biệt.

## Đọc thêm

- [Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html)
- [Distributive conditional types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types)

## Ghi chú của bạn

