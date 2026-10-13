# 3. Suy luận type argument và các lỗi hay gặp

Compiler suy ra `T` bằng cách thu thập "ứng viên" từ các đối số; hiểu cách nó chọn giúp bạn đoán đúng kết quả và sửa lỗi khi suy luận không như ý.

```ts
function same<T>(a: T, _b: T): T {
  return a;
}

same("a", 2);                          // Lỗi: 2 không gán được cho "a"/string
same<string | number>("a", 2);         // OK khi chỉ rõ T
```

## Ý chính

- Mỗi vị trí dùng `T` trong tham số cho một **ứng viên**. Compiler chọn một kiểu thoả mọi ứng viên; nếu không có, báo lỗi ở đối số "đến sau".
- Kiểu trả về cũng tham gia suy luận qua **contextual typing** (kiểu mong đợi ở chỗ nhận kết quả).
- Không có ứng viên thì `T` rơi về mặc định, rồi constraint, rồi `unknown`.
- Literal có được giữ hay bị nới rộng (`"a"` thành `string`) tuỳ vị trí của `T` và constraint. Cần giữ literal thì dùng `const` type parameter (TS 5.0+).
- `NoInfer<T>` (TS 5.4+) cho một vị trí không đóng góp ứng viên.
- Lỗi phổ biến nhất không phải lỗi cú pháp, mà là generic "nói dối": `T` chỉ xuất hiện ở kiểu trả về nên không có gì chứng minh được nó.

## Lý thuyết chi tiết

**Thu thập và chọn ứng viên.** Với `same("a", 2)`, ứng viên đầu là `string` (từ `"a"`), ứng viên thứ hai là `number`. Compiler không tự tạo union `string | number` cho bạn; nó lấy ứng viên đầu rồi kiểm tra các đối số còn lại, và `2` không khớp. Nếu bạn muốn union thì nói rõ bằng type argument, hoặc đổi chữ ký để mỗi đối số có type parameter riêng (`<A, B>`).

**Literal và nới rộng.**

```ts
function id<T>(x: T): T { return x; }
const w1 = id("a");   // kiểu "a" (literal được giữ vì kết quả là T ở dạng trần)

function wrapArr<T>(x: T): T[] { return [x]; }
const ll = wrapArr("a");   // string[], literal bị nới thành string
```

Quy tắc thực dụng: cứ để hover cho bạn biết. Khi cần chắc chắn một literal được giữ, hãy dùng constraint hoặc `const` type parameter.

**`const` type parameter (TS 5.0+).** Tương đương việc viết `as const` ở chỗ gọi, nhưng nằm ở chữ ký hàm nên người gọi không phải nhớ:

```ts
function tuple<const T extends readonly unknown[]>(xs: T): T {
  return xs;
}
const t = tuple(["a", 1]);   // readonly ["a", 1]

function tupleNo<T extends readonly unknown[]>(xs: T): T {
  return xs;
}
const t2 = tupleNo(["a", 1]);   // (string | number)[]
```

Constraint `readonly unknown[]` cho ra tuple `readonly`. Nếu constraint là mảng thường (`unknown[]`), TS hiện tại suy ra tuple không `readonly` (`["a", 1]`); đã thử với TS 7.0.2, còn các bản 5.0–5.2 cư xử khác nên chưa kiểm chứng.

**`NoInfer<T>` (TS 5.4+).** Dùng khi một tham số chỉ nên *kiểm tra* theo `T` đã suy ra từ tham số khác:

```ts
function pick<T extends string>(items: readonly T[], def: NoInfer<T>): T {
  return items[0] ?? def;
}
pick(["a", "b"], "a");   // OK
pick(["a", "b"], "c");   // Lỗi: "c" không thuộc "a" | "b"

function pickNo<T extends string>(items: readonly T[], def: T): T {
  return items[0] ?? def;
}
pickNo(["a", "b"], "c");   // Không lỗi: T bị nới thành "a" | "b" | "c"
```

Bản không `NoInfer` âm thầm chấp nhận giá trị sai vì `"c"` cũng là một ứng viên.

**Generic chỉ ở kiểu trả về là lời nói dối.**

```ts
function parse<T>(json: string): T {
  return JSON.parse(json);   // JSON.parse trả any, nên khớp mọi T
}
const u = parse<{ id: number }>("{}");
u.id;   // kiểu nói là number, runtime là undefined
```

Không có đầu vào nào ràng buộc `T`, nên người gọi tự "khai" kiểu và compiler tin. Phiên bản trung thực trả `unknown` rồi validate (Bài 9), hoặc nhận một schema/guard làm tham số để `T` được suy ra từ đó.

**Không có ứng viên.**

```ts
function empty<T>(): T[] { return []; }
const e = empty();               // unknown[]
const e2: string[] = empty();    // T suy ra từ kiểu mong đợi: string
```

Trường hợp thứ hai là "return type inference": kiểu của biến nhận cũng là nguồn suy luận. Hữu ích nhưng dễ gây ngạc nhiên; đừng phụ thuộc vào nó cho API công khai.

**Generic và `any` rò rỉ.** `function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }` compile được vì `any` khớp với `T`. Kiểu bên ngoài trông đúng nhưng thân hàm không được kiểm tra. Thêm `as T` hoặc chú thích `const result: unknown = ...` giúp bạn nhìn thấy chỗ đang tin.

**Giá trị khởi tạo rỗng cho `reduce`.** `items.reduce((acc, it) => [...acc, it.sku], [])` suy ra `acc: never[]` và báo `TS2769: No overload matches this call`; với `{}` thì chỉ mục vào `acc` báo `TS7053`. `reduce` suy `U` từ giá trị khởi tạo, mà `[]`/`{}` không có thông tin. Sửa bằng `reduce<string[]>(..., [])` hoặc `reduce<Record<string, Item>>(..., {})`. Đây là trường hợp truyền type argument tay là đúng. Xem thêm file 5.

**Truyền hàm generic làm callback vẫn suy luận được.** `[1, 2].map(identity)` với `identity<T>(x: T): T` cho `number[]`: compiler suy `T` của `identity` từ kiểu phần tử của mảng (đã kiểm chứng).

**Mảng `readonly` không gán được cho tham số mảng thường.**

```ts
function sum<T extends number>(xs: T[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
const ro: readonly number[] = [1];
sum(ro);   // Lỗi: readonly number[] không gán được cho number[]
```

Sửa bằng `xs: readonly T[]` nếu hàm không mutate.

**Object truyền vào bị nới rộng thuộc tính.**

```ts
function wrap<T>(x: T): { v: T } { return { v: x }; }
const wr = wrap({ kind: "a" });                // { v: { kind: string } }
const wr2 = wrap({ kind: "a" } as const);      // { v: { readonly kind: "a" } }
```

Nếu `kind` cần là literal (discriminant), hãy dùng `as const`, `const T`, hoặc constraint chứa literal.

## Tricks & tips thực tế

- **Đọc lỗi từ dưới lên.** Thông báo generic dài thường kết thúc bằng dòng cụ thể nhất ("Type 'number' is not assignable to type 'string'"). Bắt đầu từ dòng đó, rồi tìm `T` được cố định ở đâu (đối số nào đến trước).
- **Khi `T` bị suy ra quá hẹp, thêm type parameter thứ hai thay vì ép `<A | B>`.** `<A, B>` cho mỗi đối số một ứng viên riêng, không cần người gọi nhớ kiểu union.
- **Khi `T` bị suy ra quá rộng và bạn muốn bắt lỗi, dùng `NoInfer`.** Ví dụ giá trị mặc định/fallback phải thuộc tập đã có. Cách `def: T & {}` không thay thế được: đã thử, `"c"` vẫn lọt qua. Dưới TS 5.4, hãy nâng TS hoặc đổi thiết kế chữ ký.
- **Đừng để `T` chỉ xuất hiện một lần** (xem file 4). Nếu chỉ ở kiểu trả về, đó thường là `as` trá hình; nếu chỉ ở tham số, thường không cần generic.
- **Nghi ngờ mọi `as T` trong thân hàm generic.** Lý do: nó vô hiệu hoá chính kiểm tra mà generic tồn tại để cung cấp. Nếu bắt buộc phải có, gom vào một chỗ và comment vì sao đúng.
- **Debug suy luận bằng hàm thăm dò.** Viết tạm `const probe = <T,>(x: T) => x;` hoặc dùng `type Show<T> = T` rồi hover; hoặc gán vào biến có kiểu sai cố ý (`const _: never = ketQua`) để compiler in ra kiểu thực trong thông báo lỗi. Xoá sau khi xem.
- **Callback trong generic: viết tham số callback không chú thích kiểu** để được contextual typing. Nếu tự chú thích sai (`(x: string) => ...` cho mảng số), lỗi sẽ chỉ vào cả lời gọi chứ không vào callback, khó đọc hơn.
- **Cẩn thận với `Object.keys`, `Object.entries` trong hàm generic**: chúng trả `string` hoặc `[string, any]`, nên bạn thường phải ép kiểu có chủ ý, hoặc giữ cấu trúc bằng `Map`/`Record` có khoá hẹp.

## Liên hệ bài tập

Khi lab yêu cầu một hàm tạo hoặc trả giá trị `Result<T>`, hãy thử gọi nó theo ba cách: để suy luận, truyền `<...>` tay, và gán vào biến có kiểu. Ghi lại cách nào cho kết quả khác nhau và vì sao. Nếu bạn thấy mình cần `as T` ở bất kỳ đâu, đó là dấu hiệu chữ ký cần xem lại.

## Đọc thêm

- [Type Inference (Generics, Handbook)](https://www.typescriptlang.org/docs/handbook/type-inference.html)
- [Generics (Handbook)](https://www.typescriptlang.org/docs/handbook/2/generics.html)
- [TypeScript 5.0 release notes (const type parameters)](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html)
- [TypeScript 5.4 release notes (NoInfer)](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-4.html)

## Ghi chú của bạn

