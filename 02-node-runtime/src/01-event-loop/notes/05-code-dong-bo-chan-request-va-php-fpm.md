# 5. Code đồng bộ nặng chặn mọi request, và so sánh với PHP-FPM

Trong Node, một request chạy code đồng bộ lâu làm **tất cả** request khác đứng chờ, vì chỉ có một thread JS; trong PHP-FPM, request chậm chỉ chiếm một worker.

```ts
import { createServer } from "node:http";

createServer((req, res) => {
  if (req.url === "/report") {
    const end = Date.now() + 700;
    while (Date.now() < end); // giả lập tính toán CPU đồng bộ
    res.end("report");
  } else {
    res.end("ok"); // nhanh, nhưng phải chờ nếu /report đang chạy
  }
}).listen(3000);
```

## Ý chính

- "Chặn" nghĩa là thread JS đang bận làm một việc mà không trả quyền cho event loop. Có hai nguồn: **CPU-bound** (tính toán, parse, regex) và **API đồng bộ** (`*Sync`).
- Thí nghiệm thật (Node 24.21): server chạy `pbkdf2Sync` ~750ms thì `/health` gửi sau 100ms phải chờ **653ms**; với `pbkdf2` bất đồng bộ (thread pool) `/health` trả lời trong **2ms**.
- Chờ I/O (DB, HTTP gọi ngoài, đọc file bất đồng bộ) **không** chặn; tính toán CPU **có** chặn.
- Cách xử lý đúng: đẩy CPU nặng sang **Worker Threads** hoặc process khác/dịch vụ riêng; cắt việc thành lô nhỏ chỉ là biện pháp tạm.
- Một process Node dùng **một lõi CPU** cho JS. Muốn dùng nhiều lõi thì chạy nhiều process (cluster, PM2, container) hoặc Worker Threads.
- So với PHP-FPM: scale bằng **số worker process**; mỗi worker một request, chờ DB chặn worker đó nhưng không chặn worker khác.

## Lý thuyết chi tiết

**Điều gì xảy ra trong khi chặn.** Gói tin của các kết nối khác vẫn đến và nằm trong bộ đệm của hệ điều hành; Node chưa đọc chúng vì chưa tới phase poll. Timer không bắn đúng hạn. Kết quả ở phía client: latency tăng vọt ở **mọi** endpoint, kể cả `/health`; load balancer có thể coi instance là chết và rút ra (health check timeout), gây phản ứng dây chuyền sang các instance còn lại.

**Phép đo.** Server ở process riêng; client (process khác) gửi request nặng rồi 100ms sau gửi `/health`:

| Handler | Request nặng | `/health` |
|---|---|---|
| `pbkdf2Sync(…, 1_000_000, …)` | 761 ms | 653 ms |
| `pbkdf2(…, 1_000_000, …, cb)` | 739 ms | 2 ms |
| Không có request nặng | | 6 ms |

Con số `/health` 653ms ≈ thời gian còn lại của request nặng (≈ 750 − 100). Với bản bất đồng bộ, **thread JS rảnh**; công việc băm chạy ở thread của libuv. Nhưng nhớ thread pool chỉ có 4 thread (file 01): 5 request băm đồng thời thì request thứ 5 xếp hàng trong pool dù event loop vẫn rảnh.

**Phân biệt hai loại chặn.**

| | Chặn thread JS | Chiếm thread pool |
|---|---|---|
| Ví dụ | `pbkdf2Sync`, `JSON.parse` 50MB, regex thảm họa | `pbkdf2` async, `fs.readFile`, `zlib` async |
| Hậu quả | Mọi request đứng | Chỉ các tác vụ dùng pool xếp hàng |
| Cách xử lý | Worker Threads, chia việc | Tăng `UV_THREADPOOL_SIZE`, hạn chế đồng thời |

Điều này gắn với phần "CPU-bound vs I/O-bound" của phase: async của Node **giải quyết I/O**, không giải quyết CPU; chỉ khi CPU được chuyển sang thread khác (pool nội bộ của Node cho một số hàm, hoặc Worker của bạn) thì mới "song song".

**Mô hình PHP-FPM.** Mỗi request được một worker process xử lý từ đầu đến cuối, rồi bộ nhớ được dọn (shared-nothing). Một request tính toán 700ms chỉ chiếm một worker; nếu còn worker rảnh, `/health` vẫn được phục vụ. Giới hạn của FPM là **số worker** (`pm.max_children`): nếu mọi worker bận chờ DB chậm thì request mới xếp hàng. Chi phí là mỗi worker tốn RAM (hàng chục MB), nên ít worker hơn kết nối.

| | PHP-FPM | Node.js |
|---|---|---|
| Đơn vị xử lý | 1 request = 1 worker process | 1 process = hàng nghìn request đan xen |
| Chờ DB | Chặn worker (bình thường) | Đăng ký callback, thread JS làm việc khác |
| CPU nặng | Chỉ chậm request đó (chiếm 1 worker) | **Chặn tất cả request** của process |
| Trạng thái giữa request | Không có (mất hết) | Có (biến module, cache, kết nối DB sống lâu) |
| Lỗi chưa bắt | Giết request đó | Có thể sập cả process (xem Bài 2) |
| Scale | Thêm worker/máy | Thêm process/máy + Worker Threads cho CPU |

Hệ quả thực tế: biến module-level trong Node **dùng chung giữa mọi request** (dễ rò dữ liệu người dùng này sang người dùng khác nếu lưu trạng thái request vào biến global), trong khi PHP không có vấn đề này vì mỗi request khởi tạo lại. Còn lợi ích: giữ connection pool, cache trong RAM, không bootstrap framework mỗi request (Laravel bootstrap mỗi request ở FPM là chi phí đáng kể; Octane tồn tại để loại nó).

## Tricks & tips thực tế

- **Quy tắc kinh nghiệm: handler nào đồng bộ quá ~10-50ms đáng bị nghi ngờ.** Lý do: ở 1000 req/s, mỗi ms chặn đồng bộ là 1ms thời gian chết của **mọi** request cùng lúc. Đo bằng lag p99 (file 04) thay vì đoán.
- **Cẩn thận payload lớn**: `JSON.parse`/`JSON.stringify` đồng bộ trên vài chục MB có thể chặn hàng trăm ms. Giới hạn kích thước body (ví dụ qua `Content-Length` hoặc cấu hình framework), dùng stream parser cho dữ liệu lớn.
- **Cẩn thận regex do người dùng điều khiển** (ReDoS): một regex backtracking thảm họa chặn cả process bằng một request. Giới hạn độ dài input, dùng regex đơn giản, hoặc thư viện an toàn (như RE2). Lý do: V8 không có timeout cho regex.
- **Băm mật khẩu dùng bản bất đồng bộ** (`crypto.scrypt`, `pbkdf2` callback/promisified) thay vì `*Sync`. Lý do: đã đo ở trên, bản `*Sync` làm đứng `/health`.
- **Đừng tăng `UV_THREADPOOL_SIZE` để "chữa" CPU-bound**: nó chỉ có ích khi có lõi CPU rảnh; quá số lõi thì chỉ tăng chuyển ngữ cảnh.
- **Health check phải nhẹ và trả lời được khi tải cao**; nhưng đừng "chữa" bằng cách tách port: nếu cùng process, thread JS bận thì health check cũng không chạy. Hãy chữa nguyên nhân (đẩy CPU đi chỗ khác).
- **Chạy nhiều process để dùng nhiều lõi** trước khi nghĩ đến Worker Threads: container/PM2 mỗi lõi một process là cách đơn giản và cô lập lỗi. Worker Threads dùng khi **một request** cần nhiều CPU và bạn không muốn chặn các request khác.
- **Khi chuyển từ Laravel**: đừng đặt tác vụ nặng (xuất báo cáo, resize ảnh) trong request handler như thói quen controller. Mô hình quen thuộc là queue job (Laravel Horizon) tương đương BullMQ + worker process riêng trong Node.
- **Tự kiểm chứng tác động**: dùng script ở đầu file, gọi `/report` và `/ok` đồng thời bằng `curl` ở hai terminal, rồi thay vòng `while` bằng `await sleep(700)` (async) để thấy `/ok` hết bị chặn. Đây cũng là cách thấy rõ "chờ" khác "tính toán".

## Liên hệ bài tập

Script đo lag của Bài này chính là công cụ để **chứng minh** điều file này nói: hãy tạo một đoạn chặn có độ dài biết trước và kiểm tra lag đo được. Câu hỏi tự đặt ra: nếu thay đoạn chặn bằng `await sleep(...)` thì lag đổi thế nào, và vì sao? Phần so sánh PHP-FPM là phần bạn nên tự giải thích lại bằng lời của mình ở cuối bài.

## Đọc thêm

- [Node.js: Don't Block the Event Loop (or the Worker Pool)](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)
- [Node.js: Worker Threads](https://nodejs.org/api/worker_threads.html)
- [Node.js: `crypto.pbkdf2`](https://nodejs.org/api/crypto.html#cryptopbkdf2password-salt-iterations-keylen-digest-callback)
- [libuv: Thread pool work scheduling](https://docs.libuv.org/en/v1.x/threadpool.html)

## Ghi chú của bạn
