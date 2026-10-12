# 5. Chọn giải pháp cho tác vụ nặng: worker, process riêng, hay queue

Khi đã xác định một tác vụ là CPU-bound (hoặc quá lâu), câu hỏi là **chạy nó ở đâu**: cùng process nhưng thread khác (Worker Thread), process con (child process), hay hệ thống khác hẳn (queue + worker service). Mỗi lựa chọn cân bằng độ trễ, cô lập, độ bền và độ phức tạp.

```ts
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

type Job = { status: "pending" | "done"; result?: number };
const jobs = new Map<string, Job>();

// "Nơi khác" làm việc nặng (ở đây giả lập bằng sleep; thực tế là worker/queue/service riêng)
async function runElsewhere(id: string): Promise<void> {
  await sleep(200);
  jobs.set(id, { status: "done", result: 42 });
}

createServer((req, res) => {
  if (req.method === "POST" && req.url === "/reports") {
    const id = crypto.randomUUID();
    jobs.set(id, { status: "pending" });
    void runElsewhere(id); // không await: trả lời ngay
    res.writeHead(202, { "content-type": "application/json", location: `/reports/${id}` });
    res.end(JSON.stringify({ id }));
  } else if (req.method === "GET" && req.url?.startsWith("/reports/")) {
    const job = jobs.get(req.url.slice("/reports/".length));
    res.writeHead(job ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify(job ?? { error: "not found" }));
  } else {
    res.writeHead(404).end();
  }
}).listen(0, () => {
  console.log("POST /reports -> 202 + id; GET /reports/:id -> trạng thái");
  setTimeout(() => process.exit(0), 100); // chỉ để ví dụ tự thoát khi chạy thử
});
```

Đây là **hình dạng API** (202 Accepted + resource để hỏi trạng thái), không phải cách thực thi việc nặng; phần `runElsewhere` mới là chỗ chọn công cụ.

## Ý chính

- **Cần kết quả ngay trong request, việc ngắn (vài chục đến vài trăm ms)?** Worker Threads (thường qua worker pool). Cùng process, chia sẻ bộ nhớ có kiểm soát, khởi động rẻ hơn process.
- **Cần cô lập mạnh, chạy chương trình khác (ffmpeg, git, Python), hoặc cần chạy được cả khi crash?** Child process.
- **Việc dài (giây đến phút), cần retry, lập lịch, chịu được restart, hoặc kết quả không cần ngay?** Queue (Redis/RabbitMQ/DB-backed) + worker process riêng, và trả 202 cho client. Giống queue worker + Horizon của Laravel.
- **Muốn dùng nhiều core cho phục vụ request (I/O-bound thông thường)?** Chạy nhiều process Node (cluster/PM2/container), không phải worker: mỗi process có event loop riêng.
- **Trước khi thêm cơ sở hạ tầng:** thử rẻ hơn trước: thuật toán tốt hơn, đẩy việc xuống DB, cache, stream thay vì nạp hết vào bộ nhớ, hoặc thư viện native/async đã tối ưu.

## Lý thuyết chi tiết

**Ma trận chọn.** Các tiêu chí thật sự quyết định:

| Tiêu chí | Chunk nhường loop | Worker Thread | Child process | Queue + worker service |
|---|---|---|---|---|
| Độ trễ khởi động | ~0 | ~50-60ms/worker (Node 24.21, đo ở Bài 4), ~0 nếu dùng lại (pool) | ~45ms cho `node -e 0` (Bài 4), nặng hơn khi app lớn | phụ thuộc hạ tầng |
| Chia sẻ bộ nhớ | có | `SharedArrayBuffer`, hoặc copy | không (chỉ IPC/stdio) | không |
| Cô lập lỗi | không (crash = cả process) | crash worker không giết main (đã thử: lỗi trong worker thành sự kiện `error` ở main), nhưng OOM/native crash nặng có thể ảnh hưởng | cao (process riêng, có thể bị kill độc lập) | cao nhất |
| Dùng thêm core | không | có | có | có (nhiều worker, nhiều máy) |
| Độ bền khi restart | không | không | không | có (job nằm trong broker/DB) |
| Retry, lịch, ưu tiên | tự viết | tự viết | tự viết | thường có sẵn |
| Độ phức tạp vận hành | thấp | thấp-vừa | vừa | cao nhất |

**Chunking (nhường loop)** thật ra không đạt parallelism: chia vòng lặp thành các lát nhỏ rồi `await setImmediate` giữa các lát. Nó giữ server phản hồi được (lag thấp) nhưng tổng thời gian không giảm và vẫn chỉ dùng một core. Hữu ích cho việc vừa phải, không đáng dựng worker.

**Worker Threads** hợp với: băm, nén, parse dữ liệu lớn, tính toán số học, xử lý ảnh bằng JS/WASM, nơi đầu vào/đầu ra là dữ liệu gọn và việc kéo dài vài chục ms đến vài giây. Chi tiết và cạm bẫy ở Bài 4.

**Child process** hợp với: gọi công cụ bên ngoài (ffmpeg, imagemagick, `git`, chương trình Python), cô lập code không tin cậy hoặc dễ crash, hoặc dùng cho CLI. Chi phí cao hơn worker nhưng cách ly ở mức hệ điều hành (có thể giới hạn tài nguyên, kill bằng tín hiệu).

**Queue + worker service** là lựa chọn khi **kết quả không cần trong chính request** hoặc việc có thể kéo dài. Ví dụ: xuất báo cáo, gửi mail hàng loạt, tạo thumbnail, gọi API chậm có retry. Đặc tính cốt lõi là **bền**: job ở trong broker (Redis, RabbitMQ, bảng DB), process worker chết thì job được giao lại. Trong hệ sinh thái Node, thư viện như BullMQ (Redis) đóng vai trò gần với Laravel Queue + Horizon (kiến thức từ tài liệu, không dùng ở bài này vì repo không thêm dependency). Mẫu API tương ứng: `POST` trả `202 Accepted` kèm `Location`/id, client poll hoặc nhận webhook/websocket.

**Mô hình quyết định theo câu hỏi.**

1. Việc này có thể **không phải làm** không? (cache, tính trước, đẩy xuống DB, giới hạn input).
2. Client có phải **chờ kết quả**? Nếu không, ưu tiên queue (bền, retry).
3. Nếu phải chờ: việc dưới ~vài giây và là code JS/WASM? Worker pool. Là chương trình ngoài? Child process.
4. Có thể nhận quá nhiều việc cùng lúc? Cần **giới hạn** (hàng đợi có chặn, từ chối 429/503) bất kể chọn gì.

**Chống nhầm lẫn "dùng worker để scale I/O".** Một server HTTP phục vụ I/O-bound **không** cần worker threads; nó cần nhiều process nếu muốn dùng nhiều core. Worker threads chỉ để dời **tính toán** khỏi event loop. Đặt worker cho mỗi request I/O chỉ thêm chi phí.

**So với Laravel.** Laravel mặc định đã "đưa việc nặng ra process khác" (queue worker chạy bằng `artisan queue:work`, Horizon giám sát), và request HTTP thì bị cô lập bởi PHP-FPM. Ở Node, hai thứ đó **không tự có**: bạn phải chủ động tách. Điều tốt là Node cho thêm tầng trung gian (Worker Threads) mà PHP-FPM không có cho request: một việc CPU ngắn trong request có thể xử lý ngay mà không cần broker.

## Tricks & tips thực tế

- **Mặc định trả `202` cho việc kéo dài hơn vài giây.** Lý do: giữ kết nối HTTP mở lâu dễ bị timeout của load balancer/proxy (thường 30-60 giây, tuỳ cấu hình) và chiếm tài nguyên; trạng thái `pending/done` cho client chủ động.
- **Đặt giới hạn trên hàng đợi và có chính sách khi đầy** (429/503 kèm `Retry-After`). Lý do: hàng đợi không giới hạn chỉ đẩy sự cố từ CPU sang RAM; hệ thống sập muộn hơn nhưng mạnh hơn.
- **Làm job idempotent khi dùng queue.** Lý do: broker thường đảm bảo "ít nhất một lần", job có thể chạy lại sau crash; gửi mail hai lần hay trừ tiền hai lần là lỗi nghiệp vụ.
- **Đo trước khi chọn hạ tầng nặng.** Một worker pool đủ cho nhiều trường hợp mà không cần Redis. Ngược lại, nếu việc phải sống sót qua deploy/restart, in-memory (Map, worker pool) là không đủ, đừng cố.
- **Truyền tham chiếu, không truyền dữ liệu lớn qua queue.** Lý do: job lưu trong broker; hãy đưa ID/đường dẫn (S3, DB) thay vì payload hàng MB, để broker nhẹ và dễ retry.
- **Tách "process web" và "process worker" khi deploy**, giống `php-fpm` và `artisan queue:work` chạy riêng. Lý do: scale độc lập (nhiều worker, ít web), deploy/restart không cắt request, và lỗi OOM của worker không hạ web.
- **Debug "chọn sai công cụ":** nếu event loop lag của web vẫn cao sau khi thêm worker, kiểm tra xem việc nặng có thật sự chạy ngoài main thread không (ví dụ thread chính vẫn serialize/parse payload lớn trước khi gửi). Thời gian clone dữ liệu lớn cũng nằm trên thread gửi (Bài 4).

## Liên hệ bài tập

Lab Bài 3 chỉ yêu cầu đo và so sánh; hãy dùng bài này như checklist cho phần kết luận: với từng khối lượng bạn đo (chặn đồng bộ vs `Promise.all`), viết một đoạn ngắn: "nếu tác vụ này xuất hiện trong endpoint production, tôi chọn cách nào trong bốn cách và vì sao" theo các tiêu chí ở bảng. Bài 4 sẽ để bạn tự tay làm hai lựa chọn đầu (worker, child process); bài này giúp bạn biết khi nào lựa chọn thứ ba (queue) mới đáng.

## Đọc thêm

- [Node.js: Don't Block the Event Loop (phần Partitioning vs Offloading)](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)
- [Node.js: Worker threads](https://nodejs.org/api/worker_threads.html)
- [Node.js: Child process](https://nodejs.org/api/child_process.html)
- [MDN: HTTP 202 Accepted](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/202)

## Ghi chú của bạn
