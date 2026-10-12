# 4. Structured logging và `AsyncLocalStorage`

Log có cấu trúc là mỗi sự kiện một **dòng JSON** với các trường cố định (`time`, `level`, `msg`, `requestId`, ...), để máy lọc, đếm và nối các dòng của cùng một request. `AsyncLocalStorage` là cách để logger biết "request nào" mà không phải truyền `requestId` qua mọi hàm.

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const als = new AsyncLocalStorage<{ requestId: string }>();

// Ý tưởng: mỗi dòng log là một object JSON; context của request lấy từ AsyncLocalStorage
function log(level: "info" | "error", msg: string, fields: Record<string, unknown> = {}): void {
  const line = { time: new Date().toISOString(), level, msg, ...als.getStore(), ...fields };
  process.stdout.write(JSON.stringify(line) + "\n");
}

log("info", "khởi động");   // ngoài request: không có requestId
await als.run({ requestId: randomUUID() }, async () => {
  log("info", "bắt đầu xử lý");
  await new Promise((r) => setTimeout(r, 5));
  log("error", "thất bại", { err: { name: "Error", message: "boom" } });
});
```

(Node 24.21 đã chạy; output là ba dòng JSON, hai dòng sau cùng `requestId` dù cách nhau một `await`. Đây là **khung ý tưởng**: chưa có mức log, che dữ liệu nhạy cảm, serialize lỗi, hay xử lý ghi chậm. Bạn tự thiết kế phần còn lại.)

## Ý chính

- **Một dòng = một JSON object**, ghi ra **stdout**; việc gom log (file, Loki, ELK, CloudWatch) là của hạ tầng. Không in chuỗi tự do kiểu `console.log("user " + id + " login")`: không lọc được theo trường.
- Trường tối thiểu cho mỗi dòng: `time` (ISO 8601, UTC), `level`, `msg`, và **`requestId`** nếu nằm trong request. Dòng *access log* thêm `method`, `path`, `status`, `durationMs`.
- **Mức log** (`debug < info < warn < error`, có thể thêm `fatal`) cho phép bật/tắt độ chi tiết bằng cấu hình mà không sửa code.
- **Che (redact) dữ liệu nhạy cảm**: `Authorization`, cookie, mật khẩu, token, thông tin cá nhân. Ưu tiên **danh sách cho phép** (chỉ log những trường biết là an toàn) hơn danh sách chặn.
- **Request id / correlation id**: sinh cho mỗi request (hoặc nhận từ header đã kiểm tra), trả lại trong header response, ghi trong mọi dòng log của request. `AsyncLocalStorage` mang nó đi xuyên `await`, timer, callback.
- Đo thời gian bằng đồng hồ **đơn điệu** (`performance.now()`, `process.hrtime.bigint()`), không phải `Date.now()`.
- Log access nên ghi khi `res` phát `close`, chứ không chỉ `finish` (client có thể bỏ giữa chừng).

## Lý thuyết chi tiết

**Vì sao JSON line.** Mỗi dòng độc lập (dễ chia luồng, dễ `grep`, `jq`), trường có tên (lọc `status >= 500`), kiểu rõ (số, boolean, mảng). So với Monolog của Laravel: handler + formatter `JsonFormatter` cho ra dạng tương tự; `context` array tương ứng `fields`; **processor** (thêm `request_id` cho mọi bản ghi) tương ứng việc trộn `als.getStore()` vào mỗi dòng. Kênh (`channel`) tương ứng một trường như `component: "http"` hay logger "con".

**Mức log và ngưỡng.** Giữ một ngưỡng tối thiểu theo cấu hình (`LOG_LEVEL=info`), bỏ qua sớm các dòng dưới ngưỡng **trước khi** dựng object/`JSON.stringify` (vì chi phí nằm ở dựng chuỗi). Gợi ý ánh xạ: lỗi client (4xx) là `info`/`warn`, lỗi server (5xx, bug) là `error`. Đừng ghi 404 ở `error`: báo động giả khiến người trực bỏ qua báo động thật.

**Serialize lỗi.** `JSON.stringify(new Error("x"))` ra `{}`; với lỗi có gán `this.name` thì chỉ ra `{"name":"RepoError"}` (đã đo trong Bài 8, file 5): `message`, `stack`, `cause` không liệt kê. Logger của bạn cần hàm chuyển lỗi thành object (`name`, `message`, `stack`, `code`, và đệ quy `cause` với **giới hạn độ sâu** để tránh vòng tham chiếu), và nên được dùng ở **một** chỗ. Cũng nhớ `JSON.stringify` **ném lỗi** với tham chiếu vòng và với `BigInt`: một dòng log không bao giờ được làm hỏng request; hãy bọc để dựng dòng log không thể ném.

**Che dữ liệu nhạy cảm.** Hai cách:

- *Danh sách chặn* (redact theo khoá: `authorization`, `cookie`, `password`, `token`, `set-cookie`...): dễ nhưng **sót** khi có trường mới hoặc lồng sâu.
- *Danh sách cho phép* (chỉ log những header/field đã biết, ví dụ `user-agent`, `content-length`): chắc hơn; trường mới mặc định không lộ.

Những chỗ hay lộ: `req.headers` nguyên bản, **query string** (`?token=...`, `?api_key=...`; nhiều hệ thống dán secret vào URL), body request đăng nhập, object lỗi của thư viện HTTP/DB chứa cấu hình kết nối (kèm mật khẩu) hay câu SQL kèm tham số. Chỉ log `path`, không log `req.url` đầy đủ nếu query có thể chứa bí mật. Và **không log body** mặc định.

**Log injection.** Dữ liệu người dùng đưa vào log (User-Agent, path) có thể chứa xuống dòng, dấu nháy. Với JSON line, `JSON.stringify` đã escape (`"evil\n\"quote"` ra đúng một dòng như ví dụ trên), nên kẻ tấn công không tự "viết thêm dòng log giả" được. Đó là một lý do bổ sung để dùng JSON thay vì nối chuỗi.

**Request id.** Hai nguồn: sinh ra (`crypto.randomUUID()`) hoặc nhận từ header của client/proxy (`x-request-id`). Nếu nhận, **kiểm tra** (độ dài tối đa, ký tự cho phép) hoặc bỏ đi và sinh mới: header là input không đáng tin, có thể chứa chuỗi cực dài hoặc ký tự điều khiển, rồi bạn ghi nguyên vào mọi dòng log và response. Luôn trả `x-request-id` trong response (kể cả response lỗi) để người dùng báo lại.

**`AsyncLocalStorage` (module `node:async_hooks`).** `als.run(store, fn)` chạy `fn` sao cho mọi code **tiếp nối bất đồng bộ** từ đó (qua `await`, `setTimeout`, callback, promise con) thấy `als.getStore()` trả đúng `store`. Đã kiểm chứng trong server `http` thật với hai request song song (`aaa`, `bbb`), mọi điểm đều đúng id của request tương ứng:

```text
aaa đầu handler          -> aaa
bbb đầu handler          -> bbb
aaa sau await/setTimeout -> aaa
aaa promise con 1 -> aaa
  [bus listener] store = aaa       (listener của EventEmitter tạo ngoài request, nhưng emit trong request)
aaa res 'finish' listener -> aaa
aaa req 'end' listener   -> aaa
ngoài run() -> -
```

Nó thay cho việc truyền `ctx`/`logger` qua mọi tham số. Phần đắt là gì? Đã đo vi mô (Node 24.21): gọi một hàm async nhỏ **không** có ALS mất khoảng 0,21 µs; có `als.run` khoảng 0,54 µs: thêm cỡ 0,3 µs mỗi lần `run`, không đáng kể so với một request HTTP (đo vi mô, mang tính tham khảo; Node thay đổi cài đặt ALS giữa các phiên bản).

**Hai cạm bẫy của ALS (đã kiểm chứng).**

1. **Context dính theo nơi tạo, không theo nơi dùng.** Một `setInterval` hay một kết nối/pool khởi tạo lười **trong request đầu tiên** sẽ mang store của request đó mãi mãi. Thử nghiệm: bộ gom "flush" tạo trong `als.run("req-A", ...)`, sau đó request B thêm item; khi flush chạy, log cho thấy `store = req-A` cả với item của B:

   ```text
   flush chạy với store = req-A items: a1,b1
   ```
   Hệ quả: log của job nền gắn nhầm request id, và (tệ hơn) dữ liệu theo request như user/tenant bị dùng sai. Hãy khởi tạo tài nguyên dùng chung **ngoài** `als.run`, hoặc truyền dữ liệu cần thiết tường minh cho job nền.
2. **`als.enterWith(store)` rò rỉ** sang phần còn lại của execution hiện tại (đã thử: sau `enterWith("leaked")` và một `await`, `getStore()` vẫn trả `"leaked"`). Ưu tiên `run()`, có phạm vi rõ ràng.

Khi một thư viện gọi callback từ hàng đợi/pool nội bộ, context có thể không còn là của request mong muốn; lúc đó dùng `AsyncResource.bind` hoặc `AsyncLocalStorage.bind` (kiến thức từ tài liệu `async_context`, chưa thử trong notes này) để buộc context.

**stdout hay file.** Quy ước 12-factor: tiến trình chỉ ghi log ra **stdout** (và lỗi nặng ra stderr), không quản lý file xoay vòng; hạ tầng (Docker, systemd, k8s) thu và chuyển đi. Ghi file trực tiếp từ ứng dụng thêm rủi ro đĩa đầy, xoay file, quyền ghi, nhiều tiến trình tranh một file. Tuy vậy, cần biết hành vi của `process.stdout`:

- Khi stdout là một **pipe** (Docker/k8s thường vậy), trên máy thử (Linux, Node 24.21) việc ghi là **bất đồng bộ**: ghi 2 MB vào pipe mà phía đọc chưa đọc, vòng lặp `write` kết thúc sau 8 ms và `process.stdout.writableLength` là khoảng 1,98 MB: dữ liệu **xếp hàng trong bộ nhớ** của tiến trình. Nếu phía đọc chậm, log phình RAM; một log quá nhiều có thể gây áp lực bộ nhớ ngay cả khi không có rò rỉ nào.
- Hệ quả quan trọng: **`process.exit()` ngay sau khi ghi có thể cắt log.** Đã thử: ghi 2 MB (2000 dòng 1 KiB) rồi `process.exit(0)`, phía đọc chỉ nhận **65536 byte** (64 KiB); khi để tiến trình tự thoát (không gọi `exit`, chỉ đặt `process.exitCode`) thì phía đọc nhận đủ **2048000 byte**. Đây là lý do graceful shutdown nên để event loop tự cạn thay vì `process.exit()` (file 5), và dòng log cuối cùng trước khi chết (thường là dòng quan trọng nhất) dễ mất nhất.

**Thời gian phản hồi.** Ghi thời điểm vào bằng `process.hrtime.bigint()` hoặc `performance.now()` (đã thử, cùng một khoảng chờ 25 ms: hrtime 27,46 ms, `performance.now` 26,57 ms, `Date.now` 26 ms: `Date.now` chỉ có độ phân giải mili giây và nhảy khi đồng hồ hệ thống chỉnh). Tính `durationMs` khi response kết thúc.

**Access log: `finish` hay `close`.** Đã thử:

```text
/normal finish: statusCode=200 writableFinished=true 3ms
/normal close : statusCode=200 writableFinished=true 4ms
(client bỏ giữa chừng)
/slow close : statusCode=200 writableFinished=false 58ms
```

Khi client ngắt giữa chừng, **chỉ `close` phát**, `finish` không; và `statusCode` vẫn là `200` (mặc định, chưa từng gửi) nên **không đáng tin** nếu `writableFinished` là `false`. Một access log đúng nên đăng ký `close`, kiểm tra `res.writableFinished`, và ghi rõ trường hợp "client ngắt" (ví dụ `aborted: true`, và đừng ghi 200 như thể đã thành công). Sự kiện `aborted` của `req` đã bị đánh dấu deprecated.

## Tricks & tips thực tế

- **Chỉ dùng một hàm `log` (hoặc đối tượng logger) trong cả ứng dụng, không `console.log` rải rác.** Lý do: đảm bảo mọi dòng có cùng định dạng, cùng `requestId`, cùng chính sách che dữ liệu.
- **Đặt tên trường cố định và có chủ ý** (`requestId` chứ không lúc `reqId` lúc `request_id`; `durationMs` có đơn vị trong tên). Lý do: người truy vấn log cần đoán đúng tên; đổi tên sau này làm gãy dashboard/cảnh báo.
- **Mỗi request một dòng access log tóm tắt**, cộng các dòng ứng dụng theo cần. Lý do: dễ tính tỉ lệ lỗi, p95/p99 từ đúng một nguồn; chi tiết nằm ở các dòng cùng `requestId`.
- **Không log theo vòng lặp nóng mà không kiểm tra mức** (`debug` trong ứng dụng thực tế). Lý do: dựng chuỗi và `JSON.stringify` rất tốn dù cuối cùng bỏ đi, và hàng đợi stdout phình khi log nhiều hơn tốc độ phía đọc.
- **Đừng log object lớn nguyên vẹn** (body, response từ dịch vụ khác, danh sách dài). Lý do: tốn băng thông log, lộ dữ liệu, và có thể vượt giới hạn dòng của hệ thống thu log (nhiều hệ thống cắt dòng quá dài).
- **Sau khi bắt lỗi, log `err` kèm `cause` một lần ở error boundary**; ở các lớp dưới chỉ bọc `cause`. Lý do: tránh log trùng (file 3).
- **Test logger bằng cách bắt dòng JSON đã ghi** (cho logger nhận một "sink" `(line: string) => void` thay vì gắn cứng `process.stdout`) và `JSON.parse` để kiểm tra trường. Lý do: kiểm tra redaction và `requestId` mà không cần đọc stdout của tiến trình.
- **Không dựa vào `AsyncLocalStorage` cho dữ liệu nghiệp vụ** (người dùng hiện tại, giao dịch DB), chỉ cho dữ liệu quan sát (request id, tracing). Lý do: nó ẩn phụ thuộc, khó test và cạm bẫy ở trên dễ gây rò dữ liệu giữa request.
- **Cân nhắc sampling cho log `info` ở lưu lượng rất cao**, nhưng **không bao giờ** lấy mẫu `error`. Lý do: chi phí lưu log tăng theo lưu lượng; lỗi thì mỗi cái đều quan trọng.
- **Debug "log không thấy `requestId`":** kiểm tra log đó phát sinh từ đâu: timer/pool/queue khởi tạo ngoài `als.run`? Một callback từ thư viện không giữ context? Dòng ghi bằng `console.log` thay vì logger chung?

## Liên hệ bài tập

Tiêu chí của project về log: mỗi request có `requestId` xuất hiện trong header response và **mọi** dòng log của request đó (kể cả dòng phát sinh sau một `await`), mỗi request có một dòng access log với `method`, `path`, `status`, `durationMs`, dữ liệu nhạy cảm không xuất hiện trong log. Tự trả lời: bạn log ở sự kiện nào của `res` và vì sao? Trường hợp client ngắt kết nối giữa chừng ghi ra sao? Một test sẽ chứng minh `Authorization` không lọt vào log như thế nào? Chỉ có hướng; việc thiết kế logger là của bạn.

## Đọc thêm

- [Node.js: `async_context` (`AsyncLocalStorage`)](https://nodejs.org/api/async_context.html)
- [Node.js: `process` (I/O của stdout/stderr, `process.exit`)](https://nodejs.org/api/process.html#a-note-on-process-io)
- [Node.js: `perf_hooks`](https://nodejs.org/api/perf_hooks.html)

## Ghi chú của bạn
