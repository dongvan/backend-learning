# 5. Debug lỗi runtime, báo cáo chẩn đoán và đọc memory trong container

Khi production gặp sự cố, bạn chỉ có những gì tiến trình để lại: **stack trace, log, báo cáo chẩn đoán, và các con số memory**. Notes này gom công cụ để chuỗi bằng chứng đó đủ dùng, và cách diễn giải khi chạy trong container/Kubernetes.

```ts
class RepoError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RepoError";
  }
}

async function loadUser(_id: number): Promise<never> {
  throw new Error("ECONNRESET");
}

try {
  await loadUser(1);
} catch (cause) {
  throw new RepoError("không đọc được user", { cause });   // giữ lỗi gốc, không làm mất stack
}
```

(`ErrorOptions` và `cause` cần `lib` từ ES2022 trở lên, repo đang dùng `ES2022`; chương trình trên kết thúc bằng lỗi chưa bắt, đúng chủ ý để xem stack.)

## Ý chính

- **Stack trace** là bằng chứng đầu tiên; giữ nó nguyên vẹn khi bọc lỗi bằng `new Error(msg, { cause })` (Node 16.9+, ES2022). Không `throw new Error(err.message)` làm mất stack gốc.
- Node có **stack bất đồng bộ** (`at async fn`) nhưng chỉ qua các `await`; callback kiểu cũ và `setTimeout` cắt chuỗi.
- `JSON.stringify(error)` **không** in `message`/`stack`/`cause`. Logger phải tự serialize lỗi.
- Code chạy từ file đã biên dịch (JS) thì stack trỏ vào file `dist`; `--enable-source-maps` map ngược về `.ts`. Chạy `node file.ts` (type stripping) thì vị trí đã khớp sẵn, không cần source map.
- `NODE_OPTIONS` đặt cờ cho mọi tiến trình Node trong môi trường (ví dụ trong container), nhưng chỉ chấp nhận một tập cờ cho phép; cờ ở dòng lệnh thắng `NODE_OPTIONS`.
- `process.report` tạo **báo cáo chẩn đoán JSON** (stack JS, heap, handle libuv, tài nguyên). Cẩn thận: mặc định có **biến môi trường**.
- `node:diagnostics_channel` là kênh pub/sub nhẹ để thư viện và Node phát sự kiện nội bộ cho công cụ giám sát.
- Trong container: **RSS quyết định bạn có bị OOMKilled không**, không phải `heapUsed`. Hai kiểu chết khác nhau: V8 hết heap (exit 134, có thông báo) và kernel OOM-kill (SIGKILL, exit 137, không thông báo nào từ Node).

## Lý thuyết chi tiết

**Đọc stack trace.** Mỗi dòng `at <hàm> (<file>:<dòng>:<cột>)`. Với ESM chạy trực tiếp, đường dẫn là URL `file:///...`. Dòng đầu là nơi `Error` được **tạo** (không hẳn nơi nó "xảy ra" nếu bạn tạo lỗi ở hàm tiện ích). Mặc định V8 giữ **10 khung** (`Error.stackTraceLimit`, đã in ra `10`); đặt `Error.stackTraceLimit = 2` thì stack chỉ còn 2 khung (đã thử: 3 dòng gồm dòng thông báo). Tăng lên (ví dụ 50) khi debug sâu, đừng tăng cố định ở production vì tạo stack tốn thêm CPU cho mỗi lỗi.

`Error.captureStackTrace(obj, fn)` gắn `stack` vào một object tuỳ ý và loại bỏ các khung từ `fn` trở lên; hữu ích để class lỗi riêng không để lộ khung của constructor trong stack (đã thử: khung đầu là nơi gọi `where`).

**`Error.cause` và stack bất đồng bộ.** Ví dụ ba tầng (`handler` -> `findUser` -> `query`), `query` ném `ECONNRESET`, `findUser` bọc thành `RepoError` với `cause`. `util.inspect` (cũng là cách `console.log` in lỗi) hiển thị cả hai (Node 24.21 đã thử):

```text
RepoError: không đọc được user
    at findUser (err1.ts:18:11)
    at async handler (err1.ts:23:3)
    at async err1.ts:27:3 {
  [cause]: Error: ECONNRESET
      at query (err1.ts:12:9)
      at async findUser (err1.ts:16:5)
      at async handler (err1.ts:23:3)
      at async err1.ts:27:3
}
```

Hai điều đáng chú ý: (1) dòng `at async handler` cho thấy chuỗi qua các `await` vẫn được dựng lại; (2) `cause` có stack **riêng**, trỏ đúng tới `query`, nơi lỗi thật sự phát sinh. Nhưng:

```ts
console.log(JSON.stringify(err));   // {"name":"RepoError"}
```

Chỉ `name` (do ta gán, nên là thuộc tính enumerable) xuất hiện: `message`, `stack`, `cause` là thuộc tính không liệt kê nên `JSON.stringify` bỏ qua. Một logger JSON ngây thơ (`logger.error({ err })`) sẽ ghi ra gần như rỗng. Phải serialize tay: `{ name, message, stack, cause: serialize(cause) }` (xem Bài 9, file 4).

**Lỗi không bắt được.** Đã thử trong Node 24.21: `Promise.reject(new Error("x"))` mà không ai xử lý làm tiến trình **kết thúc** (chế độ mặc định `throw`: biến thành `uncaughtException`). Với `--unhandled-rejections=warn` chỉ in `UnhandledPromiseRejectionWarning` và tiếp tục chạy. Bạn có thể đăng ký `process.on("unhandledRejection", ...)` để log (ví dụ nhận được `reason` và chính `promise`), và `process.on("uncaughtException", (err, origin) => ...)` (đã thử: `origin` là chuỗi `"uncaughtException"`; với rejection là `"unhandledRejection"`). Sau `uncaughtException`, trạng thái tiến trình không còn đáng tin: log rồi thoát (có thể theo trình tự graceful) và để trình giám sát khởi động lại. Quên `await`/`.catch` là nguồn gốc phổ biến nhất của kiểu lỗi này.

**Source map.** Dự án biên dịch bằng `tsc` với `"sourceMap": true` sinh `dist/app.js` và `dist/app.js.map`. Đã thử cùng một file, ném lỗi ở dòng 5 của `src/app.ts`:

```text
# node dist/app.js                     -> chỉ vào mã đã biên dịch
    at loadUser (file:///.../sm/dist/app.js:3:15)
# node --enable-source-maps dist/app.js -> map ngược về nguồn
    at loadUser (/.../sm/src/app.ts:5:11)
# node src/app.ts                       -> type stripping, vị trí đã đúng sẵn
    at loadUser (file:///.../sm/src/app.ts:5:11)
```

Dòng/cột trong `dist` (3:15) khác nguồn (5:11), nên không có source map thì mọi log lỗi trỏ vào mã đã biên dịch, rất khó đối chiếu. Lưu ý: tài liệu Node nói bật source map có thể làm việc truy cập `error.stack` chậm hơn (phải giải mã map); tác động đo được tuỳ khối lượng lỗi, chưa đo ở đây. Nếu lỗi rất nhiều (log lỗi hàng nghìn lần/giây) hãy đo trước khi bật ở production.

**`NODE_OPTIONS`.** Biến môi trường chứa cờ Node dùng cho mọi lần chạy (không cần sửa lệnh khởi động, tiện trong Dockerfile/k8s manifest). Đã thử:

- `NODE_OPTIONS="--max-old-space-size=100 --enable-source-maps"` có hiệu lực (đã đo `heap_size_limit` 292 MB).
- Cờ ở dòng lệnh **thắng** `NODE_OPTIONS`: với `NODE_OPTIONS=--max-old-space-size=100` và dòng lệnh `--max-old-space-size=200`, kết quả là giới hạn ứng với 200 (392 MB).
- Cờ không được phép bị từ chối: `NODE_OPTIONS="--foo"` -> `node: --foo is not allowed in NODE_OPTIONS`.
- Gắn nhầm `--inspect` vào `NODE_OPTIONS` khiến **mọi tiến trình Node** con (npm, script, worker) cũng cố mở cổng debug 9229: xung đột cổng và rủi ro bảo mật.
- Node 24.21 có `--max-old-space-size-percentage=<N>` (đã thử `=25` trên máy 7,7 GB: `heap_size_limit` ~2120 MB, tức một phần tư RAM cộng phần dôi như đã nêu ở file 1). Tiện khi image chạy trên nhiều cỡ container, nhưng kiểm tra xem nó dựa trên RAM máy hay giới hạn cgroup trên môi trường thật của bạn trước khi tin (chưa thử trong cgroup).

**`diagnostics_channel`.** Một pub/sub rất nhẹ, `hasSubscribers` cho phép bên phát bỏ qua việc dựng dữ liệu khi không ai nghe. Node tự phát vài kênh (ví dụ `http.server.request.start`); thư viện APM (OpenTelemetry...) subscribe để tạo span mà không cần vá (monkey-patch) code của bạn. Đã thử (Node 24.21):

```ts
import diagnostics_channel from "node:diagnostics_channel";

diagnostics_channel.subscribe("http.server.request.start", (msg) => {
  const { request } = msg as { request: { method?: string; url?: string } };
  console.log("[dc] request.start", request.method, request.url);
});

const ch = diagnostics_channel.channel("app:cache");   // kênh tự đặt, quy ước tên "<phạm vi>:<sự kiện>"
console.log(ch.hasSubscribers);                        // false cho tới khi có người subscribe
ch.subscribe((m) => console.log("[dc] app:cache", m));
if (ch.hasSubscribers) ch.publish({ key: "user:1", hit: false });
```

Kết quả: có dòng `[dc] request.start GET /ping?x=1` khi một request tới server `http`, và `[dc] app:cache { key: 'user:1', hit: false }`. Mức giới thiệu: bạn sẽ gặp khái niệm này khi gắn công cụ giám sát; chưa cần tự dùng trong dự án nhỏ.

**`process.report`.** `process.report.getReport()` trả object, `writeReport()` ghi file `report.<ngày>.<giờ>.<pid>.<tid>.<seq>.json`. Các khoá cấp cao đã quan sát: `header, javascriptStack, javascriptHeap, nativeStack, resourceUsage, uvthreadResourceUsage, libuv, workers, environmentVariables, userLimits, sharedObjects`. `libuv` liệt kê handle đang mở (kiểu `timer`, `async`, `loop`...: hữu ích để biết vì sao tiến trình không thoát), `javascriptHeap` có `memoryLimit`, `usedMemory`, `heapSpaces`, `resourceUsage` có `rss`, `constrained_memory`, `maxRss`. Cờ khởi động: `--report-uncaught-exception`, `--report-on-fatalerror`, `--report-on-signal`. Đã thử với `--report-uncaught-exception`: sau lỗi chưa bắt, một file `report.*.json` xuất hiện với `header.event = "Exception"` và `javascriptStack.message = "Error: boom"`.

**Cảnh báo bảo mật:** báo cáo chứa mục `environmentVariables`. Đã thử `DB_PASSWORD=hunter2 node ...`: giá trị `hunter2` có mặt trong báo cáo, và biến mất khi thêm `--report-exclude-env`. Mật khẩu/khoá API truyền qua env là chuyện thường ở container, nên coi file report là dữ liệu nhạy cảm; dùng `--report-exclude-env` ở môi trường chia sẻ báo cáo.

**Container và Kubernetes: đọc memory đúng cách.**

- Limit của pod/container được kernel (cgroup) thực thi theo **RSS và bộ nhớ trang liên quan của cả cgroup**, không phải theo `heapUsed`. Vượt limit: kernel gửi `SIGKILL`; k8s ghi `OOMKilled`, exit code **137** (128 + 9). Node **không có cơ hội** log hay graceful shutdown.
- V8 hết heap tự báo lỗi (`FATAL ERROR: ... JavaScript heap out of memory`) và thoát **134** (128 + SIGABRT). Phân biệt hai mã này giúp biết nên xem log của Node (134) hay metrics của cgroup (137).
- Một container hay bị OOMKilled dù `heapUsed` thấp thường do: `Buffer`/stream (nằm ngoài heap), `--max-old-space-size` đặt bằng đúng limit (V8 chưa kịp dọn thì kernel đã giết), nhiều worker thread/child process cộng dồn, hay đợt snapshot/report (file 3).
- Trong Node: `process.constrainedMemory()` trả giới hạn mà hệ điều hành áp cho tiến trình (cgroup); trên máy thử không có giới hạn nên trả `18446744073709552000` (xấp xỉ 2^64, nghĩa là "không giới hạn"). `process.availableMemory()` trả bộ nhớ còn trống (đã thử: ~6,5 GB). Với cgroup v2, file `/sys/fs/cgroup/memory.max` và `memory.current` là nguồn của limit/usage hiện tại (kiến thức từ tài liệu; máy thử không có các file này nên chưa kiểm chứng việc đọc chúng).
- Cách đặt cấu hình thực tế (kiến thức nền, không phải số liệu đo): `resources.limits.memory` bằng `requests.memory` để pod có QoS ổn định, và `--max-old-space-size` khoảng 60-75% limit.

## Tricks & tips thực tế

- **Luôn dùng `cause` khi bọc lỗi**, và ghi log cả chuỗi `cause`. Lý do: lỗi tầng trên ("không đọc được user") ít giá trị; lỗi gốc (`ECONNRESET`, mã SQL) mới cho biết nguyên nhân.
- **Không `catch` chỉ để `console.log(err.message)`:** mất stack. Hoặc ném tiếp, hoặc log đủ `err` (kèm stack) qua hàm serialize lỗi thống nhất.
- **Biến `unhandledRejection`/`uncaughtException` thành log có cấu trúc rồi thoát có kiểm soát.** Lý do: tiếp tục chạy sau lỗi không bắt được có thể để dữ liệu ở trạng thái nửa vời; để orchestrator (k8s, systemd) khởi động lại sạch hơn.
- **Bật `--enable-source-maps` khi chạy mã đã biên dịch** (và giữ `.map` trong image hoặc kho artifact), nếu không stack trỏ vào dist. Lý do: bạn đọc log lúc có sự cố, không có thời gian dịch ngược vị trí.
- **Đặt `--report-on-fatalerror` (và `--report-exclude-env`) trong môi trường dựng sẵn** nếu cần chẩn đoán sau chết. Lý do: lỗi V8 OOM không bắt được từ JS, báo cáo là cơ hội duy nhất lấy thông tin, đừng để lộ secret.
- **Ghi `rss`, `heapUsed`, `external` ra metrics định kỳ và đặt cảnh báo trên RSS so với limit** (ví dụ 80%). Lý do: cảnh báo trước khi OOMKilled, thay vì chỉ biết sau.
- **Khi pod OOMKilled: kiểm tra theo thứ tự** (1) exit code 137 hay 134; (2) đường RSS trước khi chết tăng đều (rò rỉ) hay nhảy vọt (một request/job lớn); (3) `heapUsed` có theo RSS không (JS) hay không (Buffer/native); (4) `--max-old-space-size` so với limit. Lý do: mỗi nhánh dẫn tới hướng điều tra khác nhau, tránh mở heap snapshot khi vấn đề nằm ngoài heap.
- **Đừng dựa vào `NODE_OPTIONS` để truyền cờ nguy hiểm** (`--inspect`) và hãy kiểm tra giá trị hiệu lực bằng `v8.getHeapStatistics()` hoặc `process.execArgv` khi nghi ngờ cờ không có tác dụng. Lý do: thứ tự ưu tiên (dòng lệnh thắng) dễ gây hiểu nhầm.
- **So với Laravel:** `report()`/`Handler` của Laravel chuyển exception vào log kèm context và `previous`; tương ứng là `cause` + logger JSON. Khác biệt lớn: ở PHP-FPM một request chết không kéo theo request khác, còn ở Node một lỗi không bắt được giết cả tiến trình đang phục vụ nhiều request.

## Liên hệ bài tập

Hãy thử tự tạo một lỗi ba tầng có `cause`, in bằng `console.log` và `JSON.stringify`, so sánh. Sau đó biên dịch một file TS nhỏ bằng `tsc` với source map và chạy có/không `--enable-source-maps`. Khi viết báo cáo lab, ghi rõ bạn đã loại trừ bộ nhớ ngoài heap bằng cách nào, và trình bày bạn sẽ đọc các con số này thế nào nếu ứng dụng chạy trong container giới hạn 512 MiB.

## Đọc thêm

- [Node.js: Diagnostics: Memory (understanding and tuning)](https://nodejs.org/en/learn/diagnostics/memory/understanding-and-tuning-memory)
- [Node.js: `process.report`](https://nodejs.org/api/report.html)
- [Node.js: `diagnostics_channel`](https://nodejs.org/api/diagnostics_channel.html)
- [Node.js: Command-line options (`--enable-source-maps`, `NODE_OPTIONS`)](https://nodejs.org/api/cli.html)
- [Node.js: Errors (`Error.cause`, `captureStackTrace`)](https://nodejs.org/api/errors.html)

## Ghi chú của bạn
