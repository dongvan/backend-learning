# 1. V8 heap, garbage collection và `process.memoryUsage()`

Bộ nhớ của một tiến trình Node không chỉ là "heap JavaScript": object nằm ở V8 heap, còn `Buffer` và dữ liệu native nằm **ngoài** heap, và hệ điều hành chỉ quan tâm tới **RSS**. Đọc đúng các con số này là bước đầu của mọi cuộc điều tra bộ nhớ.

```ts
import { memoryUsage } from "node:process";

const mb = (n: number) => (n / 1024 / 1024).toFixed(1) + "MB";
const m = memoryUsage();
console.log(`rss=${mb(m.rss)} heapTotal=${mb(m.heapTotal)} heapUsed=${mb(m.heapUsed)} external=${mb(m.external)} arrayBuffers=${mb(m.arrayBuffers)}`);
```

(Node 24.21 đã thử. Chạy trực tiếp bằng `node file.ts`.)

## Ý chính

- **V8 heap** chia thành vùng **trẻ** (young generation, gồm *new space*) và vùng **già** (old generation, *old space* cùng vài vùng đặc biệt như *large object space*, *code space*). Giả thuyết nền: *hầu hết object chết trẻ*.
- **Scavenge** (minor GC): dọn vùng trẻ, rất nhanh (dưới ~1-2 ms trong các thí nghiệm bên dưới), chạy rất thường xuyên. Object sống sót đủ lâu được **promote** sang old space.
- **Mark-Sweep / Mark-Compact** (major GC): đánh dấu mọi object còn được tham chiếu từ gốc (root), quét/dồn vùng già. Đắt hơn, nhưng V8 làm phần lớn **song song, tăng dần, đồng thời** để giảm thời gian dừng.
- `process.memoryUsage()` trả 5 trường: `rss`, `heapTotal`, `heapUsed`, `external`, `arrayBuffers`. **`rss` không bằng tổng các trường còn lại**.
- `Buffer` / `ArrayBuffer` nằm ngoài V8 heap: tăng `external` và `arrayBuffers`, **không** tăng `heapUsed`. Heap snapshot nhìn thấy "vỏ" JS của chúng nhưng không thấy dung lượng thật.
- `--max-old-space-size=<MB>` giới hạn **old space**, không phải tổng bộ nhớ tiến trình. Vượt giới hạn: `FATAL ERROR: ... JavaScript heap out of memory`, tiến trình chết (exit code 134, SIGABRT).
- Heap tăng chưa chắc là rò rỉ: GC chạy theo áp lực bộ nhớ, nên đọc `heapUsed` **ngay sau một lần GC** (xem file 2) mới có ý nghĩa.

## Lý thuyết chi tiết

**Vì sao generational.** Một request HTTP tạo hàng nghìn object tạm (chuỗi, mảng, kết quả parse) rồi bỏ đi trong vài mili giây. Nếu mỗi lần dọn phải quét cả heap vài trăm MB thì quá đắt. V8 cấp phát object mới vào new space (nhỏ, vài MB đến vài chục MB, tự điều chỉnh). Khi new space đầy, scavenge chỉ chép object **còn sống** sang nửa kia (semi-space); object sống sót qua hai lần scavenge bị promote lên old space. Chi phí tỉ lệ với số object **sống**, không phải số object đã cấp phát, nên rất rẻ khi hầu hết đã chết.

Old space được dọn bằng Mark-Sweep-Compact: duyệt đồ thị từ các root (biến toàn cục, stack, handle native), đánh dấu, rồi quét và đôi khi dồn để chống phân mảnh. Thời gian tỉ lệ với **kích thước đồ thị còn sống**, vì vậy heap phình to (cache, Map tăng mãi) làm **mỗi lần** major GC chậm hơn, và tăng thời gian dừng (latency đuôi) dù không rò rỉ gì.

**Quan sát được bằng `--trace-gc`** (Node 24.21 đã thử):

```text
[31621:0x1dd86000]  72 ms: Scavenge 8.7 (9.6) -> 8.1 (10.6) MB, pooled: 0 MB, 0.77 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure;
[31919:0x32ef9000] 156 ms: Mark-Compact 15.9 (29.8) -> 13.2 (30.7) MB, pooled: 0 MB, 4.26 / 0.01 ms  (+ 0.4 ms in 43 steps since start of marking, ...) finalize incremental marking via stack guard; GC in old space requested
```

Đọc: `loại GC  <heapUsed trước> (<heapTotal trước>) -> <heapUsed sau> (<heapTotal sau>) MB, <thời gian>`, rồi lý do. Trong một chương trình tạo ba triệu object tạm, giữ lại 10%, có 25 lần Scavenge (mỗi lần dưới 5 ms) và chỉ vài lần Mark-Compact. `mu` là "mutator utilization": phần thời gian dành cho code của bạn thay vì GC; số này tụt dần về 0 khi GC chiếm hết CPU, dấu hiệu heap sắp cạn.

**Bốn con số, và vì sao `rss` khác.**

| Trường | Ý nghĩa | Ghi chú |
|---|---|---|
| `rss` | Resident Set Size: RAM vật lý tiến trình đang chiếm | Gồm heap, code của Node/V8, stack, thư viện native, `Buffer`, vùng GC chưa trả lại OS. **Đây là số container bị giới hạn.** |
| `heapTotal` | V8 đã xin từ OS cho heap | Có thể lớn hơn nhiều so với đang dùng |
| `heapUsed` | Phần heap đang chứa object | Chỉ số chính để tìm rò rỉ JS |
| `external` | Bộ nhớ C++ gắn với object JS (Buffer, ...) | Bao gồm `arrayBuffers` |
| `arrayBuffers` | Riêng `ArrayBuffer`/`Buffer` | Tập con của `external` |

Số đo thật (Node 24.21, tiến trình trống rồi lần lượt thêm):

```text
start          rss=64.7MB heapTotal=10.1MB heapUsed=8.8MB  external=10.7MB  arrayBuffers=2.8MB
Buffer 50MB    rss=64.7MB heapTotal=10.1MB heapUsed=8.8MB  external=60.7MB  arrayBuffers=52.8MB
+AB 30MB       rss=64.9MB heapTotal=10.1MB heapUsed=8.8MB  external=90.7MB  arrayBuffers=82.8MB
1M objects     rss=131.1MB heapTotal=113.6MB heapUsed=48.7MB external=88.0MB arrayBuffers=80.1MB
```

Hai điều đáng chú ý, trái kỳ vọng thông thường:

1. Cấp 50 MB bằng `Buffer.alloc` làm `external` tăng 50 MB nhưng **`rss` gần như không đổi**. Hệ điều hành cấp trang bộ nhớ theo kiểu lười: trang chưa bị ghi chưa chiếm RAM thật. Khi `buf.fill(1)`, RSS mới tăng thêm đúng 100 MB (đã thử với 100 MB: `rss` 63 MB -> 163 MB sau `fill`). Tương tự `Buffer.allocUnsafe`. Hệ quả: `external` là dung lượng đã **xin**, `rss` là dung lượng đã **dùng thật**; hai số có thể lệch nhau rất nhiều, và một tiến trình có thể "bất ngờ" tăng RSS khi dữ liệu thực sự được ghi vào.
2. `heapTotal` (113 MB) lớn hơn `heapUsed` (49 MB) gấp đôi sau khi tạo một triệu object: V8 xin dư chỗ cho đợt tăng trưởng tiếp theo. Đừng đọc `heapTotal` như mức dùng.

`process.memoryUsage.rss()` rẻ hơn nhiều so với `process.memoryUsage()` đầy đủ (tài liệu Node nêu rõ điều này), nên dùng hàm này khi đo thường xuyên.

**Các vùng heap.** `v8.getHeapSpaceStatistics()` liệt kê từng vùng: `new_space`, `old_space`, `code_space`, `large_object_space`, `trusted_space`... Trong thí nghiệm, mảng 1 triệu phần tử đẩy một phần lớn dữ liệu vào `large_object_space` (13,8 MB): object lớn không đi qua scavenge, được cấp riêng và không bị chép. `new_space` hiện `0.0MB / 64.0MB` (đã dùng / đã cấp): V8 đang cấp 64 MB cho vùng trẻ nhưng lúc đó chưa có gì trong đó. Tên vùng và kích thước phụ thuộc phiên bản V8; đừng hard-code.

**Giới hạn heap.** `v8.getHeapStatistics().heap_size_limit` là trần tổng. Mặc định phụ thuộc RAM máy (máy thử 7,7 GB RAM cho 2240 MB). Đặt `--max-old-space-size=N` thì `heap_size_limit` **không** bằng N, mà lớn hơn vì cộng thêm vùng trẻ. Đã đo (Node 24.21):

```text
--max-old-space-size=64   -> heap_size_limit 256 MB
--max-old-space-size=100  -> 292 MB
--max-old-space-size=512  -> 704 MB
--max-old-space-size=4096 -> 4288 MB
```

Phần chênh (192 MB) là vùng trẻ cộng thêm; con số này là chi tiết cài đặt, chỉ dùng để thấy rằng giới hạn cấu hình và giới hạn thực không trùng.

**Khi chạm giới hạn.** Chương trình cố tình giữ mọi thứ với `--max-old-space-size=64`:

```text
<--- Last few GCs --->
[...] 116 ms: Mark-Compact 48.1 (81.2) -> 48.1 (113.0) MB ...
[...] 134 ms: Mark-Compact 63.3 (128.3) -> 63.3 (128.3) MB ... allocation failure; scavenge might not succeed

FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

Hai dòng Mark-Compact liên tiếp mà con số trước/sau **gần bằng nhau** (48.1 -> 48.1, 63.3 -> 63.3) cho thấy GC không thu hồi được gì: mọi thứ còn được tham chiếu. Tiến trình thoát với mã 134 (128 + SIGABRT 6). Đây **không** phải exception: `try/catch`, `process.on("uncaughtException")` không bắt được; chỉ có thể xử lý bằng cách phòng ngừa, giám sát, và (nếu cần) `--heapsnapshot-near-heap-limit` (file 3).

**So sánh PHP.** PHP-FPM có `memory_limit` theo request và tiến trình worker bị tái chế sau N request, nên rò rỉ nhỏ thường vô hình. Node là một tiến trình sống lâu, một bộ nhớ chung cho mọi request: rò rỉ 1 KB mỗi request ở 100 req/s là gần 8 GB mỗi ngày. Không có "kết thúc request thì xoá hết".

## Tricks & tips thực tế

- **Đặt `--max-old-space-size` theo giới hạn container, chừa chỗ cho phần ngoài heap.** Ví dụ container 1 GiB: đặt old space khoảng 600-700 MB, vì RSS còn gồm `Buffer`, vùng trẻ, code, thư viện native. Đặt bằng đúng giới hạn container thì kernel giết tiến trình (OOMKilled) trước khi V8 kịp báo lỗi gọn gàng.
- **Theo dõi cả `rss` và `heapUsed`, không chỉ một.** `heapUsed` tăng đều mà `rss` phẳng là heap đang lấp chỗ đã xin; `rss` tăng mà `heapUsed` phẳng nghĩa là rò rỉ **ngoài heap** (Buffer, addon native, socket, phân mảnh), và heap snapshot sẽ không giúp được.
- **Dùng `process.memoryUsage.rss()` cho metrics định kỳ.** Hàm đầy đủ phải quét thống kê heap, tốn hơn; với giám sát 1-10 giây một lần nên dùng bản nhẹ khi chỉ cần RSS.
- **Đo lặp lại sau khi "làm nóng".** Vài trăm request đầu làm heap tăng vì JIT, cache lười, pool kết nối; đó không phải rò rỉ. So sánh hai điểm đo cách nhau đủ xa, cùng tải.
- **Đừng tăng `--max-old-space-size` để "chữa" OOM.** Rò rỉ thật chỉ chết chậm hơn, và major GC trên heap lớn gây dừng lâu hơn. Tăng giới hạn chỉ đúng khi bạn đã chứng minh tập dữ liệu sống hợp lý (xem retained size ở file 3) đã vượt trần.
- **`Buffer.alloc` vs `Buffer.allocUnsafe` về bộ nhớ:** `allocUnsafe` không xoá nội dung nên nhanh hơn và có thể chứa dữ liệu cũ của tiến trình; vì thế không bao giờ gửi nguyên nó ra ngoài chưa ghi đủ. Về RSS, cả hai chỉ tốn RAM thật khi trang bị ghi.
- **Debug "memory lên nhưng không biết ở đâu":** chạy với `--trace-gc` ở môi trường thử, xem Mark-Compact có thu hồi được không (trước -> sau giảm rõ rệt hay không). Nếu có, đó là áp lực bình thường; nếu không, có thứ đang giữ tham chiếu.
- **Không gọi `global.gc()` trong production** để "dọn bộ nhớ": nó chặn event loop và che mất vấn đề. `--expose-gc` chỉ dùng trong thí nghiệm để có điểm đo ổn định.

## Liên hệ bài tập

Trong lab, bạn sẽ cần ghi lại `heapUsed`, `rss`, `external` theo thời gian khi tải tăng. Hãy tự đặt câu hỏi trước khi mở công cụ: con số nào tăng, con số nào phẳng, và điều đó loại trừ những giả thuyết nào (ví dụ `external` phẳng thì không phải `Buffer`). Thử chạy chương trình của bạn với `--trace-gc` và mô tả bằng lời một lần Scavenge và một lần Mark-Compact trong log.

## Đọc thêm

- [Node.js: Understanding and Tuning Memory](https://nodejs.org/en/learn/diagnostics/memory/understanding-and-tuning-memory)
- [Node.js: `process.memoryUsage()`](https://nodejs.org/api/process.html#processmemoryusage)
- [Node.js: module `v8` (`getHeapStatistics`, `getHeapSpaceStatistics`)](https://nodejs.org/api/v8.html)

## Ghi chú của bạn
