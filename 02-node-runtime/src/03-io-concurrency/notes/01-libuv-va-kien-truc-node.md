# 1. libuv và kiến trúc của Node.js

Node.js = **V8** (chạy JavaScript) + **libuv** (event loop, I/O bất đồng bộ, thread pool) + các binding C++ nối hai thứ đó với API như `fs`, `net`, `crypto`. JavaScript của bạn luôn chạy trên **một thread**; phần "bất đồng bộ" nằm ở libuv và hệ điều hành.

```ts
import { readFile } from "node:fs/promises";

console.log("node", process.versions.node, "| v8", process.versions.v8, "| libuv", process.versions.uv);
const t = performance.now();
const p = readFile(import.meta.filename); // trả về ngay, việc đọc diễn ra ngoài thread JS
console.log("sau khi gọi readFile:", (performance.now() - t).toFixed(2), "ms (chưa có dữ liệu)");
await p;
```

Node 24.21 đã thử: `node 24.21.0 | v8 13.6.233.17-node.53 | libuv 1.52.1`.

## Ý chính

- V8 chỉ biết thực thi JS và quản lý heap/GC. V8 **không** có `setTimeout`, `fs`, socket: những thứ đó do Node (qua libuv) cung cấp.
- libuv cung cấp: event loop, timers, socket/TCP/UDP bất đồng bộ, file system, DNS, signals, child process, và một **thread pool** cho việc không có API bất đồng bộ thật ở OS.
- Code JS của bạn chạy trên một thread chính (main thread). Khi bạn `await` một I/O, thread đó **rảnh** để xử lý việc khác, không phải "chờ".
- Callback/promise của I/O luôn quay lại thread JS. Hai thread không bao giờ chạy JS của bạn cùng lúc (trừ khi bạn chủ động tạo Worker, Bài 4).
- "Node đơn luồng" chỉ đúng với JS. Process Node thật sự có nhiều thread (thread pool libuv, thread GC của V8, thread xử lý nền...).

## Lý thuyết chi tiết

**Ai làm gì.** Hình dung ba tầng:

```text
JS của bạn          (một thread, V8)
   | gọi API như fs.readFile, net.connect, crypto.pbkdf2
Node C++ bindings   (đóng gói yêu cầu thành "request" gửi cho libuv)
   |
libuv               (event loop + thread pool + wrapper quanh epoll/kqueue/IOCP)
   |
Hệ điều hành        (kernel: socket, file, tiến trình)
```

Khi bạn gọi `socket.write(...)`, Node đăng ký một yêu cầu với libuv; libuv ghi dữ liệu vào socket non-blocking của kernel. Khi kernel báo "socket sẵn sàng đọc", libuv đưa một callback vào hàng đợi, và vòng lặp sự kiện chạy callback đó trên thread JS. Chi tiết các pha của vòng lặp (timers, poll, check...) là nội dung Bài 1; bài này tập trung vào **việc gì chạy ở đâu**.

**libuv là thư viện C đa nền tảng.** Nó che sự khác nhau giữa các cơ chế đa hợp I/O của từng hệ điều hành: `epoll` (Linux), `kqueue` (macOS/BSD), `IOCP` (Windows). Nhờ đó cùng một đoạn JS chạy được trên cả ba. Libuv không phải của riêng Node; Julia, Luvit cũng dùng.

**So sánh với PHP-FPM.** Với PHP-FPM, một request chiếm hẳn một process (hoặc worker) từ lúc đến tới lúc xong; khi code gọi `$pdo->query()` thì process đó **ngồi chờ** (blocking), và bạn mở rộng bằng cách có nhiều process. Với Node, một process phục vụ hàng nghìn kết nối: khi request A chờ DB, thread JS chuyển sang xử lý request B. Hệ quả quan trọng:

| | PHP-FPM | Node.js |
|---|---|---|
| Đơn vị concurrency | process/worker | kết nối/promise trong một thread |
| Chờ I/O | process bị chặn | thread rảnh, làm việc khác |
| Việc tính toán nặng ở request A | chỉ ảnh hưởng worker đó | **chặn mọi request khác** trong cùng process |
| Trạng thái toàn cục | mất sau mỗi request | tồn tại giữa các request (cache, biến module) |

Dòng thứ ba là cái giá của mô hình: vì mọi request chia sẻ một thread JS, một vòng lặp CPU 500ms của một request làm **tất cả** request khác đứng 500ms. Đó là chủ đề xuyên suốt của Bài 3 và 4.

**V8 và libuv không biết nhau.** Chúng được "dán" lại bởi Node. V8 có khái niệm microtask queue (promise); libuv có khái niệm các pha của loop. Node điều phối: sau mỗi callback từ libuv, Node chạy `process.nextTick` queue rồi microtask queue của V8. Đó là lý do thứ tự `nextTick` -> promise -> `setImmediate` có quy tắc riêng (Bài 1, 2).

**Nhìn thấy các thread thật.** Trên Linux, đếm thread của chính process Node:

```ts
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";

const count = (): number => readdirSync("/proc/self/task").length;
console.log("lúc bắt đầu:", count());
await readFile(import.meta.filename); // lần đầu dùng thread pool
await new Promise((r) => setTimeout(r, 50));
console.log("sau khi dùng fs bất đồng bộ:", count());
```

Node 24.21 trên máy 12 core đã thử: `7` rồi `11`. Tức là process Node đã có 7 thread ngay khi khởi động (main, GC, nền của V8, ...), và **4 thread của thread pool libuv chỉ được tạo khi lần đầu cần** (lười, `lazy`). Con số 7 phụ thuộc phiên bản và máy; điều đáng nhớ là chênh lệch +4 bằng `UV_THREADPOOL_SIZE` mặc định. (`/proc` chỉ có trên Linux.)

## Tricks & tips thực tế

- **Đừng nói "Node là đơn luồng" khi phỏng vấn hay thiết kế**; hãy nói "JS chạy trên một thread, I/O và một số tác vụ nặng chạy ngoài thread đó". Lý do: nếu tin Node hoàn toàn đơn luồng, bạn sẽ không hiểu vì sao `crypto.pbkdf2` bất đồng bộ lại không chặn server nhưng `pbkdf2Sync` thì chặn, và vì sao thread pool có thể nghẽn.
- **Khi debug "server đứng hình", hỏi trước: thread JS đang bận hay đang rảnh?** Nếu CPU của process ~100% một core mà không phục vụ được request, thread JS đang bị chặn bởi code đồng bộ. Nếu CPU thấp mà vẫn chậm, thường là chờ I/O ngoài (DB, API) hoặc thread pool nghẽn (bài 2).
- **Dùng `process.versions` khi ghi báo cáo bug/benchmark**, vì hành vi libuv/V8 thay đổi theo phiên bản (ví dụ cách libuv dùng `io_uring` cho file I/O đã thay đổi qua các bản; chi tiết đó là kiến thức từ tài liệu, chưa thử ở bài này).
- **Quen với việc "một process = một core JS"**: máy 12 core mà chạy một process Node thì code JS chỉ dùng tối đa khoảng một core. Mở rộng theo chiều ngang bằng nhiều process (cluster/PM2/container, xem Bài 4) hoặc Worker Threads cho việc CPU.
- **Biến module/global sống giữa các request** là lợi thế (cache trong bộ nhớ, connection pool) nhưng cũng là cạm bẫy so với PHP: rò rỉ bộ nhớ tích luỹ qua thời gian, và dữ liệu của người dùng A có thể bị lộ cho B nếu bạn lưu vào biến toàn cục thay vì theo request. Với Laravel bạn quen việc "mỗi request bắt đầu sạch"; ở Node bạn phải tự giữ kỷ luật đó.

## Liên hệ bài tập

Lab Bài 3 yêu cầu đo event loop lag khi chặn thread JS. Trước khi viết, hãy tự dự đoán: một vòng lặp đồng bộ 300ms thì lag đo được khoảng bao nhiêu, và nó ảnh hưởng một `setInterval` 50ms ra sao? Sau khi đo, đối chiếu dự đoán với kết quả và giải thích bằng sơ đồ "JS chạy ở đâu" ở trên.

## Đọc thêm

- [Node.js: Event Loop, Timers, and process.nextTick()](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick)
- [libuv: Design overview](https://docs.libuv.org/en/v1.x/design.html)
- [Node.js: `process.versions`](https://nodejs.org/api/process.html#processversions)

## Ghi chú của bạn
