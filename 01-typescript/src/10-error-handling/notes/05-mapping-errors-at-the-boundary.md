# 5. Chuyển lỗi thành HTTP response ở ranh giới, và không lộ chi tiết nội bộ

Domain/service chỉ ném hoặc trả lỗi có kiểu, **một** nơi ở rìa dịch chúng thành status code và body theo contract; lỗi lạ luôn thành 500 chung chung.

```ts
type KnownError = NotFound | Conflict | Forbidden | InvalidInput; // các lớp lỗi nghiệp vụ

function statusOf(e: KnownError): 400 | 403 | 404 | 409 {
  switch (e.code) {
    case "NOT_FOUND": return 404;
    case "CONFLICT": return 409;
    case "FORBIDDEN": return 403;
    case "INVALID_INPUT": return 400;
    default: return assertNever(e);   // thêm lỗi mới mà quên map -> lỗi biên dịch
  }
}
```

## Ý chính

- Service và domain **không biết HTTP**. Chúng chỉ nói "không tìm thấy", "xung đột". Một hàm ở ranh giới (middleware, error handler, filter) ánh xạ sang status code.
- Ánh xạ nên **exhaustive** (Bài 2): mỗi lỗi mới của domain buộc bạn quyết định status của nó ngay lúc biên dịch.
- **Mặc định an toàn**: lỗi không nhận ra thì 500 + thông điệp chung + `requestId`; chi tiết đầy đủ chỉ vào log.
- **Không lộ nội bộ**: stack trace, câu SQL, đường dẫn file, tên bảng/cột, địa chỉ host, thông điệp của thư viện, phiên bản phần mềm.
- Chỉ trả cho client thứ chúng cần để sửa: `code`, `message` do bạn viết, `details` của validation, `requestId`.
- Lỗi dự kiến và lỗi bất ngờ đi cùng đường vào một hàm ranh giới; nhưng **hình dạng response** thì giống nhau (cùng `ApiError`).

## Lý thuyết chi tiết

**Bảng ánh xạ phổ biến.**

| Tình huống | Lớp/`code` gợi ý | HTTP |
|---|---|---|
| Body sai hình dạng/thiếu trường | `INVALID_INPUT` | 400 (hoặc 422 nếu muốn tách "cú pháp đúng, nghiệp vụ sai") |
| Chưa đăng nhập | `UNAUTHENTICATED` | 401 |
| Không đủ quyền | `FORBIDDEN` | 403 |
| Không có tài nguyên | `NOT_FOUND` | 404 |
| Trạng thái xung đột (đã đóng, trùng unique) | `CONFLICT` | 409 |
| Quá giới hạn tốc độ | `RATE_LIMITED` | 429 |
| Lỗi lạ / hạ tầng | `INTERNAL` | 500 |
| Phụ thuộc ngoài không khả dụng | `UNAVAILABLE` | 503 |

400 hay 422 cho lỗi dữ liệu là quy ước của từng đội; chọn một và nhất quán. Laravel dùng 422 cho validation, nhiều API khác dùng 400.

**Một hàm ranh giới** (đã chạy với framework giả, chỉ là hàm thuần):

```ts
type ApiError = {
  error: {
    code: string;
    message: string;
    details?: readonly { path: string; message: string }[];
    requestId: string;
  };
};

function isKnown(e: unknown): e is KnownError {
  return (
    e instanceof NotFound || e instanceof Conflict ||
    e instanceof Forbidden || e instanceof InvalidInput
  );
}

function toHttp(e: unknown, requestId: string): { status: number; body: ApiError } {
  if (isKnown(e)) {
    const base = { code: e.code, message: e.message, requestId };
    return {
      status: statusOf(e),
      body: { error: e instanceof InvalidInput ? { ...base, details: e.issues } : base },
    };
  }
  // Lỗi lạ: ghi đầy đủ ở server, trả chung chung cho client
  logger.error({ requestId, err: e });
  return {
    status: 500,
    body: { error: { code: "INTERNAL", message: "Internal server error", requestId } },
  };
}
```

(`logger` là logger của bạn; trong thử nghiệm dùng `console.error`.) Kết quả đã chạy: `NotFound` thành `404` + `NOT_FOUND`; một `Error("connect ECONNREFUSED 10.0.0.5:5432")` thành `500` + `INTERNAL` và **không** có địa chỉ `10.0.0.5` trong body, địa chỉ chỉ nằm trong log.

Lớp lỗi dùng ở trên (rút gọn, kế thừa từ file 2):

```ts
abstract class DomainError extends Error {
  abstract readonly code: string;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}
class NotFound extends DomainError { readonly code = "NOT_FOUND" as const; }
class Conflict extends DomainError { readonly code = "CONFLICT" as const; }
class Forbidden extends DomainError { readonly code = "FORBIDDEN" as const; }
class InvalidInput extends DomainError {
  readonly code = "INVALID_INPUT" as const;
  constructor(readonly issues: readonly { path: string; message: string }[]) {
    super("Invalid input");
  }
}
```

**Exhaustive mapping.** Hàm `statusOf` ở đầu file dùng `assertNever` (Bài 2):

```ts
function assertNever(x: never): never {
  throw new Error(`Unhandled: ${String(x)}`);
}
```

Thêm `class RateLimited` vào union `KnownError` thì `default: return assertNever(e)` báo lỗi biên dịch ngay. Dạng bảng tra cũng ép đủ khoá: `const STATUS: Record<KnownError["code"], number> = {...}` thiếu khoá thì lỗi.

**Chuyển `ZodError` thành lỗi của contract.** Ở rìa, input sai thành `InvalidInput` mang `details` (với `path` đầy đủ, xem Bài 9 file 2):

```ts
import { z } from "zod";

const Body = z.object({ title: z.string().min(1) });

function parseBody(raw: unknown): z.infer<typeof Body> {
  const r = Body.safeParse(raw);
  if (!r.success) {
    throw new InvalidInput(
      r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return r.data;
}
// parseBody({ title: "" }) -> toHttp(...) ->
// { status: 400, body: { error: { code: "INVALID_INPUT", message: "Invalid input", requestId, details: [{ path: "title", message: "Too small: expected string to have >=1 characters" }] } } }
```

Dạng `Result` tương đương: `parseBody` trả `Result<Body, InvalidInput>`, và hàm ranh giới nhận `Result` thất bại. Chọn theo quy ước đã chọn ở file 1.

**Những thứ không bao giờ ra response.** Ví dụ catch-all tệ (minh hoạ, chưa chạy):

```ts
// KHÔNG LÀM
function badHandler(e: unknown) {
  return { status: 500, body: { error: String(e), stack: (e as Error).stack } };
}
// Body sẽ chứa: "Error: connect ECONNREFUSED 10.0.0.5:5432" + stack với đường dẫn file trên server
```

Kẻ tấn công thu được cấu trúc mạng, đường dẫn deploy, tên thư viện/phiên bản để tìm lỗ hổng. Ngoài ra thông điệp "tài khoản không tồn tại" và "sai mật khẩu" khác nhau cho phép dò user (user enumeration): với đăng nhập, dùng một thông điệp chung.

**Cả khi `NODE_ENV=development`** bạn có thể muốn trả stack cho tiện, nhưng hãy bật qua cờ cấu hình rõ ràng, mặc định tắt. Laravel làm tương tự với `APP_DEBUG` (bật thì trang lỗi chi tiết, tắt thì chỉ "Server Error").

**Unhandled error và tiến trình.** Lỗi ném trong callback/async không có `catch` có thể làm sập tiến trình hoặc treo request. Một error handler cấp cao (middleware cuối cùng của framework) chính là chỗ gom: đảm bảo mọi request đều nhận một response. Ở NestJS (Phase 03) vai trò này là *exception filter*; ở Express là middleware lỗi 4 tham số. Nguyên tắc ở đây không đổi.

**So sánh PHP/Laravel.** `App\Exceptions\Handler` (hoặc `bootstrap/app.php` với `withExceptions`) đăng ký `render` cho từng loại exception và `report` để ghi log: đây chính là `toHttp` ở trên cộng với `logger`. Exception tự định nghĩa có thể có `render()` riêng. Khác biệt: ở TypeScript, bạn dùng kiểu và `switch` exhaustive để **trình biên dịch** bảo đảm mọi lỗi đã được ánh xạ.

## Tricks & tips thực tế

- **Một hàm ánh xạ duy nhất, nằm ở rìa.** Lý do: ánh xạ rải rác ở từng controller dẫn đến cùng một lỗi có hai status khác nhau tuỳ endpoint.
- **Lỗi mới của domain → compiler chỉ chỗ phải cập nhật.** Dùng `assertNever` hoặc `Record<code, status>`. Lý do: tránh lỗi mới lọt ra 500 vì quên ánh xạ.
- **Luôn có nhánh mặc định 500 an toàn.** Lý do: mọi thứ không lường trước phải ra đúng hình dạng `ApiError`, không phải trang HTML mặc định hay stack.
- **Gắn `requestId` ở middleware đầu tiên và đưa vào mọi log và response.** Lý do: tra một lỗi production từ thông báo của người dùng chỉ mất một lần tìm.
- **Log ở ranh giới, đủ ngữ cảnh**: `requestId`, route, user id (nếu có), `err` gồm stack và chuỗi `cause`. Lý do: thiếu ngữ cảnh thì log lỗi hạ tầng gần như vô dụng.
- **Che giá trị nhạy cảm trong log** (mật khẩu, token, số thẻ). Lý do: log hay đi vào hệ thống có quyền truy cập rộng hơn DB; log cả body request gốc là cách rất hay làm rò rỉ.
- **Giữ `message` cho client do bạn viết, không lấy từ `e.message` của thư viện.** Lý do: thông điệp thư viện không ổn định giữa phiên bản và có thể chứa chi tiết nội bộ.
- **Đừng dùng 200 kèm `{ success: false }`.** Lý do: cache, giám sát, client HTTP generic đều dựa vào status; che lỗi dưới 200 làm hỏng cả chuỗi công cụ.
- **Test bảng ánh xạ**: mỗi lỗi → status + `code` mong đợi, cộng một test "lỗi lạ → 500 và body không chứa chuỗi nhạy cảm". Lý do: đây là hợp đồng, và đoạn hay hồi quy nhất.
- **Debug response sai status**: chạy `toHttp` thẳng với lỗi giả trong test, không cần dựng server; vì là hàm thuần nên in kết quả là đủ. Lý do: tách logic khỏi framework khiến nó kiểm thử được rẻ.
- **Thận trọng với `instanceof` qua ranh giới serialize** (worker, queue): lỗi mất prototype nên `isKnown` sai; truyền `code` và dựng lại lỗi ở phía nhận.

## Liên hệ bài tập

Contract tạo Order của bài lab cần hàm ánh xạ lỗi sang status. Hãy tự thiết kế: danh sách lỗi (từ file 1-3), status cho từng lỗi, và cách bạn bảo đảm thêm lỗi mới sẽ bị compiler bắt nếu quên ánh xạ. Sau đó thử tình huống một lỗi "lạ" và kiểm tra response của bạn không chứa thông tin nội bộ nào.

## Đọc thêm

- [MDN: HTTP response status codes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status)
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457)
- [OWASP: Error Handling Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html)
- [TypeScript: Exhaustiveness checking](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking)

## Ghi chú của bạn

