# 3. I/O-bound vs CPU-bound, concurrency vs parallelism

Một tác vụ là **I/O-bound** khi phần lớn thời gian nó **chờ** thứ bên ngoài (DB, mạng, đĩa); là **CPU-bound** khi phần lớn thời gian nó **tính toán** trên chính thread đang chạy. Node mạnh ở loại đầu và yếu (nếu chạy trên main thread) ở loại sau.

```ts
function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
  return true;
}

const t = performance.now();
const timer = setTimeout(() => console.log("timer trễ:", (performance.now() - t).toFixed(0), "ms"), 10);
let count = 0;
for (let n = 0; n < 3_000_000; n++) if (isPrime(n)) count++; // CPU-bound, đồng bộ
console.log("tìm xong", count, "số nguyên tố sau", (performance.now() - t).toFixed(0), "ms");
void timer;
```

Timer hẹn 10ms nhưng chỉ chạy **sau khi** vòng `for` kết thúc: callback không thể ngắt code đồng bộ.

## Ý chính

- **I/O-bound:** thread JS gần như không tốn CPU; thời gian chờ nằm ở bên ngoài. Node phục vụ rất nhiều tác vụ loại này đồng thời chỉ với một thread (đó là concurrency).
- **CPU-bound:** thread JS bận tính toán. Trong lúc đó **không có callback, timer, request nào khác được xử lý** trên thread đó.
- **Concurrency (đồng thời):** nhiều tác vụ **cùng tiến triển** trong một khoảng thời gian (có thể xen kẽ trên một thread). **Parallelism (song song):** nhiều tác vụ **thực sự chạy cùng một khoảnh khắc** trên nhiều core.
- `async/await` cho bạn **concurrency**, không cho parallelism CPU. Bọc hàm nặng trong `async function` hay `Promise` **không** làm nó chạy nền.
- Một tác vụ thật thường là **hỗn hợp**: ví dụ endpoint upload ảnh (đọc mạng = I/O, giải mã/resize = CPU, ghi S3 = I/O). Phải tách phần CPU ra mới tối ưu được.

## Lý thuyết chi tiết

**Hai trục khác nhau.** Hay bị nhầm "async = song song". Hai trục độc lập:

| | Một thread | Nhiều thread/process |
|---|---|---|
| Chờ I/O hiệu quả | Node async I/O (concurrency) | thread-per-request, PHP-FPM |
| Tính toán nhanh hơn | không thể | Worker Threads, child process, cluster (parallelism) |

Async I/O giải quyết bài toán "đừng đứng chờ"; nó không làm phép tính chạy nhanh hơn. Muốn tính nhanh hơn bằng cách dùng nhiều core, bạn **phải** có nhiều thread hoặc process thật (Bài 4).

**`async` không đẩy việc ra nền.** Ví dụ phổ biến, sai:

```ts
async function sumUpTo(n: number): Promise<number> {
  let s = 0;
  for (let i = 0; i < n; i++) s += i;
  return s; // vẫn chạy đồng bộ trên main thread
}

const t = performance.now();
const p = sumUpTo(1_000_000_000); // vòng lặp chạy NGAY, trước khi hàm trả promise
console.log("hàm đã trả promise sau", (performance.now() - t).toFixed(0), "ms");
console.log(await p);
```

Phần thân hàm `async` chạy đồng bộ cho tới `await` đầu tiên (ở đây không có). Dòng log đầu tiên in ra sau khi vòng lặp đã xong, vì lời gọi `sumUpTo(...)` không trả về cho tới lúc đó. `Promise.resolve().then(heavy)` cũng vậy: nó chỉ **dời** `heavy` sang microtask, rồi vẫn chặn thread khi chạy.

**Phân loại bằng cách đo, không bằng cảm giác.** Một tác vụ có thể đo bằng hai số: thời gian thực (wall time) và thời gian CPU của process.

- wall >> CPU: phần lớn là chờ (I/O-bound).
- wall ≈ CPU: phần lớn là tính toán (CPU-bound).

Với vòng lặp tìm số nguyên tố ở đầu file (3 triệu số), Node 24.21 đo được wall ~750-820ms và CPU user ~690ms, system vài ms; với 12 triệu số thì wall ~5510ms, user ~5090ms. Wall xấp xỉ CPU, tức CPU-bound, và event loop lag đo được gần bằng toàn bộ thời gian chạy (timer 10ms ở ví dụ đầu file trễ ~820ms). Cách đo xem file 04.

**Cảm nhận độ lớn.** Ngưỡng "nặng" tuỳ yêu cầu độ trễ, nhưng một quy tắc thực dụng: bất kỳ đoạn đồng bộ nào quá vài chục ms trong server phục vụ nhiều request đáng bị nghi ngờ; vài trăm ms đã thấy rõ bằng p99 latency. Dấu hiệu CPU-bound hay gặp trong backend:

- Băm/mã hoá (`pbkdf2Sync`, `bcrypt` thuần JS, `crypto.createHash` trên dữ liệu lớn).
- `JSON.parse`/`JSON.stringify` trên payload hàng chục MB.
- Regex dính **backtracking thảm hoạ** (ReDoS) với input người dùng.
- Nén/giải nén, xử lý ảnh, parse CSV/XML lớn, sắp xếp mảng hàng triệu phần tử.
- Vòng lặp lồng nhau trên dữ liệu lớn (O(n^2)) trong chính handler.

**Dấu hiệu I/O-bound hay gặp:** truy vấn DB, gọi HTTP tới dịch vụ khác, đọc/ghi file lớn, Redis, gửi mail. Ở đây thời gian nằm ở mạng/đĩa; Node làm tốt chỉ cần quản lý số kết nối đồng thời.

**Concurrency trong Node, nhìn cụ thể.** Ví dụ mô phỏng 100 lời gọi I/O, mỗi cái chờ 100ms (thay cho gọi DB/API):

```ts
import { setTimeout as sleep } from "node:timers/promises";

async function fakeApiCall(id: number): Promise<number> {
  await sleep(100); // thay cho gọi mạng
  return id;
}

let t = performance.now();
for (let i = 0; i < 20; i++) await fakeApiCall(i); // tuần tự
console.log("20 lời gọi tuần tự:", (performance.now() - t).toFixed(0), "ms");

t = performance.now();
await Promise.all(Array.from({ length: 20 }, (_, i) => fakeApiCall(i))); // đồng thời
console.log("20 lời gọi đồng thời:", (performance.now() - t).toFixed(0), "ms");
```

Tuần tự ~2000ms, đồng thời ~100ms: cùng một thread, nhưng 20 lời chờ **chồng lên nhau**. Đây là sức mạnh của Node với I/O. Còn nếu mỗi `fakeApiCall` thay vì `sleep(100)` là một vòng lặp CPU 100ms, `Promise.all` vẫn mất ~2000ms vì CPU không thể "chồng" trên một thread.

**So với PHP.** PHP-FPM cho concurrency bằng nhiều process: 20 request đồng thời cần 20 worker, mỗi worker đứng chờ I/O. Điều đó tốn RAM nhưng "tự động an toàn" với CPU-bound: việc nặng ở request A không chặn request B. Node đổi lại: ít RAM hơn rất nhiều cho I/O, nhưng **bạn** phải đảm bảo không có việc CPU dài trên main thread. Trong Laravel, việc nặng thường đẩy sang queue worker; ở Node tương đương là Worker Threads, process riêng, hoặc queue (file 05 và Bài 4).

## Tricks & tips thực tế

- **Tự hỏi mỗi khi thêm code vào handler: "nó chờ hay nó tính?"** Lý do: chờ thì `await` là đủ; tính thì cần nghĩ tới việc nó sẽ chặn mọi request khác trong cùng process.
- **Phân biệt I/O-bound thật với "chờ bị giới hạn":** một API chậm 2 giây vì DB thiếu index là I/O-bound từ góc nhìn Node, nhưng sửa ở DB chứ không ở Node. Đừng thêm worker để giải quyết truy vấn chậm.
- **Cẩn thận `JSON.parse`/`JSON.stringify` và regex trên input không tin cậy.** Lý do: chúng đồng bộ, và kích thước/độ phức tạp do người dùng quyết định. Đặt giới hạn kích thước body, kiểm tra kích thước trước khi parse, và tránh regex lồng nhau kiểu `(a+)+`.
- **Đừng "cứu" hàm CPU-bound bằng `setImmediate`/`setTimeout(0)` ở mỗi vòng lặp một cách bừa bãi.** Chia nhỏ công việc (chunking) để nhường vòng lặp có thể dùng được cho việc nhẹ-vừa, nhưng làm tổng thời gian dài hơn, code phức tạp hơn, và vẫn dùng đúng một core. Dùng khi việc không đáng đưa sang worker; còn lại ưu tiên worker.
- **Với `Promise.all` trên danh sách lớn, concurrency vô hạn là một lỗi thiết kế** (file 04): lý do là quá tải tài nguyên phía sau (DB, API, fd).
- **Đo bằng dữ liệu giống production.** Một hàm nhanh với 100 phần tử có thể O(n^2) và nặng với 100.000. CPU-bound hay lộ ra khi dữ liệu lớn dần, không phải lúc dev.
- **Khi nghi ngờ CPU-bound, dùng profiler trước khi sửa.** `node --cpu-prof app.ts` (hoặc `--inspect` + Chrome DevTools) cho biết hàm nào chiếm thời gian; đoán sai điểm nóng là lỗi tối ưu phổ biến nhất. (Profiling sâu thuộc chủ đề cuối Phase 02.)

## Liên hệ bài tập

Lab chặn event loop: hãy tạo cả hai loại tác vụ (một vòng lặp CPU và một `await sleep`) rồi xếp 20 cái bằng `for...await` và `Promise.all`; so sánh bảng kết quả để thấy `Promise.all` chỉ giúp một trong hai loại. Dùng `process.cpuUsage()` để chứng minh bằng số liệu rằng loại nào là CPU-bound (wall ≈ CPU) và loại nào là I/O-bound (wall >> CPU), thay vì tin cảm giác.

## Đọc thêm

- [Node.js: Don't Block the Event Loop](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)
- [Node.js: `process.cpuUsage()`](https://nodejs.org/api/process.html#processcpuusagepreviousvalue)
- [Node.js: Overview of Blocking vs Non-Blocking](https://nodejs.org/en/learn/asynchronous-work/overview-of-blocking-vs-non-blocking)

## Ghi chú của bạn
