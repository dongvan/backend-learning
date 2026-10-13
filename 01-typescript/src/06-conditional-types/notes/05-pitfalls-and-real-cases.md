# 5. Cạm bẫy và tình huống thực tế với conditional types, infer và template literal

Những chỗ `extends` "nhìn có vẻ đúng" nhưng cho kết quả khác: phân phối trên `never`/`boolean`/`any`, `readonly` và optional trong phép gán được, conditional bị trì hoãn trong chữ ký hàm, `infer` mất overload, `${number}` rộng hơn bạn nghĩ. Mọi ví dụ và mã lỗi dưới đây đã được `tsc` 7.0.2 kiểm chứng với cấu hình của repo (dùng `Equal<A, B>` như ở Bài 5, file 03).

```ts
type IsStr<T> = T extends string ? true : false;
// IsStr<never>   là never
// IsStr<boolean> là false
// IsStr<any>     là boolean            (cả hai nhánh)
// IsStr<string | number> là boolean    (true | false)
```

## Ý chính

- Dòng `T extends U ? X : Y` có **ba hành vi đặc biệt** cần nhớ: phân phối trên union (kể cả `boolean`), ra `never` khi `T` là `never`, ra union cả hai nhánh khi `T` là `any`.
- `extends` là **gán được**, nên `readonly`, optional và thuộc tính thừa ảnh hưởng kết quả theo những cách khác với "bằng nhau".
- Conditional chứa tham số kiểu chưa biết bị **trì hoãn (deferred)**: bên trong hàm generic bạn không dùng được narrowing để trả giá trị.
- Template literal có giới hạn cứng (TS2590) và khớp `${number}` theo luật của `Number(...)`, không phải "số nguyên đẹp".
- Mã lỗi thường gặp: TS2322, TS2344, TS2345, TS2314, TS2456, TS1338, TS2589, TS2590.

## Lý thuyết chi tiết

**1. Phép gán được: `readonly`, optional, `{}`, `object`**

```ts
{ a?: 1 }        extends { a: 1 }   // 0 (không): optional không gán được cho bắt buộc
{ a: 1 }         extends { a?: 1 }  // 1 (có)
{ readonly a: 1 } extends { a: 1 }  // 1: readonly KHÔNG làm đổi khả năng gán
string[]         extends readonly string[]  // 1
readonly string[] extends string[]          // 0: chiều ngược lại không được (TS4104 khi gán thật)
string extends {}      // 1: {} nghĩa là "không phải null/undefined", không phải "object"
null   extends {}      // 0
string extends object  // 0: object chỉ nhận kiểu không nguyên thuỷ
(() => 1) extends object // 1: hàm là object
unknown extends string // 0, và IsStr<unknown> là false
```

Hệ quả thực tế: kiểm tra "khoá có bắt buộc không" bằng `{} extends Pick<T, K>` (đúng khi `K` optional) là mẹo chuẩn, nhưng "kiểm tra có `readonly` không" **không** làm được bằng `extends`: phải dùng `Equal` (trick hàm generic) như ở Bài 5. Cũng vì `{}` không phải "object", đừng dùng `T extends {}` để lọc object; dùng `T extends object` (và nhớ nó nhận cả hàm và mảng).

**2. Trong nhánh true, `T` được thu hẹp**

```ts
type Up<T> = T extends string ? Uppercase<T> : never;   // dùng T như string trong nhánh true: hợp lệ
// Up<"a" | 1> là "A"
type IdOf<T> = T extends { id: unknown } ? T["id"] : never;   // truy cập T["id"] không cần infer
// IdOf<{ id: 1 } | { x: 2 }> là 1
```

Lý do: trong nhánh true compiler thêm ràng buộc `T & string` (hoặc `T & { id: unknown }`). Nhờ vậy không phải `infer` cho mọi trường hợp (xem tip ở file 02). Nhánh false thì **không** thu hẹp ngược (không có `Exclude` ngầm).

**3. Conditional bị trì hoãn trong chữ ký hàm: lỗi nguyên văn**

```ts
function wrap<T extends string | number>(x: T): T extends string ? string[] : number[] {
  return typeof x === "string" ? [x] : [x];
  // TS2322: Type 'string[]' is not assignable to type 'T extends string ? string[] : number[]'.
  // TS2322: Type 'number[]' is not assignable to type 'T extends string ? string[] : number[]'.
}
```

Cách sửa dùng overload (đã kiểm chứng: `wrap2("a")` ra `string[]`):

```ts
function wrap2(x: string): string[];
function wrap2(x: number): number[];
function wrap2(x: string | number): string[] | number[] {
  return typeof x === "string" ? [x] : [x];
}
```

Lý do: overload tách **chữ ký công khai (chính xác)** khỏi **thân hàm (rộng)**; conditional bắt thân hàm chứng minh điều compiler không chứng minh được. Quy tắc: kiểu trả về dạng `T extends ...` chỉ nên dùng khi thân hàm không phải tự chọn nhánh (ví dụ hàm chỉ truyền thẳng, hoặc đã có `as` ở đúng một chỗ).

**4. Tham số kiểu không suy ra được qua conditional ở vị trí tham số**

```ts
declare function f<T>(x: T extends string ? 1 : 2): T;
const r = f("a");
// TS2345: Argument of type '"a"' is not assignable to parameter of type '2'.   (T bị suy ra là unknown)
```

Lý do: compiler không "chạy ngược" conditional để tìm `T`. Muốn tham số vừa nhận giá trị vừa tính kiểu theo nó, đặt `T` ở một tham số thường (`x: T`) rồi tính kiểu trả về từ `T`. Với trường hợp "đừng suy ra `T` từ vị trí này", dùng `NoInfer<T>` (TS 5.4+):

```ts
declare function pick<T extends string>(opts: T[], dflt: NoInfer<T>): T;
pick(["a", "b"], "a");   // T là "a" | "b"
pick(["a", "b"], "c");   // TS2345: Argument of type '"c"' is not assignable to parameter of type '"a" | "b"'.
```

**5. Hàm có tuỳ chọn quyết định kiểu trả về (mẫu `read(path, { raw: true })`)**

```ts
type ReadOpts = { raw?: boolean };
type ReadResult<O extends ReadOpts> = O extends { raw: true } ? Uint8Array : string;
declare function read<const O extends ReadOpts = {}>(path: string, opts?: O): ReadResult<O>;

// read("a")                    -> string
// read("a", { raw: true })     -> Uint8Array
// read("a", { raw: dynBool })  -> string     (boolean không extends true => nhánh false, KHÔNG phải union)
```

`const O` (TS 5.0+) giữ `true` literal thay vì `boolean`. Điểm đáng chú ý: khi giá trị chỉ biết lúc chạy (`boolean`), kết quả là `string` dù runtime có thể trả `Uint8Array`, tức **kiểu nói dối**. Với API công khai nên hoặc dùng overload (`raw: true` / `raw?: false`) và cấm `boolean`, hoặc trả union khi `boolean`. Đây là cùng nguyên nhân ở mục 3: kiểu không biết nhánh nào chạy.

**6. `infer` trên hàm: overload và `this`**

```ts
declare function ov(x: string): void;
declare function ov(x: number, y: number): void;
// Parameters<typeof ov> là [x: number, y: number]      -> chỉ overload CUỐI CÙNG

class A { m(this: A, x: number) { return x; } }
// Parameters<A["m"]> là [x: number]                    -> tham số `this` giả không nằm trong danh sách
```

Hệ quả: một wrapper `withRetry<F extends (...a: never[]) => unknown>(f: F)` dùng `Parameters<F>` sẽ **mất các overload** trước. Muốn giữ cả bộ, viết wrapper cho từng overload hoặc nhận `F` và trả `F` (không dựng lại chữ ký).

**7. `UnionToIntersection`: ví dụ chuẩn của contravariant `infer`**

```ts
type U2I<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never;
// U2I<{ a: 1 } | { b: 2 }> là { a: 1 } & { b: 2 }
// U2I<string | number>     là never                    (string & number)
```

Cơ chế: phân phối `U` thành một union các hàm `(k: A) => void | (k: B) => void`; `infer I` đặt ở vị trí tham số (contravariant) nên compiler suy ra **giao**. Dùng để gộp nhiều interface plugin thành một kiểu context. Đừng đi tiếp tới "union thành tuple": nó dựa vào thứ tự nội bộ của union, không được đảm bảo và dễ vỡ khi nâng cấp compiler.

**8. `Awaited` biết thenable, bản tự viết thường không**

```ts
type Unwrap<T> = T extends Promise<infer U> ? Unwrap<U> : T;
type Thenable = { then(cb: (v: number) => void): void };
// Awaited<Thenable>  là number
// Unwrap<Thenable>   là Thenable     (không phải Promise nên bị bỏ qua)
// Awaited<Promise<string> | number> là string | number
// ReturnType<typeof asyncFn> là Promise<X>, Awaited<ReturnType<typeof asyncFn>> mới là X
```

Lý do: `await` trong JS gỡ mọi object có `then`, không chỉ `Promise`. Thư viện ORM hay trả query builder là thenable (không phải Promise); `Awaited` xử lý đúng. Ở Laravel: `$query->get()` mới chạy truy vấn; query builder thenable của JS ngược lại "chạy khi bị `await`", nên kiểu cần mô tả điều này.

**9. Lọc theo tag, lấy payload, lấy tên method**

```ts
type Ev = { type: "created"; id: string } | { type: "deleted"; at: number };
type EventOf<T extends Ev["type"]> = Extract<Ev, { type: T }>;
// EventOf<"deleted"> là { type: "deleted"; at: number }

type MethodNames<T> = { [K in keyof T]-?: T[K] extends (...a: never[]) => unknown ? K : never }[keyof T];
class Repo { find() { return 1; } name = "r"; save(x: number) { return x; } }
// MethodNames<Repo> là "find" | "save"
```

`Extract<Ev, { type: T }>` hoạt động vì `Extract` là conditional phân phối: từng thành viên của `Ev` được thử với `{ type: T }`. `MethodNames` là mẫu "mapped rồi index" đã học ở Bài 5; mỗi giá trị là tên khoá hoặc `never`.

**10. Lỗi cú pháp và ràng buộc điển hình**

```ts
type Bad = infer U;
// TS1338: 'infer' declarations are only permitted in the 'extends' clause of a conditional type.

type R1 = ReturnType<string>;
// TS2344: Type 'string' does not satisfy the constraint '(...args: any) => any'.

type Gen = Array;
// TS2314: Generic type 'Array<T>' requires 1 type argument(s).

type Circ = Circ extends string ? 1 : 2;
// TS2456: Type alias 'Circ' circularly references itself.
```

TS2344 trên utility có sẵn thường có nghĩa bạn truyền *giá trị* thay vì `typeof giá_trị`, hoặc truyền kiểu không phải hàm. TS2314 xảy ra khi quên đối số kiểu cho kiểu generic.

**11. Template literal: `${number}` rộng hơn mong đợi**

Kiểm chứng với `const n: \`${number}\` = ...`:
- Chấp nhận: `"1e3"`, `" 1"` (có khoảng trắng đầu), `"0x10"`, `"-1.5"`.
- Từ chối: `""`, `"1_000"`, `"Infinity"`, `"NaN"`.

Lý do: `${number}` khớp chuỗi mà `Number(...)` biên dịch thành số hữu hạn theo cú pháp literal số của JS. Nên nếu bạn dùng nó để kiểm tra "id số" từ query string, nó vẫn cho `"1e3"` hay `" 1"` đi qua. Kiểm tra id nghiêm ngặt phải ở runtime (Zod `.regex`/`.int()`, Bài 9).

**12. Giới hạn kích thước union: TS2590**

```ts
type D = "0"|"1"|"2"|"3"|"4"|"5"|"6"|"7"|"8"|"9";
type D4 = `${D}${D}${D}${D}`;     // 10.000 literal: chạy
type D5 = `${D4}${D}`;            // 100.000 literal
const x: D5 = "00000";
// TS2590: Expression produces a union type that is too complex to represent.
```

Nếu bạn kiểm soát tập đầu vào, đừng liệt kê tích Descartes; dùng pattern (`${number}`, `${string}-${string}`) để biểu diễn lớp chuỗi mà không liệt kê.

**13. Quy tắc nhỏ của `infer` trên chuỗi**

```ts
type First<S> = S extends `${infer H}${string}` ? H : never;   // First<"abc"> là "a", First<""> là never
type Two<S> = S extends `${infer A}${infer B}` ? [A, B] : never;   // Two<"abc"> là ["a", "bc"]: A một ký tự, B phần còn lại
type SnakeToCamel<S extends string> = S extends `${infer H}_${infer T}`
  ? `${H}${Capitalize<SnakeToCamel<T>>}` : S;
// SnakeToCamel<"created_at_utc"> là "createdAtUtc"
// SnakeToCamel<"a__b"> là "aB"       (hai dấu _ liền nhau bị nuốt)
// SnakeToCamel<"_a">   là "A"        (dấu _ đầu bị mất)
// Split<string, "."> là [string]     (chuỗi không literal thì không tách được)
```

Không có delimiter giữa hai `infer` thì cái đầu **ăn đúng một ký tự**. Hàm đổi kiểu chuỗi trên kiểu (SnakeToCamel) **không cùng một thứ** với hàm đổi chuỗi thật lúc chạy: nếu hai hàm lệch nhau (ví dụ xử lý `__` khác nhau), kiểu sẽ nói dối. Viết test chứng minh cả hai đồng ý trên một bộ ví dụ.

Một phát hiện cần để ý: `Uppercase<string>` là kiểu mẫu chứ không phải `string`; gán `"abc"` cho `Uppercase<string>` báo lỗi (`Type 'string' is not assignable to type 'Uppercase<string>'`), còn `"ABC"` thì hợp lệ.

## Tricks & tips thực tế

- **Mẫu "có đọc chữ ký thì kiểm tra đủ năm giá trị": `never`, `any`, `unknown`, union, `boolean`.** Lý do: bảng ở đầu file cho thấy `IsStr` cho ra `never`, `boolean`, `false`, `boolean` ở bốn trường hợp; một helper chưa thử cả năm chưa nên đưa vào code chung.
- **Tách "kiểm tra" khỏi "biến đổi".** Kiểm tra (trả `true/false`) bọc `[T]`; biến đổi từng phần tử (trả kiểu mới) để phân phối. Lý do: hai mục đích cần hai hành vi ngược nhau, trộn vào một helper là nguồn bug.
- **Khi hàm có kiểu trả về conditional mà thân hàm phải `as`, gói trong overload** thay vì `as` rải rác. Lý do: chữ ký công khai là hợp đồng; thân hàm là chi tiết.
- **Khi hover thấy conditional "chưa tính" (`T extends string ? ... : ...`), tạo lời gọi cụ thể** (`type Probe = Fn<"a">`). Lý do: kiểu chỉ được tính khi `T` cụ thể; trước đó compiler giữ nguyên dạng.
- **Với tên event/route theo template, hãy viết một bộ test `Equal` cho: một thành viên, nhiều thành viên, `never`, `string` (không literal).** Lý do: ca `string` thường làm kết quả suy biến thành `string` hay `never` và gây lỗi ở nơi dùng, không phải nơi định nghĩa.
- **Đừng dựng kiểu "thông minh" thay cho kiểm tra runtime ở biên.** `RouteParams` bảo đảm bạn truyền đủ tham số, nhưng không bảo đảm chuỗi từ client là hợp lệ. Lý do: kiểu bị xoá khi chạy; dữ liệu ngoài vẫn là `unknown` cho đến khi validate.
- **So sánh với PHP/Laravel.** PHPStan/Psalm có `@template` và conditional return type trong docblock (`@return ($raw is true ? string : array)`), nhưng chỉ là chú thích do công cụ ngoài kiểm tra; PHP runtime không biết. Trong TS, kiểu conditional là một phần của ngôn ngữ, nhưng cùng chung giới hạn: nó mô tả, không thực thi.

## Tình huống mở để tự suy nghĩ

1. `IsAny<T>` dùng `0 extends 1 & T`. Tự giải thích từng bước vì sao `IsAny<unknown>` ra `false` và `IsAny<never>` ra gì (đoán trước, rồi kiểm bằng `Equal`).
2. Với `ReadResult<O>` ở mục 5: bạn muốn `read("a", { raw: dynBool })` ra `string | Uint8Array`. Sửa `ReadResult` thế nào, và có nên không? Phương án nào đọc dễ hơn: conditional hay overload?
3. Wrapper `retry<F>(f: F)` cần giữ nguyên chữ ký của `f`, kể cả overload. Chữ ký nào bảo toàn điều đó mà không dùng `Parameters`/`ReturnType`?
4. Hàm `Awaited` tự viết của bạn có xử lý thenable không? Nếu một ORM trả `{ then, ... }`, kiểu của bạn nói gì và runtime làm gì?
5. Nếu `SnakeToCamel` của kiểu và hàm đổi key runtime xử lý `"a__b"` khác nhau, lỗi sẽ xuất hiện ở đâu và ai phát hiện? Test nào bắt được?

## Liên hệ bài tập

`UnwrapPromise` đụng các mục 7 và 8: đối chiếu với `Awaited` trên thenable và trên union `Promise<A> | B`. `EventName<T>` đụng các mục 11 và 13: khoá không phải chuỗi, `Capitalize` với khoá đã viết hoa, và trường hợp đầu vào là `string` không literal. Viết `Equal` cho các ca đó trước, rồi mới viết kiểu.

## Đọc thêm

- [Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html)
- [Template Literal Types](https://www.typescriptlang.org/docs/handbook/2/template-literal-types.html)
- [TypeScript 5.4: NoInfer](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-4.html)
- [TypeScript 5.0: const type parameters](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html)

## Ghi chú của bạn
