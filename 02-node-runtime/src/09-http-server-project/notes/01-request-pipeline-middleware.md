# 1. Request pipeline và middleware (mô hình onion)

Một HTTP server nhỏ chỉ là một hàm nhận `(req, res)`; "framework" chủ yếu là cách bạn **tổ chức chuỗi bước** xử lý request: đánh số request, ghi log, parse body, định tuyến, bắt lỗi. Middleware là hàm bọc quanh phần còn lại của chuỗi, và `next` là phần còn lại đó.

```ts
import http from "node:http";

// Toàn bộ "server" ở mức thấp nhất: một listener nhận (req, res)
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end(`${req.method} ${req.url}\n`);
});
server.listen(3000, "127.0.0.1");
```

(Node 24.21, chạy bằng `node server.ts`. Đây là project cuối phase: notes này là **hướng dẫn thiết kế**, không phải lời giải; phần việc là của bạn.)

## Ý chính

- `req` là `IncomingMessage` (một **Readable stream**), `res` là `ServerResponse` (một **Writable stream**). Body request **chưa được đọc** khi listener chạy; bạn phải tự đọc.
- **Middleware** = hàm `(ctx, next) => Promise<void>`. Gọi `await next()` để chuyển quyền cho bước sau; **code sau `await next()` chạy khi bước sau đã xong** (đường ra). Không gọi `next()` = chặn chuỗi (ví dụ xác thực thất bại).
- Mô hình **onion**: đi vào từ lớp ngoài cùng tới handler, rồi đi ngược ra. Vì vậy một middleware ở lớp ngoài cùng có thể `try/catch` mọi lỗi của lớp trong, và đo thời gian trọn vẹn.
- Middleware thực chất là **hàm bậc cao** (hàm nhận hàm `next`, trả/chạy một hàm), và việc ghép chúng lại (**compose**) là đệ quy trên chỉ số trong mảng.
- Thứ tự là **ngữ nghĩa**, không phải thẩm mỹ: bắt lỗi và log ở ngoài cùng, request id trước log, parse body trước router/handler cần nó.
- Ba bẫy phổ biến: quên `await next()`, gọi `next()` hai lần, và middleware vừa ghi response vừa gọi `next()` (hai bên cùng ghi).

## Lý thuyết chi tiết

**Vòng đời một request trong `node:http`.** Khi header đã được parse, server phát sự kiện `request` với `req` và `res`. Từ lúc đó:

1. `req.method`, `req.url` (gồm cả query string, chưa được parse), `req.headers` (khoá đã viết thường) có sẵn.
2. Body chưa đọc: là stream, đọc bằng `for await (const chunk of req)` hoặc sự kiện `data`/`end`.
3. Bạn phải gọi `res.writeHead/setHeader`, `res.write`, rồi `res.end()`. Sau khi `end()`, response kết thúc; sau khi header đã gửi (`res.headersSent === true`) không thể đổi status code nữa.
4. Sự kiện `finish` của `res` phát khi dữ liệu đã giao cho hệ điều hành; `close` phát khi kết nối/response bị đóng, **kể cả khi client bỏ giữa chừng** (xem file 4).

So với PHP-FPM: ở đó `$_SERVER`, `$_POST`, `php://input` đã được chuẩn bị sẵn trong mỗi request và mỗi request là một vòng đời riêng. Ở Node, server là một tiến trình dài sống, **mọi request chia sẻ cùng bộ nhớ** và cùng một event loop; không có "mỗi request một process". Hệ quả: trạng thái theo request phải nằm trong một đối tượng `ctx` (hoặc `AsyncLocalStorage`, file 4), tuyệt đối không nằm trong biến module.

**Middleware kiểu Koa: `(ctx, next)`.** Một khung ý tưởng tối giản để thấy cơ chế (chạy được, Node 24.21; cố ý **thiếu** mọi thứ một server cần: không có `ctx` HTTP, không chống gọi `next` hai lần, không xử lý lỗi):

```ts
type Next = () => Promise<void>;
type Middleware = (trace: string[], next: Next) => Promise<void>;

// middleware i nhận "phần còn lại của chuỗi" làm next
function chain(stack: Middleware[]) {
  return (trace: string[]): Promise<void> => {
    const run = (i: number): Promise<void> => {
      const mw = stack[i];
      return mw ? mw(trace, () => run(i + 1)) : Promise.resolve();
    };
    return run(0);
  };
}

const trace: string[] = [];
await chain([
  async (t, next) => { t.push("A:trước"); await next(); t.push("A:sau"); },
  async (t, next) => { t.push("B:trước"); await next(); t.push("B:sau"); },
  async (t) => { t.push("handler"); },
])(trace);
console.log(trace.join(" > "));
```

Kết quả: `A:trước > B:trước > handler > B:sau > A:sau`. Đó là hình củ hành: vào A, vào B, tới handler, ra B, ra A. Nếu middleware đầu không gọi `next` (ví dụ từ chối), kết quả chỉ có dòng của nó và handler **không bao giờ chạy** (đã thử).

**Vì sao là hàm bậc cao.** `chain` nhận mảng hàm và trả về một hàm; mỗi middleware nhận một hàm (`next`) và có thể gọi nó 0, 1 hoặc nhiều lần, đồng bộ hay muộn hơn. Việc `next` đóng (closure) trên chỉ số `i` là điều khiến mỗi lớp biết "bước tiếp theo của riêng mình". Bạn sẽ thấy cùng ý tưởng trong `Pipeline` của Laravel (`array_reduce` dựng chuỗi closure `fn($request) => $middleware->handle($request, $next)`): `$next($request)` là `next()`. Khác biệt: middleware Laravel chạy **đồng bộ** trong một request; ở Node, `next()` trả Promise nên bạn phải `await`.

**Các bẫy với `next`** (đã chạy với khung trên):

1. **Quên `await next()`.** `next();` không có `await` làm phần "đường ra" chạy ngay, **trước khi** handler xong. Kết quả đo được: `timer:bắt đầu > timer:kết thúc (đo sai)`, và chỉ sau đó mới `handler xong`: middleware đo thời gian ghi nhận gần 0 ms. Tệ hơn, nếu handler ném lỗi, Promise bị bỏ rơi không ai bắt: Node phát `unhandledRejection` (đã thử) và, với cấu hình mặc định, **giết cả tiến trình** (file 3).
2. **Gọi `next()` hai lần** làm các bước sau chạy hai lần (ghi response hai lần, lỗi `ERR_HTTP_HEADERS_SENT`). Cách phòng thủ phổ biến: giữ biến `lastIndex` trong compose; nếu `i <= lastIndex` thì ném lỗi rõ ràng. Hãy tự nghĩ vì sao chỉ số chứ không phải cờ boolean đơn giản.
3. **Vừa trả response vừa gọi `next()`**: middleware xác thực gửi 401 rồi vẫn `await next()` nên handler tiếp tục chạy và cố ghi. Quy tắc: *hoặc* kết thúc response *hoặc* chuyển tiếp, không cả hai.

**Express-style `(req, res, next)` hay Koa-style `(ctx, next)`.** Express dùng callback `next(err)`; lỗi async phải tự chuyển vào `next` (Express 4 không bắt lỗi của handler async). Koa-style dựa trên Promise nên `try/catch` quanh `await next()` bắt được lỗi của mọi lớp phía trong, thuận hơn cho "centralized error handling". Dự án này chỉ dùng `node:http` nên bạn tự chọn; đề xuất: kiểu Promise, vì nó khớp `async/await` của phase này.

**Thiết kế `ctx`.** Một đối tượng gói `req`, `res`, thông tin đã chuẩn bị (`url`, `query`, `params`, `body`, `requestId`, `startTime`, `state` cho middleware chia sẻ dữ liệu). Quyết định cần cân nhắc:

- Kiểu của `ctx.body`/`ctx.params` thay đổi theo thời điểm (chưa parse, đã parse). Đừng khai báo tất cả là bắt buộc rồi dối kiểu; dùng giá trị khởi tạo hợp lý hoặc kiểu tuỳ chọn và kiểm tra, hoặc tách thành các kiểu theo giai đoạn.
- Handler nên **trả về dữ liệu** (rồi một lớp ngoài tuần tự hoá thành response) hay **tự ghi `res`**? Trả về dữ liệu dễ test hơn (không cần giả `res`) và dễ chuẩn hoá header/định dạng, nhưng khó hỗ trợ streaming; hãy chọn và nêu lý do.

**Một pipeline gợi ý (từ ngoài vào trong), kèm lý do thứ tự:**

| Lớp | Việc | Vì sao ở vị trí này |
|---|---|---|
| 1. request id + đo thời gian | gán/đọc id, ghi `startTime` | mọi log về sau cần id; đo thời gian trọn vẹn |
| 2. access log | ghi một dòng khi response kết thúc | cần biết status cuối cùng, nên đăng ký lắng nghe `close` trên `res` |
| 3. error boundary | `try { await next() } catch` | ngoài cùng của phần nghiệp vụ để bắt mọi lỗi phía trong (file 3) |
| 4. (tuỳ chọn) xác thực, giới hạn tốc độ | từ chối sớm | trước khi tốn công đọc body |
| 5. body parser | đọc và parse body có giới hạn | sau các từ chối sớm |
| 6. router + handler | khớp tuyến, chạy handler | lớp trong cùng |

Lớp 2 và 3 có thể đổi chỗ tuỳ cách bạn muốn log lỗi (log trong error boundary hay trong access log), nhưng phải nhất quán: một lỗi chỉ được log **một** lần.

## Tricks & tips thực tế

- **Luôn `await next()` và luôn `return` hoặc `await` mọi Promise trong middleware.** Lý do: Promise bị bỏ rơi biến lỗi thành `unhandledRejection` và phần "đường ra" chạy sai thời điểm (đã đo).
- **Bọc phần gọi chuỗi ở ngoài cùng bằng một `.catch` cuối cùng** (ngoài cả error boundary) để lỗi trong chính error boundary (bug trong định dạng lỗi) cũng không giết tiến trình. Lý do: lớp bắt lỗi cũng là code, cũng có bug.
- **Không lưu trạng thái request vào biến module.** Lý do: hai request đan xen tại điểm `await`; biến chung sẽ bị request này ghi đè khi request kia đang dùng. Dùng `ctx` hoặc `AsyncLocalStorage`.
- **Giữ middleware nhỏ, một trách nhiệm, và có thể test riêng:** gọi middleware với `ctx` giả và `next` là hàm ghi nhớ đã được gọi chưa. Lý do: dễ kiểm tra "không gọi next khi từ chối" mà không cần mở cổng.
- **Đặt tên cho middleware** (hàm có tên hoặc gán thuộc tính `name`) để stack trace và log chỉ ra lớp nào. Lý do: stack trace chứa `at async (anonymous)` thì không biết nó từ đâu.
- **Ghi lại thời điểm bắt đầu bằng `performance.now()` hoặc `process.hrtime.bigint()`**, không phải `Date.now()`: đồng hồ đơn điệu, không nhảy khi hệ thống chỉnh giờ.
- **Đừng biến `compose` thành thư viện tổng quát hoá quá sớm** (kiểu hỗ trợ mọi dạng `ctx`, hook, plugin). Lý do: repo này là học tập; mục tiêu là hiểu cơ chế. Chỉ thêm khi bài toán yêu cầu.
- **So với Laravel:** middleware Laravel có `handle` (trước/sau) và `terminate` (sau khi gửi response); ở Node, "sau khi gửi" là phần sau `await next()` hoặc sự kiện `res.on("close")`. Cẩn thận: code chạy sau khi response đã gửi vẫn chiếm event loop.
- **Debug "middleware không chạy":** in tên từng lớp khi vào/ra (hoặc dùng `diagnostics_channel`), kiểm tra lớp nào không gọi `next`, và kiểm tra thứ tự đăng ký. Hầu hết lỗi là một lớp trả response sớm hoặc quên `await`.

## Liên hệ bài tập

Khi thiết kế chuỗi middleware cho project, hãy tự trả lời: (1) Request id và access log nằm ở lớp nào, vì sao? (2) Điều gì xảy ra nếu một middleware gọi `next()` hai lần, bạn phát hiện và báo lỗi thế nào? (3) Làm sao chứng minh bằng test rằng lỗi ném ở handler đi qua đúng error boundary mà không đổ cả tiến trình? Chỉ có hướng; việc viết `compose` và các middleware là của bạn.

## Đọc thêm

- [Node.js: module `http`](https://nodejs.org/api/http.html)
- [Node.js: Anatomy of an HTTP Transaction](https://nodejs.org/en/learn/http/anatomy-of-an-http-transaction)
- [Node.js: module `stream`](https://nodejs.org/api/stream.html)

## Ghi chú của bạn
