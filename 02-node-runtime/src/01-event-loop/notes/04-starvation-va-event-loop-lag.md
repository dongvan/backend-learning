# 4. Starvation và event loop lag

Khi nextTick/microtask tự đẻ thêm nextTick/microtask vô hạn, event loop không bao giờ sang phase kế (starvation); còn khi một callback chạy lâu, mọi thứ chờ sau nó bị trễ (lag), và lag đo được.

```ts
import { monitorEventLoopDelay } from "node:perf_hooks";

const h = monitorEventLoopDelay({ resolution: 10 });
h.enable();
// ... chạy workload ...
h.disable();
console.log((h.percentile(99) / 1e6).toFixed(1), "ms (p99)"); // histogram tính bằng nanosecond
```

## Ý chính

- **Starvation**: queue nextTick hoặc microtask không bao giờ cạn thì timer, I/O, immediate **không bao giờ** được chạy; process trông như treo nhưng CPU 100%.
- `setImmediate` đệ quy **không** gây starvation vì mỗi lần chạy xong, vòng lặp đi qua đủ các phase (timers, poll) trước khi quay lại check.
- **Event loop lag** là độ trễ giữa lúc một callback đáng lẽ chạy và lúc nó thực sự chạy. Nguyên nhân gần như luôn là code đồng bộ chạy lâu.
- Hai cách đo: `perf_hooks.monitorEventLoopDelay` (histogram chính xác, chi phí thấp) và `performance.eventLoopUtilization()` (tỉ lệ thời gian vòng lặp bận).
- Lag là **chỉ số sức khỏe hàng đầu** của một service Node: p99 lag cao nghĩa là mọi request cùng bị chậm, dù thao tác DB rất nhanh.

## Lý thuyết chi tiết

**Starvation do nextTick và microtask.** Thí nghiệm (Node 24.21): đặt `setTimeout(..., 0)`, rồi chạy hàm đệ quy lên lịch chính nó 2 triệu lần bằng nextTick:

```ts
let n = 0;
setTimeout(() => console.log(`timer fired, after ${n} ticks`), 0);
function spin(): void {
  if (++n < 2_000_000) process.nextTick(spin);
}
spin();
// timer fired, after 2000000 ticks   (khoảng 227ms tổng)
```

Timer chỉ bắn **sau khi** 2 triệu tick xong. Giới hạn 2 triệu là do tôi tự đặt để chương trình kết thúc; nếu bỏ giới hạn thì timer không bao giờ chạy và process kẹt mãi. Làm lại với `Promise.resolve().then(spin)` cho kết quả tương tự (`timer fired after 2000000 promises`): microtask cũng gây đói. Với `setImmediate(spin)` thì timer 5ms bắn sau khoảng 420 lần immediate (5ms thật), tức loop vẫn thở.

Trong production, starvation thường không do `spin` rõ ràng mà do: vòng lặp `while (queue.length) await processOne()` mà `processOne` **không có** I/O thật (chỉ `await` giá trị đã sẵn sàng, cache), nên mỗi vòng chỉ là microtask và không bao giờ nhường cho I/O. Request khác không được phục vụ cho đến khi queue cạn.

**Lag do callback chậm.** Đoạn đo thủ công bằng `setInterval(…, 20)` và so khoảng cách thực giữa hai lần chạy: khi một callback khác chặn 150ms, output là `lag 150 ms` (Node 24.21). Phương pháp này đơn giản nhưng đo thô; dùng histogram thì đầy đủ hơn.

**`monitorEventLoopDelay`.** Đo bằng cách đặt một timer lặp (độ phân giải `resolution`, mặc định 10ms) và ghi lại độ trễ thực tế giữa các lần bắn vào histogram HDR. Thí nghiệm: chạy 300ms rảnh rồi 3 lần chặn 200ms xen kẽ `sleep(50)` (Node 24.21):

```
{ min: '10.6', mean: '24.9', p50: '10.9', p99: '209.3', max: '209.3', exceeds: 0, count: 42 }
```

Phát hiện cần ghi nhớ:

- `min` ≈ 10.6ms, tức **xấp xỉ giá trị `resolution`**, không phải 0. Histogram ghi cả chu kỳ của timer, không trừ phần `resolution`. Khi đọc số, hãy coi "độ trễ thật" ≈ giá trị đo trừ `resolution` (chỉ là diễn giải của tôi dựa trên số đo, chưa đối chiếu mã nguồn Node).
- `p99` và `max` ≈ 209ms ứng với đoạn chặn 200ms + resolution. `p50` vẫn ~11ms: khi lag xảy ra hiếm thì trung vị che mất, cần xem **p99/max**.
- Đơn vị là **nanosecond**; chia 1e6 để ra ms.
- `exceeds` đếm số lần độ trễ vượt 1 giờ (đã thử, 0), không phải "vượt ngưỡng của bạn"; đừng nhầm.
- `count` là số mẫu, ≈ thời gian chạy / resolution (không phải số lần bị lag).

**Event loop utilization (ELU).** `performance.eventLoopUtilization()` trả `{ idle, active, utilization }`: tỉ lệ thời gian vòng lặp bận. Thử: một callback chặn 300ms trong cửa sổ khoảng 700ms đo được `utilization` khoảng 0.43 (Node 24.21). Truyền kết quả trước đó vào để đo trong một **khoảng** (`performance.eventLoopUtilization(prev)`). Dùng ELU để thấy "tải" (gần 1 = bão hòa); dùng delay để thấy "độ trễ người dùng cảm nhận".

## Tricks & tips thực tế

- **Xuất lag p99 và ELU ra metric** (Prometheus, v.v.) và đặt cảnh báo. Lý do: CPU% của process không phân biệt được "bận ở C++/GC" với "thread JS bị tắc"; lag chỉ ra ngay request đang bị chờ.
- **Dùng `h.reset()` định kỳ** (ví dụ mỗi 10 giây sau khi xuất metric) để histogram phản ánh cửa sổ gần nhất. Không reset thì p99 của cả đời process che mất vấn đề mới.
- **Khi thấy lag, tìm "thủ phạm đồng bộ"**: `JSON.parse`/`JSON.stringify` payload lớn, regex nặng (ReDoS), vòng lặp lớn trên mảng, `*Sync`, băm mật khẩu đồng bộ. Công cụ: `node --cpu-prof` hoặc `--inspect` rồi ghi CPU profile; frame rộng nhất trong flame graph là nghi phạm. (Công cụ profiling được học sâu hơn ở phần Memory/Profiling của phase này.)
- **Không đệ quy bằng `process.nextTick`** để "lặp công việc nền". Dùng `setImmediate` (nhường I/O) hoặc `await` một thao tác I/O thật. Lý do: như thí nghiệm, nextTick/microtask không nhường.
- **Vòng lặp `await` không I/O vẫn là vòng lặp chiếm CPU**: nếu cần xử lý 100.000 phần tử, cứ mỗi N phần tử `await new Promise(r => setImmediate(r))` để nhường. Hoặc đẩy sang Worker. `await` một promise đã resolve **không** nhường cho I/O, vì chỉ là microtask.
- **Đo lag trong test tải**, không chỉ latency của request: nếu lag p99 tăng theo tải còn latency DB ổn thì nút thắt ở code JS, không ở DB.
- **Đừng tự chế đo lag bằng `setInterval` trong production nếu có `monitorEventLoopDelay`**: tự chế chỉ thấy lag khi timer được lên lịch, còn histogram ghi chi phí thấp và đủ phân vị. Tự chế phù hợp để học.
- **Với PHP**: không có khái niệm này vì mỗi request độc lập; request chậm chỉ làm chậm **chính nó** (và chiếm một worker). Trong Node, một request chậm **kéo theo** các request khác. Đây là thay đổi tư duy chính khi chuyển sang Node.

## Liên hệ bài tập

Script đo event loop lag trong `EXERCISE.md`: hãy thử cả hai hướng (đo thủ công bằng khoảng cách giữa hai lần timer và dùng `monitorEventLoopDelay`) rồi tạo tải có kiểm soát (vòng `while` chặn một khoảng biết trước) để kiểm tra số đo có khớp. Gợi ý quan sát: giá trị tối thiểu có phải 0 không, và vì sao? Thử thêm một kịch bản "đói" an toàn (có giới hạn số lần) để tự thấy timer không chạy.

## Đọc thêm

- [Node.js: `perf_hooks.monitorEventLoopDelay`](https://nodejs.org/api/perf_hooks.html#perf_hooksmonitoreventloopdelayoptions)
- [Node.js: `performance.eventLoopUtilization`](https://nodejs.org/api/perf_hooks.html#performanceeventlooputilizationutilization1-utilization2)
- [Node.js: Don't Block the Event Loop](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)

## Ghi chú của bạn
