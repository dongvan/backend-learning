# 4. Giới hạn concurrency và đo lường (event loop lag, CPU time)

`Promise.all` trên 10.000 phần tử bắn 10.000 yêu cầu cùng lúc; hãy **giới hạn số tác vụ đang chạy**, và **đo** thread JS bị chặn bao lâu bằng event loop lag, CPU time, event loop utilization.

```ts
import { setTimeout as sleep } from "node:timers/promises";

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++; // an toàn: JS đơn luồng, không có chen ngang giữa đọc và tăng
      results[i] = await fn(items[i] as T, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

let inFlight = 0, peak = 0;
const ids = Array.from({ length: 30 }, (_, i) => i);
const t = performance.now();
const out = await mapLimit(ids, 5, async (id) => {
  peak = Math.max(peak, ++inFlight);
  await sleep(50);
  inFlight--;
  return id * 2;
});
console.log("kết quả giữ đúng thứ tự:", out.slice(0, 5), "| đồng thời tối đa:", peak, "|", (performance.now() - t).toFixed(0), "ms");
```

Node 24.21: `đồng thời tối đa: 5`, ~317ms (30 tác vụ × 50ms / 5 = 300ms cộng chi phí).

## Ý chính

- Concurrency vô hạn là lỗi thiết kế: nó chuyển áp lực sang thứ phía sau (kết nối DB, API đối tác, file descriptor, thread pool, bộ nhớ chứa tất cả promise và kết quả).
- Mẫu giới hạn đơn giản: N "worker" bất đồng bộ cùng lấy việc từ một con trỏ chung. Không cần thư viện.
- Event loop lag = thời gian một callback phải chờ **sau** thời điểm lẽ ra nó chạy. Đây là chỉ số **sức khoẻ** số một của server Node.
- Ba thước đo hay đi cùng nhau: **event loop delay** (có bị chặn không), **CPU time** (`process.cpuUsage`: bận tính toán hay chỉ chờ), **event loop utilization** (tỉ lệ thời gian loop thực sự làm việc).
- Đo bằng `performance.now()` (đơn điệu, chính xác cao), không dùng `Date.now()` để đo khoảng thời gian.

## Lý thuyết chi tiết

**Vì sao cần giới hạn?** Hãy tưởng tượng crawl 5.000 URL bằng `Promise.all(urls.map(fetch))`: bạn mở 5.000 socket cùng lúc, có thể chạm giới hạn file descriptor (`EMFILE`), làm quá tải máy chủ đích (bị rate-limit/ban), và giữ 5.000 response trong bộ nhớ. Với DB, pool thường chỉ có 10-20 kết nối; hàng nghìn truy vấn còn lại **xếp hàng trong thư viện**, vẫn giữ bộ nhớ và làm độ trễ của request khác tăng. Kiểm soát concurrency ở **biên** của bạn cho phép áp lực được xử lý có chủ đích (hàng đợi, từ chối, backoff) thay vì sụp đổ không kiểm soát. (Kịch bản `EMFILE` là kiến thức thông thường, chưa tái hiện trong bài này vì phụ thuộc `ulimit -n` của máy.)

**Giải thích `mapLimit`.** Mỗi hàm `worker` là một vòng `while` bất đồng bộ: lấy chỉ số kế tiếp, `await` việc, lặp lại. Có `limit` worker như vậy chạy "đồng thời" (xen kẽ trên một thread). Điều quan trọng: `const i = next++;` **không cần khoá**, vì giữa việc đọc và tăng `next` không thể có callback khác chen vào (JS đơn luồng, không có `await` ở đó). Đây là điểm khác lớn với lập trình nhiều thread, nơi cùng đoạn mã sẽ cần mutex. Kết quả ghi theo chỉ số `i` nên giữ nguyên thứ tự đầu vào dù việc xong lộn xộn.

Hai chỗ cần quyết định khi dùng thật: (1) nếu một tác vụ ném lỗi thì `Promise.all` từ chối ngay nhưng các worker khác **vẫn tiếp tục lấy việc** trong nền (không có cơ chế huỷ ở bản đơn giản này), nên với việc có tác dụng phụ hãy kiểm tra cờ huỷ hoặc dùng `AbortSignal`; (2) nếu cần cả thành công lẫn thất bại, bọc `fn` bằng `try/catch` trả về `{ ok, value | error }` giống `Promise.allSettled`.

**Event loop lag, ba cách đo.**

1. *Tự đo bằng `setInterval`*: hẹn mỗi 50ms, so khoảng thực tế với 50ms. Đơn giản, dễ hiểu, đủ cho lab.
2. *`monitorEventLoopDelay` (`node:perf_hooks`)*: histogram có sẵn, độ phân giải nano giây, cho `min/max/mean/percentile`. Giá trị trả về tính bằng **nano giây**.
3. *`performance.eventLoopUtilization()`*: trả `{ idle, active, utilization }`, cho biết loop bận bao nhiêu phần.

Ví dụ `monitorEventLoopDelay`:

```ts
import { monitorEventLoopDelay } from "node:perf_hooks";

const h = monitorEventLoopDelay({ resolution: 10 });
h.enable();
await new Promise((r) => setTimeout(r, 200));
console.log("lúc rảnh   p99:", (h.percentile(99) / 1e6).toFixed(1), "ms");
const t = performance.now();
while (performance.now() - t < 300); // chặn 300ms
await new Promise((r) => setTimeout(r, 50));
console.log("sau khi chặn 300ms: max", (h.max / 1e6).toFixed(0), "ms");
h.disable();
```

Node 24.21 đã thử: lúc rảnh p99 ~11ms (gần bằng `resolution` 10ms cộng sai số timer, **không phải 0**); sau khi chặn 300ms, `max` ~305-315ms. Lưu ý: giá trị lag thấp nhất bạn thấy là cỡ `resolution`, vì histogram ghi khoảng cách giữa các lần timer nội bộ chạy.

Ví dụ `eventLoopUtilization` (chặn 200ms rồi rảnh 200ms):

```ts
import { performance } from "node:perf_hooks";

await new Promise((r) => setTimeout(r, 10)); // vào vòng lặp thật sự
const a = performance.eventLoopUtilization();
await new Promise((r) => setTimeout(r, 0));
const t = performance.now();
while (performance.now() - t < 200); // chặn 200ms
await new Promise((r) => setTimeout(r, 200)); // rảnh ~200ms
const e = performance.eventLoopUtilization(a);
console.log(e.utilization.toFixed(2), Math.round(e.active), Math.round(e.idle));
```

Đã thử: `0.50 201 200` (utilization 0,50; active ~201ms; idle ~200ms). Utilization gần 1 nghĩa là loop gần như luôn bận: dấu hiệu server sắp bão hoà (cần scale/giảm việc), dù chưa chặn dài.

**CPU time.** `process.cpuUsage(prev)` trả micro giây CPU `user` và `system` đã tiêu của **cả process** (mọi thread, gồm thread pool và worker). Hiệu hai lần gọi cho CPU tiêu trong khoảng đó:

```ts
function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
  return true;
}

const c0 = process.cpuUsage();
const w0 = performance.now();
let count = 0;
for (let n = 0; n < 3_000_000; n++) if (isPrime(n)) count++;
const wall = performance.now() - w0;
const cpu = process.cpuUsage(c0);
console.log({ count, wallMs: Math.round(wall), cpuUserMs: Math.round(cpu.user / 1000), cpuSysMs: Math.round(cpu.system / 1000) });
```

Node 24.21 với 3 triệu số: `wallMs ~750`, `cpuUserMs ~690`, `cpuSysMs ~3`; với 12 triệu số: wall ~5510ms, user ~5090ms, system ~2ms. `wall ≈ CPU` là chữ ký của CPU-bound. Tác vụ I/O-bound cho `CPU << wall`. Khi đo tác vụ có thread pool/worker, CPU có thể **lớn hơn** wall (nhiều thread cộng dồn), một cách khác để thấy parallelism thật sự.

**Chọn thước đo nào?**

| Câu hỏi | Dùng |
|---|---|
| Có request nào bị chờ lâu vì code đồng bộ không? | event loop delay (p99, max) |
| Server còn dư năng lực không? | event loop utilization |
| Tác vụ này bận CPU hay chỉ chờ? | `process.cpuUsage` so với wall |
| Hàm nào chiếm thời gian? | profiler (`--cpu-prof`), không phải ba cái trên |

## Tricks & tips thực tế

- **Luôn chọn con số concurrency có lý do, không phải `Infinity`.** Gợi ý khởi điểm: bằng kích thước pool kết nối DB (hoặc nhỏ hơn) khi gọi DB; vài chục khi gọi HTTP ngoài (hoặc theo rate limit đối tác); khoảng `UV_THREADPOOL_SIZE` khi việc dùng pool. Lý do: nút thắt luôn ở thứ chậm nhất phía sau; vượt nó chỉ tạo hàng đợi ẩn.
- **Xử lý theo lô (chunk) vs giới hạn trượt:** chia mảng thành lô 10 rồi `Promise.all` từng lô đơn giản nhưng lô phải chờ tác vụ chậm nhất; `mapLimit` giữ N slot luôn đầy nên nhanh hơn khi thời gian từng tác vụ lệch nhau.
- **Đưa event loop delay lên metrics production (p99, max).** Lý do: CPU% của container không phân biệt "bận hữu ích" với "bị chặn dài bởi một handler"; lag p99 tăng là cảnh báo sớm trước khi timeout xuất hiện. Alert theo ngưỡng (ví dụ p99 > 100ms) phụ thuộc yêu cầu của bạn.
- **Đừng `reset()` histogram rồi chặn ngay.** Đã gặp trên Node 24.21: gọi `h.reset()` ngay trước một vòng lặp chặn 300ms thì `max` chỉ ~11ms (mẫu bị mất), còn chờ thêm một nhịp timer (~30ms) sau `reset()` mới chặn thì `max` ~307ms. Nguyên nhân chưa phân tích; hệ quả thực tế là đọc histogram theo chu kỳ (đọc rồi `reset` ở cuối mỗi cửa sổ), đừng reset ngay trước đoạn bạn muốn đo.
- **Dùng `performance.now()`, không `Date.now()`.** Lý do: `Date.now()` theo đồng hồ hệ thống, có thể nhảy khi NTP chỉnh giờ, và độ phân giải mili giây; `performance.now()` đơn điệu và có phần thập phân.
- **Đo nhiều lần, bỏ lần đầu.** Lần chạy đầu gồm JIT warmup, khởi tạo thread pool, cache lạnh của OS (ví dụ `dns.lookup` ~6-9ms lần đầu so với `fs.readFile` ~1ms). Báo cáo khoảng giá trị (min-max hoặc p50/p95) thay vì một con số.
- **`setInterval` tự đo cũng bị lệch bởi chính nó khi loop bận**: đúng bản chất, vì nó đo lag thật, nhưng độ phân giải kém hơn histogram. Với phép đo lab, đủ dùng; với production, dùng `monitorEventLoopDelay`.
- **Khi lag cao mà CPU thấp:** nghi ngờ GC dài (heap lớn) hoặc thao tác đồng bộ có I/O (`readFileSync`, `execSync`) chứ không phải tính toán thuần. Dùng `--cpu-prof` và xem cả phần "(garbage collector)" trong profile.

## Liên hệ bài tập

Lab chặn event loop (đo event loop lag): thiết kế sao cho có **ba mốc** để so sánh: loop rảnh, loop bị chặn đồng bộ N ms, và cùng khối lượng nhưng chia thành lô nhỏ nhường loop. Ghi lag lớn nhất và p99 cho mỗi mốc, kèm `cpuUsage`. Với lab đọc file song song vs tuần tự: thử cả `Promise.all` không giới hạn và phiên bản có giới hạn (tự viết), rồi vẽ bảng thời gian theo giới hạn 1, 2, 4, 8, 32, vô hạn; giải thích điểm mà tăng giới hạn không còn có ích.

## Đọc thêm

- [Node.js: `perf_hooks.monitorEventLoopDelay`](https://nodejs.org/api/perf_hooks.html#perf_hooksmonitoreventloopdelayoptions)
- [Node.js: `performance.eventLoopUtilization`](https://nodejs.org/api/perf_hooks.html#performanceeventlooputilizationutilization1-utilization2)
- [Node.js: `process.cpuUsage`](https://nodejs.org/api/process.html#processcpuusagepreviousvalue)

## Ghi chú của bạn
