# 1. TCP với `node:net`: luồng byte, không có ranh giới message

TCP chỉ cung cấp một **luồng byte hai chiều, tin cậy, có thứ tự**; nó không biết "message" là gì. Mọi thứ bạn thấy ở tầng trên (HTTP, WebSocket, Redis, PostgreSQL) đều là giao thức tự dựng thêm **framing** trên luồng byte đó.

```ts
import net from "node:net";
import { once } from "node:events";

// Server đếm dòng: gom byte thành dòng bằng "\n", trả "#<số thứ tự> <dòng IN HOA>"
const server = net.createServer((socket) => {
  let buf = "";
  let lines = 0;
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      socket.write(`#${++lines} ${line.toUpperCase()}\n`);
    }
  });
  socket.on("end", () => socket.end());
});
server.listen(0, "127.0.0.1");                // cổng 0: hệ điều hành chọn cổng trống
await once(server, "listening");
const { port } = server.address() as net.AddressInfo;

const client = net.connect(port, "127.0.0.1");
client.setEncoding("utf8");
await once(client, "connect");
client.write("xin ");                          // 3 lần write...
client.write("chao\nhai\nba");
client.write("\n");                            // ...nhưng là 3 dòng, không khớp ranh giới write
let got = "";
client.on("data", (d: string) => { got += d; });
await new Promise((r) => setTimeout(r, 100));
console.log(JSON.stringify(got));              // "#1 XIN CHAO\n#2 HAI\n#3 BA\n"
client.end();
await once(client, "close");
server.close();
```

Chạy trên Node 24.21: cả ba `write` dồn thành **một** sự kiện `data` ở server (`"xin chao\nhai\nba\n"`). Đây là ví dụ minh hoạ, không phải đề bài: đề bài lab yêu cầu bạn tự làm echo server, và việc gom dòng ở trên chỉ là kỹ thuật framing để hiểu vấn đề.

## Ý chính

- Socket Node (`net.Socket`) là **`Duplex` stream** (đọc được và ghi được), dữ liệu là `Buffer` (hoặc string nếu `setEncoding`). Mọi quy tắc stream (backpressure, `pipe`/`pipeline`, `'end'`, `'close'`) áp dụng nguyên vẹn.
- **Không có ranh giới message**: một `write` có thể tới bằng nhiều `data`, nhiều `write` có thể dồn vào một `data`. Giao thức của bạn phải tự định nghĩa framing (dấu xuống dòng, tiền tố độ dài, hoặc độ dài cố định).
- `end()` gửi **FIN** (đóng chiều ghi, kết nối half-close); `destroy()` bỏ socket ngay; `resetAndDestroy()` gửi **RST**. Ba thứ này cho ra hành vi rất khác ở phía bên kia.
- Lỗi mạng đến qua sự kiện `'error'` kèm `err.code` (`ECONNREFUSED`, `ECONNRESET`, `EPIPE`, `EADDRINUSE`…). **Socket không có listener `'error'` thì process sập** (EventEmitter ném lỗi chưa được xử lý).
- `server.close()` của `net.Server` chỉ **ngừng nhận kết nối mới**; các socket đang mở vẫn sống và `'close'` chỉ phát khi socket cuối cùng đóng.
- Cổng `0` để hệ điều hành chọn cổng: cách chuẩn để test mà không đụng cổng đang dùng.

## Lý thuyết chi tiết

**Vì sao TCP không có "message".** Kernel giữ hai bộ đệm cho mỗi kết nối (gửi và nhận). `socket.write(buf)` chỉ chép byte vào bộ đệm gửi; kernel tự cắt thành segment theo MSS/cửa sổ và có thể gộp hai lần `write` vào một segment (đặc biệt với thuật toán Nagle, xem dưới). Phía nhận, `read` lấy "bất kỳ lượng byte nào đang có". Node đọc theo khối (libuv cấp buffer 64 KiB) và phát `'data'` cho mỗi lần đọc.

Hai thí nghiệm đã chạy (Node 24.21, loopback):

- Ba `write` 10 byte + một `end(Buffer.alloc(4MiB))` → server thấy **65 lần** `'data'`, tổng 4194334 byte. Một write lớn bị cắt thành nhiều chunk (≈64 KiB), còn các write nhỏ có thể dính nhau.
- Ba `write` ngắn liên tiếp → một chunk duy nhất.

Hệ quả: code kiểu "mỗi `data` là một message" **chạy được trong test cục bộ rồi hỏng ở production** (mạng thật, tải cao, payload lớn). Đây là lỗi kinh điển.

**Các kiểu framing.**

| Kiểu | Cách | Dùng ở |
|---|---|---|
| Ký tự phân cách | Kết thúc bằng `\n` hoặc `\r\n` | Redis RESP (một phần), SMTP, HTTP header, server chat dòng |
| Tiền tố độ dài | 4 byte đầu là độ dài payload | PostgreSQL wire protocol, WebSocket frame, gRPC |
| Độ dài cố định | Mỗi message đúng N byte | Giao thức nhị phân đơn giản |
| Đóng kết nối | Hết dữ liệu khi `FIN` | HTTP/1.0 không có Content-Length |

Bộ gom (như ở ví dụ đầu) luôn cần: (1) bộ đệm tích luỹ, (2) vòng lặp `while` rút **mọi** message hoàn chỉnh trong bộ đệm (không phải một), (3) giữ lại phần thừa cho lần sau. Với ký tự phân cách cần **giới hạn độ dài dòng**: client không gửi `\n` thì bộ đệm lớn mãi (DoS bộ nhớ). Với tiền tố độ dài cần giới hạn độ dài khai báo (client có thể khai báo 4 GiB).

Lưu ý khi gom bằng string: `setEncoding("utf8")` dùng `StringDecoder` nên ký tự UTF-8 đa byte bị cắt giữa hai chunk vẫn được ghép đúng. Nếu tự `chunk.toString()` trên `Buffer` thì có thể hỏng ký tự ở biên chunk. Với giao thức nhị phân hãy giữ `Buffer` và dùng `Buffer.concat` / `readUInt32BE`.

**Vòng đời kết nối và half-close.** Mỗi chiều đóng độc lập:

- `socket.end()` = "tôi không gửi gì nữa" (gửi FIN). Bên kia nhận sự kiện `'end'` trên socket của họ nhưng **vẫn có thể ghi** nếu muốn.
- Mặc định `allowHalfOpen: false`: khi socket nhận `'end'`, Node **tự `end()` chiều ghi** luôn. Với `allowHalfOpen: true` bạn phải tự gọi `end()`.

Thí nghiệm (Node 24.21): client gửi `"hello"` rồi `end()` (client có `allowHalfOpen: true` để còn đọc được).

| Server | Kết quả client nhận |
|---|---|
| `allowHalfOpen: false`, server chỉ `on("end")` | `""` (server tự đóng chiều ghi trước khi kịp trả lời) |
| `allowHalfOpen: true`, server `end("tổng 5 byte")` trong `'end'` | `"tổng 5 byte"` |

Half-close là cách dựng giao thức "gửi hết yêu cầu rồi đóng, chờ trả lời" (như `nc` hay `cat file | nc host port`). Nó cũng giải thích vì sao `socket.end()` rồi `socket.write()` cho `ERR_STREAM_WRITE_AFTER_END` (lỗi phía Node, không phải lỗi mạng).

Thứ tự sự kiện đóng: `'end'` (hết dữ liệu để đọc) → `'finish'` (ghi xong) → `'close'` (tài nguyên được giải phóng, tham số `hadError`). Dùng `'close'` để dọn dẹp, vì nó phát cả trong trường hợp lỗi.

**Timeout, keepAlive, noDelay.**

- `socket.setTimeout(ms)`: chỉ phát sự kiện `'timeout'` khi **không có hoạt động** `ms` mili giây; **không tự đóng** socket (đã thử: sau `'timeout'`, `socket.destroyed === false`). Bạn phải gọi `destroy()` trong handler.
- `socket.setKeepAlive(true, initialDelay)`: bật **TCP keepalive** của kernel (gửi probe khi kết nối rảnh) để phát hiện peer chết hẳn (mất điện, rút dây) và giữ NAT/firewall không quên kết nối. Đây **không phải** HTTP keep-alive; hai thứ cùng tên nhưng khác tầng. Thời gian giữa probe và số lần thử do kernel cấu hình (Linux: `net.ipv4.tcp_keepalive_*`, mặc định rất dài, khoảng 2 giờ; kiến thức từ tài liệu, chưa thử).
- `socket.setNoDelay(true)`: tắt **thuật toán Nagle**. Nagle gom các write nhỏ để chờ ACK của segment trước, tiết kiệm gói tin nhưng thêm độ trễ (kết hợp với *delayed ACK* của bên nhận có thể thành vài chục ms). Giao thức request/response nhỏ, độ trễ thấp (chat, RPC) nên bật `noDelay`. Node 24 `http.Agent` mặc định đã `noDelay: true` (xem `http.globalAgent.options`, đã in ra); với `net.connect` thuần mặc định là **tắt**.

**Phân loại lỗi hay gặp** (đã tái hiện trên Node 24.21):

| `err.code` | Nghĩa | Tái hiện |
|---|---|---|
| `EADDRINUSE` (`syscall: listen`) | Cổng đã có tiến trình khác nghe | Hai server `listen` cùng cổng; lỗi phát ở **server** |
| `ECONNREFUSED` (`syscall: connect`) | Không ai nghe ở cổng đó (kernel trả RST ngay) | `connect` tới cổng vừa `close()`; `err.address`/`err.port` có sẵn |
| `ECONNRESET` (`syscall: read`) | Peer gửi **RST** (crash, `resetAndDestroy`, firewall, ghi vào socket đã đóng phía kia) | Server gọi `socket.resetAndDestroy()`; client có `'error'` rồi `'close'` với `hadError = true` |
| `EPIPE` (`syscall: write`) | Ghi vào kết nối mà peer đã đóng | Server `destroy()` ngay khi nhận kết nối; client (`allowHalfOpen: true`) ghi vài lần: lần ghi sau cùng `EPIPE` |
| `ETIMEDOUT` | Kernel hết kiên nhẫn (SYN không phản hồi, keepalive hết lượt) | Cần mạng thật (kiến thức từ tài liệu, chưa thử) |

`ECONNRESET` mà server thấy thường nghĩa là **client bỏ đi đột ngột** (đóng tab, mất sóng). Nó bình thường ở mức vài phần trăm; điều nguy hiểm là không gắn `'error'` nên process sập.

**Backlog và `listen`.** `server.listen(port, host, backlog)`: hàng đợi kết nối đã bắt tay xong nhưng chưa `accept`. Mặc định 511 (`ss -ltnp` hiển thị `Send-Q 511` cho socket LISTEN, đã thấy). Nếu event loop bận (CPU chặn), kết nối mới chất trong backlog; đầy thì client thấy treo hoặc timeout. Đó là một dấu hiệu "event loop bị chặn" nhìn từ ngoài.

**Địa chỉ nghe.** `listen(port)` không có host sẽ nghe `::` (dual-stack) hoặc `0.0.0.0` tuỳ hệ thống: mọi interface. `127.0.0.1` chỉ loopback. Trong container phải nghe `0.0.0.0` (hoặc bỏ host) để bên ngoài vào được; nghe `127.0.0.1` trong container là lỗi "không kết nối được từ ngoài" rất hay gặp.

**So với PHP-FPM.** Nginx giữ socket TCP với client, còn PHP-FPM worker nói chuyện với Nginx qua FastCGI (Unix socket hoặc TCP) và **không bao giờ thấy TCP của client**. Mỗi request là một lần chạy script, nên "kết nối bị ngắt giữa chừng" hầu như là việc của Nginx. Trong Node, process của bạn **chính là** server TCP: bạn thấy `ECONNRESET`, `EPIPE`, nửa-đóng, buffer đầy, và phải tự xử lý.

## Tricks & tips thực tế

- **Luôn gắn `socket.on("error", ...)` ngay trong handler `connection` và cho mọi socket client**: lỗi `ECONNRESET` xảy ra ở mọi hệ thống thật, và không có listener thì cả process (mọi người dùng khác) sập vì một client lỗi.
- **Không giả định một `data` = một message**: test bằng cách ghi từng byte một hoặc gộp cả mảng message vào một `write`; nếu giao thức của bạn vỡ, framing sai. Test này rẻ và bắt được lỗi trước production.
- **Đặt trần cho bộ đệm gom** (độ dài dòng, độ dài khai báo) và đóng kết nối nếu vượt: nếu không, một client xấu ăn hết RAM của process.
- **Dùng `setTimeout` của socket để đuổi kết nối rảnh**, nhưng nhớ `destroy()` trong handler (nó không tự đóng). Lý do: kết nối "ma" tích tụ làm cạn file descriptor (`EMFILE`).
- **Dùng `once(server, "listening")` rồi đọc `server.address()`** (cổng 0) thay vì cố định cổng trong test: tránh `EADDRINUSE` khi chạy nhiều test song song.
- **Khi ghi nhiều, tôn trọng backpressure**: `socket.write()` trả `false` khi bộ đệm đầy; chờ `'drain'` hoặc dùng `pipeline`. Ghi vô tội vạ vào client chậm làm RAM tăng dần (xem Bài về streams).
- **Dùng `socket.end(data)` thay vì `write(data); destroy()`** để dữ liệu cuối kịp gửi: `destroy()` bỏ cả phần còn trong bộ đệm gửi.
- **Khi debug "kết nối treo"**: `ss -tn` xem `Recv-Q`/`Send-Q` (xem bài 6); `Recv-Q` lớn ở phía bạn nghĩa là process chưa đọc kịp (event loop bận hoặc stream paused).
- **Cẩn thận với `readable` ở trạng thái paused**: socket chưa có `'data'` listener / `resume()` thì `'end'` không bao giờ phát; nhiều bug "kết nối không đóng" xuất phát từ đây.
- **So với Laravel**: không có tương đương trực tiếp; phần gần nhất là cấu hình `fastcgi_read_timeout` hay `keepalive_timeout` ở Nginx, tức việc mà bây giờ code Node của bạn phải đảm nhận.

## Liên hệ bài tập

Lab TCP echo server buộc bạn nghĩ về: mỗi `data` có phải một dòng? Khi client gửi `end()` thì server nên làm gì (trả lời rồi đóng, hay đóng ngay)? Kết nối của client bỏ đi giữa chừng thì sao (gắn `'error'`, `'close'`)? Hãy tự thử các phép đo ở trên với server của bạn: gửi một byte mỗi lần, gửi 4 MiB một lần, đóng đột ngột, và quan sát số kết nối đang mở (`server.getConnections`). Hướng: đọc kỹ thứ tự `end`/`finish`/`close` và quyết định nơi dọn tài nguyên.

## Đọc thêm

- [Node.js: `net`](https://nodejs.org/api/net.html)
- [Node.js: Stream](https://nodejs.org/api/stream.html)
- [Node.js: Errors, system error codes](https://nodejs.org/api/errors.html#common-system-errors)

## Ghi chú của bạn
