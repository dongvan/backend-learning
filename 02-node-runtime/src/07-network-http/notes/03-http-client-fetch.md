# 3. HTTP client: `fetch`, timeout, lỗi mạng và `http.Agent`

`fetch` toàn cục của Node (do **undici** cài sẵn) là client HTTP mặc định; nó chỉ `reject` khi **không nhận được phản hồi** (lỗi mạng, huỷ, timeout), còn `404`/`500` vẫn là phản hồi "thành công" mà bạn phải tự kiểm tra `res.ok`.

```ts
import http from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

const server = http.createServer((req, res) => {
  if (req.url === "/missing") res.writeHead(404, { "content-type": "application/json" }).end('{"error":"nope"}');
  else res.end("ok");
}).listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const r = await fetch(`${base}/missing`);
console.log(r.status, r.ok, await r.json());      // 404 false { error: 'nope' }  <- KHÔNG throw

class HttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {   // không dùng parameter property: Node chạy .ts trực tiếp không hỗ trợ
    super(`HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}
async function getJson<T>(url: string, ms = 3000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new HttpError(res.status, await res.text());   // đọc/đóng body trước khi ném
  return (await res.json()) as T;
}
try { await getJson(`${base}/missing`); } catch (e) { console.log(e instanceof HttpError, (e as HttpError).status); }
server.close(); server.closeAllConnections();
```

## Ý chính

- `fetch` **không throw** với 4xx/5xx. Bạn phải kiểm tra `res.ok` (hoặc `res.status`). Khác Guzzle/Laravel `Http::` (mặc định ném khi `->throw()`; Guzzle ném với `http_errors` bật).
- `fetch` **throw** khi lỗi mạng: `TypeError: fetch failed`, nguyên nhân thật nằm ở **`err.cause`** (ví dụ `ECONNREFUSED`).
- Timeout: `AbortSignal.timeout(ms)` ném `TimeoutError`; huỷ thủ công qua `AbortController` ném giá trị bạn truyền vào `abort(reason)`. **`fetch` mặc định không có timeout tổng** (undici có timeout header/body nhưng khá dài), nên luôn đặt.
- Signal vẫn hiệu lực **sau khi có header**: đang đọc body mà hết hạn thì `res.text()` reject (đã thử: `TimeoutError`).
- Phải **tiêu thụ hoặc huỷ body** của mỗi phản hồi, không thì kết nối bị giữ (đã đo với body 8 MiB).
- `http.Agent` quản lý pool kết nối cho `http.request`; từ Node 19 `http.globalAgent` đã `keepAlive: true` (Node 24.21 đã in `keepAlive: true, timeout: 5000, noDelay: true`).

## Lý thuyết chi tiết

**Phân biệt ba loại thất bại.**

| Loại | Ví dụ | `fetch` làm gì |
|---|---|---|
| Lỗi mạng | `ECONNREFUSED`, `ECONNRESET`, DNS lỗi, TLS lỗi | `reject` với `TypeError("fetch failed")`, `cause` chứa `code` |
| Huỷ/timeout | `AbortSignal.timeout`, `abort()` | `reject` với `TimeoutError` hoặc `AbortError` hoặc lý do bạn đưa |
| Lỗi HTTP | 404, 500, 503 | **resolve** bình thường; `ok === false` |

Đã chạy (Node 24.21):

```text
refused: TypeError | fetch failed | cause: ECONNREFUSED connect ECONNREFUSED 127.0.0.1:<port>
timeout: TimeoutError | The operation was aborted due to timeout
abort:   Error người dùng huỷ              # abort(new Error(...)) -> chính lý do đó được ném
đọc body (hết hạn khi đang đọc): TimeoutError
```

Điều này quyết định chiến lược retry: lỗi mạng và 502/503/504 thường **retry được** (nếu thao tác idempotent: GET, PUT, DELETE, hoặc POST có idempotency key); 4xx nói chung **không** nên retry (trừ 408, 429 kèm `Retry-After`). Bắt lỗi theo `err.name === "TimeoutError"`, `err.cause?.code`, `res.status`, không so khớp chuỗi message.

**`AbortSignal` và vì sao timeout bằng `setTimeout` thủ công là cách kém.** `AbortSignal.timeout(ms)` tạo signal tự `abort` sau `ms` (timer không giữ process sống). Nó huỷ **cả** việc chờ header lẫn đọc body (vì signal vẫn gắn vào luồng). Kết hợp nhiều nguồn huỷ bằng `AbortSignal.any([AbortSignal.timeout(5000), userSignal])`. Khi `fetch` bị huỷ, kết nối TCP đó **bị đóng** (server thấy `req` `close`, đã thấy log phía server "client đã bỏ"), không quay lại pool: tránh trả về dữ liệu rác lần sau.

Một request nội bộ nên có **timeout theo từng lớp**: timeout tổng của thao tác và timeout từng lần gọi (nhỏ hơn). Truyền cùng `signal` xuống mọi lời gọi (HTTP, DB) để khi người dùng bỏ hoặc hết hạn thì mọi thứ dừng, như `res.on("close")` huỷ upstream ở bài 2.

**Body là stream; không đọc là rò kết nối.** HTTP/1.1 chỉ dùng lại kết nối khi phản hồi đã được đọc hết. Đã đo với server trả 8 MiB:

- 4 lần `fetch` **không đọc body**: mở **4** kết nối (không thể tái dùng, mỗi kết nối kẹt vì chưa ai đọc).
- 4 lần `fetch` + `await res.body?.cancel()`: kết nối cũng không được tái dùng (đo được 5 kết nối cho 4 lần; chưa rõ vì sao nhiều hơn 4, nên đừng suy diễn thêm). `cancel()` giải phóng bộ nhớ nhưng không cứu kết nối.
- Với body **nhỏ**, `fetch` không đọc body mà kết nối vẫn tái dùng được (body nhỏ đã nằm đủ trong buffer): đừng suy ra là an toàn, vì khi server trả body lớn bất ngờ sẽ rò.

Quy tắc: luôn `await res.json()` / `res.text()` / `res.arrayBuffer()`, hoặc `res.body.cancel()` nếu thật sự bỏ (chấp nhận mất kết nối). Khi `!res.ok`, vẫn phải đọc hoặc huỷ body.

**`http.Agent` và pool.** `fetch` có pool riêng của undici (mỗi origin một pool); `http.request` dùng `http.Agent`. Hành vi `Agent` đã đo (server giả mất 200 ms/request):

| Cấu hình | Kết nối TCP mở | Ghi chú |
|---|---|---|
| `agent: false` (mỗi request một kết nối), 5 request tuần tự | 5 | Tốn handshake mỗi lần |
| `keepAlive: true`, 5 tuần tự | 1 | Tái dùng |
| `keepAlive: true`, 4 song song x 3 vòng | 4 | Pool lớn bằng độ song song |
| `maxSockets: 2`, 4 song song | 2 | 2 request **xếp hàng** trong `agent.requests` chờ socket |
| `fetch` tuần tự x5 | 2 | undici cũng tái dùng, ít kết nối (không phải 5) |

`maxSockets` mặc định `Infinity`: một vòng lặp gọi 10 000 request song song mở 10 000 kết nối. Đặt `maxSockets` để tạo giới hạn cho từng host và xếp hàng phần dư (hàng đợi nằm trong bộ nhớ, `agent.requests`). `agent.destroy()` đóng các socket rảnh khi tắt chương trình; nếu không process có thể không thoát vì socket keep-alive còn mở (`timeout` mặc định 5 s của globalAgent giúp việc này tự hết).

**Race "kết nối keep-alive bị server đóng đúng lúc gửi".** Client lấy socket rảnh trong pool để gửi request, trong khi server vừa đóng nó (hết `keepAliveTimeout`). Kết quả: `ECONNRESET` hoặc `socket hang up` trên một request vốn hợp lệ. Giảm bằng cách đặt timeout rảnh phía client **nhỏ hơn** `keepAliveTimeout` phía server (client bỏ socket trước), và retry các thao tác idempotent một lần. (Kiến thức từ tài liệu và kinh nghiệm; chưa dựng lại ở đây.)

**Streaming upload với `fetch`.** Body có thể là `ReadableStream`; khi đó phải đặt `duplex: "half"` (đã dùng khi thử body chunked). Phía server nhận bằng `Transfer-Encoding: chunked`. Dùng khi đẩy file lớn hoặc dữ liệu sinh dần, thay vì dựng hết trong RAM.

**Header mặc định của `fetch`.** `fetch` tự thêm `accept: */*`, `accept-language: *`, `sec-fetch-mode: cors`, `user-agent: node`, `accept-encoding: gzip, deflate` (đã thấy phía server) và giải nén phản hồi tự động. Đừng tự tin vào "request trông như thế này"; nhìn thực tế bằng `curl -v` hoặc log phía server.

**So với Laravel/PHP.** `Http::get()` (Guzzle/cURL) mở kết nối cho mỗi request PHP-FPM và đóng khi request kết thúc: không có pool dùng chung giữa các request của người dùng. Trong Node, pool sống cùng process, được dùng chung bởi **mọi** request đồng thời; vì vậy `maxSockets`, timeout, và việc đọc body là vấn đề của cả hệ thống, không chỉ của một request.

## Tricks & tips thực tế

- **Luôn đặt timeout** (`AbortSignal.timeout`) cho mọi `fetch` ra ngoài. Lý do: mặc định không có timeout tổng; một upstream treo làm tích tụ request treo đến khi cạn bộ nhớ/kết nối.
- **Bọc `fetch` thành hàm riêng** (kiểm tra `ok`, ném lỗi có kiểu, đặt timeout, đọc body). Lý do: quên `res.ok` là lỗi phổ biến nhất, một chỗ dùng chung giúp không lặp lại.
- **Phân biệt lỗi bằng `err.cause?.code` và `err.name`**, không bằng message. Lý do: message thay đổi giữa phiên bản, `TypeError: fetch failed` che thông tin thật.
- **Luôn đọc hoặc huỷ body, kể cả khi `!res.ok`.** Lý do: kết nối kẹt ngốn socket (đã đo 4 request thành 4 kết nối).
- **Retry có điều kiện**: chỉ thao tác idempotent, lỗi mạng hoặc 502/503/504/429, có backoff và giới hạn lần, tổng thời gian gói trong một `AbortSignal`. Lý do: retry mù quáng tạo "bão retry" làm sập chính upstream đang yếu.
- **Đặt `maxSockets` cho agent gọi dịch vụ ngoài** nếu bạn không muốn dịch vụ đó bị quá tải bởi chính process của bạn. Lý do: mặc định không giới hạn.
- **Khi test, nhớ `agent.destroy()` / `server.closeAllConnections()`**; nếu không, kết nối keep-alive giữ process hoặc `server.close()` chờ 5-6 giây (xem bài 5).
- **Không dùng `fetch` cho nội bộ cần kiểm soát sâu** (proxy: stream header nguyên bản, `Connection` hop-by-hop): `http.request` cho kiểm soát thấp hơn (ví dụ proxy ở bài 2). `fetch` chuẩn hoá nhiều thứ và hạn chế một số header (kiến thức từ tài liệu).
- **Debug**: `NODE_DEBUG=http` cho log `http` (kiểu `HTTP <pid>: SERVER new http connection`) ở phía `http`; `fetch` (undici) có hệ thống chẩn đoán riêng, chưa thử ở đây. Dùng thêm `curl -v` để đối chiếu hành vi (xem bài 6).

## Liên hệ bài tập

Lab không bắt buộc client, nhưng khi test server của mình bạn sẽ gọi nó bằng `fetch`: hãy tự quan sát (1) phản hồi 404/500 của server bạn có làm `fetch` throw không (không), (2) số kết nối server thấy (`server.on("connection")`) khi gọi tuần tự nhiều lần, (3) điều gì xảy ra nếu bạn cố ý không đọc body. Đây cũng là cách kiểm tra drain ở lab graceful shutdown: client keep-alive nào còn nối khi server tắt?

## Đọc thêm

- [Node.js: Fetch (nodejs.org/en/learn)](https://nodejs.org/en/learn/getting-started/fetch)
- [MDN: Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
- [MDN: `AbortSignal.timeout()`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static)
- [Node.js: `http.Agent`](https://nodejs.org/api/http.html#class-httpagent)

## Ghi chú của bạn
