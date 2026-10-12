# 4. WebSocket: HTTP Upgrade, frame, ping/pong và vì sao dùng thư viện

WebSocket mở đầu bằng một request HTTP thường (`Upgrade: websocket`), server trả `101 Switching Protocols`, rồi **cùng socket TCP đó** chuyển sang giao thức frame hai chiều. Sau đó không còn request/response: hai bên gửi **message** bất cứ lúc nào.

```ts
import http from "node:http";
import crypto from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";      // hằng số cố định trong RFC 6455
const acceptOf = (key: string) => crypto.createHash("sha1").update(key + GUID).digest("base64");

// Ví dụ trong RFC 6455 §1.3
console.log(acceptOf("dGhlIHNhbXBsZSBub25jZQ=="));          // s3pPLMBiTxaQ9kYGzzhZRbK+xOo=

const server = http.createServer((_req, res) => res.writeHead(426).end("cần WebSocket"));
server.on("upgrade", (req, socket: Duplex) => {
  const key = req.headers["sec-websocket-key"];
  if (req.headers.upgrade?.toLowerCase() !== "websocket" || typeof key !== "string") {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }
  socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${acceptOf(key)}`, "", ""].join("\r\n"));
  socket.end();                                              // demo chỉ cần handshake, rồi đóng
  socket.on("error", () => {});
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = (server.address() as AddressInfo).port;

const ws = new WebSocket(`ws://127.0.0.1:${port}/chat`);     // client toàn cục của Node 24
await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error("ws lỗi")); });
console.log("đã mở, readyState =", ws.readyState);           // 1 (OPEN)
ws.close();
server.close(); server.closeAllConnections();
```

(Ví dụ chạy được trên Node 24.21. Handshake đúng thì client toàn cục chấp nhận; nếu `Sec-WebSocket-Accept` sai, `onerror` sẽ kích hoạt.)

## Ý chính

- WebSocket = **HTTP Upgrade** + giao thức **frame**. Handshake: client gửi `Sec-WebSocket-Key` (số ngẫu nhiên base64), server trả `Sec-WebSocket-Accept = base64(sha1(key + GUID))`. Không có bước này client từ chối kết nối.
- Sau `101`, kết nối **không còn là HTTP**: không có header, status, routing HTTP nữa; handler `'request'` không chạy, mà là sự kiện **`'upgrade'`** của `http.Server`.
- Khác TCP thô: có **ranh giới message** (frame), có opcode (text, binary, ping, pong, close) và mã đóng.
- Client → server **luôn che (mask)** payload bằng khoá 4 byte; server → client **không** mask. Server phải đóng kết nối nếu nhận frame không mask từ client.
- Phát hiện kết nối chết cần **ping/pong** (heartbeat) ở tầng ứng dụng hoặc giao thức: TCP không báo ngay khi peer biến mất.
- Node 24 có **client** `WebSocket` toàn cục (chuẩn WHATWG, do undici cung cấp). Node **không có server WebSocket built-in**; thực tế dùng thư viện (`ws`, `uWebSockets.js`, hoặc Socket.IO ở tầng cao).
- **Upgraded socket không thuộc về HTTP server nữa**: `server.close()` không chờ, `closeAllConnections()` không đóng chúng (đã đo, xem bài 5). Bạn tự theo dõi và đóng.

## Lý thuyết chi tiết

**Handshake từng bước.** Client gửi (ví dụ lấy từ RFC, đã chạy bằng socket thô):

```http
GET /chat HTTP/1.1
Host: server.example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
```

Server (Node 24.21, đã in ra):

```http
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

`Sec-WebSocket-Accept` **không phải bảo mật**: nó chỉ chứng minh server hiểu WebSocket (chống việc một server HTTP thường vô tình bị coi là WebSocket) và chống proxy cache. Còn `Sec-WebSocket-Protocol` (chọn subprotocol) và `Sec-WebSocket-Extensions` (ví dụ `permessage-deflate`) là phần mở rộng tuỳ chọn.

Trong Node, handshake đi qua sự kiện `'upgrade'` của `http.Server` với `(req, socket, head)`: `socket` là **socket TCP thô** (`Duplex`) và `head` là byte đã đọc dư sau header. Nếu server **không** có listener `'upgrade'`, Node đóng kết nối. Điều này nghĩa là các lớp trước kia (xác thực, kiểm tra `Origin`) phải làm **trong handler `'upgrade'`**, trước khi ghi `101`, vì sau đó không còn cơ hội trả 401/403 kiểu HTTP.

**Frame.** Mỗi message gồm một hoặc nhiều frame:

```text
byte 0:  FIN(1) RSV(3) OPCODE(4)
byte 1:  MASK(1) PAYLOAD_LEN(7)      # 0-125: độ dài thật; 126: 2 byte kế là độ dài; 127: 8 byte kế
[2 hoặc 8 byte độ dài mở rộng]
[4 byte mask key]                    # chỉ có khi MASK=1 (client -> server)
payload                              # nếu có mask: payload[i] ^= key[i % 4]
```

Opcode: `0x0` continuation, `0x1` text (UTF-8), `0x2` binary, `0x8` close, `0x9` ping, `0xA` pong. Đã in frame thật bằng socket thô:

```text
client -> server: 81 82 01020304 496b      # FIN+text, MASK+len 2, key 01 02 03 04, "Hi" đã XOR
server -> client: 81 08 6563686f3a204869    # FIN+text, len 8 (không mask), "echo: Hi"
```

Ở demo, tôi viết bộ giải mã **chỉ để học** (xử lý payload < 64 KiB, không xử lý phân mảnh, không kiểm tra UTF-8, không giới hạn kích thước, không timeout). Đó chính là lý do thực tế dùng `ws`: phân mảnh (message gồm nhiều frame + frame điều khiển xen giữa), frame 64 bit, kiểm tra UTF-8, giới hạn `maxPayload`, nén, backpressure, đóng đúng chuẩn, và tối ưu hiệu năng mà một đoạn code trăm dòng không thể bảo đảm.

Hai điểm cơ chế đáng giữ trong đầu:

- Vì TCP là luồng byte, một frame có thể đến thành nhiều chunk và nhiều frame có thể dính trong một chunk. Bộ giải mã vẫn phải **gom và rút nhiều frame** y hệt framing ở bài 1 (vòng `for (f = parse(buf); f; f = parse(buf))` trong demo).
- Message lớn gửi liên tục chiếm bộ đệm; `socket.write` trả `false` thì dừng gửi (backpressure) như mọi stream.

**Ping/pong và phát hiện kết nối chết.** Đứt kết nối kiểu "TCP chết hẳn" (mất sóng di động, rút dây) **không** gây sự kiện nào cho tới khi gửi dữ liệu và hết lần thử, hoặc TCP keepalive (rất lâu). Mẫu chuẩn: server gửi frame **ping** định kỳ (ví dụ 30 s), client trả **pong** tự động; nếu một chu kỳ không có pong thì `terminate` (destroy) kết nối. Trình duyệt trả pong tự động nhưng **JavaScript không có API gửi hay nhận ping** (Node 24 client toàn cục cũng không có `ping()`). Server `ws` có `ws.ping()` và sự kiện `pong`. Heartbeat tầng ứng dụng (message `{"type":"ping"}`) hoạt động được từ trình duyệt. Load balancer/proxy cũng có timeout rảnh (ví dụ Nginx `proxy_read_timeout` mặc định 60 s; kiến thức từ tài liệu), nên heartbeat còn giữ kết nối khỏi bị đóng vì "rảnh".

**Đóng kết nối và mã đóng.** Đóng đúng chuẩn là bắt tay hai chiều: bên A gửi frame close (có mã 2 byte và lý do), bên B trả close, rồi đóng TCP. Đã chạy: client `ws.close(1000, "bye")` → server nhận `code = 1000`, trả frame close → client `onclose` với `code 1000, wasClean true`.

| Mã | Nghĩa |
|---|---|
| 1000 | Đóng bình thường |
| 1001 | Going away (server tắt, tab đóng) |
| 1002 / 1003 | Lỗi giao thức / dữ liệu không chấp nhận |
| 1006 | **Không có frame close** (kết nối đứt bất thường); chỉ là giá trị báo cho ứng dụng, **không bao giờ được gửi trên dây** |
| 1008 | Vi phạm chính sách (ví dụ sai xác thực) |
| 1009 | Message quá lớn |
| 1011 | Lỗi nội bộ server |
| 1012 / 1013 | Service restart / thử lại sau (hữu ích khi graceful shutdown) |
| 4000-4999 | Dành cho ứng dụng tự định nghĩa |

Khi graceful shutdown, gửi `1001` hoặc `1012` cho các WebSocket đang mở trước khi đóng, để client biết nên kết nối lại (kèm backoff ngẫu nhiên, nếu không toàn bộ client đồng loạt kết nối lại vào instance mới: "thundering herd").

**Client `WebSocket` toàn cục của Node 24.** API giống trình duyệt: `new WebSocket(url, protocols?)`, `onopen`/`onmessage`/`onclose`/`onerror`, `send`, `close(code, reason)`, `readyState` (0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED). `onerror` **không** cho biết nguyên nhân (cũng như trình duyệt, vì lý do bảo mật), nên chẩn đoán phải dựa vào log server hoặc `curl`. Đã chạy: gửi `"xin chào"` tới server demo, nhận `"echo: xin chào"`. Khác trình duyệt: không có cookie tự động, bạn tự quản lý header xác thực (kiến thức từ tài liệu; tuỳ chọn truyền header cho client toàn cục chưa thử ở đây).

**Xác thực.** Trình duyệt không cho đặt header tuỳ ý khi mở WebSocket. Các cách phổ biến: cookie phiên (đồng bộ origin), token ngắn hạn trong query (`?ticket=...`, một lần dùng, hết hạn nhanh, vì URL hay bị log), hoặc gửi message xác thực ngay sau khi mở và đóng kết nối nếu không có trong N giây. **Luôn kiểm tra `Origin`** trong handler `'upgrade'` nếu dùng cookie: WebSocket không bị SOP chặn, nên không kiểm tra là mở cửa cho Cross-Site WebSocket Hijacking.

**Scale ngang.** Kết nối WebSocket là trạng thái nằm trong bộ nhớ của một process; broadcast tới người dùng ở process khác cần kênh chung (Redis pub/sub, NATS…), và load balancer cần giữ kết nối (không "sticky" theo request mà theo kết nối, mà kết nối đã cố định theo TCP). Điều này khác hẳn PHP-FPM (không giữ trạng thái giữa request); với Laravel bạn thường đẩy WebSocket sang dịch vụ riêng (Reverb, Pusher, Soketi) chính vì mô hình process-per-request không giữ được hàng chục nghìn kết nối mở.

## Tricks & tips thực tế

- **Dùng `ws` (hoặc framework có sẵn) cho server thật**, đừng tự viết parser. Lý do: phân mảnh, UTF-8, giới hạn, nén, backpressure rất dễ sai và có hậu quả bảo mật. Tự viết handshake/frame chỉ để học như ở đây.
- **Đặt giới hạn `maxPayload`, số kết nối, và tốc độ message** (ở `ws`: `maxPayload`). Lý do: một client có thể gửi frame khai báo hàng GB hoặc tràn message; không giới hạn là DoS.
- **Heartbeat ping/pong và `terminate()` khi mất pong.** Lý do: kết nối "ma" tích tụ giữ file descriptor và bộ nhớ, và broadcast vào socket chết lãng phí.
- **Kiểm tra `Origin` và xác thực trong `'upgrade'` trước khi ghi `101`.** Lý do: sau handshake không thể trả 401/403 HTTP; và cookie bị trình duyệt gửi kèm mà không có chặn same-origin.
- **Theo dõi mọi socket upgrade trong một `Set` và dọn ở sự kiện `'close'`.** Lý do: `server.close()`/`closeAllConnections()` của HTTP không quản lý chúng; không có `Set` thì lúc tắt máy bạn không có cách chủ động đóng (đã đo: process không thoát).
- **Backpressure khi broadcast**: kiểm tra `socket.writableNeedDrain` hoặc `ws.bufferedAmount`; bỏ qua hoặc ngắt client chậm. Lý do: một client chậm làm bộ đệm gửi phình, RAM của cả process tăng.
- **Client tự reconnect với backoff có jitter** và xử lý mã đóng 1001/1012. Lý do: khi server restart, mọi client kết nối lại cùng lúc.
- **Debug**: `curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" http://host/path` để xem `101` và header phản hồi (kiến thức từ tài liệu, chưa chạy lệnh này; đã làm tương đương bằng socket thô); công cụ như `websocat` hay tab Network → WS của trình duyệt để nhìn frame.
- **Đừng dùng WebSocket khi SSE hoặc polling đủ dùng**: thông báo một chiều server → client thường đơn giản và dễ qua proxy hơn với Server-Sent Events. Lý do: WebSocket thêm trạng thái, heartbeat, reconnect và scale phức tạp.

## Liên hệ bài tập

Bài này không có lab WebSocket riêng; ví dụ ở đây chỉ để bạn hiểu cơ chế. Hãy tự chạy: in ra `Sec-WebSocket-Accept` cho một key khác và đối chiếu với client; thử gửi handshake thiếu `Sec-WebSocket-Key` và xem bạn nên trả mã nào. Khi làm lab graceful shutdown, câu hỏi tự đặt: nếu server của bạn có kết nối upgrade (WebSocket, hoặc bất kỳ giao thức nâng cấp), `server.close()` có chờ chúng không, và bạn sẽ đóng chúng bằng cách nào?

## Đọc thêm

- [RFC 6455: The WebSocket Protocol](https://datatracker.ietf.org/doc/html/rfc6455) (xem §1.3 handshake, §5.2 frame, §7.4 mã đóng)
- [MDN: WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)
- [MDN: Writing WebSocket servers](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_servers)
- [Node.js: `http` sự kiện `'upgrade'`](https://nodejs.org/api/http.html#event-upgrade)

## Ghi chú của bạn
