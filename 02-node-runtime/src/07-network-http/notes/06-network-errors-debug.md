# 6. Lỗi mạng thường gặp và cách debug

Hầu hết "lỗi mạng" trong Node quy về vài mã `err.code` và vài trạng thái socket; biết mã nào xuất hiện ở **lớp nào** (kernel, `net`, `http`, `fetch`) và ai là bên gây ra giúp bạn đoán đúng nguyên nhân trong vài phút thay vì vài giờ.

```ts
import http from "node:http";
import net from "node:net";
import { once } from "node:events";

// Server đóng socket giữa chừng; xem cùng một sự cố ở hai client khác nhau
const server = http.createServer((req, res) => {
  if (req.url === "/die") req.socket.destroy();   // không trả lời gì
  else res.end("ok");
}).listen(0, "127.0.0.1");
await once(server, "listening");
const port = (server.address() as net.AddressInfo).port;

const req = http.get({ port, host: "127.0.0.1", path: "/die", agent: false });
req.on("error", (e: NodeJS.ErrnoException) => console.log("http.get:", e.code, "|", e.message));
await new Promise((r) => req.on("close", r));

try { await fetch(`http://127.0.0.1:${port}/die`); } catch (e) {
  const x = e as Error & { cause?: NodeJS.ErrnoException };
  console.log("fetch:", x.message, "| cause:", x.cause?.code, x.cause?.message);
}
server.close(); server.closeAllConnections();
// http.get: ECONNRESET | socket hang up
// fetch: fetch failed | cause: UND_ERR_SOCKET other side closed        (Node 24.21 đã chạy)
```

## Ý chính

- Cùng một sự cố có **tên khác nhau** theo client: `http` báo `ECONNRESET`/`socket hang up`, `fetch` báo `TypeError: fetch failed` với `cause.code = UND_ERR_SOCKET` (mã của undici, không phải mã hệ điều hành).
- Lỗi thật của `fetch` nằm ở **`err.cause`**; in `err` không đủ, hãy in `err.cause` (hoặc `util.inspect(err, { depth: 5 })`).
- Quy trình debug theo tầng: **tiến trình có nghe không** (`ss -ltnp`/`lsof -i`) → **tới được không** (`curl -v`, `nc -vz`) → **hai bên nói gì** (`curl -v`, `NODE_DEBUG=http`, `tcpdump`) → **tiến trình có phản hồi kịp không** (event loop bị chặn?).
- `curl -v` cho biết **ở bước nào thất bại**: `Trying` (DNS xong), `Connected` (TCP xong), `>` (request đã gửi), `<` (phản hồi). Thiếu `Connected` là sự cố mạng/cổng; có `Connected` nhưng không có `<` là sự cố ứng dụng (treo, event loop bị chặn).
- Event loop bị chặn **trông như lỗi mạng**: TCP vẫn kết nối được (kernel + backlog), nhưng không có byte nào về.

## Lý thuyết chi tiết

**Bảng mã lỗi (đã tái hiện trừ khi ghi chú).**

| Mã | Lớp | Ai/gì gây ra | Cách nghĩ |
|---|---|---|---|
| `EADDRINUSE` | `listen` | Cổng đang bị tiến trình khác giữ (hoặc chính bạn khởi chạy hai lần) | `ss -ltnp` tìm PID; trong test dùng cổng `0` |
| `EACCES` (listen) | `listen` | Cổng < 1024 mà không có quyền (kiến thức từ tài liệu, chưa thử) | Dùng cổng cao, hoặc proxy ở trước |
| `EADDRNOTAVAIL` | `listen`/`connect` | Địa chỉ không thuộc máy này (kiến thức từ tài liệu, chưa thử) | Sai IP/interface |
| `ECONNREFUSED` | `connect` | Không ai nghe ở `ip:port` (kernel trả RST) | Server chưa chạy/sai cổng/đã `close()`; xảy ra **tức thì** |
| `ECONNRESET` | `read`/`write` | Peer gửi RST giữa chừng (crash, `destroy` thô, LB cắt) | Bình thường ở mức nhỏ; xem kết nối keep-alive cũ |
| `EPIPE` | `write` | Ghi vào kết nối peer đã đóng | Thiếu kiểm tra, client bỏ sớm |
| `ETIMEDOUT` | `connect`/`read` | Không phản hồi (firewall drop, mạng đứt, kernel hết lượt keepalive) | Khác `ECONNREFUSED`: ở đây **im lặng** (kiến thức từ tài liệu, chưa thử) |
| `ENOTFOUND` / `EAI_AGAIN` | DNS | Tên không phân giải được / DNS tạm lỗi | Kiểm tra `getent hosts`, DNS (kiến thức từ tài liệu, chưa thử) |
| `EMFILE` | mọi nơi | Hết file descriptor của process (mỗi socket là một fd) | `ulimit -n`, rò rỉ socket, không giới hạn song song |
| `socket hang up` (`ECONNRESET`) | `http` client | Server đóng kết nối **trước khi gửi phản hồi** | Đã tái hiện: server `destroy()` socket |
| `UND_ERR_SOCKET` ("other side closed") | undici/`fetch` | Tương tự trên | Xem `cause.message` |
| `ERR_HTTP_REQUEST_TIMEOUT` | `clientError` | Client gửi header/body quá chậm (Bài 2, đã tái hiện) | `headersTimeout`/`requestTimeout` |
| `ERR_HTTP_HEADERS_SENT` | `http` server | Đặt header sau khi đã gửi (đã tái hiện) | Hai nhánh cùng trả lời |
| `ERR_STREAM_WRITE_AFTER_END` | stream | Ghi sau `end()` (đã tái hiện, có thể làm sập process nếu không có `'error'`) | Thiếu `return` |
| `ERR_SERVER_NOT_RUNNING` | `close()` | Gọi `close()` hai lần (đã tái hiện) | Cờ `shuttingDown` |
| `ERR_UNHANDLED_ERROR`/process sập | bất kỳ | `'error'` của emitter không có listener | Gắn `on("error")` cho socket/server/`res` |

**Phân biệt lỗi do ai.** Một khung đơn giản:

- Lỗi xảy ra khi **kết nối** (`connect`, `ECONNREFUSED`, `ETIMEDOUT`, DNS): vấn đề địa chỉ, firewall, dịch vụ đích chưa chạy.
- Lỗi xảy ra khi **kết nối đã mở** (`ECONNRESET`, `EPIPE`, `socket hang up`): peer hoặc thiết bị giữa chừng (proxy/LB/NAT) đóng; thường liên quan timeout rảnh, crash, hoặc giới hạn kích thước.
- **Không có lỗi mà chỉ treo**: peer chậm, event loop bị chặn, deadlock, hoặc mạng drop im lặng; cần timeout để biến nó thành lỗi có tên.
- Lỗi **HTTP** (4xx/5xx): kết nối tốt, vấn đề ở tầng ứng dụng. `fetch` không throw cho loại này (bài 3).

**Event loop bị chặn nhìn từ bên ngoài.** Đã gặp một cách vô tình trong lúc viết thí nghiệm: gọi `execFileSync("curl", ...)` ngay trong cùng process với server. Server không thể phục vụ vì event loop đứng chờ `curl`, nên `curl` báo:

```text
* Connected to 127.0.0.1 (127.0.0.1) port 37869
> GET /x HTTP/1.1
...
* Operation timed out after 3000 milliseconds with 0 bytes received
```

`Connected` có (kernel nhận kết nối vào backlog), `>` có (request đã gửi), nhưng **không có `<`**. Đây là dấu hiệu điển hình "process còn sống nhưng đang bận". Hãy dùng `ss -tn` để xem `Recv-Q` của kết nối tăng (byte chưa được ứng dụng đọc), và đo độ trễ event loop (`perf_hooks.monitorEventLoopDelay`, xem bài về event loop). Đừng bao giờ dùng hàm `*Sync` của `child_process`/`fs` trong server.

**Công cụ (đã chạy, Linux).**

`ss` (socket statistics, thay `netstat`):

```bash
ss -ltnp                  # -l LISTEN, -t TCP, -n số (không phân giải tên), -p tiến trình sở hữu
ss -ltnp 'sport = :3000'  # lọc theo cổng
ss -tn state established '( sport = :3000 )'
```

Đầu ra thật (Node 24.21, cổng ngẫu nhiên):

```text
State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process
LISTEN 0      511        127.0.0.1:36453      0.0.0.0:*    users:(("MainThread",pid=37211,fd=21))
```

Tên tiến trình hiển thị là `MainThread` (tên thread chính của Node), **không phải `node`**; dùng PID để tìm. `Send-Q 511` ở dòng LISTEN là backlog; ở kết nối ESTAB, `Recv-Q` lớn là ứng dụng đọc chậm, `Send-Q` lớn là peer nhận chậm.

`lsof -i` (list open files; socket là file):

```bash
lsof -nP -i :3000                         # ai đang dùng cổng 3000
lsof -nP -a -p <PID> -iTCP                # mọi socket TCP của một tiến trình
```

Đầu ra thật:

```text
COMMAND     PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
MainThrea 41074  dng   21u  IPv4 121413      0t0  TCP 127.0.0.1:43955 (LISTEN)
MainThrea 41074  dng   22u  IPv4 121418      0t0  TCP 127.0.0.1:34552->127.0.0.1:43955 (ESTABLISHED)
```

Đếm dòng của một PID là cách nhanh để thấy **rò rỉ kết nối** (số ESTABLISHED/CLOSE_WAIT tăng mãi). `CLOSE_WAIT` chất đống nghĩa là peer đã đóng nhưng **ứng dụng bạn chưa `close`** socket (lỗi của bạn, thường quên `destroy`/đọc body).

`curl -v` (xem đúng byte HTTP):

```bash
curl -sv -o /dev/null --max-time 3 http://127.0.0.1:3000/x
curl -sv --http1.1 -H "Connection: close" http://127.0.0.1:3000/   # thử không keep-alive
curl -w '%{time_connect} %{time_starttransfer} %{time_total}\n' -o /dev/null -s http://127.0.0.1:3000/
```

Đầu ra thật của phản hồi:

```text
< HTTP/1.1 200 OK
< x-demo: 1
< Date: ...
< Connection: keep-alive
< Keep-Alive: timeout=5
< Content-Length: 2
```

Dòng `Connection: keep-alive` / `Keep-Alive: timeout=5` cho thấy server giữ kết nối và bạn dễ đối chiếu với cấu hình `keepAliveTimeout` (bài 2). `-w` tách thời gian: `time_connect` lớn là mạng/LB, `time_starttransfer - time_connect` lớn là ứng dụng chậm.

`nc` (netcat): `nc -vz 127.0.0.1 3000` kiểm tra nhanh cổng có mở không; `printf 'GET / HTTP/1.1\r\nHost: x\r\n\r\n' | nc 127.0.0.1 3000` gửi HTTP thô, tiện thử `clientError` và header chậm.

`tcpdump` (giới thiệu; cần root, kiến thức từ tài liệu, chưa chạy ở đây): bắt gói để thấy handshake (SYN, SYN-ACK, ACK), FIN, RST, retransmission.

```bash
sudo tcpdump -i lo -nn 'tcp port 3000'          # loopback, không phân giải tên
sudo tcpdump -i lo -nn -A 'tcp port 3000'       # in kèm nội dung ASCII (HTTP không mã hoá)
sudo tcpdump -i lo -nn 'tcp[tcpflags] & (tcp-rst) != 0'   # chỉ gói RST
```

Dùng khi nhật ký ứng dụng không giải thích được ai đóng kết nối: thấy **RST** hay **FIN** và từ phía nào. Với TLS bạn chỉ thấy byte mã hoá. Wireshark đọc được file `-w out.pcap` cho phân tích sâu hơn.

`NODE_DEBUG` (log nội bộ của Node ra stderr; đã chạy):

```bash
NODE_DEBUG=http node server.ts      # luồng http: connection, write, outgoing message end, socket close
NODE_DEBUG=net node server.ts       # net: setupListenHandle, bind, createConnection
NODE_DEBUG=http,net node server.ts  # có thể gộp
```

Mẫu thật (`NODE_DEBUG=http`):

```text
HTTP 37299: SERVER new http connection
HTTP 37299: write ret = true
HTTP 37299: outgoing message end.
HTTP 37299: server socket close
```

(`37299` là PID.) Giá trị là xem **thứ tự** và có sự kiện hay không (kết nối có mở không, phản hồi có `end` không), không phải nội dung. `NODE_DEBUG` ghi ra **stderr** và có thể rất ồn; không để bật ở production. Phần `fetch`/undici có kênh chẩn đoán riêng (`diagnostics_channel`), chưa thử ở đây.

**Kiểm tra từ trong Node.** `server.on("connection", ...)` để đếm kết nối mới; `server.getConnections(cb)` để lấy số đang mở (đã dùng); `socket.remoteAddress/remotePort`; `process.getActiveResourcesInfo()` liệt kê handle đang giữ process (hữu ích khi "tại sao process không thoát"); `server.listening`. Với "process không thoát": một `setInterval`, socket keep-alive, hoặc socket upgrade chưa đóng là thủ phạm thường gặp (bài 5).

**Cổng bận và TIME_WAIT.** `EADDRINUSE` còn xảy ra khi bạn khởi động lại nhanh: socket cũ ở `TIME_WAIT` thường **không** chặn việc `listen` của Node (libuv đặt `SO_REUSEADDR` trên Linux; kiến thức từ tài liệu, chưa thử), nên nguyên nhân thường gặp hơn là tiến trình cũ chưa chết (`ss -ltnp` để thấy). `TIME_WAIT` nhiều là bình thường ở phía **client chủ động đóng**; chỉ đáng lo khi bạn mở/đóng hàng chục nghìn kết nối/giây (cạn cổng tạm), khi đó dùng keep-alive/pool.

**So với PHP-FPM / Nginx.** Khi Laravel "lỗi mạng" bạn thường chỉ có `502 Bad Gateway` từ Nginx và dòng log `upstream prematurely closed connection` hoặc `connect() failed (111: Connection refused)` (111 chính là `ECONNREFUSED`, 104 là `ECONNRESET`). Các số này là `errno` của Linux, Node chỉ đổi thành tên. Dùng `curl -v` và `ss` y hệt, chỉ khác là tiến trình bị nghi ngờ là Node.

## Tricks & tips thực tế

- **In `err.cause` và `err.code`**, không chỉ `err.message`. Lý do: `fetch failed` che mất nguyên nhân thật (`ECONNREFUSED`, `UND_ERR_SOCKET`, TLS...).
- **Dùng `curl -v` trước khi đổ lỗi cho code Node.** Lý do: tách được "mạng/cổng" (không có `Connected`) khỏi "ứng dụng" (có `Connected` mà không có `<`) chỉ trong một lệnh.
- **`ss -ltnp` khi `EADDRINUSE`** và nhớ rằng tên tiến trình là `MainThread`; tìm theo PID/cổng. Lý do: tránh `kill` nhầm hoặc tìm `node` mà không thấy.
- **Theo dõi số kết nối theo thời gian** (`server.getConnections`, `lsof | wc -l`) và gắn vào metric. Lý do: rò rỉ kết nối (nhất là `CLOSE_WAIT`) là lỗi tăng chậm, chỉ thấy khi đồ thị đi lên.
- **Mọi lời gọi ra ngoài đều có timeout, mọi socket đều có `'error'` listener.** Lý do: hai lỗi này tạo ra hầu hết sự cố "treo không rõ nguyên nhân" và "process sập vì ECONNRESET".
- **Retry kết nối keep-alive bị đóng giữa chừng (một lần, chỉ thao tác idempotent).** Lý do: `ECONNRESET` trên socket cũ trong pool là hiện tượng bình thường khi server đóng kết nối rảnh đúng lúc client gửi request.
- **Đừng bật `NODE_DEBUG` ở production và đừng log header chứa token.** Lý do: nhiễu, chi phí I/O, và lộ bí mật vào log.
- **Khi nghi event loop bị chặn**: thử `curl` cùng lúc từ ngoài; nếu `Connected` nhưng không phản hồi, đo độ trễ event loop thay vì xem mạng. Lý do: tiết kiệm thời gian tìm sai chỗ.
- **Chạy thử trên loopback bằng cổng `0`**, tái hiện lỗi cố ý (đóng đột ngột, treo, chậm) bằng socket thô. Lý do: chỉ khi từng thấy lỗi bằng mắt bạn mới nhận ra nó trong log production.
- **Đừng gọi `*Sync` trong server** (`execFileSync`, `readFileSync` lớn, `crypto.pbkdf2Sync`). Lý do: chặn event loop toàn bộ, mọi người dùng khác bị treo (đã tái hiện: `curl` timeout, 0 byte nhận).

## Liên hệ bài tập

Khi làm hai lab (TCP echo, HTTP thuần, graceful shutdown), hãy dùng bộ công cụ này làm "kính hiển vi": chạy server, dùng `ss -ltnp`/`lsof` để xem kết nối từng bước; `curl -v` để xem header `Connection`; bật `NODE_DEBUG=http,net` một lần để thấy thứ tự sự kiện; cố ý gây `EADDRINUSE`, `ECONNREFUSED`, `ECONNRESET` và ghi lại bạn thấy mã nào ở đâu. Hướng: lập bảng riêng của bạn "triệu chứng → lớp → công cụ kiểm tra", đối chiếu với bảng ở trên rồi bổ sung vào mục Ghi chú.

## Đọc thêm

- [Node.js: Common system errors](https://nodejs.org/api/errors.html#common-system-errors)
- [Node.js: Debugging (`NODE_DEBUG`, inspector)](https://nodejs.org/en/learn/getting-started/debugging)
- [Node.js: `http`](https://nodejs.org/api/http.html)
- [Node.js: `net`](https://nodejs.org/api/net.html)
- [MDN: HTTP Connection management in HTTP/1.x](https://developer.mozilla.org/en-US/docs/Web/HTTP/Connection_management_in_HTTP_1.x)

## Ghi chú của bạn
