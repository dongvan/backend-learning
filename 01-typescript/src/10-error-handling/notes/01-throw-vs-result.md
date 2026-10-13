# 1. `throw` hay `Result<T, E>`: hai cách nói "việc này có thể thất bại"

`throw` đẩy lỗi lên ngoài chữ ký hàm (compiler không biết); `Result<T, E>` đưa lỗi **vào kiểu trả về** để compiler buộc bạn xử lý.

```ts
type Ok<T> = { ok: true; value: T };
type Err<E> = { ok: false; error: E };
type Result<T, E> = Ok<T> | Err<E>;

const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
const err = <E>(error: E): Err<E> => ({ ok: false, error });

type TitleError = { kind: "empty" } | { kind: "too_long"; max: number };

function parseTitle(raw: string): Result<string, TitleError> {
  const t = raw.trim();
  if (t === "") return err({ kind: "empty" });
  if (t.length > 80) return err({ kind: "too_long", max: 80 });
  return ok(t);
}

const r = parseTitle("  hi ");
if (r.ok) {
  r.value.toUpperCase(); // "HI"
} else {
  r.error.kind;          // "empty" | "too_long"
}
```

## Ý chính

- Chữ ký `function f(): User` **không nói** nó có thể ném. TypeScript không có "checked exception" như Java: không cách nào khai báo hay ép bên gọi xử lý lỗi ném ra.
- `Result<T, E>` là discriminated union (Bài 2) với khoá `ok`. Bên gọi phải thu hẹp `r.ok` mới lấy được `value` (đã kiểm: truy cập `r.value` khi chưa thu hẹp là lỗi biên dịch).
- Dùng `Result` cho **lỗi dự kiến, thuộc nghiệp vụ** (email đã tồn tại, hết hàng, input sai). Dùng `throw` cho **lỗi bất thường/bug/hạ tầng** (mất kết nối DB, invariant bị phá).
- Hai cách không loại trừ nhau. Ranh giới là nơi chuyển đổi: `try/catch` bọc API ném lỗi để thành `Result`; hoặc `Result` thất bại được chuyển thành HTTP status.
- Điều quan trọng không phải chọn cách nào mà là **nhất quán** trong một lớp, và kiểu lỗi `E` được thiết kế có chủ đích.

## Lý thuyết chi tiết

**Vì sao `throw` không an toàn về kiểu.**

```ts
function findUser(id: string): { id: string } {   // chữ ký nói "luôn trả user"
  if (id === "") throw new Error("empty id");     // nhưng thực tế có thể ném
  return { id };
}
```

Compiler không phát hiện được: ai gọi `findUser` cũng không bị nhắc xử lý. Thêm một loại lỗi mới (`UserBannedError`) thì không có chỗ nào báo lỗi biên dịch. Lỗi chỉ lộ ở runtime, hoặc không bao giờ lộ ra cho tới khi sập production. Ngoài ra bên bắt lỗi (`catch`) nhận `unknown` nên mất cả thông tin kiểu (xem file 2).

**`Result` buộc xử lý, và lỗi trở thành dữ liệu có kiểu.** Union `E` liệt kê chính xác các tình huống thất bại; bên gọi dùng `switch` + exhaustive check (Bài 2) để mọi lỗi mới đều lộ ra ở các nơi tiêu thụ:

```ts
function messageOf(e: TitleError): string {
  switch (e.kind) {
    case "empty": return "Tiêu đề bắt buộc";
    case "too_long": return `Tối đa ${e.max} ký tự`;
  }
}
```

**Biến đổi và nối `Result`** (không cần thư viện cho nhu cầu cơ bản):

```ts
function map<T, U, E>(r: Result<T, E>, f: (v: T) => U): Result<U, E> {
  return r.ok ? ok(f(r.value)) : r;
}

function andThen<T, U, E, F>(r: Result<T, E>, f: (v: T) => Result<U, F>): Result<U, E | F> {
  return r.ok ? f(r.value) : r;
}
```

`andThen` hợp nhiều bước, mỗi bước có thể lỗi với kiểu khác nhau; kiểu lỗi tổng là hợp (`E | F`). Đã biên dịch và chạy. Chú ý `return r` ở nhánh lỗi hợp lệ về kiểu vì `Err<E>` thu hẹp được thành `Result<U, E>`.

**Các thông báo lỗi bạn sẽ gặp khi dùng `Result`** (đã chạy với `tsc` 7.0.2 và `tsconfig.json` của repo; `CartError` là union lỗi bất kỳ của bạn):

```ts
declare function checkout(): Result<number, CartError>;
declare function checkoutAsync(): Promise<Result<number, CartError>>;

const r = checkout();
r.value;
// error TS2339: Property 'value' does not exist on type 'Result<number, CartError>'.
//   -> chưa thu hẹp bằng `if (r.ok)`

async function g() {
  const p = checkoutAsync();          // quên await
  if (p.ok) return p.value;
  // error TS2339: Property 'ok' does not exist on type 'Promise<Result<number, CartError>>'.
  return 0;
}

function save(): Result<void, CartError> { return ok(); }
// error TS2554: Expected 1 arguments, but got 0.   -> phải viết ok(undefined)

const bad: Result<number, CartError> = err({ kind: "nope" });
// error TS2322: Type 'Err<{ kind: "nope"; }>' is not assignable to type 'Result<number, CartError>'.
```

Lỗi cuối đọc khó: đầy đủ nó gồm bốn dòng và dòng cuối là `Property 'sku' is missing in type '{ kind: "nope"; }' but required in type '{ kind: "item_unavailable"; sku: string; }'`. Compiler thử khớp với nhánh `item_unavailable` của union và báo thiếu `sku`, trong khi lỗi thật là `"nope"` không phải một `kind` hợp lệ. Khi gặp lỗi dài kiểu này với union, hãy nhìn **giá trị tag** bạn viết trước, đừng chữa theo dòng cuối.

Ngữ cảnh kiểu quan trọng khi tạo lỗi. `const e1: Result<number, CartError> = err({ kind: "empty" })` biên dịch được vì kiểu đích giữ literal `"empty"`. Nhưng tách ra biến trung gian không có kiểu: `const w = err({ kind: "empty" }); const e2: Result<number, CartError> = w;` báo `TS2322` vì `w` có kiểu `Err<{ kind: string }>` (tag bị mở rộng thành `string`, xem Bài 2). Sửa: gán kiểu cho `w`, viết `err<CartError>(...)`, hoặc để `err(...)` nằm thẳng ở vị trí `return`.

**Narrowing bằng destructuring.** `const { ok: isOk } = res; if (isOk) return res.value;` hợp lệ từ TS 4.6 (kiểu thu hẹp được qua biến discriminant `const` được destructure; đã kiểm). Nhưng `const { ok, value, error } = res` *lấy* `value`/`error` thì báo `TS2339` vì chưa thu hẹp lúc destructure (đã kiểm). Cách viết gọn an toàn nhất vẫn là `if (r.ok) { r.value } else { r.error }`.

**`noImplicitReturns` và `switch`.** Hàm nhận `CartError` rồi `switch` thiếu một nhánh, không có `default`, báo `TS2366: Function lacks ending return statement and return type does not include 'undefined'` (đã kiểm). Đó là cách compiler nhắc "lỗi mới chưa được xử lý" mà không cần `assertNever`. Với `if (...) return;` (không giá trị) lẫn `return value;` trong hàm có thể trả `undefined`, `noImplicitReturns` báo `TS7030: Not all code paths return a value`.

**Hai chiều của `async`: `Promise` reject và `Result` khác kênh, và `return` không `await` thoát khỏi `try`.**

```ts
async function noAwait(): Promise<string> {
  try { return fails(); } catch { return "caught"; }   // lỗi của fails() KHÔNG bị bắt ở đây
}
async function withAwait(): Promise<string> {
  try { return await fails(); } catch { return "caught"; }  // bị bắt
}
```

Đã chạy: `noAwait()` làm lời hứa reject (thoát khỏi `catch`), `withAwait()` trả `"caught"`. Lý do: `return promise` trả lời hứa đi, `try` đã kết thúc trước khi nó reject. Trong `try/catch`, hãy `return await`.

**`finally` có thể nuốt lỗi.** Một `return` trong `finally` ghi đè cả `throw` đang bay: `function f() { try { throw new Error("x"); } finally { return "swallowed"; } }` trả `"swallowed"` mà không ném gì (đã chạy). Chỉ dọn dẹp trong `finally`, đừng `return`/`throw` ở đó.

**Bọc API ném lỗi thành `Result`.** `JSON.parse` ném `SyntaxError`:

```ts
function tryParseJson(text: string): Result<unknown, { kind: "bad_json"; cause: unknown }> {
  try {
    return ok(JSON.parse(text));
  } catch (cause) {
    return err({ kind: "bad_json", cause }); // cause: unknown, giữ nguyên lỗi gốc để debug
  }
}
```

**Khi nào chọn cái nào.**

| Tình huống | Gợi ý | Lý do |
|---|---|---|
| Email đã đăng ký, hết tồn kho, ticket đã đóng | `Result` hoặc lỗi nghiệp vụ có kiểu | Xảy ra thường xuyên, bên gọi phải quyết định |
| Mất kết nối DB, timeout, bug (null không ngờ) | `throw` | Bên gọi thường không xử lý được, để lên tầng trên (error handler) |
| Code nhiều bước phụ thuộc nhau, mỗi bước có lỗi riêng | `Result` | Tránh `try/catch` lồng, dòng chảy rõ ràng |
| Framework bắt lỗi chung (NestJS exception filter) | `throw` lỗi có kiểu | Hợp với cách framework hoạt động |
| Thư viện bên thứ ba ném sẵn | `throw`, bọc ở rìa | Không đối đầu với hệ sinh thái |

**Kiểu lỗi của `Result` nên là gì?** Hai lựa chọn: object thuần có `kind`/`code` (như trên) hoặc instance của class `Error` (file 2). Object thuần dễ serialize và so khớp trong `switch`; class `Error` có stack trace và hợp với `throw`. Một mô hình thường dùng: lỗi nghiệp vụ là union discriminated trong `Result`, lỗi hạ tầng là `throw`.

**So sánh PHP/Laravel.** Laravel chủ yếu dùng exception (`ModelNotFoundException`, `ValidationException`) và để `Handler` map ra HTTP. PHP không có `Result` chuẩn; docblock `@throws` chỉ là tài liệu, IDE nhắc nhưng engine không ép. TypeScript cho bạn lựa chọn thứ hai (Result) với kiểm tra tĩnh thật sự. Rust (`Result`), Go (`value, err`) là nơi ý tưởng này phổ biến.

## Tricks & tips thực tế

- **Dùng `ok: true/false` (boolean literal) làm khoá phân biệt.** Lý do: ngắn, đọc tự nhiên (`if (r.ok)`), và thu hẹp kiểu hoạt động tốt. Nhớ bật `strict` để `ok` là kiểu literal chứ không phải `boolean` rộng.
- **Chỉ gán kiểu `E` là union hẹp, không phải `Error` hay `unknown`.** Lý do: `Result<T, Error>` không cho compiler biết có những lỗi nào, mất toàn bộ lợi ích.
- **Đừng trộn: hàm vừa trả `Result` vừa ném lỗi nghiệp vụ.** Lý do: bên gọi phải nhớ cả hai cách xử lý; chọn một quy ước cho lỗi nghiệp vụ.
- **Ở nhánh lỗi giữ thông tin gốc (`cause`) khi bọc lỗi.** Lý do: log về sau cần biết lỗi gốc, đặc biệt khi thất bại do hạ tầng (file 3).
- **Không lạm dụng `Result` cho mọi hàm.** Lý do: hàm thuần không thể thất bại nghiệp vụ (cộng hai số) mà trả `Result` chỉ tạo nghi thức vô nghĩa; code dài và khó đọc.
- **Với async: `Promise<Result<T, E>>`, và `await` rồi kiểm `ok`.** Lý do: `Promise` reject là kênh riêng cho lỗi bất thường; `Result` là kênh cho lỗi dự kiến. Cạm bẫy: quên `await` rồi kiểm `.ok` trên Promise (luôn `undefined`) thì compiler sẽ báo lỗi thuộc tính không tồn tại, hãy đọc kỹ thông báo.
- **Debug "lỗi lọt đi mà không ai xử lý"**: tìm các `catch (e) { /* trống */ }` và `.catch(() => {})`. Lý do: nuốt lỗi khiến hệ thống tiếp tục chạy với trạng thái sai.
- **Thử kiểm tra tay**: thêm một biến thể vào union lỗi, chạy `npm run type-check` và xem các `switch` báo lỗi ở đâu (giống Bài 2). Nếu không chỗ nào báo thì chỗ nào đó đang dùng `default` che lỗi.
- **Đừng vội thêm thư viện Result** (`neverthrow`, `ts-results`, `effect`). Lý do: dự án học này không thêm dependency ngoài nhu cầu; hai type và vài hàm nhỏ đủ để hiểu cơ chế, sau đó mới đánh giá thư viện.

- **Trong `try/catch` của hàm async luôn `return await`.** Lý do: `return promise` không `await` làm lỗi thoát khỏi `try`, `catch` không bao giờ chạy (đã chạy, xem trên). Quy tắc lint `@typescript-eslint/return-await` kiểm việc này (repo không có lint; đây là gợi ý).
- **Một lời hứa reject không ai xử lý làm sập tiến trình Node 24.** Đã chạy: `Promise.reject(new Error("boom"))` không có `catch` làm tiến trình thoát mã `1` và in stack; `Promise.reject("oops")` (không phải `Error`) sinh `UnhandledPromiseRejection` với `code: 'ERR_UNHANDLED_REJECTION'`. Lý do cần `Result` hoặc `try/catch` ở ranh giới: lỗi async quên xử lý là lỗi sập dịch vụ, không phải lỗi "một request".
- **Kiểu của `ok`/`err` dùng hàm tạo thay vì literal rải rác.** Lý do: một chỗ viết `{ ok: true, value }`, ít cơ hội gõ nhầm `okay: true`; compiler bắt nhầm tag ngay.

## Liên hệ bài tập

Contract tạo Order của bài lab cần mô tả việc tạo có thể thất bại thế nào. Hãy tự liệt kê: lỗi nào là "dự kiến" (client có thể sửa và gửi lại) và lỗi nào là bất thường? Với từng lỗi dự kiến, nó nên là một nhánh của union lỗi mang dữ liệu gì (ví dụ item nào hết hàng)? Rồi quyết định hàm tạo order trả `Result` hay ném, và bạn cần quy ước nào cho cả bài.

## Đọc thêm

- [TypeScript: Narrowing (discriminated unions, exhaustiveness)](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
- [TypeScript: Everyday Types (union types)](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#union-types)
- [MDN: `try...catch`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/try...catch)

## Ghi chú của bạn

