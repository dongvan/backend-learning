# 2. `Record`, `Exclude`, `Extract`, `NonNullable`

`Record` dựng object từ tập khoá; `Exclude`/`Extract`/`NonNullable` lọc **union**, không phải object.

```ts
type Role = "admin" | "editor" | "viewer";

const perms: Record<Role, string[]> = {
  admin: ["read", "write", "delete"],
  editor: ["read", "write"],
  viewer: ["read"],
};   // thiếu một vai trò là lỗi biên dịch

type Ev = "created" | "updated" | "deleted";
type NotDeleted = Exclude<Ev, "deleted">;   // "created" | "updated"
type OnlyCU = Extract<Ev, "created" | "updated" | "zzz">;   // "created" | "updated"
type NN = NonNullable<string | number | null | undefined>;  // string | number
```

## Ý chính

- `Record<K, V>` = object có đúng các khoá `K`, mỗi khoá kiểu `V`. Khoá là union literal thì **bắt buộc đủ khoá** (exhaustive); khoá là `string` thì là bảng tra tuỳ ý.
- `Exclude<U, X>` bỏ khỏi union `U` các thành viên gán được cho `X`; `Extract<U, X>` giữ các thành viên đó; `NonNullable<T>` bỏ `null` và `undefined`.
- Ba cái này là **conditional type phân phối** qua từng thành viên của union (Bài 6).
- `Record<string, V>` với `noUncheckedIndexedAccess` cho `V | undefined` khi đọc: kiểu trung thực hơn.
- Dùng `Extract` với discriminated union để chọn nhánh theo tag.

## Lý thuyết chi tiết

**`Record` cho bảng tra đầy đủ.** Cùng ý tưởng với `Record` ở bài exhaustive check (Bài 2): thêm một vai trò vào `Role`, mọi `Record<Role, ...>` báo lỗi ngay.

```ts
const perms2: Record<Role, string[]> = { admin: [], editor: [] };   // Lỗi: thiếu viewer
```

**`Record<string, V>` và `noUncheckedIndexedAccess`.**

```ts
const byId: Record<string, number> = { a: 1 };
const v = byId["a"];       // number | undefined
const vv: number = v;      // Lỗi: possibly undefined
```

Nếu khoá chỉ có một vài giá trị có thể thiếu, kết hợp với `Partial`:

```ts
const partialMap: Partial<Record<Role, number>> = { admin: 1 };
partialMap.viewer;   // number | undefined
```

Hai cạm bẫy nhỏ: `Record<string, never>` thường được dùng để biểu diễn "object rỗng", nhưng đọc khoá bất kỳ ra `never`/`undefined` trông rất lạ; nếu bạn cần object rỗng, nghĩ lại thiết kế. Và `Record<number, V>` chấp nhận khoá số, kể cả khi runtime khoá luôn là chuỗi.

**Phân phối của `Exclude`/`Extract`.** `Exclude<"a" | "b", "a">` được tính từng thành viên: `"a" extends "a" ? never : "a"` ra `never`, `"b" extends "a" ? never : "b"` ra `"b"`, gộp lại thành `"b"`. Nên:

```ts
type S = Exclude<string, "a">;   // vẫn là string
const s: S = "a";                // OK! string không phải union literal nên không loại được "a"
```

`Exclude` chỉ loại được thành viên của union, không loại giá trị khỏi kiểu rộng như `string`.

**Chọn nhánh trong discriminated union.**

```ts
type Msg = { type: "a"; x: number } | { type: "b"; y: string };
type MsgA = Extract<Msg, { type: "a" }>;       // { type: "a"; x: number }
type MsgNotA = Exclude<Msg, { type: "a" }>;    // { type: "b"; y: string }
```

`Extract<Msg, { type: "a" }>` giữ nhánh nào gán được cho `{ type: "a" }`: nhánh có `type: "a"` (và thừa thuộc tính khác, vẫn gán được vì structural typing). Rất hữu ích để dẫn xuất payload của từng sự kiện từ một union chung thay vì khai báo lại.

**Lọc bằng template literal.**

```ts
type Routes = "GET /a" | "POST /a" | "GET /b";
type Gets = Extract<Routes, `GET ${string}`>;   // "GET /a" | "GET /b"
```

**`NonNullable` và type guard.** `NonNullable<T>` từ TS 4.8 được định nghĩa là `T & {}` (trước đó là conditional type). Cả hai đều bỏ `null`/`undefined`:

```ts
const arr = [1, null, 2, undefined];
const clean = arr.filter((x): x is NonNullable<typeof x> => x != null);   // number[]
```

`filter(Boolean)` không thu hẹp kiểu (và còn loại luôn `0`, `""`), nên cần một type predicate như trên nếu bạn muốn `number[]`.

**Khoá theo kiểu giá trị** (kết hợp mapped type và `keyof`, giới thiệu trước Bài 5):

```ts
type Cfg = { port: number; host: string; debug: boolean };
type KeysOfType<T, V> = { [K in keyof T]: T[K] extends V ? K : never }[keyof T];
const k: KeysOfType<Cfg, string> = "host";
```

**Kết hợp với template literal để sinh tên.**

```ts
type Handlers = { [E in Ev as `on${Capitalize<E>}`]: () => void };
// { onCreated: () => void; onUpdated: () => void; onDeleted: () => void }
```

Cú pháp `as` trong mapped type (key remapping) cần TS 4.1+; sẽ học ở Bài 5.

## Tricks & tips thực tế

- **Dùng `Record<UnionKey, V>` thay cho `switch` khi chỉ tra bảng.** Lý do: thêm khoá mới vào union bắt buộc cập nhật bảng, và bảng ngắn hơn `switch`. Với logic phức tạp theo từng nhánh, vẫn dùng `switch` + `assertNever`.
- **Dùng `as const satisfies Record<K, V>` khi muốn vừa kiểm đủ khoá vừa giữ giá trị literal (TS 4.9+).** Đã thử: `{ ... } satisfies Record<Status, string>` đơn thuần cho giá trị kiểu `string`; thêm `as const` thì `x.draft` có kiểu `"a"`. Chú thích `: Record<...>` thì cũng nới về `string`. Chọn tuỳ việc bạn cần kiểu hẹp ở chỗ dùng hay không.
- **Chọn `Map` thay `Record` khi khoá là dữ liệu động** (id người dùng, chuỗi từ request). Lý do: `Record<string, V>` là object thường nên khoá như `"__proto__"` hay `"constructor"` có thể gây nhầm lẫn/rủi ro prototype; `Map` không có vấn đề đó và có API rõ ràng (`has`, `get`).
- **Khoá `Record` nên là union hẹp, hạn chế `string`.** `Record<string, V>` mất lợi ích kiểm tra khoá; nếu thật sự cần tra bảng động, ghi chú rõ và nhớ xử lý `undefined`.
- **Dẫn xuất kiểu từ một union gốc** thay vì khai báo lại: `type Handled = Exclude<Ev, "deleted">` luôn đúng khi `Ev` thêm phần tử; khai báo lại bằng tay sẽ lệch dần.
- **Đừng dùng `Exclude` để "xoá" thuộc tính object.** Người mới hay nhầm `Exclude<Article, "id">` (nó làm việc trên union, kết quả vẫn là `Article`). Dùng `Omit` cho object.
- **`NonNullable` ở ranh giới.** Dùng sau khi đã kiểm tra thực sự (`if (x != null)`, type guard), không dùng `as NonNullable<T>` để "tắt" lỗi; nếu không, giá trị `null` vẫn chạy vào runtime và gây `TypeError`.
- **So với PHP:** `Record<Role, ...>` giống mảng cấu hình keyed bởi enum, nhưng PHP không kiểm tra đủ khoá. `NonNullable` tương ứng cách bạn loại `null` trước khi gọi method (`?->`, `??`), nhưng ở cấp kiểu.
- **Debug:** muốn biết `Exclude`/`Extract` ra gì, tạo `type Show = Extract<...>` rồi hover, hoặc gán sai cố ý vào một biến có kiểu đó để compiler liệt kê các thành viên còn lại trong lỗi.

## Liên hệ bài tập

Khi dẫn xuất DTO, thử dùng `Record` hoặc `Extract` ở chỗ có tập giá trị đóng (ví dụ trạng thái), thay vì nhắc lại literal. Hỏi bản thân: nếu thêm một giá trị vào union gốc, những kiểu nào tự cập nhật và những kiểu nào phải sửa tay?

## Đọc thêm

- [Utility Types: Record, Exclude, Extract, NonNullable](https://www.typescriptlang.org/docs/handbook/utility-types.html)
- [Conditional Types (distributive)](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types)
- [Mapped Types: key remapping via `as`](https://www.typescriptlang.org/docs/handbook/2/mapped-types.html#key-remapping-via-as)

## Ghi chú của bạn

