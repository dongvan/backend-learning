# 4. `as const` và `satisfies` cho config

`as const` giữ nguyên giá trị literal và đánh dấu readonly; `satisfies` kiểm tra object khớp một kiểu mà **không** làm mất kiểu hẹp mà compiler đã suy ra.

```ts
const LOG_LEVELS = {
  debug: 10,
  info: 20,
  error: 40,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;        // "debug" | "info" | "error"
type LevelValue = (typeof LOG_LEVELS)[LogLevel]; // 10 | 20 | 40
export type { LogLevel, LevelValue };
```

## Ý chính

- Mặc định TS **mở rộng** (widen) literal: `{ port: 3000 }` có `port: number`. `as const` ngăn việc đó, đồng thời thêm `readonly` đệ quy.
- `as const` cho phép **một nguồn sự thật**: viết giá trị một lần, suy ra union kiểu từ chính nó bằng `keyof typeof` hoặc `(typeof arr)[number]`.
- `satisfies` (TS 4.9+) kiểm tra "giá trị này có hợp kiểu X không" nhưng giữ nguyên kiểu suy ra của giá trị, khác với chú thích `: X` làm kiểu bị mở rộng thành X.
- Kết hợp `as const satisfies X` (cần TS 4.9+): vừa bị khoá literal, vừa bị kiểm tra cấu trúc.
- Cả hai chỉ có tác dụng ở compile-time. Không thay thế validate dữ liệu runtime (Zod, Bài 9).

## Lý thuyết chi tiết

**Widening.** Compiler mở rộng literal khi giá trị có thể bị thay đổi sau đó:

```ts
const a = { env: "prod", retries: 3 };
// a: { env: string; retries: number }

const b = { env: "prod", retries: 3 } as const;
// b: { readonly env: "prod"; readonly retries: 3 }

// @ts-expect-error  Cannot assign to 'retries' because it is a read-only property
b.retries = 4;
export { a, b };
```

**Mảng và tuple.** `as const` biến mảng thành tuple readonly:

```ts
const METHODS = ["GET", "POST", "PUT"] as const;
// readonly ["GET", "POST", "PUT"]

type Method = (typeof METHODS)[number];      // "GET" | "POST" | "PUT"

function isMethod(s: string): s is Method {
  return (METHODS as readonly string[]).includes(s);
}
export { isMethod };
```

Ở `isMethod`, `METHODS.includes(s)` lỗi vì `s: string` không gán được cho tham số kiểu `Method`. Dùng cast sang `readonly string[]` (rộng hơn) là cách quen thuộc. Mẫu này cho bạn runtime array **và** union kiểu từ cùng một khai báo, dễ hơn viết hai chỗ rồi giữ đồng bộ bằng tay.

**Tương đương `enum`.** `as const` object thường được ưa hơn `enum` của TS: không sinh code runtime riêng, không có hành vi lạ của numeric enum, và hoạt động tốt khi bật `erasableSyntaxOnly` (TS 5.8+) hoặc khi chạy bằng công cụ chỉ "xoá kiểu" (xem Bài 8). Đánh đổi: phải tự suy ra union.

```ts
const Status = { Draft: "draft", Sent: "sent" } as const;
type Status = (typeof Status)[keyof typeof Status];   // "draft" | "sent"

function isSent(s: Status): boolean {
  return s === Status.Sent;
}
export { Status, isSent };
```

Việc khai báo `const Status` và `type Status` cùng tên là hợp lệ vì chúng nằm ở hai "không gian" (giá trị và kiểu) khác nhau.

**`satisfies`: kiểm tra mà không mở rộng.** So sánh ba cách:

```ts
type Route = { path: string; auth?: boolean };

// 1) Chú thích: kiểm tra OK nhưng mất thông tin cụ thể
const r1: Record<string, Route> = { home: { path: "/" }, admin: { path: "/admin", auth: true } };
// r1.home: Route   (và r1.typo cũng hợp lệ, kiểu Route | undefined với noUncheckedIndexedAccess)

// 2) Không kiểm tra: giữ kiểu hẹp nhưng không có lưới an toàn
const r2 = { home: { path: "/" }, admin: { path: 123 } };      // sai kiểu mà không báo

// 3) satisfies: cả hai
const r3 = {
  home: { path: "/" },
  admin: { path: "/admin", auth: true },
} satisfies Record<string, Route>;

r3.home.path;       // string
r3.admin.auth;      // boolean (không phải boolean | undefined)
// @ts-expect-error  Property 'typo' does not exist on type
r3.typo;
export { r1, r2, r3 };
```

Với `satisfies`, khoá `typo` bị bắt vì kiểu của `r3` là kiểu *suy ra* của object chứ không phải `Record<string, Route>`.

**`satisfies` bắt lỗi chính tả và thừa khoá** nhờ excess property check:

```ts
type Retry = { attempts: number; backoffMs: number };

const retry = {
  attempts: 3,
  backoffMs: 200,
  // @ts-expect-error  Object literal may only specify known properties
  jitter: true,
} satisfies Retry;
export { retry };
```

**`as const satisfies`** dùng khi muốn giá trị bị khoá literal *và* hợp kiểu:

```ts
type Endpoint = { method: "GET" | "POST"; path: string };

const ENDPOINTS = {
  list: { method: "GET", path: "/users" },
  create: { method: "POST", path: "/users" },
} as const satisfies Record<string, Endpoint>;

type EndpointName = keyof typeof ENDPOINTS;            // "list" | "create"
const m = ENDPOINTS.create.method;                     // "POST"
export type { EndpointName };
export { m };
```

Không có `as const`, `satisfies` vẫn giữ `method` là `"POST"` nhờ kiểu đích chứa literal (đã thử), nhưng `path` bị mở rộng thành `string` vì kiểu đích không có literal cho nó, và các thuộc tính vẫn sửa được. Có `as const`, `path` thành `"/users"` và mọi thuộc tính thành `readonly`.

**Cạm bẫy `readonly`.** `as const` làm mảng thành tuple `readonly`, mà `readonly` không gán được cho kiểu mảng thường. Với `as const` đứng một mình, truyền vào hàm nhận `string[]` sẽ lỗi:

```ts
const HOSTS = ["a", "b"] as const;

function connectAll(hosts: string[]): number {
  return hosts.length;
}

// @ts-expect-error  The type 'readonly ["a", "b"]' is 'readonly' and cannot be assigned to the mutable type 'string[]'
connectAll(HOSTS);
```

Cách sửa đúng là đổi tham số thành `readonly string[]` (hàm chỉ đọc nên khai báo vậy là chính xác và rộng rãi hơn cho người gọi). Với `as const satisfies` thì hành vi khác: khi kiểu đích là mảng *mutable*, kiểu suy ra của mảng trong kết quả cũng là tuple **không** readonly (đã thử trên TS 7.0.2), nên đoạn dưới đây hợp lệ mà không cần `readonly` ở kiểu đích:

```ts
type Config = { hosts: string[] };
export const cfg = { hosts: ["a", "b"] } as const satisfies Config;   // cfg.hosts: ["a", "b"]
```

Vì hành vi này tinh tế và dễ đổi giữa các phiên bản, hãy rê chuột kiểm tra kiểu thực tế thay vì suy đoán.

**`as const` không phải `const` thật ở runtime.** `Object.freeze` mới đóng băng thật. `as const` chỉ ảnh hưởng kiểu; mã JS vẫn sửa được object, và dữ liệu từ ngoài không được bảo vệ.

**Hàm nhận tham số "config" và `const` type parameter (TS 5.0+).** Thay vì bắt người gọi viết `as const`, hàm có thể tự yêu cầu giữ literal:

```ts
function defineRoutes<const T extends readonly string[]>(names: T): T {
  return names;
}

const routes = defineRoutes(["home", "about"]);   // readonly ["home", "about"]
export { routes };
```

Cú pháp `<const T>` cần TS 5.0+. Dùng khi bạn viết helper kiểu `defineConfig(...)`.

**Giới hạn của `as const`: chỉ áp lên literal.** `as const` không "đóng băng" kết quả của một biểu thức, nó chỉ áp dụng cho literal viết thẳng tại chỗ:

```text
TS1355: A 'const' assertion can only be applied to references to enum members, or string,
        number, boolean, array, or object literals.
        Math.random() as const        // gọi hàm
        (cond ? 1 : 2) as const       // biểu thức điều kiện
```

Trong object literal có giá trị động (`{ id: someVar } as const`) thì chỉ phần literal được khoá, `id` giữ kiểu của `someVar` (kèm `readonly`).

**Duyệt một object `as const`: `Object.keys` trả `string[]`.** Đây là cạm bẫy kinh điển khi dùng config làm bảng tra:

```ts
const LV = { debug: 10, info: 20 } as const;

// for (const k of Object.keys(LV)) LV[k];
// TS7053: Element implicitly has an 'any' type because expression of type 'string'
//         can't be used to index type '{ readonly debug: 10; readonly info: 20; }'.

export const viaEntries = Object.entries(LV).map(([name, value]) => `${name}=${value}`);
// Object.entries(LV): [string, 10 | 20][]   (khoá bị mất literal, giá trị thì giữ)
// Object.values(LV):  (10 | 20)[]

export function typedKeys<T extends object>(o: T): (keyof T)[] {
  return Object.keys(o) as (keyof T)[];     // lời hứa: an toàn khi o không có khoá thừa lúc chạy
}
export const viaKeys = typedKeys(LV).map((k) => LV[k]);   // (10 | 20)[]
```

Vì sao TS không tự suy `keyof T`: ở runtime object có thể mang thêm khoá (subtype, dữ liệu ngoài), nên `Object.keys` cố tình trả `string[]`. `as (keyof T)[]` là một cast, nên chỉ dùng cho object bạn tự kiểm soát (như config `as const`).

**`satisfies Record<Union, X>` ép đủ khoá.** Khi tập khoá là một union, `satisfies` cho bạn kiểm tra tính đầy đủ:

```ts
type Role = "admin" | "user" | "guest";

export const perms = {
  admin: ["*"],
  user: ["read"],
  guest: [],
} satisfies Record<Role, string[]>;
// Bỏ dòng guest: TS2741: Property 'guest' is missing in type '{ admin: string[]; user: string[]; }'
//                         but required in type 'Record<Role, string[]>'.
```

Thêm một `Role` mới sẽ làm bảng này lỗi tại chỗ cần bổ sung (đã thử), tương tự `match` đầy đủ trong PHP 8 nhưng bắt ở compile time.

**Contextual typing vẫn hoạt động trong `satisfies`.** Hàm viết bên trong object nhận kiểu tham số từ kiểu đích:

```ts
export const handlers = {
  onUpload: (name) => name.length,        // name: string, suy ra từ Record<string, (s: string) => number>
} satisfies Record<string, (s: string) => number>;
// handlers.onUpload: (name: string) => number   (đã thử)
```

**`<const T>` với ràng buộc mutable** (TS 5.0+, đã thử trên TS 7.0.2): `function d<const T extends string[]>(x: T): T` gọi với `["a", "b"]` cho ra `["a", "b"]` (tuple **không** readonly), còn ràng buộc `readonly string[]` cho `readonly ["a", "b"]`. Một số bài viết cũ nói "ràng buộc mutable làm `const` mất tác dụng" (chưa kiểm chứng trên bản TS cũ); hãy rê chuột kiểm tra trên phiên bản bạn dùng thay vì tin vào bài viết. Quy ước an toàn: khai báo ràng buộc là `readonly ...[]` nếu hàm không sửa đầu vào.

## Tricks & tips thực tế

- **Dùng `satisfies` cho object config thay vì chú thích `: Type`.** Lý do: giữ được kiểu hẹp (literal, tuple, khoá cụ thể) để suy ra kiểu khác từ nó, mà vẫn bị compiler kiểm tra.
- **Suy ra union từ config thay vì viết hai lần.** `type Level = keyof typeof LEVELS`. Lý do: thêm một mục vào object thì union tự cập nhật, không có chỗ để quên.
- **Dùng `as const` cho bảng tra tĩnh** (mã quốc gia, trạng thái, role). Lý do: đóng băng literal và biến mảng thành tuple, nên `[number]` cho ra union chính xác.
- **Đừng `as const` cho dữ liệu đến từ ngoài** (body request, kết quả DB). Lý do: `as const` chỉ là lời khẳng định lúc compile, không kiểm tra gì lúc chạy. Dữ liệu ngoài đi qua validate.
- **Đừng dùng `as` thay `satisfies` để "ép" kiểu config.** `{...} as Config` bỏ qua thiếu khoá/thừa khoá và có thể nói dối với compiler. `satisfies` báo lỗi đúng chỗ. Lý do: `as` là lời hứa, `satisfies` là kiểm tra.
- **Gặp lỗi `readonly` không gán được cho mutable**: sửa ở tham số nhận (`readonly T[]`) thay vì bỏ `as const`. Lý do: hàm nhận mảng mà không sửa nó nên khai báo `readonly` là đúng và rộng rãi hơn với người gọi.
- **Debug kiểu config**: gán thử `const _check: never = cfg;` để compiler in kiểu thực của `cfg` trong thông báo lỗi, hoặc rê chuột vào biến. Lý do: thấy ngay literal có bị mở rộng không.
- **`typeof` trên biến chỉ dùng được ở vị trí kiểu** (`type X = typeof cfg`). Lý do: `typeof` ở vị trí giá trị là toán tử runtime của JS và trả chuỗi `"object"`.
- **So với PHP/Laravel**: `config/*.php` trả mảng và bạn đọc bằng `config('app.x')` rồi không có kiểu nào ràng buộc. PHP 8.1 `enum` và `const` class gần với `as const`. `satisfies` giống việc Laravel có sẵn kiểm tra cấu trúc config mà PHP không cung cấp: lỗi chính tả khoá chỉ lộ ở runtime, còn TS bắt ở compile time.

## Liên hệ bài tập

Phần config của bài lab nên là một object khai báo một lần rồi suy ra kiểu từ nó. Hãy tự thử ba cách (chú thích, không kiểm tra, `satisfies`), so sánh kiểu suy ra khi rê chuột, và giải thích lại vì sao bạn chọn cách cuối cùng. Chú ý tuple/readonly khi truyền config vào hàm khác.

## Đọc thêm

- [`as const` (const assertions)](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-4.html#const-assertions)
- [The `satisfies` operator (TS 4.9)](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator)
- [`const` type parameters (TS 5.0)](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html#const-type-parameters)

## Ghi chú của bạn
