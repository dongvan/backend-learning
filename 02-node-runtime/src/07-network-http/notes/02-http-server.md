# 2. `node:http` server: request và response là stream

`http.createServer` chỉ là một TCP server có thêm bộ phân tích HTTP; mỗi request đến là một cặp `IncomingMessage` (stream đọc) và `ServerResponse` (stream ghi). Mọi điều bạn quen ở framework (routing, body parser, JSON) đều **không có**, bạn tự làm.

```ts
import http from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

// Endpoint /time: trả JSON, có Content-Length, 404 cho đường dẫn khác
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (req.method === "GET" && url.pathname === "/time") {
    const body = JSON.stringify({ now: new Date().toISOString(), q: Object.fromEntries(url.searchParams) });
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),   // byte, không phải số ký tự
    });
    res.end(body);
    return;
  }
  res.writeHead(404).end();
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const { port } = server.address() as AddressInfo;

const r = await fetch(`http://127.0.0.1:${port}/time?tz=vn`);
console.log(r.status, await r.json());
server.close();
server.closeAllConnections();   // fetch giữ kết nối keep-alive; xem phần close() bên dưới
```

## Ý chính

- `req` là `Readable` (body), `res` là `Writable`. Body request đến theo từng chunk; **bạn phải đọc hoặc bỏ** nó, và **bạn phải tự giới hạn kích thước**.
- Header phải gửi trước body. `res.writeHead` / `res.setHeader` chỉ dùng được **trước** khi gửi byte đầu tiên; sau đó `ERR_HTTP_HEADERS_SENT`.
- Không có `Content-Length` thì Node tự dùng `Transfer-Encoding: chunked` (đã thấy khi `pipeline` vào `res`).
- Tên header trong `req.headers` luôn **chữ thường**; header trùng được gộp (`, `), riêng `set-cookie` là mảng; muốn nguyên bản dùng `req.rawHeaders`.
- Ba timeout quan trọng (Node 24.21 đã đọc mặc định): `headersTimeout` 60 s, `requestTimeout` 300 s, `keepAliveTimeout` 5 s (cộng thêm `keepAliveTimeoutBuffer` 1 s). `server.timeout` mặc định `0` (tắt).
- `server.close()` ngừng nhận kết nối mới, **không** cắt request đang chạy, và (Node 24.21) chỉ đóng ngay kết nối keep-alive đang **rảnh**; xem bài graceful shutdown.
- Lỗi cấp giao thức (cú pháp HTTP sai, header quá lớn, timeout header) **không** vào handler request mà vào sự kiện `'clientError'`.

## Lý thuyết chi tiết

**Đường đi của một request.** Socket TCP nhận byte → parser HTTP (llhttp, viết bằng C) phân tích dòng đầu và header → khi header đủ, Node tạo `IncomingMessage` và gọi handler **ngay**, trước khi nhận hết body → body đến sau dưới dạng `'data'` trên `req`. Nghĩa là handler chạy khi mới có header: bạn có thể từ chối sớm (401, 413) mà chưa tốn công đọc body.

**Đọc body: chunk, giới hạn, và vì sao cần giới hạn.** Có hai cách chặn: dựa vào `Content-Length` (khai báo, có thể sai hoặc vắng với chunked) và đếm byte thật.

```ts
import http from "node:http";
import { once } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

const MAX = 1024;

class PayloadTooLarge extends Error {
  readonly status = 413;
}

async function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  if (Number(req.headers["content-length"] ?? 0) > max) throw new PayloadTooLarge("quá lớn");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {              // req là async iterable
    size += (chunk as Buffer).length;
    if (size > max) throw new PayloadTooLarge("quá lớn");   // chặn cả khi chunked / khai báo sai
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const body = await readBody(req, MAX);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ bytes: body.length }));
  } catch (e) {
    const status = e instanceof PayloadTooLarge ? e.status : 500;
    // body chưa đọc hết còn nằm trên kết nối: đóng kết nối thay vì cố tái dùng
    res.writeHead(status, { connection: "close" }).end(`lỗi ${status}`);
  }
}).listen(0, "127.0.0.1");
await once(server, "listening");
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

for (const size of [10, 1024, 1025, 100_000]) {
  const r = await fetch(url, { method: "POST", body: Buffer.alloc(size) });
  console.log(size, "->", r.status);            // 200, 200, 413, 413 (Node 24.21 đã chạy)
}
server.close();
server.closeAllConnections();
```

Đã thử thêm client gửi `Transfer-Encoding: chunked` (5 mảnh x 400 byte, không có `Content-Length`): vẫn bị chặn 413 nhờ đếm byte thật; chỉ kiểm tra `Content-Length` sẽ lọt.

Vì sao `connection: close` khi từ chối: nếu trả 413 mà body phần còn lại vẫn đang truyền, parser phải biết bỏ qua đúng phần đó mới dùng lại được kết nối. Đóng kết nối là lựa chọn đơn giản và an toàn. Ngoài ra `for await` khi ném lỗi giữa chừng sẽ **destroy `req`**; đừng tiếp tục đọc.

Đối chiếu Laravel/PHP: PHP-FPM nhận body đã được Nginx đệm sẵn (`client_max_body_size` và `post_max_size`); với Node, **không ai chặn thay bạn**. Quên giới hạn nghĩa là một request 2 GB có thể hạ cả process.

**Header và status code.**

- `res.writeHead(status, headers)` ghi header ngay lúc đó (gộp với `setHeader` đã đặt trước). `res.statusCode = 204` + `res.end()` cũng được, header sẽ được gửi khi ghi byte đầu hoặc `end()`.
- Header mặc định Node thêm: `Date`, `Connection`, `Keep-Alive` (khi giữ kết nối), `Content-Length` hoặc `Transfer-Encoding`. Không tự thêm `Content-Type`, nên nhớ đặt và nhớ `charset=utf-8` cho text.
- `Content-Length` đếm **byte**: dùng `Buffer.byteLength(str)`; dùng `str.length` sẽ sai với tiếng Việt (ký tự đa byte) và treo hoặc cắt cụt phản hồi.
- Gửi nhiều `Set-Cookie`: truyền mảng (`res.setHeader("Set-Cookie", ["a=1", "b=2"])`); client `fetch` đọc bằng `headers.getSetCookie()` (đã chạy).
- Status code quan trọng cho backend: 400 (sai cú pháp/validate), 401 vs 403, 404, 405 (kèm `Allow`), 408, 413, 415, 422, 429 (kèm `Retry-After`), 500, 502 (upstream trả sai), 503 (quá tải hoặc đang tắt), 504 (upstream timeout).
- HEAD: handler vẫn chạy; Node bỏ phần body khi gửi, nhưng bạn đừng tốn công tạo nó.

**Ghi sau khi kết thúc (cạm bẫy thật).** Đã đo trên Node 24.21:

```ts
res.end("x");
res.setHeader("x-late", "1");   // ném ERR_HTTP_HEADERS_SENT
res.write("again");             // KHÔNG ném; phát 'error' ERR_STREAM_WRITE_AFTER_END trên res
```

Lỗi thứ hai bị phát thành sự kiện `'error'` trên `res`; không có listener thì **process sập** (kể cả khi bạn truyền callback cho `write`, callback vẫn được gọi nhưng lỗi vẫn bị ném). Thường gặp khi code có hai nhánh cùng trả lời (thiếu `return` sau `res.end()`).

**Streaming và backpressure ở response.** `res.write()` trả `false` khi bộ đệm socket đầy; dùng `pipeline(readable, res)` thay vì tự vòng lặp:

```ts
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
// trong handler:
res.writeHead(200, { "content-type": "text/plain" });          // không Content-Length -> chunked
await pipeline(Readable.from(["a\n", "b\n", "c\n"]), res);     // tự lo backpressure, tự end(), tự destroy khi lỗi
```

**Phát hiện client bỏ đi.** Đừng dựa vào `req.on("aborted")` (đã deprecated). Dùng `res.on("close")` rồi kiểm tra `res.writableFinished` (hoặc `writableEnded`): `close` mà chưa `finished` nghĩa là kết nối đứt trước khi trả lời xong. Ví dụ proxy ngay dưới đã chạy: khi client bỏ, bạn nên **huỷ việc đang làm** (huỷ request upstream, `AbortController` cho truy vấn DB) thay vì cứ chạy tiếp cho một người đã không còn đó.

```ts
// proxy nhỏ: huỷ upstream khi client bỏ đi (mẫu minh hoạ, đã chạy, không phải lời giải lab)
import http from "node:http";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";

function forward(upPort: number): http.RequestListener {
  return async (req, res) => {
    const up = http.request({ port: upPort, host: "127.0.0.1", path: req.url, method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${upPort}` } });
    res.on("close", () => { if (!res.writableFinished) up.destroy(); });    // client đi -> bỏ upstream
    try {
      const [upRes] = (await Promise.all([once(up, "response"), pipeline(req, up).catch(() => {})])) as [[http.IncomingMessage], unknown];
      res.writeHead(upRes[0].statusCode ?? 502, upRes[0].headers);
      await pipeline(upRes[0], res);
    } catch (e) {
      if (!res.headersSent) res.writeHead(502).end("bad gateway: " + (e as NodeJS.ErrnoException).code);
      else res.destroy();
    }
  };
}
```

Đã chạy với upstream "nhỏ giọt": khi client huỷ `fetch`, log của upstream báo `res close, writableEnded=false` sau vài chục ms, tức việc huỷ lan truyền đúng.

**Keep-alive và các timeout (Node 24.21, đã đo).**

| Thuộc tính | Mặc định | Làm gì |
|---|---|---|
| `server.headersTimeout` | 60 000 ms | Thời gian tối đa để nhận **toàn bộ header** của một request (chống slowloris) |
| `server.requestTimeout` | 300 000 ms | Thời gian tối đa để nhận **toàn bộ request** (header + body). `0` = tắt |
| `server.keepAliveTimeout` | 5 000 ms | Chờ request kế tiếp trên kết nối rảnh trước khi đóng |
| `server.keepAliveTimeoutBuffer` | 1 000 ms | Khoảng đệm cộng thêm vào `keepAliveTimeout` (xem dưới) |
| `server.timeout` | 0 | Timeout rảnh của socket (hiếm khi cần) |
| `server.maxRequestsPerSocket` | 0 | Số request tối đa trên một kết nối (0 = không giới hạn) |
| `server.maxHeadersCount` | `null` | Số header tối đa (null = không giới hạn); kích thước header giới hạn bởi `http.maxHeaderSize` = 16 KiB |

Thí nghiệm với `headersTimeout: 300, requestTimeout: 600, keepAliveTimeout: 400, connectionsCheckingInterval: 50`:

- Gửi dở header rồi nhỏ giọt: sau ~310 ms server phát `clientError` với `code: "ERR_HTTP_REQUEST_TIMEOUT"`.
- Header đủ, `Content-Length: 100` nhưng body nhỏ giọt: sau ~600 ms từ lúc bắt đầu cũng `ERR_HTTP_REQUEST_TIMEOUT`.
- Request hoàn chỉnh, rồi để rảnh: socket đóng sau **~1400 ms = `keepAliveTimeout` + 1000 ms buffer** (đo nhiều lần; header phản hồi vẫn quảng cáo `Keep-Alive: timeout=<keepAliveTimeout/1000>`, không tính buffer).

Hai điều dễ nhầm. Một, `headersTimeout` và `requestTimeout` chỉ được kiểm tra theo chu kỳ `connectionsCheckingInterval` (mặc định 30 s) nên mặc định trong thực tế có thể "trễ" đến vài chục giây; test phải hạ chu kỳ này như trên. Hai, `requestTimeout` tính trên **toàn bộ request**, nên upload lớn qua mạng chậm có thể bị cắt; tăng nó hoặc để reverse proxy/Nginx lo upload.

**Sự kiện `'clientError'`.** Đã gửi lên server (Node 24.21, không có handler tuỳ chỉnh, `maxHeaderSize: 1024`, `headersTimeout: 200`):

| Gửi gì | Phản hồi mặc định |
|---|---|
| Rác không phải HTTP | `400 Bad Request` + `Connection: close` |
| Header 2000 byte khi giới hạn 1024 | `431 Request Header Fields Too Large` |
| Header chậm | `408 Request Timeout` |
| HTTP/1.1 thiếu `Host` | `400 Bad Request` |
| Method lạ `FOO` | `400 Bad Request` |

Nếu bạn gắn `server.on("clientError", (err, socket) => ...)` thì **bạn chịu trách nhiệm** đóng socket và (nếu muốn) ghi phản hồi; trong lần thử đầu tôi chỉ `socket.destroy()` nên client nhận **không gì cả** thay vì 408. Chỉ gắn handler này để log, và tự ghi `HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n` rồi `socket.end()` nếu `socket.writable`.

**`server.close()` thực sự làm gì.** Chi tiết (và thí nghiệm) ở bài 5. Tóm tắt Node 24.21: dừng listen ngay (kết nối mới bị `ECONNREFUSED`), đóng ngay kết nối **rảnh**, để request đang chạy xong, nhưng một kết nối keep-alive vừa xong request sau khi gọi `close()` **vẫn giữ** `Connection: keep-alive` và sống thêm `keepAliveTimeout` + buffer.

**Đối chiếu Nginx / PHP-FPM.** Nginx có `client_header_timeout`, `client_body_timeout`, `keepalive_timeout`, `client_max_body_size`, `large_client_header_buffers`: đúng bộ các giới hạn mà ở Node bạn phải tự đặt hoặc nhờ reverse proxy đặt. Khi Node sau Nginx, Nginx giữ keep-alive với client và thường mở kết nối **ngắn hoặc tái dùng** tới Node; đặt `keepAliveTimeout` của Node **lớn hơn** timeout idle của load balancer phía trước (ví dụ ALB 60 s) để tránh race: LB gửi request vào đúng lúc Node đóng kết nối rảnh, sinh lỗi 502 ngẫu nhiên (kiến thức từ tài liệu và kinh nghiệm vận hành, chưa tái hiện ở đây).

## Tricks & tips thực tế

- **Đặt giới hạn body ngay từ đầu** (đếm byte thật, không chỉ tin `Content-Length`) vì Node không có `post_max_size`. Lý do: một request lớn hoặc chunked vô tận ăn hết RAM, và đây là lỗ hổng DoS rẻ nhất.
- **`return` sau mỗi lần trả lời**, hoặc dùng cấu trúc if/else-if đầy đủ. Lý do: ghi sau `end()` cho lỗi `ERR_STREAM_WRITE_AFTER_END` có thể sập process (đã đo).
- **Dùng `Buffer.byteLength` cho `Content-Length`**, không dùng `.length`. Lý do: tiếng Việt có ký tự đa byte, sai độ dài làm client treo hoặc cụt phản hồi.
- **`async` handler phải bắt lỗi**: `createServer(async (req, res) => {...})` mà ném lỗi thì thành unhandled rejection (có thể kill process tuỳ cấu hình), và client **treo** vì không ai trả lời. Bọc `try/catch` ở ngoài cùng và luôn trả lời (500) nếu `!res.headersSent`.
- **Gắn handler `'clientError'` để log**, nhưng ghi và đóng phản hồi đàng hoàng. Lý do: nếu chỉ `destroy()` client không nhận được gì, khó debug phía họ.
- **Hạ `connectionsCheckingInterval` trong test khi thử timeout** (như đã làm), nếu không phải chờ đến 30 s mới thấy `headersTimeout` hoạt động.
- **Đừng tăng `headersTimeout`/`requestTimeout` về `0` ở server public**: nó là lớp phòng thủ cơ bản chống slowloris. Nếu đã có Nginx/ALB phía trước, vẫn nên giữ làm lớp thứ hai.
- **Đặt `keepAliveTimeout` > idle timeout của LB** (và `headersTimeout` > `keepAliveTimeout`). Lý do: tránh 502 ngẫu nhiên do race đóng kết nối (kiến thức từ tài liệu, chưa tái hiện).
- **Đừng parse body bằng nối chuỗi** (`body += chunk`): ký tự UTF-8 bị cắt ở biên chunk. Gom `Buffer` rồi `toString("utf8")` một lần, hoặc `setEncoding`.
- **Với route nhiều, dùng `new URL(req.url, "http://x")`** để tách path/query; `req.url` là chuỗi thô gồm cả query. Lý do: tách thủ công hay sai với `%`-encoding và `?` trong giá trị.
- **Test thủ công bằng `curl -v`** để nhìn đúng header thô (xem bài 6) thay vì tin vào code client có thể đã sửa header.

## Liên hệ bài tập

Phần HTTP server thuần của lab: bạn sẽ cần route tối thiểu, đọc body JSON có giới hạn, trả đúng status/header, và xử lý lỗi không để client treo. Hãy tự trả lời trước khi viết: khi body quá lớn thì phản hồi gì và có đóng kết nối không? Khi handler ném lỗi thì ai trả lời client? Khi client bỏ giữa chừng thì handler có biết không? Thử cố ý gửi header chậm bằng `nc`/socket thô và xem `clientError`. (Routing/middleware/centralized error handling có hệ thống là việc của Project Bài 9, không làm trước ở đây.)

## Đọc thêm

- [Node.js: `http`](https://nodejs.org/api/http.html)
- [Node.js: Anatomy of an HTTP Transaction](https://nodejs.org/en/learn/http/anatomy-of-an-http-transaction)
- [MDN: HTTP Messages](https://developer.mozilla.org/en-US/docs/Web/HTTP/Messages)
- [MDN: HTTP response status codes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status)

## Ghi chú của bạn
