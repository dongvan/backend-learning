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

## Liên hệ bài tập

Contract tạo Order của bài lab cần mô tả việc tạo có thể thất bại thế nào. Hãy tự liệt kê: lỗi nào là "dự kiến" (client có thể sửa và gửi lại) và lỗi nào là bất thường? Với từng lỗi dự kiến, nó nên là một nhánh của union lỗi mang dữ liệu gì (ví dụ item nào hết hàng)? Rồi quyết định hàm tạo order trả `Result` hay ném, và bạn cần quy ước nào cho cả bài.

## Đọc thêm

- [TypeScript: Narrowing (discriminated unions, exhaustiveness)](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
- [TypeScript: Everyday Types (union types)](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#union-types)
- [MDN: `try...catch`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/try...catch)

## Ghi chú của bạn

