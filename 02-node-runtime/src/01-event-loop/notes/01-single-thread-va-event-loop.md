# 1. Mô hình single-thread và event loop

Code JavaScript của bạn chạy trên **một thread duy nhất**, và event loop là vòng lặp quyết định callback nào được chạy tiếp theo; việc chờ I/O được giao cho hệ điều hành hoặc thread pool của libuv.

```ts
import { readFile } from "node:fs/promises";

console.log("1. gửi yêu cầu đọc file");
const p = readFile(import.meta.filename, "utf8"); // giao cho thread pool, trả về ngay
console.log("2. chưa có kết quả, vẫn chạy tiếp");
console.log("3. đọc xong, độ dài:", (await p).length);
```

## Ý chính

- Chỉ có **một call stack** chạy JS. Hai đoạn JS của bạn không bao giờ chạy cùng lúc trong một process; đó là lý do không có race condition kiểu "hai thread cùng sửa một biến" trong code JS thông thường.
- "Bất đồng bộ" trong Node nghĩa là: **bắt đầu** một thao tác, đăng ký callback, trả quyền điều khiển lại cho event loop. Việc chờ diễn ra **ngoài** thread JS.
- Có hai nơi thực hiện công việc nền: (1) cơ chế I/O không chặn của hệ điều hành (socket mạng: epoll trên Linux), (2) **thread pool của libuv** (mặc định 4 thread) cho file system, DNS `lookup`, một số hàm `crypto`, `zlib`.
- Node **không** có JS chạy song song mặc định. Muốn chạy JS song song phải dùng Worker Threads hoặc child process (bài sau).
- Process Node tự thoát khi event loop **không còn việc** (không còn handle/request đang sống) và không còn callback nào chờ chạy.
- Hệ quả quan trọng nhất cho backend: **một request chạy code đồng bộ lâu thì mọi request khác đứng chờ**.

## Lý thuyết chi tiết

**Các thành phần.** Node gồm V8 (thực thi JS, quản lý heap, microtask queue), libuv (event loop, thread pool, I/O đa nền tảng) và phần binding C++ nối hai bên. Khi bạn gọi `fs.readFile`, V8 chạy hàm JS, hàm đó gọi xuống C++ để đẩy một "request" vào libuv, rồi **quay về ngay**. Khi thao tác xong, libuv đưa kết quả vào hàng đợi; event loop lấy ra và gọi callback (hoặc resolve promise) trên chính thread JS.

**Thread pool không phải nơi chạy JS.** Thread của pool chỉ chạy phần C/C++ chặn (đọc file, băm mật khẩu). Callback kết quả vẫn chạy ở thread chính. Thí nghiệm sau (Node 24.21 đã thử, máy 12 lõi, `UV_THREADPOOL_SIZE` mặc định) gọi 6 lần `pbkdf2` bất đồng bộ cùng lúc, mỗi lần tốn khoảng 200ms CPU:

```ts
import { pbkdf2 } from "node:crypto";

const t0 = performance.now();
for (let i = 1; i <= 6; i++) {
  pbkdf2("p", "s", 300_000, 64, "sha512", () =>
    console.log(`job ${i} xong ở`, Math.round(performance.now() - t0), "ms"),
  );
}
```

Kết quả thật: 4 job đầu xong ở khoảng 211-226ms, hai job cuối ở khoảng 395-401ms. Có đúng 4 job chạy song song, job 5 và 6 phải chờ thread rảnh. Chạy lại với `UV_THREADPOOL_SIZE=8` thì hai dòng cuối (job 3 và job 2) xong ở khoảng 255ms, tức 6 job chạy gần như cùng lúc. Bài học: "bất đồng bộ" không có nghĩa là "vô hạn song song"; pool có giới hạn và dùng chung cho cả fs, dns, crypto.

**Socket mạng không dùng thread pool.** Với TCP/HTTP, libuv đăng ký file descriptor vào cơ chế đa hợp của OS (epoll/kqueue/IOCP) và chỉ một thread chờ được hàng nghìn kết nối. Đây là lý do Node phục vụ nhiều kết nối đồng thời với ít bộ nhớ. (Kiến thức từ tài liệu libuv, chưa tự đo ở đây.)

**Thí nghiệm: I/O bất đồng bộ vs code đồng bộ chặn.** Một HTTP server chạy ở process riêng; client ở process khác gửi một request nặng, 100ms sau gửi tiếp `/health`. "Nặng" là `pbkdf2` 1.000.000 vòng (khoảng 750-850ms):

| Handler nặng | Thời gian request nặng | `/health` gửi sau 100ms |
|---|---|---|
| `pbkdf2Sync` (chặn thread JS) | 761 ms | **653 ms** |
| `pbkdf2` bất đồng bộ (thread pool) | 739 ms | **2 ms** |

(Node 24.21, một lần chạy; con số tuyệt đối thay đổi theo máy, hình dạng kết quả thì ổn định.) Với bản đồng bộ, `/health` không được xử lý cho đến khi hàm xong: đó là cái giá của một thread JS. Lưu ý client phải ở **process riêng**, nếu để cùng process thì event loop của client cũng bị chặn và số đo vô nghĩa (lỗi đo tôi đã mắc khi thử lần đầu).

**Khi nào process thoát?** Đoạn sau liệt kê những gì đang giữ event loop sống:

```ts
import { createServer } from "node:http";
import { once } from "node:events";

const s = createServer().listen(0);
await once(s, "listening");
setInterval(() => {}, 1000);
setTimeout(() => {}, 500);
setImmediate(() => {});
console.log(process.getActiveResourcesInfo());
// Node 24.21: [ 'TCPServerWrap', 'Timeout', 'Timeout', 'Immediate' ]
process.exit(0);
```

`process.getActiveResourcesInfo()` là công cụ debug hay dùng khi "chương trình không chịu thoát": nó chỉ ra socket, timer, server nào còn sống. Timer có thể gọi `.unref()` để không giữ process sống (đã thử: `setTimeout(..., 5000).unref()` cùng một timer 10ms khác thì process kết thúc sau khoảng 80ms thay vì 5 giây).

**So sánh PHP-FPM.** Chi tiết ở file 04; ở đây chỉ cần nhớ: PHP-FPM cho mỗi request một worker process, trong worker đó code chạy tuần tự và **chặn** khi chờ DB là bình thường vì worker khác lo request khác. Node đảo ngược: một process phục vụ mọi kết nối, nên **không được chặn**, còn chờ DB thì "miễn phí" vì chỉ là đăng ký callback.

## Tricks & tips thực tế

- **Mặc định dùng API bất đồng bộ** (`fs/promises`, `crypto.pbkdf2`, không phải `*Sync`) trong code chạy sau khi server khởi động. Lý do: hàm `*Sync` chặn mọi request. Hàm `*Sync` chỉ chấp nhận ở script khởi động (đọc config một lần) hoặc CLI.
- **Cân nhắc `UV_THREADPOOL_SIZE`** nếu app gọi nhiều `fs`/`crypto`/`dns.lookup` đồng thời và thấy chúng xếp hàng. Phải đặt **trước** khi pool được dùng lần đầu (biến môi trường lúc khởi động process), vì pool được tạo một lần. Tăng bừa bãi không giúp nếu CPU đã bão hòa.
- **`dns.lookup` dùng thread pool**, trong khi `dns.resolve*` dùng mạng thẳng. Khi pool bị `fs` nuốt hết, DNS lookup của HTTP client có thể chậm bí ẩn. (Kiến thức từ tài liệu Node, chưa thử.)
- **Dùng `process.getActiveResourcesInfo()`** khi test treo hoặc process không thoát: xem ngay cái gì đang giữ vòng lặp sống thay vì đoán.
- **Đừng nhầm "async" với "song song"**: `await Promise.all` nhiều tác vụ **I/O** chạy chồng nhau vì chúng chờ ngoài thread JS; nhưng nhiều tác vụ **CPU** viết trong `async function` vẫn chạy tuần tự trên một thread. `async` không biến code CPU thành song song.
- **Với người học Laravel**: queue worker/Octane/Swoole mới gần mô hình Node (một process giữ trạng thái, phục vụ nhiều việc). PHP-FPM thuần thì không. Vì vậy các thói quen như "gọi `sleep(1)` cũng không sao" hoặc "tính toán nặng trong controller" an toàn trong FPM nhưng gây hại trong Node.

## Liên hệ bài tập

Các bài dự đoán thứ tự output trong `EXERCISE.md` chỉ làm đúng được khi bạn nắm mô hình này: callback chỉ chạy khi call stack rỗng. Với script đo lag, hãy tự đặt câu hỏi: nếu một đoạn đồng bộ chiếm 200ms thì điều gì xảy ra với timer 10ms đang chờ? Thử vẽ ra trước khi chạy.

## Đọc thêm

- [Node.js: The Node.js Event Loop](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick)
- [Node.js: Don't Block the Event Loop](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)
- [libuv: Design overview](https://docs.libuv.org/en/v1.x/design.html)
- [Node.js: `process.getActiveResourcesInfo()`](https://nodejs.org/api/process.html#processgetactiveresourcesinfo)

## Ghi chú của bạn
