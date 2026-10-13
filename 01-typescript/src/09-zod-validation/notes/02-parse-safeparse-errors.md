# 2. `parse` vs `safeParse`, và `ZodError`

`parse` ném lỗi khi dữ liệu sai; `safeParse` trả về kết quả dạng discriminated union để bạn tự xử lý.

```ts
import { z } from "zod";

const Comment = z.object({ body: z.string().min(1), articleId: z.string() });

const r = Comment.safeParse({ body: "" });
if (r.success) {
  r.data;   // { body: string; articleId: string }
} else {
  r.error;  // ZodError, r.data không tồn tại ở nhánh này
}
```

## Ý chính

- `schema.parse(x)`: trả dữ liệu đã parse, hoặc **ném `ZodError`**. Hợp khi lỗi là tình huống bất thường và có một chỗ bắt chung.
- `schema.safeParse(x)`: không ném, trả `{ success: true; data } | { success: false; error }`. Hợp khi sai input là chuyện bình thường (form, API công khai) và bạn muốn xử lý tại chỗ.
- `ZodError` là lớp con của `Error`, chứa mảng `issues`. Mỗi issue có `code`, `path`, `message` và vài trường riêng tuỳ loại.
- Zod 4 có ba hàm định dạng lỗi: `z.flattenError`, `z.treeifyError`, `z.prettifyError`. Các phương thức cũ `error.format()` / `error.flatten()` của Zod 3 đã bị đánh dấu deprecated.
- `error.message` của `ZodError` là **chuỗi JSON của `issues`**, không phải câu đọc được. Đừng trả thẳng nó ra client.
- Message mặc định là tiếng Anh. Tuỳ biến bằng tham số `error`, hoặc đổi locale toàn cục.

## Lý thuyết chi tiết

**Hai kiểu trả về.** `safeParse` trả union phân biệt bằng `success`, đúng kiểu bạn đã học ở Bài 2: kiểm tra `r.success` thì TS thu hẹp được `r.data` hay `r.error`.

```ts
// Dạng ném: ngắn gọn khi có chỗ bắt tập trung
try {
  const c = Comment.parse(raw);
  // dùng c
} catch (e) {
  if (e instanceof z.ZodError) {
    // lỗi input, map ra 400
  } else {
    throw e; // lỗi khác, không nuốt
  }
}
```

`catch (e)` cho `e` kiểu `unknown` (bật bởi `strict`), nên `instanceof z.ZodError` vừa là kiểm tra runtime vừa là thu hẹp kiểu.

**Quên thu hẹp `success` không phải lỗi biên dịch, mà là `T | undefined`.** Ở Zod 4.6.5, kết quả `safeParse` khai báo `data` và `error` ở cả hai nhánh (nhánh sai có `data?: never`), nên:

```ts
const Query = z.object({ page: z.number() });
const r = Query.safeParse({});
const n: number = r.data;
// error TS2322: Type '{ page: number; } | undefined' is not assignable to type 'number'.
```

Nghĩa là truy cập `r.data` *được phép*, nhưng kiểu là `{ page: number } | undefined` (đã kiểm bằng `tsc`). Compiler vẫn buộc bạn xử lý `undefined` trước khi dùng như giá trị thật; nếu bạn "chữa" bằng `r.data!` hay `as`, bạn đã tắt đúng lớp bảo vệ. Chữa đúng là `if (!r.success) { ... return }` rồi dùng `r.data`. (Câu "`r.data` không tồn tại" ở ví dụ đầu file nên hiểu là "không có giá trị ở nhánh lỗi".)

**`parse` trả về object mới, không sửa input.** Đã chạy: kết quả khác tham chiếu với input, kể cả object lồng nhau (`out.o !== input.o`), và input gốc nguyên vẹn (khoá thừa vẫn còn trong input). Hệ quả: so sánh `result === input` luôn sai, và sau khi parse bạn phải dùng `result` chứ không dùng input (xem file 4).

**Phân biệt `ZodError` của input với bug ném từ callback.** Nếu `refine`/`transform` tự ném lỗi (ví dụ `TypeError`), lỗi đó *không* bị gói thành `ZodError` mà thoát nguyên vẹn (đã chạy). Vì vậy `catch (e) { if (e instanceof z.ZodError) ... else throw e }` đúng nghĩa: nhánh `else` là bug thật.

**Các thông báo mặc định hay gặp** (đã chạy, tiếng Anh; dùng để nhận diện, đừng dựa vào chuỗi):

| Input sai | `code` | `message` |
|---|---|---|
| thiếu trường (`undefined`) với `z.string()` | `invalid_type` | `Invalid input: expected string, received undefined` |
| `null` với `z.string()` | `invalid_type` | `Invalid input: expected string, received null` |
| `[]` với `z.array(...).min(1)` | `too_small` | `Too small: expected array to have >=1 items` |
| giá trị ngoài `z.enum` | `invalid_value` | `Invalid option: expected one of "admin"\|"member"` |
| `z.union` không nhánh nào khớp | `invalid_union` | `Invalid input` (kèm `errors`: mảng lỗi của từng nhánh) |

Chú ý `invalid_union` của `z.union`: message chung chung, lỗi chi tiết nằm trong `issue.errors` (mảng các mảng issue). Ví dụ `z.union([z.string(), z.number()]).safeParse(true)` cho một issue duy nhất có `errors` gồm hai mảng. Đây là lý do `z.discriminatedUnion` cho lỗi dễ đọc hơn (file 4).

**Chọn cái nào?**

| Tình huống | Chọn |
|---|---|
| Biến môi trường lúc khởi động | `parse` (sai thì chết luôn, đúng ý) |
| Controller/handler cần trả 400 có chi tiết | `safeParse` rồi map, hoặc `parse` kèm một error handler chung |
| Dữ liệu nội bộ lẽ ra không thể sai | `parse`: sai là bug, ném lỗi to |
| Dữ liệu người dùng nhập | `safeParse` |

Không có quy tắc tuyệt đối; điều quan trọng là **một** chỗ chuyển `ZodError` thành lỗi của contract (xem Bài 10).

**Cấu trúc issue** (đã chạy thật với Zod 4.6.5):

```ts
const User = z.object({
  email: z.email(),
  password: z.string().min(8, { error: "Mật khẩu tối thiểu 8 ký tự" }),
  age: z.number().int().min(18).optional(),
});

const bad = User.safeParse({ email: "x", password: "123", age: "20" });
// bad.error.issues:
// [
//   { origin: "string", code: "invalid_format", format: "email", pattern: "...", path: ["email"],
//     message: "Invalid email address" },
//   { origin: "string", code: "too_small", minimum: 8, inclusive: true, path: ["password"],
//     message: "Mật khẩu tối thiểu 8 ký tự" },
//   { expected: "number", code: "invalid_type", path: ["age"],
//     message: "Invalid input: expected number, received string" },
// ]
```

`path` là mảng khoá/chỉ số (`["tags", 0, "name"]`), `code` là mã máy đọc được (`invalid_type`, `too_small`, `too_big`, `invalid_format`, `custom`, `unrecognized_keys`, `invalid_union`, ...). Thiết kế contract nên dựa vào `path` và `code`, không dựa vào `message` tiếng Anh.

**Ba cách định dạng (Zod 4).**

```ts
const err = bad.error!; // chỉ để minh hoạ; code thật hãy thu hẹp bằng bad.success

z.prettifyError(err);
// ✖ Invalid email address
//   → at email
// ✖ Mật khẩu tối thiểu 8 ký tự
//   → at password
// ✖ Invalid input: expected number, received string
//   → at age
// (dùng cho log/CLI cho người đọc)

z.flattenError(err);
// { formErrors: [], fieldErrors: { email: ["Invalid email address"], password: [...], age: [...] } }
// (hợp với form phẳng: mỗi trường một mảng message)

z.treeifyError(err);
// { errors: [], properties: { email: { errors: ["Invalid email address"] }, password: {...}, age: {...} } }
// (giữ cấu trúc lồng của object/array)
```

**Cạm bẫy của `flattenError` với dữ liệu lồng nhau.** Nó chỉ phẳng hoá cấp một: mọi lỗi sâu hơn bị gom vào khoá cấp đầu và **mất đường dẫn**. Ví dụ đã chạy:

```ts
const Article = z.object({
  title: z.string().min(1),
  tags: z.array(z.object({ name: z.string().min(2) })).max(2),
});
const r2 = Article.safeParse({ title: "", tags: [{ name: "a" }, { name: "bb" }, { name: "c" }] });
// z.flattenError(r2.error!).fieldErrors.tags ===
//   ["Too small: expected string to have >=2 characters",
//    "Too small: expected string to have >=2 characters",
//    "Too big: expected array to have <=2 items"]
// Không biết lỗi nào của phần tử số mấy
```

`z.treeifyError` giữ được `tags.items[0].properties.name`, nhưng phần tử hợp lệ ở giữa xuất hiện là `null`. Cách chắc chắn nhất là **tự map từ `issues`**: `path` vẫn đầy đủ.

```ts
const details = r2.error?.issues.map((i) => ({
  path: i.path.join("."),   // "tags.0.name"
  code: i.code,
  message: i.message,
}));
```

Khi `path` có `symbol` (hiếm), `join` sẽ lỗi; với input JSON thì path chỉ gồm chuỗi và số nên an toàn.

**Tuỳ biến message (Zod 4).** Tham số là `error` (Zod 3 dùng `message`). Dạng chuỗi ngắn vẫn chạy:

```ts
z.string().min(1, { error: "Bắt buộc" });    // dạng object, khuyến nghị
z.string().min(1, "Bắt buộc");               // dạng chuỗi, vẫn hoạt động (đã chạy)
z.string({ error: (iss) => (iss.input === undefined ? "Bắt buộc" : "Phải là chuỗi") });
```

Hàm `error` nhận issue, nên phân biệt được "thiếu" (`input === undefined`) với "sai kiểu". Locale: `z.config(z.locales.vi())` đổi message mặc định sang tiếng Việt (đã chạy: `"Đầu vào không hợp lệ: mong đợi string, nhận được số"`). Đây là cấu hình **toàn cục**, đặt một lần ở điểm khởi động.

**Bất đồng bộ.** Schema có `refine`/`transform` async phải dùng `parseAsync` / `safeParseAsync`. Gọi `parse` đồng bộ sẽ ném lỗi `Encountered Promise during synchronous parse. Use .parseAsync() instead.` (đã chạy). Ví dụ điển hình là kiểm tra "email đã tồn tại" bằng DB ngay trong schema; cân nhắc làm ở service thay vì schema (xem tips).

**So sánh với Laravel.** Laravel trả `422` kèm `{ message, errors: { field: [msgs] } }` — gần giống `flattenError`, và cũng bị phẳng với khoá lồng kiểu `tags.0.name` (Laravel dùng dấu chấm). Zod không tự trả HTTP; bạn tạo chính xác hình dạng mong muốn từ `issues`.

## Tricks & tips thực tế

- **Dùng `safeParse` ở rìa HTTP và viết một hàm chuyển `ZodError` thành lỗi của contract.** Lý do: handler không bị đầy `try/catch`, và mọi endpoint trả lỗi cùng một hình dạng.
- **Trả `path` + `code` cho client, `message` chỉ để hiển thị.** Lý do: front-end đổi ngôn ngữ/đổi cách hiển thị dựa trên `code`; chuỗi message đổi giữa các phiên bản Zod.
- **Không `res.json(error)` hay `error.message` ra client.** Lý do: lộ cấu trúc nội bộ, regex, tên trường; xem thêm Bài 10.
- **Gặp `ZodError` ở chỗ không ngờ thì in `z.prettifyError(e)`.** Lý do: `console.log(e)` in JSON dài khó đọc, `prettifyError` ra từng dòng kèm vị trí.
- **Đừng `catch { }` rỗng quanh `parse`.** Lý do: nuốt luôn lỗi lập trình (bug) lẫn lỗi input.
- **Kiểm tra email trùng, tồn tại khoá ngoại ở service/DB, không ở schema.** Lý do: schema nên thuần (không I/O), test nhanh, parse đồng bộ; còn race condition giữa "kiểm tra" và "ghi" chỉ unique index mới giải quyết triệt để.
- **Chú ý khác biệt Zod 3 → 4 khi copy code mạng**: `z.string().email()` thành `z.email()` (bản cũ vẫn chạy nhưng deprecated); `message` thành `error`; `error.format()` / `error.flatten()` thành `z.treeifyError` / `z.flattenError`; `.passthrough()` thành `z.looseObject()` / `.loose()`. Lý do: tài liệu cũ còn nhiều, và API deprecated sẽ bị gỡ ở bản sau.
- **Đặt `z.config(z.locales.vi())` chỉ khi sản phẩm hướng người dùng Việt.** Lý do: API cho máy gọi nên giữ `code`; message cố định ngôn ngữ làm log khó tra cứu.

## Liên hệ bài tập

Trong lab, thử gửi input sai nhiều chỗ cùng lúc (thiếu trường, sai kiểu, mảng items có một phần tử lỗi) và quan sát từng `issue`. Tự hỏi: nếu mình cần báo cho client "item thứ 2, trường quantity sai", thông tin đó nằm ở đâu trong `issues`, và hàm định dạng nào làm mất nó?

## Đọc thêm

- [Zod: Error formatting](https://zod.dev/error-formatting)
- [Zod: Customizing errors](https://zod.dev/error-customization)
- [Zod: Basic usage (parse / safeParse)](https://zod.dev/basics)

## Ghi chú của bạn

