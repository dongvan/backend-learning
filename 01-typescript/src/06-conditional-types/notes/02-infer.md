# 2. `infer`: trích kiểu bên trong một kiểu khác

`infer` khai báo một biến kiểu **ngay trong mệnh đề `extends`** của conditional để compiler tự điền vào kiểu khớp.

```ts
type ElementOf<T> = T extends readonly (infer E)[] ? E : never;
// ElementOf<string[]> là string, ElementOf<readonly [1, "a"]> là 1 | "a", ElementOf<number> là never

type FirstArg<F> = F extends (first: infer A, ...rest: never[]) => unknown ? A : never;
```

## Ý chính

- `infer X` chỉ dùng được **trong vế phải của `extends`** trong một conditional type, và `X` chỉ có hiệu lực ở nhánh *true*.
- Mẫu chung: "nếu `T` có dạng `Hình<...>`, lấy phần `...` ra".
- Nơi hay dùng: phần tử mảng, tham số/giá trị trả về của hàm, tham số của constructor, phần của template literal.
- Cùng một biến `infer` xuất hiện nhiều lần: vị trí **covariant** (trả về, thuộc tính) cho **union**; vị trí **contravariant** (tham số hàm) cho **intersection**.
- `infer X extends C` (TS 4.7+) ràng buộc kiểu suy ra; ở template literal có thể suy ra thẳng `number` (TS 4.8+).
- `ReturnType`, `Parameters`, `ConstructorParameters`, `Awaited` đều là conditional dùng `infer`.

## Lý thuyết chi tiết

**Trích từ object và hàm.**

```ts
type Unbox<T> = T extends { value: infer V } ? V : T;
// Unbox<{ value: Date }> là Date, Unbox<string> là string

function sendMail(to: string, subject: string, urgent?: boolean) {
  return { to, subject, urgent };
}
// FirstArg<typeof sendMail> là string
// Parameters<typeof sendMail> là [to: string, subject: string, urgent?: boolean]
```

Tại sao `rest: never[]` trong ví dụ trên? Tham số của hàm là **contravariant**: để một hàm bất kỳ gán được cho mẫu của bạn, các tham số còn lại trong mẫu phải là "đủ rộng". `never[]` làm mẫu chấp nhận mọi hàm có tham số đầu khớp. Dùng `any[]` cũng chạy nhưng kéo theo `any`.

**Tuple: lấy đầu, đuôi, cuối.**

```ts
type LastOf<T extends readonly unknown[]> = T extends readonly [...unknown[], infer L] ? L : never;
// LastOf<[1, 2, 3]> là 3
type Tail<T extends readonly unknown[]> = T extends readonly [unknown, ...infer R] ? R : [];
// Tail<[1, 2, 3]> là [2, 3]
```

**Nhiều vị trí `infer` cùng tên.** Hành vi theo biến thể (variance):

```ts
type Cov<T> = T extends { a: infer U; b: infer U } ? U : never;
// Cov<{ a: string; b: number }> là string | number         (covariant -> union)

type Contra<T> = T extends { a: (x: infer U) => void; b: (x: infer U) => void } ? U : never;
// Contra<{ a: (x: string) => void; b: (x: number) => void }> là string & number   (contravariant -> intersection)
```

Hiểu điều này để biết vì sao đôi khi nhận về `never` (giao của hai kiểu không liên quan là `never` ở primitive).

**`infer X extends C` (TS 4.7+) và suy ra số (TS 4.8+).**

```ts
type FirstString<T> = T extends [infer S extends string, ...unknown[]] ? S : never;
// FirstString<["a", 1]> là "a", FirstString<[1, "a"]> là never

type ToNum<S> = S extends `${infer N extends number}` ? N : never;
// ToNum<"42"> là 42, ToNum<"abc"> là never
```

Ràng buộc `extends` trên `infer` vừa lọc (không khớp ⇒ nhánh false) vừa cho kiểu tốt hơn mà không cần thêm một conditional lồng.

**Giới hạn khi suy ra từ hàm: overload và generic.**

```ts
declare function f(x: string): string;
declare function f(x: number): number;
// ReturnType<typeof f> là number    -> chỉ lấy OVERLOAD CUỐI CÙNG

declare function ident<T>(x: T): T;
// ReturnType<typeof ident> là unknown   -> generic bị "xoá" thành ràng buộc của nó
```

Đây là hai bẫy thật: bạn không thể trích toàn bộ overload bằng `infer`, và không thể giữ tham số kiểu của hàm generic.

**Class và constructor.**

```ts
class Repo { find(id: string) { return { id, ok: true }; } }
type FindResult = ReturnType<Repo["find"]>;          // { id: string; ok: boolean }

type CtorArgs<C> = C extends new (...args: infer A) => unknown ? A : never;
class Svc { constructor(readonly url: string, readonly retries = 3) {} }
// CtorArgs<typeof Svc> là [url: string, retries?: number]
```

`Repo["find"]` là indexed access (Bài 5) lấy kiểu method trước khi áp `ReturnType`.

**Trích bên trong union tagged và Map.**

```ts
type Msg = { type: "ping" } | { type: "data"; body: string };
type BodyOf<M> = M extends { body: infer B } ? B : never;
// BodyOf<Msg> là string   (phân phối: nhánh "ping" cho never, tự biến mất khỏi union)

type MapKey<M> = M extends Map<infer K, unknown> ? K : never;
// MapKey<Map<string, number>> là string
```

**So sánh với PHP/Laravel.** PHP có reflection (`ReflectionFunction::getReturnType()`) làm điều tương tự ở **runtime**. `infer` làm ở compile time, không tốn chi phí và không cần tồn tại hàm thật khi chạy. PHPStan có `@template` + `@param class-string<T>` để suy luận kiểu; ý tưởng gần với `infer`.

## Tricks & tips thực tế

- **Dùng `ReturnType`/`Parameters`/`Awaited` có sẵn trước khi tự viết.** Lý do: chúng đã xử lý biên (overload, optional, rest). Chỉ tự viết `infer` khi cần dạng chưa có (ví dụ `Parameters` của method trên class: `Parameters<Repo["find"]>`).
- **Mẫu "kiểu dẫn xuất từ service"**: `type FindResult = Awaited<ReturnType<UserService["findOne"]>>` để controller/test dùng đúng kiểu mà service trả về, không khai báo lại. Lý do: đổi service thì mọi nơi dùng tự cập nhật. Cách này phổ biến trong NestJS (Phase 03).
- **Đặt tên biến infer có nghĩa** (`infer Item`, `infer Ret`) thay vì `T1`, `U`. Lý do: kiểu dài đọc như câu; tên nghĩa giúp hover thông báo lỗi.
- **Mẫu luôn có nhánh `never` rõ ràng khi không khớp.** `: never` làm lỗi hiện ngay chỗ dùng; còn trả `unknown`/`T` thì lỗi lan đi xa. Lý do: fail-fast ở cấp kiểu. Tuy nhiên với các helper "tuỳ chọn" (`Unbox`) trả `T` là chủ ý, hãy ghi rõ trong tên.
- **Debug `infer` ra `unknown` hoặc `never`**: (1) thử thay `infer X` bằng kiểu cụ thể để xem khớp hay không; (2) kiểm tra `readonly` (`readonly [..]` không khớp mẫu `[...]` mutable; hãy khớp `readonly unknown[]`); (3) kiểm tra optional/rest tham số; (4) kiểm tra overload cuối cùng. Lý do: bốn nguyên nhân này chiếm gần hết các lần "tại sao ra `never`".
- **`as const` tuple là `readonly`**: mẫu `T extends [infer H, ...infer R]` *không* khớp `readonly [1, 2]`. Viết `readonly [infer H, ...infer R]` để nhận cả hai. Lý do: tuple `readonly` không gán được cho tuple mutable.
- **Đừng dùng `infer` để trích kiểu của một thứ có thể truy cập bằng indexed access.** `T["value"]` đơn giản và nhanh hơn `T extends { value: infer V } ? V : never` khi bạn chắc chắn khoá tồn tại. Lý do: ít code hơn, ít chỗ sai hơn; `infer` cần thiết khi *hình dạng* mới là điều cần so khớp (hàm, mảng, template).

## Liên hệ bài tập

`UnwrapPromise` cần so khớp hình dạng `Promise<...>` và lấy phần bên trong. Hãy tự hỏi: mẫu ở vế phải `extends` trông thế nào, biến `infer` đặt ở đâu, nhánh false trả về gì, và có cần đệ quy để xử lý `Promise<Promise<X>>` không? Sau khi làm xong, đối chiếu kết quả với `Awaited<T>` bằng `Equal` trên một loạt trường hợp (lồng nhau, không phải promise, union).

## Đọc thêm

- [Inferring Within Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#inferring-within-conditional-types)
- [TypeScript 4.7: `extends` constraints on `infer`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-7.html)

## Ghi chú của bạn

