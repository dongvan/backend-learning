# 5. Graceful shutdown: tắt server mà không làm rơi request

Graceful shutdown nghĩa là khi nhận tín hiệu dừng (SIGTERM), server **ngừng nhận việc mới, làm nốt việc đang dở, đóng tài nguyên theo thứ tự, rồi thoát** trong một khoảng thời gian giới hạn. Phần khó không nằm ở `server.close()` mà ở những thứ `close()` **không** làm: kết nối keep-alive, request treo, socket đã upgrade, và thứ tự đóng DB/queue.

```ts
import http from "node:http";
import net from "node:net";
import { once } from "node:events";

// Đo: gọi server.close() khi một request đang chạy. Kết nối đó sống thêm bao lâu sau khi trả lời?
// Dùng socket thô làm client để đo hành vi phía server, không bị client tự đóng kết nối rảnh.
async function measure(label: string, closeConnectionWhenDraining: boolean): Promise<void> {
  let draining = false;
  const server = http.createServer((_req, res) => {
    setTimeout(() => {
      // quyết định ở thời điểm TRẢ LỜI (không phải lúc request đến)
      if (draining && closeConnectionWhenDraining) res.setHeader("Connection", "close");
      res.end("xong");
    }, 300);
  });
  server.keepAliveTimeout = 2000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const sock = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
  sock.on("error", () => {});
  sock.resume();
  await once(sock, "connect");
  const t0 = Date.now();
  sock.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");

  await new Promise((r) => setTimeout(r, 50));
  draining = true;
  const closed = once(server, "close");           // gắn listener TRƯỚC khi gọi close()
  server.close();
  await closed;
  console.log(`${label}: (server trả lời lúc ~300 ms) server 'close' lúc ${Date.now() - t0} ms`);
}
await measure("không Connection: close", false);
await measure("có Connection: close   ", true);
```

Kết quả (Node 24.21): `3317 ms` khi không đặt `Connection: close` (= 300 ms xử lý + `keepAliveTimeout` 2000 ms + buffer 1000 ms), và `~305 ms` khi đặt. Cùng một `server.close()`, chênh nhau 3 giây: đó là cạm bẫy trung tâm của bài này.

## Ý chính

- **Thứ tự chuẩn**: (1) đánh dấu "đang tắt" và báo **not-ready**, (2) ngừng nhận kết nối mới (`server.close()`), (3) để request đang chạy **drain** xong, (4) đóng kết nối keep-alive rảnh, (5) dừng consumer queue/cron, (6) đóng DB/cache/queue producer, (7) thoát. Có **timeout cưỡng bức** cho cả quá trình.
- `process.on("SIGTERM", ...)`: nếu **không** có handler, tín hiệu giết process ngay, request đang chạy bị cắt (đã thử: tiến trình thoát với `signal=SIGTERM`, không có code, phản hồi đang chờ không bao giờ tới).
- `server.close()` (Node 24.21, đã đo): dừng `listen` ngay (kết nối mới bị `ECONNREFUSED`), đóng kết nối **rảnh**, để request đang chạy xong. **Không** tự đóng kết nối keep-alive vừa xong request sau lúc gọi `close()`; nó vẫn nói `Connection: keep-alive`, nhận được cả request mới trên socket đó, và sống thêm `keepAliveTimeout` + 1 s buffer.
- Sau khi đã gọi `close()`, request đang chạy xong thì **đặt `Connection: close` ở thời điểm trả lời** (hoặc gọi `closeIdleConnections()` sau mỗi response) để socket rảnh đóng ngay.
- `server.closeAllConnections()` cắt **mọi** kết nối HTTP kể cả đang chạy (client thấy `ECONNRESET`): chỉ dùng làm bước cưỡng bức khi hết hạn.
- Socket **đã upgrade** (WebSocket…) **không** bị `closeIdleConnections()`/`closeAllConnections()` đóng; `server.close()` cũng chờ chúng (đã đo: process không thoát cho đến khi bị `SIGKILL`). Tự theo dõi và đóng.
- Timer cưỡng bức phải `.unref()` để không giữ process sống khi mọi thứ đã đóng xong; và nên để process **thoát tự nhiên** (event loop rỗng) thay vì `process.exit()` sớm.
- Trong Kubernetes/ECS, instance bị **rút khỏi load balancer song song** với việc gửi SIGTERM; có độ trễ lan truyền, nên cần cửa sổ "đã not-ready nhưng vẫn phục vụ" trước khi đóng listener.

## Lý thuyết chi tiết

**Tín hiệu.** `SIGTERM` là "xin hãy tắt" (orchestrator, `kill`, systemd); `SIGINT` là Ctrl+C; `SIGKILL` không thể bắt hoặc chặn (kernel giết ngay). Orchestrator gửi SIGTERM, chờ **grace period** rồi mới SIGKILL. Kubernetes: `terminationGracePeriodSeconds` mặc định 30 s (kiến thức từ tài liệu, chưa thử). Nên timeout cưỡng bức của bạn phải **nhỏ hơn** grace period (ví dụ 20 s so với 30 s), để bạn tự kết thúc có kiểm soát thay vì bị SIGKILL ngang.

Handler tín hiệu của Node (`process.on("SIGTERM", fn)`) chạy trong event loop như callback thường, nên nếu event loop đang bị chặn bởi CPU thì handler cũng không chạy. Nên **bảo vệ khỏi gọi hai lần**: người vận hành có thể gửi SIGTERM nhiều lần (hoặc SIGINT rồi SIGTERM). Mẫu thông dụng: biến cờ `shuttingDown`; lần thứ hai có thể thoát ngay (`process.exit(1)`) vì ai đó đang thúc ép.

**`server.close()` thực sự làm gì (đã đo, Node 24.21).** Các thí nghiệm dùng server `http`, client thô hoặc `http.Agent`:

| Tình huống lúc gọi `close()` | Kết quả |
|---|---|
| Có kết nối keep-alive **rảnh** | Đóng ngay; `'close'` phát ngay (≈ 1-40 ms) |
| Có request đang chạy 300 ms | Request hoàn tất và nhận phản hồi `200`; callback `close` **chưa** chạy |
| Request xong, header phản hồi | `Connection: keep-alive`, `Keep-Alive: timeout=<ka/1000>` (vẫn quảng cáo giữ kết nối) |
| Client gửi tiếp request trên socket cũ | **Vẫn được phục vụ** (`200`) |
| Kết nối mới | `ECONNREFUSED` ngay |
| Sau khi request cuối xong | Socket sống thêm `keepAliveTimeout` + `keepAliveTimeoutBuffer` (1000 ms) rồi mới đóng, đo bằng client thô: `ka=500` → ~1.5 s, `ka=2000` → ~3.3 s, `ka=3000` → ~4.3 s |
| Gọi `close()` lần thứ hai | Callback nhận `ERR_SERVER_NOT_RUNNING` |

Điểm gây bất ngờ: tài liệu cũ nói "`server.close()` chờ mọi kết nối keep-alive" (đúng cho Node < 19) và nhiều bài blog khuyên tự theo dõi mọi socket. Từ Node 19, `close()` đã tự gọi `closeIdleConnections()`, **nhưng chỉ cho kết nối rảnh tại thời điểm gọi**; kết nối bận lúc đó sẽ rảnh sau, và không ai đóng nó cho đến khi hết hạn keep-alive. Bạn phải xử lý phần đó.

Lưu ý: khi dùng `http.Agent` keep-alive làm client trong thí nghiệm, thời gian socket rảnh bị đóng **không ổn định** (client có thể đóng socket rảnh của chính nó sớm hơn theo gợi ý `Keep-Alive: timeout`; đo được 1.8 s và 4.3 s trong hai lần chạy cùng cấu hình, chưa giải thích hết). Nên đo phía server bằng client thô như ở ví dụ đầu.

Ngoài ra `net.Server.close()` (bài 1) vốn chỉ dừng `listen` và chờ socket đóng; `http.Server` kế thừa và thêm bước đóng kết nối rảnh.

**Các kỹ thuật con (mỗi cái đo riêng).**

1. *Quyết định `Connection: close` tại lúc trả lời.* Như ví dụ đầu: `if (draining) res.setHeader("Connection", "close")` đặt **ngay trước khi ghi phản hồi**, vì request có thể đến **trước** khi tắt nhưng trả lời **sau**. Trong thí nghiệm đầu tiên của tôi, đặt cờ ở lúc request đến khiến request đang chạy vẫn trả `keep-alive` và socket treo 6 s; chuyển quyết định sang lúc trả lời thì `Connection: close` xuất hiện và socket đóng ngay. Với client dùng agent, header này khiến client bỏ socket đó khỏi pool.

2. *`closeIdleConnections()` định kỳ hoặc sau mỗi response.* Một cách khác: sau mỗi `res` `'finish'` khi đang drain, gọi `server.closeIdleConnections()` (sau `setImmediate` để socket kịp chuyển sang trạng thái rảnh). Tôi chưa đo riêng kỹ thuật này; trong thí nghiệm tiến trình con kết hợp cả (1) và (2), socket đóng cùng thời điểm (≤ 1 ms) với lúc trả lời `/slow` xong và tiến trình thoát code 0 ngay sau đó (~830 ms tính từ lúc server khởi động). Hãy tự đo từng kỹ thuật riêng để biết cái nào thực sự làm việc.

3. *Timeout cưỡng bức.*

```ts
// một mảnh, không phải chương trình hoàn chỉnh
const timer = setTimeout(() => server.closeAllConnections(), 1500);
timer.unref();            // không giữ process sống; nếu mọi thứ đóng sớm, process thoát ngay
```

   Đã thử: có request `/hang` không bao giờ trả lời. Không có timer, process **không thoát** (bị `SIGKILL` sau 7 s); có timer, ở 1.5 s `closeAllConnections()` cắt `/hang` (client thấy `ECONNRESET`), `'close'` phát, process thoát với code 0 tại ~1.6 s (nhờ `unref`, không phải `process.exit`).

4. *Socket đã upgrade (WebSocket…).*

```ts
const upgraded = new Set<import("node:stream").Duplex>();
server.on("upgrade", (_req, socket) => {
  upgraded.add(socket);
  socket.on("close", () => upgraded.delete(socket));
  // ... ghi 101 và xử lý giao thức ở đây
});
// khi tắt, sau closeAllConnections():
for (const s of upgraded) s.destroy();     // hoặc gửi frame close 1001/1012 trước, rồi destroy khi hết hạn
```

   Đã đo (Node 24.21): sau `server.close()` + `closeAllConnections()`, client upgrade vẫn **chưa bị đóng**, `upgraded.size === 1`, `'close'` của server chưa phát; ngay khi `destroy()` socket đó, `'close'` phát sau ~2 ms. Chạy lại bằng một tiến trình con `drain` và `force` có kết nối upgrade: **cả hai đều không thoát** tới khi `SIGKILL`.

**Cửa sổ readiness và liveness.** Orchestrator dùng hai loại kiểm tra: *liveness* ("còn sống không, nếu không thì restart") và *readiness* ("có nhận traffic không, nếu không thì rút khỏi load balancer"). Khi tắt, bạn muốn readiness trả `503` **trước** khi đóng listener, vì việc rút instance khỏi load balancer là bất đồng bộ (Endpoints/target group cập nhật mất vài giây; kiến thức từ tài liệu, chưa thử). Nếu bạn đóng listener ngay lập tức, khoảng đó load balancer vẫn gửi request vào cổng đóng → `ECONNREFUSED` → lỗi 502/connection refused cho người dùng. Trong thí nghiệm tiến trình con, ngay sau SIGTERM kết nối mới đã bị từ chối (`/ready` cũng lỗi `ECONNREFUSED` vì listener đã đóng, không phải `503`): đó là hành vi của cách làm "đóng listener ngay". Mẫu khác: SIGTERM → cờ `ready=false` (readiness trả 503, vẫn phục vụ request thật) → chờ vài giây → mới `server.close()`.

```ts
// Đo cửa sổ: readiness 503 nhưng vẫn phục vụ (Node 24.21, đã chạy):
//   trong cửa sổ chờ: /ready=503, /=200
```

Với ECS/ALB tương tự: target bị `deregistering` có `deregistration_delay`; app vẫn nên phục vụ trong thời gian đó (kiến thức từ tài liệu, chưa thử). Trong K8s, cách khác là hook `preStop` (ví dụ `sleep 5`) trước khi SIGTERM được gửi; nó cũng nằm trong grace period (kiến thức từ tài liệu).

**Thứ tự đóng tài nguyên.** Quy tắc: đóng theo thứ tự **ngược với phụ thuộc**, tức là thứ nào *sinh việc* thì đóng trước, thứ nào *được việc dùng* thì đóng sau.

| Bước | Việc | Vì sao ở vị trí này |
|---|---|---|
| 1 | Readiness → 503 | Để LB ngừng gửi traffic mới |
| 2 | Ngừng nhận việc: `server.close()`, ngừng consumer queue, ngừng cron | Không để việc mới đổ vào khi đang tắt |
| 3 | Drain: chờ request/job đang chạy (có hạn) | Hoàn tất việc đã nhận |
| 4 | Flush: log, metric, outbox, tin nhắn đang gửi | Dữ liệu còn trong bộ đệm |
| 5 | Đóng DB, Redis, kết nối broker | Việc đang chạy cần chúng cho đến cuối |
| 6 | Thoát (để event loop rỗng) | Không `process.exit()` sớm làm mất log/ghi dở |

Đóng DB trước khi drain xong là lỗi hay gặp: request đang chạy gọi truy vấn sau đó và ném lỗi "pool is closed", biến shutdown "graceful" thành lỗi 500 hàng loạt.

**So sánh với Nginx / PHP-FPM.** `nginx -s quit` (SIGQUIT) là graceful: worker ngừng nhận kết nối mới và đợi request xong (có `worker_shutdown_timeout` làm hạn). PHP-FPM cũng hiểu SIGQUIT (graceful) và `request_terminate_timeout` giới hạn mỗi request. Khi triển khai Laravel, mỗi request là một lần chạy script ngắn, nên "drain" gần như tự nhiên: worker xong request thì tự rảnh. Với Node, **một process chứa mọi kết nối, mọi job, mọi timer**, nên bạn phải tự quản lý từng thứ có thể giữ event loop sống, hoặc chấp nhận bị SIGKILL.

## Tricks & tips thực tế

- **Quyết định `Connection: close` ở lúc trả lời, không phải lúc request đến.** Lý do: request đến trước khi tắt nhưng trả lời sau; quyết định sớm để lại kết nối keep-alive treo cho đến `keepAliveTimeout` + 1 s (đã đo 6 s với `ka=5000`).
- **Gắn `once(server, "close")` / callback TRƯỚC khi gọi `server.close()`**, không sau. Lý do: nếu `'close'` đã phát, `await once(...)` đến sau sẽ chờ mãi (đã mắc phải khi viết thí nghiệm: process thoát với cảnh báo "unsettled top-level await").
- **Dùng `timer.unref()` cho timeout cưỡng bức** và đừng gọi `process.exit()` trong đường vui. Lý do: `exit` cắt log chưa flush và ghi dở; để event loop rỗng giúp mọi thứ `close` đúng; và `unref` tránh timer giữ process sống.
- **Đặt timeout tổng < grace period của orchestrator**, kèm log rõ từng bước (thời điểm, số request đang chạy). Lý do: khi bị SIGKILL bạn không có dấu vết nào để biết kẹt ở đâu.
- **Đếm request đang chạy** (tăng ở đầu handler, giảm ở `res.on("close")`) và log số này khi tắt. Lý do: biết đang chờ ai; thay vì đoán "tại sao shutdown treo 30 s".
- **Đặt `server.requestTimeout`/`headersTimeout` hợp lý** và timeout riêng cho handler. Lý do: một request treo mãi sẽ giữ `close()` chờ vô hạn; timeout cưỡng bức chỉ là lưới an toàn cuối.
- **Tự theo dõi socket upgrade** (WebSocket, SSE tự dựng, tunnel `CONNECT`). Lý do: không có API nào của http server đóng chúng (đã đo), nên không làm thì shutdown không bao giờ xong.
- **Gửi mã đóng 1001/1012 cho WebSocket trước khi destroy** và để client reconnect có jitter. Lý do: client biết đây là tắt có chủ đích, không đồng loạt kết nối lại tức thì.
- **Trong Docker, bảo đảm tín hiệu tới process Node**: dùng `CMD ["node", "server.js"]` dạng exec (không qua shell), hoặc `--init`/`tini`; `npm start` có thể không chuyển tiếp SIGTERM như mong muốn, và Node chạy làm PID 1 có hành vi tín hiệu riêng (kiến thức từ tài liệu, chưa thử ở đây). Lý do: nếu SIGTERM không tới app, mọi mã shutdown vô dụng và bạn nhận SIGKILL sau grace period.
- **Test shutdown bằng một tiến trình con thật**: `spawn(process.execPath, ["server.ts"])`, gửi `child.kill("SIGTERM")`, đo bằng client. Lý do: handler tín hiệu và việc process thoát tự nhiên không test được bằng cách gọi hàm trong cùng process (đã dùng cách này cho mọi số đo ở đây). Có thể đo bằng `kill -TERM <pid>` ở terminal, kiểm tra exit code bằng `echo $?`.
- **Cẩn thận handler `uncaughtException`/`unhandledRejection`**: đây là lỗi trạng thái không rõ; nên log rồi shutdown (và để orchestrator restart), không cố "tiếp tục như chưa có gì". Lý do: tiếp tục chạy với trạng thái hỏng gây lỗi khó truy vết hơn là restart.

## Liên hệ bài tập

Lab graceful shutdown (drain connection) yêu cầu bạn tự dựng quy trình. Hãy làm theo cách đo trước khi viết: (1) dựng server có `/slow`, (2) gửi SIGTERM từ tiến trình cha và ghi lại thứ tự sự kiện (`close()`, response cuối, đóng socket, `exit`), (3) thử giữ một kết nối keep-alive rảnh, một kết nối đang xử lý, một request treo vô hạn, rồi xem từng thứ ảnh hưởng thế nào đến thời điểm process thoát, (4) quyết định cách xử lý từng loại. Các bảng đo ở trên cho bạn hướng; việc ghép thành chương trình hoàn chỉnh và chọn thứ tự là phần của bạn. Câu hỏi tự kiểm tra: nếu client mới tới trong lúc drain thì sao? Nếu SIGTERM đến hai lần? Nếu một request kẹt mãi?

## Đọc thêm

- [Node.js: `server.close()`](https://nodejs.org/api/http.html#serverclosecallback)
- [Node.js: `server.closeIdleConnections()` và `closeAllConnections()`](https://nodejs.org/api/http.html#servercloseidleconnections)
- [Node.js: Process signal events](https://nodejs.org/api/process.html#signal-events)
- [Node.js: `net.Server.close()`](https://nodejs.org/api/net.html#serverclosecallback)

## Ghi chú của bạn
