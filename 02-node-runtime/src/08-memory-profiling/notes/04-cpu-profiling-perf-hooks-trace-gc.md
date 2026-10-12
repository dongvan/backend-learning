# 4. CPU profile, flame graph, `perf_hooks` và `--trace-gc`

Memory chỉ là một nửa câu chuyện. Khi API chậm, câu hỏi đầu tiên là "CPU đang bận làm gì, event loop có bị chặn không, GC có chiếm thời gian không". Ba công cụ trả lời: **CPU profile**, **`perf_hooks`**, và **`--trace-gc`**.

```bash
node --cpu-prof app.ts          # khi thoát, ghi CPU.<ngày>.<giờ>.<pid>.<tid>.<seq>.cpuprofile
node --cpu-prof --cpu-prof-dir=./prof app.ts
```

Mở file `.cpuprofile` bằng tab *Performance* (hoặc *JavaScript Profiler*) của Chrome DevTools, hoặc đọc bằng tay như bên dưới (Node 24.21 đã thử).

## Ý chính

- CPU profiler của V8 là **sampling**: cứ khoảng 1 ms lấy mẫu "đang chạy hàm nào, stack thế nào". Hàm xuất hiện nhiều mẫu = tốn thời gian. Chi phí thấp, dùng được ở production có kiểm soát.
- **Self time** (thời gian riêng của hàm) khác **total time** (gồm cả hàm nó gọi). Tìm điểm nóng bằng self time; tìm "đường nóng" bằng total time.
- **Flame graph**: trục ngang = tỉ lệ thời gian (mẫu), **không** phải thời gian trôi theo đồng hồ; trục dọc = độ sâu stack. Khối rộng ở **trên cùng** (lá) là nơi tốn CPU thực sự.
- `--cpu-prof` ghi file khi tiến trình kết thúc bình thường; `--prof` ghi log thô của V8 rồi dùng `node --prof-process` để tóm tắt (cách cũ, vẫn hữu ích khi cần xem tick theo JS/C++/GC).
- `perf_hooks` cho đo thời gian chính xác trong code (`mark`/`measure`), độ trễ event loop (`monitorEventLoopDelay`), và mức bận của event loop (`eventLoopUtilization`).
- `--trace-gc` in từng lần GC (file 1). Dùng để kiểm tra "chậm là do GC hay do code của mình".

## Lý thuyết chi tiết

**Một chương trình có điểm nóng rõ.** Hai hàm tạo tải trong khoảng 1,5 giây:

```ts
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function hashLike(n: number): number {
  let h = 0;
  for (let i = 0; i < n; i++) h = (h * 31 + i) | 0;
  return h;
}
let acc = 0;
const end = Date.now() + 1500;
while (Date.now() < end) {
  for (let i = 0; i < 200; i++) acc += slugify("Xin Chào Thế Giới " + i).length;
  acc += hashLike(200_000);
}
console.log(acc);
```

Chạy `node --cpu-prof cpu1.ts` tạo file khoảng 44 KB (JSON). Cấu trúc (đã in ra): các khoá `nodes, startTime, endTime, samples, timeDeltas`; 184 node, 1.310 mẫu, tổng 1.595 ms. `nodes` là cây cuộc gọi (mỗi node có `callFrame.functionName/url/lineNumber`); `samples` là danh sách id node theo từng lần lấy mẫu; `timeDeltas` là khoảng cách giữa các mẫu (micro giây). Cộng `timeDeltas` theo node cho ra self time:

```ts
import { readFileSync } from "node:fs";

type N = { id: number; callFrame: { functionName: string; url: string; lineNumber: number } };
type Prof = { nodes: N[]; samples: number[]; timeDeltas: number[] };

const p = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as Prof;
const selfUs = new Map<number, number>();
p.samples.forEach((id, i) => selfUs.set(id, (selfUs.get(id) ?? 0) + (p.timeDeltas[i] ?? 0)));

const byFn = new Map<string, number>();
for (const n of p.nodes) {
  const key = `${n.callFrame.functionName || "(anon)"}:${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber + 1}`;
  byFn.set(key, (byFn.get(key) ?? 0) + (selfUs.get(n.id) ?? 0));
}
for (const [k, us] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log((us / 1000).toFixed(0).padStart(6) + "ms", k);
```

Kết quả thật:

```text
  1015ms (anon):cpu1.ts:1
   322ms slugify:cpu1.ts:1
    47ms (garbage collector)::0
    46ms hashLike:cpu1.ts:4
    43ms RegExp: [^a-z0-9]+::0
    23ms __require:index:8
```

Điều trái kỳ vọng: `hashLike` (vòng lặp 200.000 bước, tốn phần lớn thời gian thực) chỉ hiện **46 ms**, còn `(anon)` ở dòng 1 (code cấp module) chiếm **1015 ms**. Lý do: JIT **inline** `hashLike` vào nơi gọi, nên mẫu được tính cho hàm bao ngoài. `--prof` xác nhận bằng dấu `*` (code đã tối ưu) trước tên: `JS: *<anonymous> cpu1.ts:1:1` chiếm 59% tick, còn `*hashLike` chỉ 2%. Bài học: **đừng đọc self time như bản đồ chính xác tới từng hàm nhỏ**; khi thấy hàm bao ngoài tốn nhiều mà không có hàm con tương xứng, nghi ngờ inlining và nhìn vào vòng lặp bên trong. Đã thử chạy lại với `node --cpu-prof --max-inlined-bytecode-size=0 cpu1.ts` (cờ V8 dành cho thí nghiệm, không dùng ở production): lúc này `hashLike` hiện đúng **1316 ms** và `slugify` 125 ms, tức tắt inline thì bản đồ khớp trực giác. Cách khác là bọc phần cần đo bằng `performance.measure`.

Mục `(garbage collector)` cho biết GC chiếm bao nhiêu (47 ms trong khoảng 1.5 s, khoảng 3%), `(program)`, `(idle)` cho thời gian không chạy JS. Trong chương trình Node nhàn rỗi, `(idle)` thường là phần lớn: bình thường.

**`--prof` và `--prof-process`.** `node --prof cpu1.ts` tạo `isolate-0x...-<pid>-v8.log` (khoảng 5 MB cho 1,5 s: log thô, to nhanh). `node --prof-process isolate*.log` in bảng `[JavaScript]`, `[C++]`, `[Summary]`, `[Bottom up (heavy) profile]`. Ký hiệu đầu dòng: `*` hàm đã tối ưu bởi TurboFan, `~` đang được thông dịch, `+` baseline. Hàm lẽ ra nóng mà mãi là `~` nghĩa là chưa được tối ưu (hoặc bị "deopt"). Cũng có dòng `Builtin: RegExpReplace`, `Builtin: StringAdd_CheckNone`, cho thấy phần thời gian nằm trong hàm dựng sẵn của V8 chứ không phải code của bạn. Với đa số trường hợp, `--cpu-prof` + DevTools dễ dùng hơn; `--prof` hữu ích khi cần nhìn bên dưới lớp JS.

**Đọc flame graph (kiến thức từ tài liệu Chrome DevTools, chưa thử vì không mở GUI).** Mỗi khối là một hàm; chiều rộng tỉ lệ số mẫu có hàm đó trong stack; khối nằm trên khối khác = nó được hàm bên dưới gọi. Tìm các **"cao nguyên" rộng ở trên cùng** (không có khối con): đó là hàm tự tốn CPU. Khối rộng nhưng có nhiều khối con nhỏ ở trên: tổng thời gian đến từ nhiều cuộc gọi nhỏ, tối ưu ở chỗ gọi (giảm số lần gọi) hiệu quả hơn tối ưu từng hàm. Chế độ *Bottom-Up* gộp theo hàm (cộng mọi nơi nó xuất hiện), *Top-Down/Call Tree* giữ cấu trúc cây. Màu thường chỉ để phân biệt, không có ý nghĩa tốt/xấu.

**Chạy profiler theo yêu cầu.** Ngoài `--cpu-prof`, có thể điều khiển qua `node:inspector` (đã thử, Node 24.21):

```ts
import inspector from "node:inspector";
import { writeFileSync } from "node:fs";

const session = new inspector.Session();
session.connect();
session.post("Profiler.enable");
session.post("Profiler.start");
// ... chạy đoạn cần đo ...
session.post("Profiler.stop", (err, { profile }) => {
  if (err) throw err;
  writeFileSync("out.cpuprofile", JSON.stringify(profile));
});
```

Cùng giao thức này là thứ DevTools nói chuyện khi bạn gắn `--inspect` (file 3). Cách này cho phép bật profile **một khoảng thời gian** (ví dụ 30 giây khi có sự cố) rồi tắt, thay vì profile cả đời tiến trình.

**`perf_hooks`.**

```ts
import { performance, PerformanceObserver, monitorEventLoopDelay } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";

new PerformanceObserver((list) => {
  for (const m of list.getEntries()) console.log(`${m.entryType} ${m.name}: ${m.duration.toFixed(1)}ms`);
}).observe({ entryTypes: ["measure"] });

const h = monitorEventLoopDelay({ resolution: 10 });
h.enable();
const elu0 = performance.eventLoopUtilization();

performance.mark("db:start");
await sleep(50);                       // giả lập I/O
performance.mark("db:end");
performance.measure("db", "db:start", "db:end");

const t = performance.now();
while (performance.now() - t < 200) { /* chặn event loop 200ms */ }
await sleep(20);

h.disable();
console.log("loop delay ms: p50", (h.percentile(50) / 1e6).toFixed(0), "p99", (h.percentile(99) / 1e6).toFixed(0), "max", (h.max / 1e6).toFixed(0));
console.log("ELU", performance.eventLoopUtilization(elu0).utilization.toFixed(2));
```

Kết quả thật: `measure db: 51.9ms` (sát 50 ms ngủ, cộng sai số lập lịch); `loop delay ms: p50 11 p99 212 max 212` và `ELU 0.75`. Đọc: histogram độ trễ ghi nhận đúng một lần chặn 200 ms (`max` 212 ms) mà trung vị 11 ms (xấp xỉ `resolution`, bình thường) che giấu; **luôn xem p99/max**, không chỉ trung bình. `eventLoopUtilization` là tỉ lệ thời gian event loop **không rảnh** (0..1) trong khoảng giữa hai lần gọi; hàm chạy lâu sát 1 nghĩa là bão hoà CPU.

Các điểm khác của `perf_hooks`:

- `performance.timerify(fn)` bọc hàm để mỗi lần gọi tạo entry loại `"function"` (đã thử: `function parse 0.081ms`).
- `PerformanceObserver` với `entryTypes: ["gc"]` nhận từng lần GC kèm `duration` và `detail.kind` (so với `perf_hooks.constants.NODE_PERFORMANCE_GC_MINOR` / `..._MAJOR`). Đã thử trên chương trình cấp phát nhiều object: toàn bộ minor GC dưới 2 ms, một major 3,9 ms, một vài lần cao hơn khi đang promote nhiều (5,2 ms). Có một lần hiện `kind=8`, không trùng với hai hằng số minor/major (một loại GC khác, ví dụ dọn tăng dần); nên so `kind` với các hằng số `constants.NODE_PERFORMANCE_GC_*` của phiên bản đang dùng thay vì hard-code số.
- Mốc `mark` vẫn nằm trong bộ đệm toàn cục (đã đo: sau `measure`, `performance.getEntriesByType("mark").length` vẫn là 2). Trong server chạy dài, mỗi request gọi `mark` mà không `performance.clearMarks()` sẽ tích luỹ: một rò rỉ nhỏ do chính công cụ đo gây ra.

**`--trace-gc`** (file 1): dùng để đối chiếu. Ví dụ: p99 latency tăng đột biến cùng lúc với một dòng `Mark-Compact` thời gian cao => GC. Nếu GC chiếm tỉ lệ lớn (`mu` thấp, nhiều Mark-Compact liên tiếp) thì nguyên nhân gốc thường là heap quá lớn hay rò rỉ, không phải tối ưu CPU.

## Tricks & tips thực tế

- **Profile đúng khối lượng công việc.** Chạy profile khi có tải đại diện (hoặc script bắn request giống thật), không phải lúc nhàn rỗi. Lý do: sampling profiler chỉ thấy cái đang chạy; ở trạng thái rảnh nó chỉ thấy `(idle)`.
- **Profile bản build gần production**: cùng phiên bản Node, cùng cờ. Dev mode (watch, source map, logger chi tiết) làm lệch đồ thị.
- **Một phiên profile cho một câu hỏi.** Lấy 30-60 giây quanh sự cố; file dài khó đọc và log `--prof` phình rất nhanh (5 MB cho 1,5 s).
- **Đừng tin self time của hàm nhỏ khi có inlining** (như `hashLike` ở trên): lên một mức, xem hàm gọi nó, và đo lại bằng `performance.now()` quanh đoạn nghi vấn để xác nhận.
- **Đặt tên hàm thay vì hàm ẩn danh** ở code nóng: `(anonymous)` trong flame graph không cho biết gì; hàm có tên hiện trong stack và `--prof` kể cả khi inline. Lý do: tên chính là nhãn bạn đọc khi gấp.
- **Theo dõi event loop delay (p99) và ELU như metrics thường trực**, không chỉ khi có sự cố. Lý do: đó là chỉ báo sớm nhất cho "một request đang chặn mọi request khác" trong mô hình đơn luồng. So với Laravel/PHP-FPM, nơi một request nặng chỉ chiếm một worker, ở Node nó làm đứng cả tiến trình.
- **Không dùng `Date.now()` để đo khoảng ngắn;** dùng `performance.now()` hoặc `process.hrtime.bigint()` (đơn điệu, độ phân giải cao, không nhảy khi đồng hồ hệ thống chỉnh).
- **`performance.mark` trong server:** luôn `performance.clearMarks()`/`clearMeasures()` hoặc dùng `PerformanceObserver` rồi xoá, hoặc chỉ dùng `performance.now()` hiệu số. Lý do: bộ đệm toàn cục tích luỹ mãi (đã quan sát).
- **Nếu profile cho thấy nhiều thời gian ở `Builtin: JSON...` hoặc RegExp**, nghi ngờ dữ liệu quá lớn đi qua `JSON.parse/stringify` đồng bộ hay regex đắt; cách xử lý thuộc về thiết kế (stream, chia nhỏ, worker thread), không phải "tối ưu vi mô".
- **So với PHP:** Blackfire/Xdebug profile theo request và quy ra thời gian từng hàm; ở Node profile là theo *tiến trình*, gộp mọi request chạy đồng thời. Kết quả cần được đọc theo "thời gian CPU cho mọi người", không phải "của một request".

## Liên hệ bài tập

Trong lab, bạn sẽ đọc một profile. Gợi ý quy trình: (1) xác định đây là vấn đề CPU, GC hay bộ nhớ bằng `--trace-gc`/`monitorEventLoopDelay`; (2) thu profile với tải đại diện; (3) tìm hàm có self time lớn nhất, đối chiếu với `--prof` nếu nghi inline; (4) viết giả thuyết rồi đo lại sau khi thay đổi. Ghi rõ số đo trước/sau, đừng chỉ viết "nhanh hơn".

## Đọc thêm

- [Node.js: Diagnostics (tổng quan)](https://nodejs.org/en/learn/diagnostics)
- [Node.js: Flame Graphs](https://nodejs.org/en/learn/diagnostics/flame-graphs)
- [Node.js: Command-line options (`--cpu-prof`, `--prof`, `--trace-gc`)](https://nodejs.org/api/cli.html)
- [Node.js: `perf_hooks`](https://nodejs.org/api/perf_hooks.html)
- [Node.js: module `inspector`](https://nodejs.org/api/inspector.html)

## Ghi chú của bạn
