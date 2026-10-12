# 2. Constraint (`extends`), `keyof` và type parameter mặc định

`T extends X` nói "T là bất kỳ kiểu nào, miễn là gán được cho X"; nhờ vậy bên trong hàm bạn dùng được những thành viên mà X đảm bảo.

```ts
function longest<T extends { length: number }>(a: T, b: T): T {
  return a.length >= b.length ? a : b;
}

longest("ab", "abc");      // OK, trả về string
longest([1], [1, 2]);      // OK, trả về number[]
longest(1, 2);             // Lỗi: number không có thuộc tính length
```

## Ý chính

- `extends` trong ngữ cảnh generic là **giới hạn trên** (upper bound), không phải kế thừa class. Đọc là "gán được cho".
- Không có constraint thì `T` gần như `unknown` bên trong hàm: bạn không truy cập được thuộc tính nào.
- Hàm vẫn trả về **`T`** (kiểu cụ thể người gọi truyền) chứ không phải kiểu của constraint. Đây là lý do dùng generic thay vì gõ thẳng tham số bằng constraint.
- `K extends keyof T` ràng buộc một tham số phải là tên thuộc tính thật của `T`, và `T[K]` cho kiểu của thuộc tính đó.
- Type parameter có thể có **giá trị mặc định** (`<T = string>`), giống tham số mặc định của hàm. Tham số bắt buộc phải đứng trước tham số có mặc định.

## Lý thuyết chi tiết

**Constraint mở khoá thành viên.** Bỏ constraint thì thân hàm báo lỗi:

```ts
function bad<T>(x: T): number {
  return x.length;   // Lỗi: Property 'length' does not exist on type 'T'
}
```

Compiler không biết `T` là gì nên chỉ cho phép những thao tác đúng với mọi kiểu. Constraint là cách bạn nói "tôi cần tối thiểu những thứ này".

**Giữ kiểu cụ thể của người gọi.** So sánh hai chữ ký:

```ts
function cloneLoose(x: { id: number }): { id: number } {
  return { ...x };
}
function clone<T extends { id: number }>(x: T): T {
  return { ...x };
}

const cl = clone({ id: 1, name: "a" });
cl.name;   // string; bản cloneLoose sẽ mất thuộc tính name
```

Chữ ký đầu "xoá" thông tin thừa; chữ ký thứ hai trả đúng kiểu đã truyền vào. Đây là trường hợp dùng generic chính đáng.

**`keyof` và indexed access `T[K]`.**

```ts
function getProp<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

const user = { id: 1, name: "An", active: true };
getProp(user, "name");     // string
getProp(user, "active");   // boolean
getProp(user, "email");    // Lỗi: "email" không thuộc keyof typeof user
```

`keyof typeof user` là `"id" | "name" | "active"`. Vì `K` bị giới hạn bởi union này và được suy luận là literal `"name"`, `T[K]` thu hẹp xuống `string`. Nếu bạn gõ `key: keyof T` (không dùng `K`) thì kết quả là `T[keyof T]`, tức union của mọi kiểu thuộc tính: `string | number | boolean`. Mất độ chính xác.

Dạng ghi cũng giữ ràng buộc giữa khoá và giá trị:

```ts
function setProp<T, K extends keyof T>(obj: T, key: K, value: T[K]): T {
  return { ...obj, [key]: value };
}
setProp(user, "id", 2);     // OK
setProp(user, "id", "2");   // Lỗi: string không gán được cho number
```

Và `pluck` cho mảng:

```ts
function pluck<T, K extends keyof T>(items: readonly T[], key: K): T[K][] {
  return items.map((i) => i[key]);
}
const ids = pluck([user], "id");   // number[]
```

**Constraint tham chiếu type parameter khác** là hợp lệ (như `K extends keyof T` ở trên). Thứ tự khai báo không quan trọng bằng việc `T` phải được khai báo trong cùng danh sách.

**Constraint là hàm hoặc constructor.**

```ts
type Constructor<T> = new (...args: any[]) => T;   // any ở đây là thủ thuật chuẩn: cần khớp mọi danh sách tham số
function make<T>(C: Constructor<T>): T {
  return new C();
}
class Foo { x = 1; }
const f = make(Foo);   // Foo
```

Dùng `never[]` thay cho `any[]` trong constraint tham số hàm (`F extends (...args: never[]) => unknown`) là cách tránh `any` mà vẫn nhận mọi hàm, vì tham số ở vị trí contravariant: `never[]` là kiểu hẹp nhất nên mọi danh sách tham số đều gán được.

**Giá trị mặc định cho type parameter.**

```ts
type ApiResponse<TData, TMeta = undefined> = { data: TData; meta: TMeta };

const r1: ApiResponse<string> = { data: "x", meta: undefined };
const r2: ApiResponse<string, { page: number }> = { data: "x", meta: { page: 1 } };
```

Mặc định kết hợp được với constraint; mặc định phải thoả constraint:

```ts
type Entity<TId extends string | number = number> = { id: TId };

const e1: Entity = { id: 1 };            // TId = number
const e2: Entity<string> = { id: "u1" };
type E3 = Entity<boolean>;               // Lỗi: boolean vi phạm constraint
```

Tham số bắt buộc không được đứng sau tham số có mặc định:

```ts
type Wrong<A = string, B> = [A, B];   // Lỗi: Required type parameters may not follow optional type parameters
```

**Mặc định không dùng cho suy luận của hàm theo cách bạn nghĩ.** Với generic function, nếu compiler không tìm được ứng viên suy luận, nó dùng mặc định (nếu có), không thì dùng constraint, không thì `unknown`. Mặc định chủ yếu hữu ích với type alias, interface, class, nơi bạn không có đối số để suy luận.

## Tricks & tips thực tế

- **Constraint tối thiểu, mô tả cấu trúc chứ không phải class cụ thể.** `T extends { id: number }` nhận được mọi entity có `id`, còn `T extends UserEntity` buộc hàm vào một class. Lý do: structural typing (Bài 1) cho phép hàm tái sử dụng rộng hơn mà không mất an toàn.
- **Ưu tiên `K extends keyof T` thay vì `key: string`.** Với `string`, typo tên thuộc tính chỉ lộ ra ở runtime; với `keyof`, lỗi hiện ngay khi gõ, và editor còn gợi ý tên khoá. Trong backend, các hàm dạng `orderBy(items, "createdAt")` hay `pluck` dùng pattern này.
- **`Object.keys(o)` trả `string[]`, không phải `(keyof T)[]`.** Vì object có thể mang thêm thuộc tính mà kiểu không biết, nên `o[k]` với `k: string` lỗi dưới `strict`. Nếu bạn biết chắc cấu trúc, ép kiểu có chủ ý: `Object.keys(o) as (keyof T)[]`, và ghi lý do bằng comment. Đây là một trong số ít chỗ `as` được chấp nhận.
- **Mặc định cho "tham số ít dùng".** `ApiResponse<TData, TMeta = undefined>` cho 90% chỗ gọi viết ngắn, 10% chỗ cần meta vẫn truyền được. Đừng đặt mặc định chỉ để "cho gọn" khi người gọi buộc phải nghĩ về kiểu: mặc định che đi một quyết định thiết kế.
- **Đặt tham số hay thay đổi sau cùng.** Vì tham số có mặc định phải ở cuối, hãy sắp xếp `<TData, TError = Error>` theo mức độ "bắt buộc phải biết".
- **Lỗi thường gặp: "Type 'X' is not assignable to type 'T'. 'T' could be instantiated with an arbitrary type..."** Gặp khi bạn trả về giá trị cụ thể cho một kiểu `T extends ...`. Ví dụ `function makeEmpty<T extends { id: number }>(): T { return { id: 0 }; }` lỗi, vì `T` có thể là `{ id: number; name: string }` mà `{ id: 0 }` thì thiếu `name`. Cách sửa: đổi chữ ký (nhận giá trị khởi tạo làm tham số, hoặc trả kiểu cụ thể thay vì `T`), tránh `as T` trừ khi bạn thật sự chứng minh được.
- **`T extends object` loại primitive nhưng nhận cả mảng, hàm.** Nếu muốn "object thường có khoá chuỗi", dùng `Record<string, unknown>`; nhưng interface không có index signature sẽ không gán được cho `Record<string, unknown>` trong nhiều trường hợp, nên khi lỗi vì lý do này hãy thử `T extends object`.
- **So với PHP:** constraint giống `@template T of Countable` trong PHPStan, hay type hint `Countable&Traversable` ở tham số. Khác ở chỗ TypeScript kiểm tra theo cấu trúc, không yêu cầu class phải khai báo `implements`.

## Liên hệ bài tập

Trong `Repository<T>` bạn sẽ cần quyết định `T` phải thoả điều kiện gì (ví dụ có định danh) và kiểu của định danh có cố định không hay là một tham số riêng có mặc định. Thử cả hai thiết kế, rồi so sánh chỗ gọi: cái nào ngắn hơn, cái nào cho phép entity có id kiểu khác?

## Đọc thêm

- [Generic Constraints](https://www.typescriptlang.org/docs/handbook/2/generics.html#generic-constraints)
- [Using Type Parameters in Generic Constraints](https://www.typescriptlang.org/docs/handbook/2/generics.html#using-type-parameters-in-generic-constraints)
- [Keyof Type Operator](https://www.typescriptlang.org/docs/handbook/2/keyof-types.html)
- [Generic Parameter Defaults](https://www.typescriptlang.org/docs/handbook/2/generics.html#generic-parameter-defaults)

## Ghi chú của bạn

