# 1. `keyof`, `typeof` và `as const`: lấy kiểu từ thứ đã có

Thay vì viết lại kiểu bằng tay, hãy **dẫn xuất** nó từ nguồn duy nhất: `keyof` lấy tập khoá của một kiểu, `typeof` lấy kiểu của một giá trị.

```ts
interface User { id: number; email: string; name?: string }
type UserKey = keyof User;                       // "id" | "email" | "name"

const ROLES = ["admin", "editor", "viewer"] as const;
type Role = (typeof ROLES)[number];              // "admin" | "editor" | "viewer"

function getField<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}
```

## Ý chính

- `keyof T` là **union các tên thuộc tính** của `T` (kiểu), không phải mảng, không tồn tại ở runtime.
- `typeof x` ở **vị trí kiểu** lấy kiểu của giá trị `x`. Đừng nhầm với `typeof x === "string"` ở vị trí biểu thức (toán tử runtime, Bài 1).
- `as const` đóng băng literal: object thành `readonly` với giá trị literal, mảng thành tuple `readonly`.
- Bộ ba `as const` + `typeof` + `[number]` / `keyof typeof` là cách chuẩn để **một nguồn dữ liệu duy nhất sinh ra cả giá trị runtime lẫn kiểu**.
- `K extends keyof T` là ràng buộc generic quen thuộc nhất của bài này: nó khiến tham số `key` chỉ nhận khoá có thật.

## Lý thuyết chi tiết

**`keyof` với các dạng kiểu khác nhau** (đã kiểm chứng với tsc 7.0.2):

```ts
type Dict = { [k: string]: number };
// keyof Dict là string | number  (vì obj[0] cũng hợp lệ trong JS)

type A = { a: 1; shared: 1 };
type B = { b: 1; shared: 1 };
// keyof (A | B) là "shared"                  -> union: chỉ khoá CHUNG
// keyof (A & B) là "a" | "b" | "shared"      -> intersection: hợp các khoá
```

Quy tắc dễ nhớ: một giá trị `A | B` chỉ chắc chắn có khoá chung, nên `keyof` của union là **giao** các khoá. Ngược lại `A & B` có mọi khoá của cả hai. Hệ quả thực tế: `Omit<Union, "x">` không phân phối, xem file 04.

**`typeof` chỉ nhận định danh (và truy cập thuộc tính), không nhận biểu thức.** Bạn có thể viết `typeof config`, `typeof config.db`, nhưng viết `typeof createUser("a", 1)` là lỗi cú pháp. Muốn kiểu trả về của hàm thì dùng `ReturnType<typeof createUser>`:

```ts
const defaultConfig = { port: 3000, host: "localhost", tls: false };
type Config = typeof defaultConfig;   // { port: number; host: string; tls: boolean }

function createUser(name: string, age: number) { return { name, age, active: true }; }
type CreatedUser = ReturnType<typeof createUser>;   // { name: string; age: number; active: boolean }
```

Chú ý `Config` ở trên có `port: number`, không phải `3000`: `const` trên object không đóng băng thuộc tính (object vẫn mutable). Đây là lúc cần `as const`.

**`as const` hoạt động ra sao.**

```ts
const HTTP = { ok: 200, notFound: 404 } as const;
// kiểu: { readonly ok: 200; readonly notFound: 404 }
type HttpName = keyof typeof HTTP;            // "ok" | "notFound"
type HttpCode = (typeof HTTP)[HttpName];      // 200 | 404
```

Với mảng, `as const` cho ra **tuple readonly**: `typeof ROLES` là `readonly ["admin", "editor", "viewer"]`. `[number]` (indexed access, file 02) lấy kiểu mọi phần tử ⇒ union literal.

**Chữ `keyof typeof`.** `keyof typeof obj` đọc từ phải sang trái: `typeof obj` lấy kiểu của giá trị, rồi `keyof` lấy khoá. Bạn phải viết `typeof` vì `keyof obj` cố tìm một *kiểu* tên `obj` và sẽ lỗi.

**`typeof` với enum và class.** `typeof Enum` là kiểu của object enum, nên `keyof typeof Level` ra các **tên** thành viên (`"Low" | "High"`), còn `Level` đứng một mình là kiểu giá trị. `typeof Mailer` là kiểu của *constructor*; kiểu instance lấy bằng `InstanceType<typeof Mailer>` hoặc đơn giản là `Mailer`.

**So sánh với PHP/Laravel.** PHP không có khái niệm "kiểu dẫn xuất từ giá trị". Gần nhất là `Mailer::class` hay `array_keys($config)` ở runtime, còn trong TS `keyof`/`typeof` chạy hoàn toàn lúc biên dịch và bị xoá khi chạy. Cái PHP phải làm bằng enum backed + `cases()` thì TS làm được bằng một mảng `as const`.

**`keyof` trên mảng, tuple và chuỗi** (đã kiểm chứng):

```ts
// keyof string[]   gồm number và mọi tên method: "length" | "push" | "pop" | ... (hợp lệ: const k: keyof string[] = 0)
// keyof "abc"      là các khoá của String: "toUpperCase", "length", number, ...
type Tup = [string, number];
// Extract<keyof Tup, `${number}`> là "0" | "1"             -> lấy đúng các chỉ số của tuple
// Exclude<keyof Tup, keyof unknown[]> là "0" | "1"
```

Lý do: mảng/tuple là object có chỉ số số và cả method của `Array`. Vì vậy `keyof` trên kiểu mảng hiếm khi là thứ bạn muốn; nếu cần "các vị trí của tuple" thì lọc bằng template literal như trên. Truy cập vượt chỉ số tuple là lỗi biên dịch (TS2493: "Tuple type '[string, number]' of length '2' has no element at index '2'"), khác với mảng thường.

**Ba cách "ghim" literal và khác biệt của chúng.**

| Cách viết | Kết quả với `{ kind: "a" }` | Ghi chú |
|---|---|---|
| `const x = { kind: "a" }` | `{ kind: string }` | thuộc tính bị widen |
| `const x = { kind: "a" } as const` | `{ readonly kind: "a" }` | literal + readonly, không kiểm tra theo kiểu đích |
| `const x = { kind: "a" } satisfies T` | giữ literal, **kiểm tra** theo `T` | không đổi kiểu của `x` thành `T` (TS 4.9+) |
| `const x: T = { kind: "a" }` | đúng `T` | mất literal cụ thể nếu `T` rộng hơn |

`as const` chỉ nhận **literal** (chuỗi, số, boolean, mảng/object literal, enum member). Áp lên lời gọi hàm bị TS1355: "A 'const' assertion can only be applied to references to enum members, or string, number, boolean, array, or object literals." Vì thế `["a", "b"].map(...) as const` là lỗi, và biến đã widen (`let lv = "x"`) thì `{ lv } as const` vẫn là `{ readonly lv: string }`.

**`keyof any` và khoá hợp lệ của object.** `keyof any` là `string | number | symbol`, chính là `PropertyKey`. Khi viết helper chấp nhận "bất kỳ khoá nào" hãy dùng `PropertyKey` thay vì `string`.

## Tricks & tips thực tế

- **Dùng mảng `as const` thay vì viết union tay rồi lặp lại danh sách.** Lý do: một nguồn sự thật. Thêm `"owner"` vào mảng thì union kiểu *và* mọi chỗ lặp qua `ROLES` tự cập nhật; viết union và mảng riêng thì sẽ lệch nhau.
- **Type guard cho dữ liệu chưa tin cậy từ mảng `as const`.** `ROLES.includes(x)` lỗi khi `x: string` vì tuple literal chỉ nhận literal. Ép mảng sang `readonly string[]` ở đúng một chỗ:

  ```ts
  function isRole(x: string): x is Role {
    return (ROLES as readonly string[]).includes(x);
  }
  ```

  Lý do: đây là ranh giới giữa dữ liệu ngoài (`string` từ query, header) và kiểu đã biết; gói ép kiểu vào một hàm có tên giúp mọi nơi khác không cần `as`. Bài 9 sẽ thay bằng Zod.
- **`as const object` thay cho `enum` (ưu tiên khi viết mới).** `enum` số có hành vi ngược (reverse mapping), sinh code runtime riêng và khó dùng với `isolatedModules`/chạy trực tiếp bằng công cụ strip-types. Object `as const` là JS thuần, vẫn cho kiểu union literal. Đây là quy ước phổ biến nhưng không bắt buộc; enum chuỗi vẫn dùng được.
- **Hàm có `K extends keyof T`**: đừng khai báo `key: string` rồi ép `obj[key as keyof T]`. Ràng buộc generic cho kiểu trả về `T[K]` chính xác theo từng lời gọi (ví dụ `getField(u, "id")` ra `number`), còn `string` thì mất thông tin và buộc phải `as`.
- **Lấy kiểu của config để truyền đi**: `type Config = typeof defaultConfig` rồi viết hàm `merge(base: Config, patch: Partial<Config>)`. Lý do: tránh khai báo `interface Config` song song với object mặc định rồi để hai cái lệch nhau. Nếu config cần kiểm tra thêm, dùng `satisfies` (Bài 7).
- **Cạm bẫy `keyof` + `string | number | symbol`.** `keyof T` có thể gồm cả `number` và `symbol`. Khi ghép vào template literal (file 03 của Bài 6) bạn phải lọc: `K & string`. Lỗi gặp: "Type 'symbol' is not assignable to type 'string | number | ...'".
- **Debug kiểu**: viết `type Show = typeof X;` rồi di chuột (hover) lên `Show` trong editor, hoặc gán thử `const _: number = x as Show` để xem thông điệp lỗi in kiểu đầy đủ. `readonly` và `literal` hay bị bỏ qua nếu quên `as const`; nếu union ra `string` thay vì literal, hầu như luôn là thiếu `as const`.
- **`as const` không đóng băng ở runtime.** Nó chỉ tác động lên kiểu. Muốn chặn sửa thật sự dùng `Object.freeze` (nông). Lý do: `as const` bị xoá hoàn toàn khi biên dịch.

## Liên hệ bài tập

Bài lab dùng `keyof` để ràng buộc tham số khoá của `MyPick` (gợi ý: khoá được chọn phải là tập con của khoá của kiểu gốc) và để duyệt các khoá ở `MyReadonly` và `Getters<T>`. Trước khi viết, tự trả lời: `keyof` của kiểu bạn truyền vào cho ra union gì? Thử với kiểu có thuộc tính optional và kiểu có `readonly`.

## Đọc thêm

- [Keyof Type Operator](https://www.typescriptlang.org/docs/handbook/2/keyof-types.html)
- [Typeof Type Operator](https://www.typescriptlang.org/docs/handbook/2/typeof-types.html)
- [Const assertions](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-4.html#const-assertions) (TS 3.4+)

## Ghi chú của bạn

