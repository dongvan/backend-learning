# 3. Xử lý lỗi tập trung (centralized error handling)

Mọi lỗi trong server đều phải **đi qua một cửa duy nhất** quyết định hai việc: trả gì cho client, và ghi gì vào log. Lỗi do client gây ra (404, 400) và lỗi bất ngờ (bug, DB sập) cần được đối xử khác nhau; và không lỗi nào được phép làm sập tiến trình hay lọt ra ngoài mà không ai thấy.

```ts
// Phân loại lỗi: lỗi nghiệp vụ "biết trước" mang status; mọi thứ khác là lỗi bất ngờ
class AppError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

function toResponse(err: unknown): { status: number; body: { error: { code: string; message: string } } } {
  if (err instanceof AppError) return { status: err.status, body: { error: { code: err.code, message: err.message } } };
  return { status: 500, body: { error: { code: "INTERNAL", message: "Internal Server Error" } } };   // không lộ chi tiết
}

console.log(toResponse(new AppError(404, "USER_NOT_FOUND", "Không có user 7")));
console.log(toResponse(new TypeError("Cannot read properties of undefined (reading 'id')")));
```

(Node 24.21 đã chạy. Khung này chỉ minh hoạ *phân loại*; đường đi của lỗi, định dạng lỗi chuẩn và việc ghi log là phần thiết kế của bạn.)

## Ý chính

- Hai loại lỗi: **lỗi vận hành / nghiệp vụ** (client gửi sai, tài nguyên không có, không có quyền: *dự đoán được*, trả 4xx kèm mã lỗi rõ ràng) và **lỗi lập trình / hạ tầng** (`TypeError`, DB đứt: *bất ngờ*, trả 500 chung chung và log chi tiết).
- **Không bao giờ** gửi stack trace, thông báo lỗi thô của thư viện, câu SQL hay đường dẫn file ra client. Gửi `code` ổn định + thông điệp an toàn; chi tiết ở log, gắn với `requestId` để đối chiếu.
- Một **error boundary** ở lớp ngoài cùng của pipeline (`try { await next() } catch`) biến mọi lỗi thành response, và **là nơi duy nhất** ghi log lỗi.
- Lỗi async trong handler **không tự biến thành 500**: ném trong `http.createServer(async (req,res)=>...)` mà không bắt sẽ **giết tiến trình** (đã thử). Phải có `try/catch` hoặc `.catch` ở đỉnh listener.
- Nếu **header đã gửi** (`res.headersSent`) thì không thể đổi status nữa: đóng kết nối (`res.destroy()`) để client biết response không trọn vẹn.
- Phân biệt lỗi bằng `instanceof` hoặc `code` (thuộc tính), không bằng so khớp chuỗi `message`.

## Lý thuyết chi tiết

**Vì sao async handler khiến tiến trình sập.** Hai thí nghiệm (Node 24.21): listener `http.createServer(async (req, res) => ...)` ném lỗi, một lần đồng bộ, một lần sau `await`:

```text
== sync                           == async
process exit code 1               process exit code 1
Error: sync boom                  Error: async boom
```

Cả hai đều **kết thúc tiến trình** với mã 1 (listener async trả về một Promise, `http` bỏ qua giá trị trả về nên rejection không ai nhận, thành `unhandledRejection`, mặc định ném thành lỗi chưa bắt). Điều này khác hẳn PHP-FPM, nơi một exception chưa bắt chỉ làm hỏng **một** request. Ở Node, một đường lỗi quên bắt = sập mọi kết nối đang phục vụ. Hệ quả thiết kế: listener ở ngoài cùng nên có dạng "gọi pipeline và gắn bộ bắt lỗi cuối cùng":

```ts
// ý tưởng: không để Promise của pipeline bị bỏ rơi
server.on("request", (req, res) => {
  handle(req, res).catch((err) => { /* lưới an toàn cuối: log, đóng response nếu chưa kết thúc */ });
});
```

**Phân loại lỗi và ánh xạ sang HTTP.** Một bảng gợi ý:

| Nguồn | Ví dụ | Trả về | Log |
|---|---|---|---|
| Client sai | JSON hỏng, thiếu trường | 400/422, `code` + chi tiết trường | `warn` hoặc `info` (đừng spam `error`) |
| Không tìm thấy / sai method | không có tuyến, user không có | 404/405 | `info` |
| Quá giới hạn | body lớn | 413 | `warn` |
| Xác thực/quyền | thiếu token | 401/403 | `warn` |
| Phụ thuộc hạ tầng | DB đứt, timeout | 503 hoặc 500 | `error` + stack |
| Bug | `TypeError`, `undefined` | 500 chung | `error` + stack |

Quy tắc: **lỗi bất ngờ là mọi thứ không nhận ra**. Giá trị bị `throw` không phải `Error` (`throw "chuỗi"`, đã thử với `toResponse("...")`) cũng phải rơi vào nhánh 500 chứ không làm hàm xử lý lỗi nổ.

**Không lộ thông tin.** Trong ví dụ, lỗi `TypeError: Cannot read properties of undefined (reading 'id')` được chuyển thành `{ code: "INTERNAL", message: "Internal Server Error" }`. Thông báo gốc, stack, tên lớp, tên bảng SQL là thông tin cho kẻ tấn công thăm dò. Client nhận `requestId` (qua header `x-request-id` hoặc trong body lỗi) để người vận hành tìm lại chi tiết trong log. Laravel làm tương tự khi `APP_DEBUG=false`: `Handler::render` trả trang 500 chung, `report` ghi chi tiết; khi `APP_DEBUG=true` stack hiện ra, và đó là lý do bật nhầm debug ở production là sự cố bảo mật. Với Node, hãy tự có một công tắc theo môi trường nếu bạn muốn trả chi tiết ở dev, và mặc định **tắt**.

**Định dạng lỗi chuẩn.** Chọn **một** hình dạng cho mọi lỗi, ví dụ `{ "error": { "code": "USER_NOT_FOUND", "message": "...", "requestId": "..." } }`. Có chuẩn công khai là `application/problem+json` (RFC 9457) với các trường `type`, `title`, `status`, `detail`, `instance`; có thể tham khảo nhưng không bắt buộc. Quan trọng là nhất quán và có `code` ổn định (máy đọc) tách khỏi `message` (người đọc, có thể đổi).

**Lớp lỗi riêng và `cause`.** Dùng lớp `AppError`/`HttpError` mang `status`, `code`, và `cause` để giữ lỗi gốc (`new AppError(..., { cause })`, ES2022). Với TS: `catch (e)` cho `e` kiểu `unknown`, nên phân loại bằng `instanceof` rồi mới truy cập thuộc tính (đã quen từ Phase 01). Cẩn thận `instanceof` có thể sai khi cùng một lớp được nạp từ hai bản module khác nhau; trong dự án nhỏ một bản thì ổn, còn không có thể dùng thuộc tính `code`/discriminant.

**Lỗi sau khi đã gửi header.** Nếu lỗi xảy ra giữa chừng khi đang stream, `res.headersSent` là `true`. Hai lựa chọn đã thử (Node 24.21):

- `res.writeHead(500)` lúc này **ném `ERR_HTTP_HEADERS_SENT`**: đặt `try/catch` hoặc kiểm tra `headersSent` trước.
- Nếu bạn chỉ `res.end()`, client (đã thử bằng `fetch`) nhận **status 200 và phần body cụt** (`"phần đầu..."`) mà không có dấu hiệu lỗi: dữ liệu hỏng mà tưởng thành công. Nếu bạn `res.destroy()`, client nhận lỗi kết nối (`fetch failed | other side closed`), ít nhất biết có sự cố. Với response đã bắt đầu, `destroy` là lựa chọn trung thực hơn.

**Lỗi ở tầng server (ngoài middleware).** Có hai nguồn lỗi bạn không bắt được trong pipeline:

- **`clientError`**: request không parse được (dòng yêu cầu hỏng, header quá to). Mặc định Node tự trả `400 Bad Request` rồi đóng (đã thử với dữ liệu rác gửi qua socket thô). Có thể tuỳ biến bằng `server.on("clientError", (err, socket) => { ... socket.end("HTTP/1.1 400 Bad Request\r\n\r\n") })`; handler của bạn phải **tự đóng socket**. Mã lỗi quan sát được: `HPE_INVALID_METHOD`.
- **`error` của server**: khi `listen` thất bại, ví dụ **`EADDRINUSE`** (đã thử: lắng nghe cổng đang dùng, nhận `[listen error] EADDRINUSE` qua `server.on("error")`). Nếu không có listener `error`, nó thành exception chưa bắt. Khi khởi động, đây là lỗi phải làm tiến trình thoát với thông báo rõ ràng.

**Lỗi ở hai đầu vòng đời.** `process.on("unhandledRejection")` và `process.on("uncaughtException")` là *lưới cuối*, không phải chỗ xử lý lỗi thường ngày. Dùng để log có cấu trúc và thoát có kiểm soát (`process.exitCode = 1` rồi shutdown, xem file 5). Khi tới đây nghĩa là một đường lỗi nào đó đã lọt khỏi error boundary: coi là bug cần sửa.

## Tricks & tips thực tế

- **Một chỗ log lỗi, một lần cho mỗi lỗi.** Lý do: nếu middleware nào cũng `catch` rồi log rồi ném tiếp, một lỗi xuất hiện 4 dòng log, khó đếm và khó tìm; hãy log ở error boundary và chỉ ném tiếp, hoặc bọc bằng `cause`.
- **Không `catch` để nuốt.** `catch {}` rỗng hoặc chỉ `console.log` rồi tiếp tục làm mất lỗi. Chỉ bắt khi bạn biết cách xử lý (thử lại, giá trị mặc định, đổi sang `AppError`), còn lại để nó nổi lên.
- **Trả 4xx chỉ cho lỗi bạn chủ động nhận ra**, mọi thứ khác 500. Lý do: `instanceof AppError` (danh sách trắng) an toàn hơn đoán "có `status` thì dùng", vì một thư viện nào đó có thể gắn `status` lạ lên lỗi của nó.
- **Gắn `requestId` vào mọi response lỗi** và log. Lý do: người dùng báo "bị lỗi lúc 14:03" thì bạn cần khoá để tìm đúng dòng log, trong hàng nghìn dòng đan xen của nhiều request.
- **Ghi `err.cause` và stack khi log**, vì `JSON.stringify(err)` chỉ ra `{}` hoặc gần như rỗng (chỉ thuộc tính enumerable, `message`/`stack`/`cause` thì không); cần hàm serialize lỗi riêng (file 4).
- **Test đường lỗi thật bằng tiến trình thật:** mở cổng 0, gửi request làm handler ném lỗi đồng bộ, lỗi sau `await`, và `Promise.reject` không `await`; khẳng định tiến trình vẫn sống và response là 500 chung. Lý do: đó là bài kiểm tra duy nhất xác nhận bạn không để lọt lỗi async (file 5).
- **Không đặt logic nghiệp vụ trong error handler** (gọi DB, gọi dịch vụ ngoài). Lý do: nếu nó cũng lỗi bạn mất lớp bảo vệ cuối; giữ nó đơn giản và gần như không thể thất bại.
- **Đừng dùng exception cho luồng điều khiển bình thường trong đường nóng.** Tạo `Error` thu thập stack, tốn hơn nhiều so với trả giá trị; chấp nhận được cho 404 hiếm, nhưng không nên cho vòng lặp.
- **Gọi `res.end()` đúng một lần và kiểm tra `res.writableEnded` / `res.headersSent` trước khi trả lỗi.** Lý do: lỗi xảy ra sau khi một lớp khác đã ghi response sẽ gây `ERR_HTTP_HEADERS_SENT` ngay trong error handler.
- **So với Laravel:** `Handler::register()` (`renderable`/`reportable`), `$dontReport`, và các exception HTTP (`NotFoundHttpException`, `ValidationException` -> 422) là tương đương; `AppError` có `status` giống `HttpException`. Khác biệt cốt lõi là phạm vi hư hại: ở PHP-FPM bug chỉ làm hỏng một request, ở Node một lỗi lọt có thể sập tiến trình.

## Liên hệ bài tập

Tiêu chí của project về lỗi: lỗi nghiệp vụ trả đúng mã và `code`, lỗi bất ngờ trả 500 **không lộ chi tiết**, stack chỉ có trong log, và lỗi ném trong handler async **không làm sập server**. Tự trả lời: lưới an toàn cuối cùng nằm ở đâu? Nếu error handler của chính bạn ném lỗi thì sao? Làm thế nào để một test chứng minh rằng stack **không** xuất hiện trong body response? Chỉ có hướng; việc thiết kế lớp lỗi và luồng xử lý là của bạn.

## Đọc thêm

- [Node.js: Errors](https://nodejs.org/api/errors.html)
- [Node.js: `http.Server` (`clientError`, `error`)](https://nodejs.org/api/http.html#event-clienterror)
- [Node.js: `process` (`unhandledRejection`, `uncaughtException`)](https://nodejs.org/api/process.html#event-unhandledrejection)

## Ghi chú của bạn
