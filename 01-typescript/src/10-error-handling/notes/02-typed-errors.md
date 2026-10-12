# 2. Lỗi có kiểu: class `Error`, `instanceof`, `cause`, và `catch` là `unknown`

Tạo lớp lỗi riêng để phân biệt được "ticket không tồn tại" với "ticket đã đóng" bằng `instanceof`, và nhớ rằng thứ bạn bắt được trong `catch` **không có kiểu**.

```ts
class AppError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

class TicketNotFoundError extends AppError {
  constructor(readonly ticketId: string) {
    super(`Ticket ${ticketId} not found`);
  }
}

try {
  throw new TicketNotFoundError("t1");
} catch (e) {              // e: unknown
  if (e instanceof TicketNotFoundError) {
    e.ticketId;            // string: đã thu hẹp
  } else {
    throw e;               // không biết là lỗi gì thì đừng nuốt
  }
}
```

## Ý chính

- `catch (e)`: `e` có kiểu `unknown` (do `strict` bật `useUnknownInCatchVariables`). JavaScript cho phép `throw` **bất cứ thứ gì** (`throw "oops"`, `throw 404`), nên compiler không thể cho `e` kiểu `Error`.
- Thu hẹp bằng `instanceof` (kiểm tra runtime, thu hẹp kiểu) hoặc bằng hàm kiểm tra tự viết.
- Lớp lỗi riêng cho từng tình huống nghiệp vụ, kế thừa từ một lớp gốc của ứng dụng. Mang theo **dữ liệu có cấu trúc** (`ticketId`), không chỉ chuỗi message.
- `new Error(msg, { cause })` (ES2022, Node 16.9+) giữ **lỗi gốc** khi bọc. Dự án `target`/`lib` là `ES2022` nên dùng được.
- `instanceof` dựa vào chuỗi prototype lúc chạy, **không** dựa vào cấu trúc như TypeScript lúc biên dịch. Hai điều này có thể lệch nhau.
- `JSON.stringify(error)` không cho ra message/stack (xem dưới). Luôn tự chọn trường để ghi log hoặc trả client.

## Lý thuyết chi tiết

**Vì sao `catch` là `unknown`.** JavaScript không buộc thứ bị ném là `Error`:

```ts
try { throw "oops"; } catch (c) {
  c instanceof Error; // false
  typeof c;           // "string"
}
```

Lỗi cũng có thể xuất phát từ thư viện bên thứ ba (kiểu riêng), từ `Promise.reject(x)`, hay `JSON.parse` ném `SyntaxError`. Nếu bạn viết `catch (e: any)` hay `(e as Error).message`, bạn *hứa* điều không chắc. Cách chuẩn hoá:

```ts
function toError(x: unknown): Error {
  return x instanceof Error ? x : new Error(String(x), { cause: x });
}
```

**Lớp gốc và `name`.** Đặt `this.name = new.target.name` để `name` luôn là tên lớp con thật, nên log và stack đọc được (`TicketNotFoundError: Ticket t1 not found`, đã chạy). `new.target` là lớp đang được `new`, nên tự đúng cho mọi lớp con mà không phải lặp lại `name` ở từng lớp.

Về `Object.setPrototypeOf(this, new.target.prototype)`: bạn sẽ gặp nó trong các hướng dẫn cũ khi `target` là ES5. Với `target: "ES2022"` (như `tsconfig.json` của repo) lớp con của `Error` hoạt động đúng, `instanceof` đã chạy đúng và **không cần** dòng đó. Nếu một ngày hạ `target` xuống ES5, hãy nhớ lại.

**Kiểm tra bằng `instanceof`** (đã chạy):

```ts
const e = new TicketNotFoundError("t1");
e instanceof TicketNotFoundError; // true
e instanceof AppError;            // true
e instanceof Error;               // true
```

Phân cấp lớp cho phép bắt theo mức độ: `instanceof AppError` bắt mọi lỗi nghiệp vụ, `instanceof TicketNotFoundError` bắt riêng một loại.

**Cạm bẫy: TypeScript so sánh cấu trúc, `instanceof` so sánh prototype.**

```ts
class A1 extends AppError { readonly code = "A" as const; }
class B1 extends AppError { readonly code = "A" as const; }

const a1: A1 = new B1("x"); // biên dịch được: hai lớp cùng cấu trúc
a1 instanceof A1;           // false  (đã chạy)
```

Hai lớp có cùng hình dạng thì TS coi như thay thế được cho nhau, nhưng runtime thì khác. Đây là lý do nên có **khoá phân biệt rõ ràng** (`code`/`kind` là literal *khác nhau* ở từng lớp) nếu bạn muốn dùng `switch` thay cho chuỗi `instanceof`:

```ts
class ConflictError extends AppError {
  readonly code = "CONFLICT";
}
class ValidationFailed extends AppError {
  readonly code = "VALIDATION";
  constructor(readonly issues: readonly { path: string; message: string }[]) {
    super("Validation failed");
  }
}
type KnownError = ConflictError | ValidationFailed;

function describe(e: KnownError): string {
  switch (e.code) {
    case "CONFLICT": return "Xung đột";
    case "VALIDATION": return `${e.issues.length} lỗi dữ liệu`;
  }
}
```

(`readonly code = "CONFLICT"` được suy ra là literal `"CONFLICT"` vì thuộc tính `readonly`.) Đây là discriminated union của Bài 2, áp dụng lên lớp lỗi.

**`cause`: giữ nguyên nhân gốc khi bọc.**

```ts
class TicketClosedError extends AppError {
  constructor(readonly ticketId: string, options?: { cause?: unknown }) {
    super(`Ticket ${ticketId} is closed`, options);
  }
}

try {
  throw new TicketClosedError("t2", { cause: new Error("db") });
} catch (caught) {
  if (caught instanceof TicketClosedError) {
    caught.cause; // unknown. Là Error("db") lúc chạy
  }
}
```

Kiểu của `cause` là `unknown`, nên thu hẹp trước khi dùng. Để lần ngược chuỗi nguyên nhân:

```ts
function rootCause(e: unknown): unknown {
  let cur = e;
  while (cur instanceof Error && cur.cause !== undefined) cur = cur.cause;
  return cur;
}
```

**Serialize.** Thuộc tính `message` và `stack` của `Error` là non-enumerable, nên:

```ts
JSON.stringify(new TicketNotFoundError("t1"));
// {"name":"TicketNotFoundError","ticketId":"t1"}   <- không có message, không có stack (đã chạy)
```

Vì `name` do ta gán là thuộc tính thường (enumerable) còn `message`/`stack` thì không. Đừng dựa vào hành vi này; hãy tự dựng object lỗi khi ghi log hay trả response.

**Duck-typing cho lỗi của thư viện.** Driver DB thường ném lỗi có `code` (ví dụ Postgres `23505` là vi phạm unique). Khi không có lớp để `instanceof`, dùng hàm thu hẹp:

```ts
function hasCode(x: unknown): x is { code: string } {
  return (
    typeof x === "object" && x !== null && "code" in x &&
    typeof (x as { code: unknown }).code === "string"
  );
}
```

`x is {...}` (type predicate) là lời *hứa* của bạn, nên kiểm tra phải thật sự đầy đủ như trên.

**Lỗi trong code async.** `await` một Promise reject thì `catch` bắt được; Promise reject không có ai `await`/`.catch` thành "unhandled rejection", làm sập tiến trình Node (mặc định từ Node 15). Luôn có `catch` hoặc `await` đường tới ranh giới.

**So sánh PHP/Laravel.** `catch (TicketNotFoundException $e)` trong PHP được kiểm tra bằng kiểu của lớp ngay trong cú pháp `catch`. JavaScript `catch` không có bộ lọc kiểu, nên phải `if (e instanceof ...)` bên trong và `throw e` lại nếu không khớp. `previous` của exception PHP tương ứng `cause` của JS.

## Tricks & tips thực tế

- **Một lớp gốc `AppError`/`DomainError` cho cả ứng dụng.** Lý do: một `instanceof` ở error handler phân biệt "lỗi chúng ta chủ động ném" với "lỗi bất ngờ".
- **Luôn `throw e` lại khi không nhận ra lỗi.** Lý do: bắt rồi nuốt khiến bug biến mất; bắt rồi ném lại giữ đường lỗi lên tới handler cuối.
- **Mang dữ liệu có cấu trúc trong lớp lỗi (`ticketId`, `issues`), message chỉ để đọc.** Lý do: code bên bắt cần dữ liệu để xử lý, không nên phải parse chuỗi message.
- **Dùng `cause` khi bọc, đừng dùng chuỗi nối (`"failed: " + e.message`).** Lý do: nối chuỗi làm mất stack trace của lỗi gốc, còn `cause` giữ cả chuỗi.
- **Cẩn thận `catch (e)` rồi `e.message` trực tiếp.** Lý do: với `unknown` đây là lỗi biên dịch, nhưng nếu bạn chữa bằng `(e as Error)` thì dễ ném `TypeError` bên trong `catch` khi `e` là chuỗi hay `undefined`. Dùng `toError(e)` hoặc `instanceof`.
- **Đặt `code`/`kind` literal khác nhau cho từng lớp lỗi.** Lý do: hai lớp trống thân giống hệt cấu trúc, TS không phân biệt chúng, và không thu hẹp được qua `switch`.
- **Lớp lỗi tự định nghĩa tránh phụ thuộc framework.** Lý do: tầng domain/service không nên biết HTTP; việc dịch sang status nằm ở ranh giới (file 5).
- **Debug lỗi `instanceof` luôn `false` dù "đúng lớp"**: nguyên nhân hay gặp là hai bản sao cùng một module (monorepo/hai phiên bản package, hoặc import qua hai đường dẫn khác nhau), hoặc lỗi đã đi qua ranh giới serialize (worker, queue, JSON) nên mất prototype. Kiểm tra bằng `e.constructor.name` và `e.name`. Lý do: prototype là danh tính của lớp, bản sao khác nhau thì khác prototype.
- **Gặp `throw` chuỗi/số ở code bên ngoài**: chuẩn hoá một lần ở rìa bằng `toError`, rồi từ đó coi mọi thứ là `Error`.
- **Ghi log bằng chính object lỗi** (`logger.error({ err })` với logger hỗ trợ), không `JSON.stringify(err)`. Lý do: như trên, stringify làm mất message và stack.

## Liên hệ bài tập

Bài lab cần lỗi có kiểu cho contract tạo Order. Hãy thiết kế: lớp gốc, vài lớp con (hoặc union object) cho các lỗi bạn đã liệt kê ở file 1, và quyết định mỗi lỗi mang dữ liệu gì. Rồi tự kiểm: thêm một lớp lỗi mới, các `switch` nào báo lỗi biên dịch? Nếu không chỗ nào báo, `default` đang che lỗi.

## Đọc thêm

- [MDN: Error (gồm `cause`)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error)
- [MDN: `new.target`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/new.target)
- [TypeScript: Narrowing (`instanceof`, type predicates)](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
- [TypeScript TSConfig: `useUnknownInCatchVariables`](https://www.typescriptlang.org/tsconfig/#useUnknownInCatchVariables)

## Ghi chú của bạn

