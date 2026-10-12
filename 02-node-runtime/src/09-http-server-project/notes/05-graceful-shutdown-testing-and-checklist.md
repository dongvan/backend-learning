# 5. Graceful shutdown, kiểm thử server và checklist tự review

Server tốt không chỉ chạy đúng mà còn **dừng đúng** (hoàn tất việc đang làm rồi mới thoát) và **kiểm thử được** (mở cổng ngẫu nhiên, gọi bằng `fetch`, đóng sạch). File này gom cả hai, cộng checklist đối chiếu tiêu chí hoàn thành của Phase 02.

```ts
import http from "node:http";

const server = http.createServer((_req, res) => res.end("ok"));
server.listen(0, "127.0.0.1", () => {         // cổng 0 = hệ điều hành chọn cổng trống
  const { port } = server.address() as { port: number };
  console.log("đang nghe ở", port);
  server.close();                              // thử xong thì đóng
});
```

(Node 24.21. Toàn bộ chương trình dưới đây là minh hoạ khái niệm; phần việc của project là của bạn.)

## Ý chính

- **Graceful shutdown**: nhận `SIGTERM`/`SIGINT` -> ngừng nhận kết nối mới -> để request đang xử lý chạy xong -> đóng tài nguyên (DB, file log) -> thoát với mã đúng. Có **hạn chót** (timeout) rồi đóng cưỡng bức.
- `server.close()` **chỉ ngừng nhận kết nối mới**; kết nối keep-alive đang mở **vẫn phục vụ request mới** nếu không xử lý (đã thử, xem dưới). Cần `closeIdleConnections()`, header `Connection: close` trong lúc tắt, và `closeAllConnections()` khi hết hạn.
- Không gọi `process.exit()` giữa chừng: có thể **cắt log chưa kịp ghi** (đã đo: chỉ 64 KiB trong 2 MB tới được phía đọc, file 4). Hãy để event loop tự cạn và đặt `process.exitCode`.
- Test server: `listen(0)` rồi đọc `server.address().port`, gọi bằng `fetch`, `afterAll` đóng sạch. Không dùng cổng cố định (xung đột khi chạy song song).
- Thiết kế để dễ test: tách **`createApp(deps)` trả server chưa `listen`** khỏi file `main` mới `listen` và gắn tín hiệu.
- Test đường lỗi bằng **tiến trình thật và request thật**: lỗi async không được làm sập server.

## Lý thuyết chi tiết

**Vì sao cần graceful shutdown.** Khi triển khai (rolling update trong k8s, `docker stop`, systemd restart) tiến trình nhận `SIGTERM`. Nếu không xử lý, Node chết ngay: mọi request đang chạy bị cắt (client thấy lỗi), việc ghi dở dang có thể hỏng dữ liệu. Với PHP-FPM, quá trình `graceful` do FPM master lo (worker xong request rồi mới tắt); ở Node, **ứng dụng tự chịu trách nhiệm**.

**Một chuỗi sự kiện thực tế** (đã chạy: tiến trình server con, client gửi `/slow` mất 500 ms, 100 ms sau gửi `SIGTERM`; Node 24.21):

```text
[server] nhận SIGTERM -> ngừng nhận kết nối mới
in-flight: done /slow sau 442ms          # request đang chạy VẪN hoàn tất
[server] đã đóng server ok
tiến trình thoát: code=0 signal=null      # thoát sạch, không process.exit
request mới: ECONNREFUSED                 # cổng đã đóng
```

Khung của handler (ý tưởng, không đầy đủ):

```ts
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;                      // tín hiệu lặp lại: bỏ qua
  shuttingDown = true;
  console.log(JSON.stringify({ level: "info", msg: "shutdown", signal }));
  const force = setTimeout(() => server.closeAllConnections(), 2000);
  force.unref();                                 // timer này không giữ tiến trình sống
  server.close(() => { process.exitCode = 0; }); // callback gọi khi mọi kết nối đã đóng
  server.closeIdleConnections();                 // đóng ngay các kết nối keep-alive đang rảnh
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

**Bẫy keep-alive (đã kiểm chứng, và khác kỳ vọng thông thường).** Thử nghiệm: một client dùng keep-alive, mở kết nối, một request `/slow` đang chạy; gọi `server.close()`; sau khi `/slow` xong, client gửi tiếp `/new` **trên cùng kết nối**. Kết quả (Node 24.21):

```text
/idle conn=keep-alive port=34332
/slow conn=keep-alive port=34332
/new  conn=keep-alive port=34332     # vẫn được phục vụ SAU khi close() đã gọi, cùng cổng nguồn (cùng kết nối)
listening: false
```

Nghĩa là sau `close()`, server không còn nhận kết nối **mới**, nhưng **kết nối đã mở vẫn tiếp tục nhận request mới** và response vẫn ghi `connection: keep-alive`. Nếu client cứ dùng lại kết nối, tiến trình có thể mãi không tắt được (hoặc tắt trễ) cho tới khi hết `keepAliveTimeout` hoặc client đóng. Cách chữa đã thử: sau khi bắt đầu tắt, đặt `res.setHeader("connection", "close")` cho các response (cờ `shuttingDown`); kết quả: response `/slow` trả `conn=close` và request kế tiếp nhận `ECONNREFUSED` (client phải mở kết nối mới, mà cổng đã đóng). Kết hợp:

1. `server.close()` (ngừng nhận mới);
2. cờ `shuttingDown` + header `Connection: close` cho response đang/sắp trả;
3. `server.closeIdleConnections()` (đóng các kết nối rảnh ngay lập tức);
4. hết hạn chót mà vẫn còn: `server.closeAllConnections()` (cắt cứng; chấp nhận mất request đang chạy).

Kiến thức từ tài liệu `http`: kể từ Node 19, `server.close()` tự gọi `closeIdleConnections()`; thí nghiệm trên cho thấy kết nối **đang bận** vẫn cần xử lý riêng như trên.

**Thứ tự đóng.** Ngược với thứ tự khởi tạo: (1) báo "không sẵn sàng" (health/readiness trả 503 để load balancer ngừng gửi), (2) ngừng nhận kết nối, (3) đợi request đang chạy, (4) đóng tài nguyên phụ thuộc (DB, hàng đợi), (5) xả log, (6) thoát. Thêm khoảng chờ ngắn trước bước (2) trong Kubernetes là chuyện thường vì quá trình gỡ pod khỏi Service không đồng bộ với `SIGTERM` (kiến thức nền, chưa thử). Hạn chót của bạn phải **nhỏ hơn** thời gian chờ của nền tảng (`terminationGracePeriodSeconds` mặc định 30 giây trong Kubernetes, `docker stop` mặc định 10 giây) kẻo bị `SIGKILL` giữa chừng.

**Tín hiệu trong container (kiến thức từ tài liệu, chưa thử).** Nếu `node` là tiến trình PID 1 mà không đăng ký handler cho `SIGTERM`, hệ điều hành không áp dụng hành vi mặc định "chết" cho PID 1, nên `docker stop` chờ hết hạn rồi mới `SIGKILL`; và nếu chạy qua `npm start` hay shell wrapper, tín hiệu có thể không tới Node. Chạy `node server.js` trực tiếp (hoặc dùng init như `tini`) và luôn có handler.

**Chặn việc mới ở mọi lớp.** Cờ `shuttingDown` còn dùng được ở middleware (trả 503 cho request mới nếu muốn) và ở health/readiness. `SIGINT` lặp lại (Ctrl+C hai lần) có thể là lệnh "thoát ngay", nhưng đó phải là quyết định có chủ ý của bạn, không phải tai nạn.

**Test server với cổng 0 và `fetch`.** Khung Vitest chạy được (Vitest 5.0.3, TS 7, Node 24.21), server tối thiểu `createApp()` trả `http.Server` chưa `listen`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.ts";

describe("http app", () => {
  const server = createApp();
  let base = "";
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();     // fetch giữ kết nối keep-alive; không đóng thì close() chờ lâu
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  it("GET /health", async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });
});
```

Ở lần chạy thử, `app.ts` chỉ có 8 dòng: `GET /health` trả `200 {"ok":true}`, mọi đường dẫn khác trả 404; đoạn test trên cần một `createApp` như thế để chạy. Đã chạy: 2 test pass trong khoảng 0,4 s. Lưu ý: ví dụ dùng `import ... from "./app.ts"` kèm đuôi `.ts`, cần `allowImportingTsExtensions` (và `noEmit`) trong `tsconfig` của phase; `tsconfig` của Phase 01 không bật cờ này, nên cấu hình Phase 02 là việc bạn quyết định (xem README/PLAN của phase).

Điểm cần chú ý:

- **`127.0.0.1` thay vì `localhost`** khi gọi: `localhost` có thể phân giải IPv6 (`::1`) trong khi server nghe IPv4, gây `ECONNREFUSED` khó hiểu.
- **Mỗi file test một server, cổng 0**: Vitest chạy các file test song song; cổng cố định sẽ xung đột.
- **Đóng sạch** trong `afterAll`: nếu không, tiến trình test treo vì handle còn mở. Công cụ dò: `why-is-node-running` hoặc `process.report` (Bài 8) liệt kê handle còn sống.
- **Test ở ba tầng**: (a) hàm thuần (khớp tuyến, serialize lỗi, redact): không cần mạng; (b) middleware/`compose` với `ctx` giả; (c) server thật bằng `fetch`. Phần lớn test nên ở (a), (b): nhanh và ít flaky; (c) kiểm tra việc ghép nối.
- **Test logger qua sink**: truyền `(line: string) => void` vào logger, `JSON.parse` từng dòng và kiểm tra `requestId`, `status`, không có `authorization`.
- **Test lỗi async**: handler thử ném đồng bộ, ném sau `await`, và `Promise.reject` không `await`; khẳng định response `500` chung và **server vẫn trả lời request kế tiếp**.
- **Test graceful shutdown ở mức tiến trình**: spawn con (`node:child_process`), gửi `SIGTERM` khi một request chậm đang chạy, khẳng định request đó hoàn tất, mã thoát 0, và request mới bị từ chối (đúng như thử nghiệm ở trên).

## Tricks & tips thực tế

- **`server.close()` kết hợp `closeIdleConnections()` + `Connection: close`, không bao giờ chỉ `close()`.** Lý do: đã đo: kết nối keep-alive bận vẫn nhận request mới sau `close()`, shutdown có thể không bao giờ kết thúc đúng hạn.
- **Dùng `timer.unref()` cho timer hạn chót.** Lý do: nếu server đóng sớm, timer đó không giữ tiến trình sống thêm cho tới khi hết hạn.
- **Đặt `process.exitCode` rồi để tiến trình tự thoát; chỉ `process.exit()` ở nhánh cưỡng bức sau khi xả log.** Lý do: `exit()` cắt dữ liệu chưa ghi (đo: 64 KiB trên 2 MB).
- **Làm shutdown idempotent (cờ `shuttingDown`).** Lý do: k8s hoặc người dùng có thể gửi tín hiệu nhiều lần; không muốn đóng hai lần hay đua nhau.
- **Log từng bước shutdown** (nhận tín hiệu, đóng server, đóng DB, thoát) kèm thời gian. Lý do: khi pod "mãi không tắt", log cho biết kẹt ở bước nào.
- **`SIGTERM` để dừng, `SIGINT` (Ctrl+C) khi dev: xử lý cả hai cùng một hàm.** Trên Windows, tín hiệu hạn chế; project này nhắm Linux/macOS.
- **Luôn cho test một hạn chót ngắn** (`{ timeout: 2000 }`) và `AbortSignal.timeout` cho `fetch`. Lý do: server lỗi khiến `fetch` treo vô hạn và test treo; hạn chót biến treo thành lỗi đọc được.
- **Không gọi API thật hay cổng cố định trong test.** Lý do: chạy được trên CI và song song, không phụ thuộc môi trường.
- **Debug test treo không thoát:** chạy `npx why-is-node-running` hoặc thêm log `server.getConnections` trong `afterAll`; thường là kết nối keep-alive chưa đóng hoặc timer chưa `clear`/`unref`.

## Liên hệ bài tập

Đối chiếu từng mục checklist ở trên với project của bạn và ghi lại bằng chứng (tên test, lệnh, số đo). Hai việc nên làm riêng: (1) viết test spawn tiến trình con để chứng minh graceful shutdown; (2) cố ý phá thử (quên `await next()`, bỏ `try/catch` ở listener) và xem test nào đỏ: nếu không test nào đỏ thì test chưa đủ.

### Checklist tự review (trước khi báo hoàn thành)

*Kiến trúc*
- [ ] Chỉ dùng `node:http` và module có sẵn của Node; không framework; không thêm dependency ngoài nhu cầu.
- [ ] Pipeline có thứ tự rõ ràng và giải thích được; không trạng thái request nào ở biến module.
- [ ] Mọi middleware `await next()`, không gọi `next()` hai lần, không vừa trả response vừa chuyển tiếp.

*Routing và input*
- [ ] 404 và 405 phân biệt (405 có `Allow`); tham số `:id`; thứ tự khớp (`/users/me` so với `/users/:id`) có test.
- [ ] `%` hỏng, JSON hỏng, sai `Content-Type`, body quá lớn (cả không có `Content-Length`) đều trả đúng 4xx, không 500, không sập.
- [ ] Query/params không dùng khoá do client chọn trên `{}` thường.

*Lỗi*
- [ ] Lỗi nghiệp vụ và lỗi bất ngờ phân biệt; 500 không lộ stack/thông điệp gốc; có `code` ổn định.
- [ ] Lỗi ném đồng bộ, sau `await`, và `Promise.reject` không `await` đều không làm sập server (có test).
- [ ] Có xử lý khi `headersSent`; có lưới an toàn cuối cùng cho `unhandledRejection`/`uncaughtException`.

*Log*
- [ ] JSON line; `time`, `level`, `msg`, `requestId`; access log có `method`, `path`, `status`, `durationMs`; client ngắt kết nối được ghi nhận đúng.
- [ ] `requestId` trong response header và mọi dòng log của request (kể cả sau `await`), nhờ `AsyncLocalStorage`.
- [ ] Không log `Authorization`, cookie, mật khẩu, body; có test chứng minh.

*Vòng đời và test*
- [ ] `SIGTERM`/`SIGINT` đóng server gọn: request đang chạy xong, kết nối keep-alive không giữ tiến trình, có hạn chót; không `process.exit()` giữa chừng.
- [ ] Test bằng cổng 0 + `fetch`, đóng sạch, không treo; `npm test` và `tsc --noEmit` sạch.

#### Đối chiếu tiêu chí Phase 02 (ROADMAP)


| Tiêu chí | Project chạm tới thế nào | Câu tự kiểm tra |
|---|---|---|
| Giải thích cách Node xử lý I/O và CPU-bound | Server xử lý nhiều request đồng thời trên một luồng nhờ I/O bất đồng bộ; một đoạn CPU nặng trong handler chặn mọi request | Vì sao một vòng lặp 200 ms trong một handler làm request khác chậm 200 ms? Đo bằng `monitorEventLoopDelay` (Bài 8) |
| Phân biệt async I/O và parallel CPU | `await` không chạy song song CPU, chỉ nhường event loop | Hai request đến cùng lúc, mỗi request tốn 100 ms CPU; tổng thời gian là bao nhiêu và vì sao? Worker thread giải quyết điều gì |
| Đọc memory profile, xử lý lỗi runtime | Giám sát `rss`/`heapUsed`, `unhandledRejection`, stack, `cause` | Server của bạn tăng bộ nhớ khi nhận nhiều body: bạn xem số nào, công cụ nào |
| Hiểu backpressure và graceful shutdown | Đọc body theo luồng có giới hạn; ghi response; shutdown như trên | Nếu client đọc chậm mà handler `res.write` liên tục thì chuyện gì xảy ra với bộ nhớ? `res.write` trả `false` nghĩa là gì |

(Ngoài phạm vi bắt buộc nhưng đáng thử để củng cố: thêm một tuyến thử nghiệm làm việc CPU nặng và quan sát độ trễ event loop; ghi lại số đo vào `PROGRESS.md` theo quy trình của repo. Chỉ tick hoàn thành khi có bằng chứng: test pass, `tsc` sạch, và bạn giải thích lại được.)


## Đọc thêm

- [Node.js: `http.Server` (`close`, `closeIdleConnections`, `closeAllConnections`)](https://nodejs.org/api/http.html#serverclosecallback)
- [Node.js: `process` (signal events)](https://nodejs.org/api/process.html#signal-events)
- [Node.js: Anatomy of an HTTP Transaction](https://nodejs.org/en/learn/http/anatomy-of-an-http-transaction)
- [Vitest: Guide](https://vitest.dev/guide/)

## Ghi chú của bạn
