# 3. Template literal types: kiểu chuỗi có cấu trúc

Cú pháp template string của JS có thể dùng ở cấp kiểu để **ghép** và **bóc tách** chuỗi literal (TS 4.1+).

```ts
type Method = "GET" | "POST";
type Path = "/users" | "/orders";
type Endpoint = `${Method} ${Path}`;
// "GET /users" | "GET /orders" | "POST /users" | "POST /orders"

type ApiPath = `/api/${string}`;
const ok: ApiPath = "/api/users";
```

## Ý chính

- Ghép các literal: union bên trong template cho ra **tích Descartes**.
- Dùng `${string}` / `${number}` làm "lỗ" tạo **pattern**: kiểu chấp nhận mọi chuỗi có dạng đó.
- Bộ 4 kiểu có sẵn: `Uppercase`, `Lowercase`, `Capitalize`, `Uncapitalize`.
- Kết hợp với `infer` (file 02) để **phân tích** chuỗi: tách route, đếm đoạn, đổi kiểu viết.
- Kết hợp với key remapping (Bài 5) để sinh khoá object mới.

## Lý thuyết chi tiết

**Ghép và bốn kiểu thao tác chuỗi.**

```ts
type Size = "sm" | "lg"; type Color = "red" | "blue";
type Variant = `${Size}-${Color}`;    // "sm-red" | "sm-blue" | "lg-red" | "lg-blue"

// Uppercase<"abc"> là "ABC", Capitalize<"abc"> là "Abc", Uncapitalize<"Abc"> là "abc", Lowercase<"ABC"> là "abc"
```

Số phần tử là tích: hai union lớn nhân với nhau sinh union rất lớn. Compiler giới hạn (xem file 04).

**Pattern literal.** `${string}` khớp mọi chuỗi (kể cả rỗng); `${number}` khớp chuỗi mà `Number(...)` hiểu là số.

```ts
type Id = `${number}`;
const p3: Id = "42";
// const p4: Id = "abc";            // lỗi
// const bad: ApiPath = "/users";   // lỗi: không bắt đầu bằng /api/
```

Hữu ích cho tên sự kiện dạng `${string}:${string}`: hàm `on<E extends `${string}:${string}`>(e: E)` bắt lỗi `on("usercreated")`.

**Bóc tách chuỗi bằng `infer`.** Mẫu `${infer Head}${Delim}${infer Tail}` so khớp **từ trái sang phải, Head khớp ngắn nhất** có thể:

```ts
type Split<S extends string, D extends string> =
  S extends `${infer H}${D}${infer T}` ? [H, ...Split<T, D>] : [S];
// Split<"a.b.c", "."> là ["a", "b", "c"]
```

Đệ quy ở đây là có điều kiện dừng (khi không còn `D` thì trả `[S]`).

**Ví dụ backend: trích tham số route.**

```ts
type RouteParams<R extends string> = R extends `${string}:${infer P}/${infer Rest}`
  ? P | RouteParams<`/${Rest}`>
  : R extends `${string}:${infer P}` ? P : never;
// RouteParams<"/users/:userId/posts/:postId"> là "userId" | "postId"
// RouteParams<"/health"> là never

type ParamsObj<R extends string> = { [K in RouteParams<R>]: string };

function buildPath<R extends string>(route: R, params: ParamsObj<R>): string {
  let out: string = route;
  for (const [k, v] of Object.entries(params as Record<string, string>)) {
    out = out.replace(`:${k}`, v);
  }
  return out;
}
buildPath("/users/:userId/posts/:postId", { userId: "1", postId: "2" });  // OK
// buildPath("/users/:userId/posts/:postId", { userId: "1" });            // lỗi: thiếu postId
```

Đây chính là kỹ thuật framework như Express/Hono/tRPC dùng để kiểu hoá `req.params`. Lưu ý `R` phải được suy ra là **literal** (tham số kiểu `R extends string` khiến TS giữ literal; nếu truyền một biến `string` thường thì `RouteParams<string>` không có ý nghĩa).

**Đổi kiểu viết khoá: camel → snake cho cột DB.**

```ts
type CamelToSnake<S extends string> = S extends `${infer H}${infer T}`
  ? `${H extends Lowercase<H> ? H : `_${Lowercase<H>}`}${CamelToSnake<T>}`
  : S;
// CamelToSnake<"createdAt"> là "created_at"
// CamelToSnake<"userEmailVerifiedAt"> là "user_email_verified_at"

type SnakeKeys<T> = { [K in keyof T as K extends string ? CamelToSnake<K> : K]: T[K] };
// SnakeKeys<{ userId: string; createdAt: Date }> là { user_id: string; created_at: Date }
```

Điều kiện `H extends Lowercase<H>` là mẹo: chữ thường bằng chính chữ thường của nó, chữ hoa thì không. Nhắc lại: phép này chỉ đổi **kiểu**. Hàm đổi key thật ở runtime vẫn phải tự viết, và kiểu của nó cần `as`.

**Trim và các thao tác nhỏ.**

```ts
type Trim<S extends string> = S extends ` ${infer R}` | `${infer R} ` ? Trim<R> : S;
// Trim<"  hi "> là "hi"
```

**`keyof` có thể là symbol: lọc bằng `& string`.** `` `get_${K}` `` với `K extends keyof T` là lỗi; viết `` `get_${K & string}` `` (đã kiểm chứng lỗi "Type 'symbol' is not assignable to ...").

**So sánh với PHP/Laravel.** Route trong Laravel là chuỗi `"/users/{user}/posts/{post}"`, tham số route kiểm tra ở runtime (`$request->route('user')`), IDE không biết tên tham số. Ở TS, kiểu hoá chuỗi route cho phép compiler bắt thiếu/sai tham số lúc biên dịch.

**`${number}` rộng hơn "chuỗi số nguyên".** Với tsc 7.0.2: `"1e3"`, `" 1"`, `"0x10"`, `"-1.5"` được chấp nhận; `""`, `"1_000"`, `"Infinity"`, `"NaN"` bị từ chối. Đừng xem nó là kiểm tra id.

**Giới hạn kích thước.** Union tích Descartes 10.000 literal (`${D}${D}${D}${D}` với `D` là chữ số) chạy được; 100.000 literal báo **TS2590: Expression produces a union type that is too complex to represent.**

**Quy tắc `infer` trên chuỗi.** Hai `infer` liền nhau không có dấu phân cách: cái đầu ăn **một ký tự**. `SnakeToCamel<"a__b">` ra `"aB"` và `SnakeToCamel<"_a">` ra `"A"` (dấu gạch dưới liền nhau hoặc đứng đầu bị nuốt). `Uppercase<string>` là kiểu mẫu: gán `"abc"` lỗi, `"ABC"` hợp lệ. Danh sách đầy đủ kèm cách nghĩ ở file 05, mục 11 đến 13.

## Tricks & tips thực tế

- **Dùng cho tập chuỗi nhỏ, có cấu trúc rõ** (tên event `entity.action`, HTTP route, tên header, key cấu hình). Lý do: nhận lại gợi ý tự hoàn thành (autocomplete) và bắt lỗi chính tả.
- **`${string}` ở đầu/cuối làm pattern rộng, ở giữa nhiều chỗ khó dự đoán.** Lý do: bộ so khớp theo luật cố định (mỗi `infer` đứng trước dấu phân cách khớp chuỗi ngắn nhất có thể); mẫu có nhiều `${string}` liền nhau không xác định thì kết quả khó suy ra. Thiết kế mẫu sao cho có **dấu phân cách** rõ giữa các `infer`.
- **Cẩn trọng với union lớn nhân nhau.** `${A}-${B}-${C}` với ba union 30 phần tử là 27.000 literal và làm chậm compiler. Lý do: số literal là tích; chia nhỏ hoặc dùng pattern `${string}` thay vì liệt kê.
- **Đừng parse chuỗi phức tạp bằng kiểu** (JSON, SQL, regex). Lý do: chậm, giới hạn đệ quy (file 04), lỗi khó đọc. Dùng thư viện runtime (Zod) và để kiểu suy ra từ schema (Bài 9).
- **Debug mẫu không khớp**: thử với chuỗi ngắn nhất, in kết quả từng lớp bằng alias trung gian (`type Step1 = Split<"a.b", ".">`) rồi hover. Lý do: đệ quy trên chuỗi khó nhìn từ đầu đến cuối; kiểm từng bước thì biết bước nào sai.
- **Hàm có tham số route/tên event nên khai báo `R extends string` (không phải `string`).** Lý do: ràng buộc `extends string` làm TS giữ kiểu literal của đối số; `route: string` làm mất thông tin và `RouteParams<string>` vô nghĩa.
- **Bắt `EventEmitter`/webhook name**: kiểu `${Entity}.${Action}` làm hệ thống event nhất quán và có autocompletion. Tên cụ thể của bài lab bạn tự thiết kế.

## Liên hệ bài tập

`EventName<T>` là bài về template literal types: ghép chuỗi với phần tên khoá của `T`. Trước khi viết, trả lời: `T` là gì (kiểu object hay union literal)? Khoá có thể là `symbol` hay `number` không, và bạn xử lý thế nào? Nếu nó phải đi qua `Capitalize`, kết quả nhìn ra sao với khoá đã viết hoa? Hãy viết các dòng `Equal` cho ít nhất ba trường hợp (một khoá, nhiều khoá, `never`).

## Đọc thêm

- [Template Literal Types](https://www.typescriptlang.org/docs/handbook/2/template-literal-types.html)
- [Intrinsic String Manipulation Types](https://www.typescriptlang.org/docs/handbook/2/template-literal-types.html#intrinsic-string-manipulation-types)

## Ghi chú của bạn

