# 1. Worker Threads cơ bản

`worker_threads` cho phép chạy JavaScript trên **thread khác** trong cùng process, mỗi thread có V8 isolate, heap và event loop riêng; giao tiếp bằng truyền thông điệp.

```ts
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

function countPrimes(limit: number): number {
  const sieve = new Uint8Array(limit + 1);
  let c = 0;
  for (let i = 2; i <= limit; i++) {
    if (sieve[i] === 0) { c++; for (let j = i * i; j <= limit; j += i) sieve[j] = 1; }
  }
  return c;
}

if (isMainThread) {
  const w = new Worker(import.meta.filename, { workerData: { limit: 5_000_000 } });
  w.on("message", (m: { count: number }) => console.log("main nhận", m));
  w.on("error", (e) => console.error("lỗi", e));
  w.on("exit", (code) => console.log("exit", code));
} else {
  const { limit } = workerData as { limit: number };
  parentPort?.postMessage({ count: countPrimes(limit) });
}
```

Node 24.21 đã thử, chạy trực tiếp bằng `node file.ts`: in `main nhận { count: 348513 }` rồi `exit 0`. (Sàng Eratosthenes cho 5 triệu số, 348.513 số nguyên tố.)

## Ý chính

- Mỗi Worker là một **thread** với **V8 isolate riêng** (heap riêng, biến toàn cục riêng, event loop riêng). Biến ở main **không** tự thấy ở worker và ngược lại.
- Cùng một file có thể chứa cả hai vai: `isMainThread` phân biệt. Hoặc dùng hai file riêng (rõ hơn khi lớn).
- Giao tiếp: `postMessage` + sự kiện `message`; dữ liệu khởi tạo qua `workerData`. Mọi thứ được **copy** (structured clone), trừ khi chuyển quyền sở hữu (transfer) hoặc chia sẻ (`SharedArrayBuffer`), xem file 2.
- Worker dành cho việc **CPU-bound**. Nó không làm I/O nhanh hơn: I/O đã bất đồng bộ sẵn trên main.
- Lỗi chưa bắt trong worker **không** làm sập process cha; nó trở thành sự kiện `error` ở main và worker thoát với `exit code 1`.
- Chạy `.ts` trực tiếp: Node 24.21 với type stripping, `new Worker(import.meta.filename)` hoặc `new Worker(new URL(import.meta.url))` trỏ vào chính file `.ts` đều chạy được (đã thử). Khi biên dịch sang `.js`, đường dẫn phải trỏ file `.js` đã biên dịch.

## Lý thuyết chi tiết

**Vòng đời.** `new Worker(file, options)` tạo thread, nạp và chạy `file` như một chương trình riêng với `isMainThread === false`. Worker kết thúc khi event loop của **nó** hết việc (không còn listener/timer/handle) hoặc khi gọi `process.exit()` bên trong nó, hoặc `worker.terminate()` từ cha. Sự kiện:

| Sự kiện | Khi nào |
|---|---|
| `online` | worker bắt đầu chạy code JS |
| `message` | worker gọi `parentPort.postMessage` |
| `messageerror` | nhận được thông điệp không giải mã (deserialize) được |
| `error` | exception chưa bắt trong worker |
| `exit` | worker dừng, kèm exit code |

Ở phía worker, `parentPort.on("message", ...)` giữ worker sống (listener là một handle). Nếu chỉ `parentPort.postMessage(...)` một lần rồi hết việc như ví dụ đầu, worker tự thoát. Đó là lý do ví dụ đầu có `exit 0` mà không cần `terminate`.

**Lỗi trong worker.**

```ts
import { Worker, isMainThread, parentPort } from "node:worker_threads";

if (isMainThread) {
  const w = new Worker(new URL(import.meta.url));
  w.on("error", (e) => console.log("error event:", e instanceof Error, (e as Error).message));
  w.on("exit", (c) => console.log("exit code", c));
  w.postMessage("go");
} else {
  parentPort?.once("message", () => {
    setTimeout(() => { throw new Error("boom trong worker"); }, 10);
  });
}
```

Đã thử: `error event: true boom trong worker` rồi `exit code 1`. Cha **không** crash; lỗi đến dưới dạng một `Error` thật (đã được tái tạo ở phía cha, stack trace là của worker). Nếu bạn **không** đăng ký listener `error` ở cha, lỗi trở thành `uncaughtException` ở cha (đây là hành vi của `EventEmitter` với sự kiện `error` không có listener) và làm chết process cha (đã thử trên Node 24.21: stack trace in ra từ `node:internal/event_target`, process thoát trước khi timer 300ms của cha kịp chạy). Vì thế luôn gắn `on("error")` ngay khi tạo worker.

**Giới hạn tài nguyên và OOM.** Mỗi worker có heap riêng; có thể giới hạn bằng `resourceLimits`:

```ts
import { Worker, isMainThread } from "node:worker_threads";

if (isMainThread) {
  const w = new Worker(new URL(import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 32 } });
  w.on("error", (e: NodeJS.ErrnoException) => console.log("error:", e.code, e.message));
  w.on("exit", (c) => console.log("exit", c));
} else {
  const keep: number[][] = [];
  for (;;) keep.push(new Array(1_000_000).fill(1)); // cố tình ăn hết heap
}
```

Đã thử: nhận `error: ERR_WORKER_OUT_OF_MEMORY Worker terminated due to reaching memory limit: JS heap out of memory`, rồi `exit 1`, process cha vẫn sống. Đây là lợi ích cô lập của worker so với chạy cùng main thread (hết heap ở main thì cả process chết).

**`terminate()` và vòng lặp vô hạn.** `worker.terminate()` trả `Promise<exitCode>` và dừng worker kể cả khi nó đang kẹt trong `for (;;);`:

```ts
import { Worker, isMainThread } from "node:worker_threads";

if (isMainThread) {
  const w = new Worker(new URL(import.meta.url));
  w.on("exit", (c) => console.log("worker exit", c));
  setTimeout(() => w.terminate().then((c) => console.log("terminate ->", c)), 100);
} else {
  for (;;); // vòng lặp vô hạn
}
```

Đã thử: `worker exit 1` và `terminate -> 1`. Điều này cho phép đặt **timeout cứng** cho việc dễ treo (regex nguy hiểm, vòng lặp từ input người dùng) mà một hàm gọi trực tiếp ở main thread không làm được. Exit code 1 do bị terminate (không phải 0).

**`workerData` vs `postMessage`.** `workerData` là bản sao dữ liệu khởi tạo, có sẵn ngay khi worker bắt đầu (qua `import { workerData } from "node:worker_threads"`); dùng cho cấu hình, tham số cố định. `postMessage` cho dòng thông điệp tiếp theo. Cả hai đều dùng structured clone.

**Worker khác gì "thread" trong Java/PHP pthreads?** Worker JS **không chia sẻ heap**: không có `mutex` cho object JS thông thường, không có data race trên object JS. Chỉ `SharedArrayBuffer` (vùng bộ nhớ thô) là chia sẻ, và bạn tự đồng bộ bằng `Atomics`. Đây là mô hình "chia sẻ không gì cả" (share-nothing) mặc định, an toàn hơn nhưng đắt hơn vì phải copy.

**Worker có "nhìn thấy" gì từ main?** Cùng process nên chung `process.env` mặc định (worker nhận bản sao của `process.env` lúc tạo, trừ khi cấu hình `env: SHARE_ENV`), chung file descriptor và thread pool libuv của process (file/dns trong worker dùng thread pool **chung** với main, xem Bài 3). Module được nạp lại trong mỗi worker (cache module riêng), nên cùng một thư viện nặng bị nạp N lần nếu có N worker: tốn RAM và thời gian khởi động.

## Tricks & tips thực tế

- **Luôn đăng ký `error` và `exit` ngay sau `new Worker`.** Lý do: không có `error` listener thì lỗi trong worker leo thang thành lỗi ở cha; không có `exit` listener thì bạn không biết worker chết lặng lẽ khi một promise treo mãi.
- **Một Promise bao quanh Worker chỉ-một-lần là đủ cho script, nhưng không cho server.** Lý do: tạo worker mỗi lần tốn ~50-60ms (file 3); ở server cần tái dùng (pool).
- **Dùng `workerData` cho cấu hình bất biến, `postMessage` cho việc.** Lý do: dễ lý giải luồng dữ liệu; worker không phải chờ thông điệp đầu tiên mới biết mình là gì.
- **Tách file worker riêng khi code dài** (ví dụ `hash.worker.ts`) và `new Worker(new URL("./hash.worker.ts", import.meta.url))`. Lý do: tránh các nhánh `isMainThread` lẫn lộn, và bundler/tsc xử lý đường dẫn rõ ràng hơn. Khi build ra `dist/`, nhớ phần mở rộng thực tế (`.js`), một lỗi hay gặp là deploy xong Worker trỏ vào `.ts` không tồn tại.
- **Đặt `resourceLimits` cho worker xử lý input không tin cậy.** Lý do: một payload độc hại làm worker ngốn bộ nhớ chỉ giết worker đó (như thí nghiệm OOM ở trên), không giết cả API. Số nên chọn dựa trên đo kích thước thật.
- **Đừng `console.log` dày đặc trong worker khi benchmark.** Output của worker được chuyển qua main thread bằng thông điệp, nên có thể làm lệch số đo (cơ chế từ tài liệu, chưa đo trực tiếp).
- **Debug:** thêm `name` (option `name`) hoặc in `threadId` (`import { threadId } from "node:worker_threads"`) vào log để biết thông điệp từ worker nào; trong `--inspect`, Chrome DevTools liệt kê từng worker như một target riêng.
- **PHP quen `pcntl_fork`/`pthreads`?** Hãy coi Worker như "process nhẹ chia sẻ chung vài thứ", không phải thread chia sẻ heap. Đừng cố truyền object có method/closure sang worker, nó sẽ bị biến thành dữ liệu thuần (file 2).

## Liên hệ bài tập

Lab Bài 4 yêu cầu so sánh tác vụ CPU-bound trên main thread với worker. Bước đầu: chạy **một** worker cho một tác vụ (ví dụ hash/fibonacci), bắt `message`, `error`, `exit`; cố tình làm worker ném lỗi để thấy cha không chết. Trước khi xây pool (file 3), đo thời gian "tạo một worker và nhận kết quả" cho tác vụ rất nhẹ để biết chi phí khởi động là bao nhiêu mili giây trên máy của bạn.

## Đọc thêm

- [Node.js: Worker threads](https://nodejs.org/api/worker_threads.html)
- [Node.js: `new Worker(filename, options)`](https://nodejs.org/api/worker_threads.html#new-workerfilename-options)
- [Node.js: Running TypeScript natively](https://nodejs.org/api/typescript.html)

## Ghi chú của bạn
