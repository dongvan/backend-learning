# 3. Worker pool, chi phí khởi động và bộ nhớ

Tạo worker **mỗi request** là sai: mỗi worker tốn hàng chục mili giây khởi động và hàng chục MB bộ nhớ. Hãy tạo **một số cố định** worker, giữ sống và **giao việc cho worker rảnh** (worker pool).

```ts
import { Worker, isMainThread, parentPort } from "node:worker_threads";

if (isMainThread) {
  const mem = (): string => `rss=${(process.memoryUsage().rss / 1048576).toFixed(0)}MB`;
  console.log("trước", mem());
  const t = performance.now();
  const ws = Array.from({ length: 8 }, () => new Worker(new URL(import.meta.url)));
  await Promise.all(ws.map((w) => new Promise((r) => w.once("message", r))));
  console.log("8 worker sẵn sàng sau", (performance.now() - t).toFixed(0), "ms,", mem());
  await Promise.all(ws.map((w) => w.terminate()));
} else {
  parentPort?.postMessage("ready");
}
```

Node 24.21, máy 12 core: tạo 8 worker rỗng mất ~140-170ms tổng; một worker tạo riêng mất ~50-60ms. RSS tăng từ ~63-64MB lên ~178-197MB, tức là **mỗi worker rỗng khoảng 15MB**.

## Ý chính

- Chi phí một worker rỗng (Node 24.21 đã đo, máy 12 core): khởi động ~50-60ms và RSS ~+15MB. Worker nạp thêm thư viện thì còn lớn hơn (mỗi worker nạp lại module riêng).
- **Pool:** số worker cố định (thường `<= availableParallelism() - 1` cho việc CPU), một hàng đợi tác vụ, tác vụ giao cho worker rảnh, kết quả trả về qua Promise.
- Pool biến chi phí khởi động thành **chi phí một lần lúc boot**, giới hạn mức dùng CPU/bộ nhớ, và cho bạn chỗ đặt **hàng đợi có chặn** (backpressure).
- Worker **không** tăng tốc việc nhỏ: gửi thông điệp, đánh thức thread, trả kết quả có chi phí cỡ vài trăm micro giây đến mili giây. Việc nhẹ hơn thế nên chạy ở main.
- Tăng tốc thực tế khi việc CPU đủ lớn: 4 tác vụ nặng (~1,4 giây mỗi cái) trên main tuần tự mất ~5,7-6,0 giây; 4 worker song song (gồm khởi động) ~1,7-1,9 giây, tức ~3,2-3,4 lần.
- Thiết kế pool phải xử lý: worker chết/treo, timeout, lỗi trong tác vụ, đóng pool lúc shutdown, và hàng đợi đầy.

## Lý thuyết chi tiết

**Đo lợi ích: main tuần tự vs worker song song.**

```ts
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

function heavy(n: number): number { // việc CPU thuần, không có I/O
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.floor(Math.sqrt(i) * 31) % 7;
  return s;
}

if (isMainThread) {
  const jobs = 4, n = 300_000_000;
  let t = performance.now();
  for (let i = 0; i < jobs; i++) heavy(n);
  console.log("main thread tuần tự", (performance.now() - t).toFixed(0), "ms");
  t = performance.now();
  await Promise.all(Array.from({ length: jobs }, () => new Promise((res, rej) => {
    const w = new Worker(new URL(import.meta.url), { workerData: n });
    w.once("message", res);
    w.once("error", rej);
  })));
  console.log(`${jobs} worker song song (gồm khởi động)`, (performance.now() - t).toFixed(0), "ms");
} else {
  parentPort?.postMessage(heavy(workerData as number));
}
```

Node 24.21, 12 core: `main thread tuần tự ~5,7-6,0 giây`, `4 worker song song ~1,7-1,9 giây`. Tăng tốc ~3,2-3,4x với 4 worker chứ không phải 4x: có chi phí khởi động và tranh chấp tài nguyên. Hai điều quan trọng: (1) trong lúc 4 worker chạy, **main thread rảnh** để phục vụ request khác (điều mà phiên bản chạy trên main không làm được), (2) với tác vụ ~1,4 giây, chi phí 50-60ms khởi động chỉ là vài phần trăm; với tác vụ 5ms thì khởi động là hơn 90% chi phí, và việc tạo worker mỗi request làm hệ thống **chậm hơn** chạy tại chỗ.

**Phân tích chi phí khởi động.** Tạo worker gồm: tạo thread, khởi tạo V8 isolate và context, nạp bootstrap Node cho worker, nạp và biên dịch file của bạn cùng mọi import. Con số ~50-60ms là cho worker rỗng; nếu worker import Zod/ORM/thư viện lớn thì cộng thêm thời gian nạp module và bộ nhớ (Node cache module **theo từng worker**, không chia sẻ giữa các worker). Đây là lý do pool chỉ tạo worker một lần và giữ nó sống.

**Chi phí bộ nhớ.** Mỗi worker có heap V8 riêng (và thường một ít bộ nhớ nền). Con số ~15MB/worker rỗng là RSS tăng thêm quan sát được trên máy này, thay đổi theo phiên bản và hệ điều hành. Bộ nhớ tổng = `main + N × (nền + heap của worker khi chạy)`. Với container có giới hạn RAM, N worker lớn có thể đẩy bạn vào OOM-kill của container (khác với `resourceLimits`, vốn chỉ giới hạn heap JS, không phải RSS tổng).

**Chọn kích thước pool.** Với việc **CPU-bound thuần**, số worker hữu ích tối đa xấp xỉ số core khả dụng; vượt quá chỉ làm các worker tranh nhau core. `os.availableParallelism()` (12 trên máy đo) là số luồng logic khả dụng; vì main thread và thread pool libuv cũng cần CPU, thường chọn `availableParallelism() - 1` hoặc ít hơn, rồi đo. Với việc **hỗn hợp** (worker còn làm I/O), có thể nhiều hơn số core. Đừng quên rằng nếu bạn đã chạy nhiều process Node (cluster/container) trên cùng máy, mỗi process có pool riêng, tổng số thread = số process × kích thước pool.

**Giải phẫu một worker pool** (không cung cấp cài đặt đầy đủ, đây là phần bạn tự làm ở lab). Các thành phần cần có:

1. Danh sách worker, mỗi cái có trạng thái `idle`/`busy`.
2. Hàng đợi tác vụ chờ (FIFO), có giới hạn độ dài.
3. Bảng ánh xạ `taskId -> { resolve, reject }` để ghép kết quả bất đồng bộ với đúng Promise của người gọi.
4. Hàm `run(payload): Promise<Result>`: nếu có worker rảnh thì giao ngay, không thì xếp hàng (hoặc từ chối nếu hàng đầy).
5. Xử lý sự kiện: `message` -> resolve đúng task và đánh dấu worker rảnh, lấy task kế từ hàng đợi; `error`/`exit` bất thường -> reject task đang chạy và **tạo worker thay thế**.
6. `close()`: ngừng nhận việc mới, chờ việc đang chạy, rồi `terminate` các worker (graceful shutdown, nội dung Phase 02 sau).

Giao thức thông điệp nên có kiểu rõ, đưa `id` vào mọi thông điệp để ghép request/response. Ví dụ chỉ riêng phần giao thức và phía worker, bằng discriminated union:

```ts
import { isMainThread, parentPort } from "node:worker_threads";

type Request = { id: number; kind: "count-primes"; limit: number };
type Response =
  | { id: number; ok: true; value: number }
  | { id: number; ok: false; message: string };

function countPrimes(limit: number): number {
  const sieve = new Uint8Array(limit + 1);
  let c = 0;
  for (let i = 2; i <= limit; i++) {
    if (sieve[i] === 0) { c++; for (let j = i * i; j <= limit; j += i) sieve[j] = 1; }
  }
  return c;
}

if (!isMainThread && parentPort !== null) {
  const port = parentPort;
  port.on("message", (req: Request) => {
    try {
      port.postMessage({ id: req.id, ok: true, value: countPrimes(req.limit) } satisfies Response);
    } catch (e) {
      port.postMessage({ id: req.id, ok: false, message: String(e) } satisfies Response);
    }
  });
} else {
  console.log("file này là phía worker; main sẽ tạo worker trỏ vào nó và gửi Request");
}
```

Bắt lỗi trong worker và trả về dạng `{ ok: false }` giúp tránh phải giết worker vì một tác vụ lỗi (lỗi nghiệp vụ được báo qua thông điệp, còn `error` event dành cho lỗi không lường). Gửi thông tin lỗi dưới dạng dữ liệu thuần (chuỗi/mã lỗi) thay vì cả object `Error` nếu muốn chủ động kiểm soát nội dung.

**Cạm bẫy thiết kế pool.**

- *Thông điệp mồ côi:* worker chết khi đang xử lý, Promise của người gọi không bao giờ settle. Luôn gắn timeout cho mỗi tác vụ và reject khi worker `exit`.
- *Tác vụ độc làm treo cả worker:* một vòng lặp vô hạn chiếm worker vĩnh viễn. Dùng `terminate()` khi quá timeout (đã thử: `terminate` dừng được vòng lặp vô hạn, file 1) rồi tạo worker mới thay.
- *Hàng đợi không giới hạn:* tác vụ đến nhanh hơn xử lý thì RAM phình. Đặt trần và trả lỗi (429/503) hoặc đợi có thời hạn.
- *Rò rỉ trạng thái giữa các tác vụ:* vì worker được tái dùng, biến toàn cục trong worker tồn tại giữa các tác vụ. Dùng như bộ nhớ đệm có chủ đích thì tốt, vô tình thì thành lỗi (dữ liệu tác vụ trước ảnh hưởng tác vụ sau).
- *Thread pool libuv chung:* nếu worker dùng `fs`/`crypto` async, chúng vẫn dùng thread pool **của process** (chung với main), nên pool worker không giải quyết nghẽn thread pool libuv (Bài 3).

**Có nên dùng thư viện pool có sẵn?** Có thư viện trưởng thành cho việc này (ví dụ Piscina). Bài này không dùng vì repo không thêm dependency ngoài nhu cầu bài học, và mục tiêu là hiểu cơ chế; trong dự án thật, hãy cân nhắc thư viện thay vì tự viết (kiến thức từ tài liệu, chưa thử ở đây).

## Tricks & tips thực tế

- **Khởi tạo pool lúc boot, "làm nóng" bằng một tác vụ nhỏ.** Lý do: request đầu tiên không phải trả ~50-60ms khởi động và JIT lạnh; p99 ổn định hơn.
- **Đừng dùng worker cho tác vụ dưới vài ms.** Lý do: overhead giao tiếp (clone, đánh thức thread) ngang hoặc lớn hơn việc cần làm; đo thử nhỏ trước (ví dụ gửi 10.000 tác vụ rỗng và đo tổng thời gian) để biết trần thông lượng của pool trên máy bạn.
- **Giữ kích thước pool theo cấu hình (biến môi trường), mặc định bảo thủ.** Lý do: máy dev 12 core, container production có thể bị giới hạn 1-2 CPU; `availableParallelism()` trong container có thể phản ánh cấu hình CPU của cgroup tuỳ phiên bản/nền tảng nên cần kiểm tra ở môi trường đích (từ tài liệu, chưa thử).
- **Đo bộ nhớ theo RSS, không chỉ `heapUsed`.** Lý do: `heapUsed` của main không gồm heap của worker; RSS mới phản ánh thứ container bị giới hạn.
- **Ghi log `threadId` và độ dài hàng đợi, thời gian chờ trong hàng đợi, thời gian chạy.** Lý do: khi chậm, bạn cần phân biệt "chờ vì pool đầy" với "tác vụ chạy lâu"; hai nguyên nhân cần giải pháp khác nhau (tăng pool vs tối ưu tác vụ).
- **Thiết kế shutdown ngay từ đầu.** Lý do: worker còn sống giữ process Node không thoát. Khi nhận `SIGTERM`, đóng nhận việc mới, chờ xong việc, rồi `terminate`. Nếu bạn quên, deploy sẽ bị treo đến khi orchestrator `SIGKILL`.
- **`worker.unref()`** cho phép process thoát dù worker còn sống (không giữ event loop). Hữu ích cho pool tuỳ chọn, nhưng đừng dùng để che lỗi quên đóng pool.
- **So sánh với Laravel Queue/Horizon:** `queue:work` chạy N **process** PHP bền, mỗi cái kéo job từ Redis; việc của bạn là cấu hình số process (Horizon `maxProcesses`). Worker pool Node là bản **trong process** của ý tưởng đó: N worker bền, hàng đợi trong bộ nhớ. Khác biệt then chốt: hàng đợi Redis **bền** qua restart và chia được cho nhiều máy; hàng đợi trong bộ nhớ thì mất khi process chết, nên chỉ dùng cho việc cần kết quả **ngay trong request** và chấp nhận mất khi restart.

## Liên hệ bài tập

Lab yêu cầu tự xây worker pool cho tác vụ CPU-bound và so sánh với main thread. Gợi ý các thí nghiệm cần có trong báo cáo: (1) chi phí khởi động một worker trên máy bạn; (2) thời gian cho K tác vụ với pool kích thước 1, 2, 4, `availableParallelism()`; (3) với tác vụ rất nhẹ, điểm mà pool chậm hơn main thread; (4) trong lúc chạy tác vụ nặng, event loop lag của main (dùng cách đo ở Bài 3). Với đường lỗi: thử ném lỗi trong một tác vụ, và cho worker "chết" giữa chừng, để kiểm tra pool của bạn không để Promise treo mãi.

## Đọc thêm

- [Node.js: Worker threads (ví dụ về pool và `resourceLimits`)](https://nodejs.org/api/worker_threads.html)
- [Node.js: `os.availableParallelism()`](https://nodejs.org/api/os.html#osavailableparallelism)
- [Node.js: Don't Block the Event Loop (Offloading)](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)

## Ghi chú của bạn
