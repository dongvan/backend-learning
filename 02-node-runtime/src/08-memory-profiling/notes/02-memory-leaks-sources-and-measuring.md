# 2. Nguồn rò rỉ bộ nhớ thường gặp và cách đo

Rò rỉ trong JavaScript không phải "quên `free`": là **một tham chiếu còn sống mà bạn không ngờ tới**, thường từ một biến sống lâu (module scope, `Map` toàn cục, emitter, timer) tới object lẽ ra đã hết việc.

```ts
// Một Map ở module scope: sống đến khi tiến trình chết
const sessions = new Map<string, { userId: number; data: Buffer }>();

export function onLogin(token: string, userId: number) {
  sessions.set(token, { userId, data: Buffer.alloc(1024) });   // không ai xoá -> heap tăng mãi
}
```

## Ý chính

- GC dọn object **không còn đường tham chiếu từ gốc**. Rò rỉ = còn đường tham chiếu ngoài ý muốn. Công cụ trả lời "ai đang giữ?" là **retainers** trong heap snapshot (file 3).
- Sáu nguồn kinh điển trong backend: cache/Map/Set không giới hạn; listener không gỡ; closure giữ biến lớn; timer/interval không clear; biến toàn cục/module scope tích luỹ; bộ đệm theo request (hàng đợi, buffer log) không xả.
- Phát hiện rò rỉ cần **số đo ổn định**: ép GC rồi đọc `heapUsed` tại nhiều thời điểm, cùng khối lượng việc. Heap tăng ngay sau tải chưa phải bằng chứng.
- Sửa rò rỉ thường là **đặt giới hạn hoặc vòng đời** (LRU, TTL, `off`, `clearInterval`, `AbortSignal`), không phải "gọi GC".
- `WeakMap`/`WeakSet`/`WeakRef` cho phép gắn dữ liệu vào object mà không giữ nó sống; hợp cho metadata theo object, **không** thay thế cache có chính sách đuổi.

## Lý thuyết chi tiết

**Thí nghiệm có kiểm soát: một registry và một listener.** Hai hàm xử lý "job"; hàm đầu rò rỉ theo hai kiểu cùng lúc, hàm sau thì dọn sạch. Chạy với `node --expose-gc` để `gc()` có sẵn và đọc `heapUsed` sau mỗi lần ép GC:

```ts
import { EventEmitter } from "node:events";

declare const gc: () => void;               // chỉ có khi chạy với --expose-gc
const mb = () => { gc(); return process.memoryUsage().heapUsed / 1024 / 1024; };

const bus = new EventEmitter();
bus.setMaxListeners(0);                     // tắt cảnh báo để thấy rò rỉ thật (đừng làm vậy ở production)

type Job = { id: number; payload: Buffer };
const registry = new Map<number, Job>();    // biến sống mãi ở module scope

function handleLeaky(id: number) {
  const job: Job = { id, payload: Buffer.alloc(1024) };
  registry.set(id, job);                    // (1) Map không bao giờ xoá
  bus.on("shutdown", () => job.id);         // (2) listener giữ closure -> job, không gỡ
}
function handleClean(id: number) {
  const job: Job = { id, payload: Buffer.alloc(1024) };
  const onShutdown = () => job.id;
  bus.once("shutdown", onShutdown);
  bus.off("shutdown", onShutdown);          // gỡ khi xong việc
}

for (const [name, fn] of [["leaky", handleLeaky], ["clean", handleClean]] as const) {
  const before = mb();
  for (let i = 0; i < 50_000; i++) fn(i);
  const after = mb();
  console.log(name.padEnd(6), "heapUsed sau gc:", before.toFixed(1), "->", after.toFixed(1), "MB; listeners:", bus.listenerCount("shutdown"));
  registry.clear(); bus.removeAllListeners("shutdown");
}
```

Kết quả thật (Node 24.21):

```text
leaky  heapUsed sau gc: 7.7 -> 25.9 MB; listeners: 50000
clean  heapUsed sau gc: 7.9 -> 7.9 MB; listeners: 0
```

Mức tăng khoảng 18 MB cho 50.000 job (cỡ 370 byte mỗi job) chỉ là phần nằm trên heap: object `Job`, closure, entry của `Map`. Vùng nhớ 1 KB thật của mỗi `Buffer` nằm ngoài heap (tăng `external`, không thấy ở `heapUsed`), nên rò rỉ thật còn lớn hơn con số này. Ví dụ chủ yếu cho thấy phương pháp "ép GC, so trước/sau, kèm một bộ đếm sức khoẻ (`listenerCount`)". Bộ đếm như `listenerCount`, `map.size`, `server.getConnections` thường chỉ ra rò rỉ nhanh hơn heap snapshot.

**Cảnh báo có sẵn: `MaxListenersExceededWarning`.** Thêm hơn 10 listener cho cùng một sự kiện của một `EventEmitter` thì Node in cảnh báo (đã thử, 11 listener):

```text
(node:37753) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 x listeners added to [EventEmitter]. MaxListeners is 10. Use emitter.setMaxListeners() to increase limit
(Use `node --trace-warnings ...` to show where the warning was created)
```

Đừng bịt cảnh báo bằng `setMaxListeners(0)` trước khi hiểu vì sao có nhiều listener. `--trace-warnings` in stack chỉ ra dòng thêm listener thứ 11.

**Closure giữ nhiều hơn bạn nghĩ.** V8 gom các biến được *bất kỳ* closure nào trong cùng scope tham chiếu vào **một context chung**. Closure không dùng biến lớn vẫn giữ nó sống, miễn là một closure anh em có dùng. Đã đo:

```ts
function makeHandlers() {
  const report = new Array<string>(200_000).fill("dòng báo cáo");   // ~1.6MB mỗi lần gọi
  const size = () => report.length;          // closure 1 dùng report
  const noop = () => "không dùng gì cả";     // closure 2 KHÔNG dùng report
  return { size, noop };
}
const kept = Array.from({ length: 100 }, () => makeHandlers().noop);   // chỉ giữ noop
console.log(kept.length);
```

```text
giữ 100 closure noop: 160 MB
sau khi bỏ chúng:       0 MB
```

Mỗi `noop` kéo theo context chứa `report`. Nếu `noop` được đăng ký làm callback dài hạn (listener, timer), 1,6 MB mỗi lần gọi bị giữ lại. Cách tránh: tách phần giữ dữ liệu lớn ra hàm riêng để scope không chung, hoặc gán `report = undefined` khi xong, hoặc tách callback ra hàm cấp module chỉ nhận đúng dữ liệu cần.

**Timer.** `setInterval` giữ callback (và mọi thứ callback tham chiếu) cho đến khi `clearInterval`. Một interval tạo **trong request** (ví dụ polling trạng thái) mà không clear khi request kết thúc là rò rỉ cổ điển. Interval cũng giữ **event loop sống** nên tiến trình không tự thoát: `timer.unref()` (đã thử: `hasRef()` từ `true` thành `false`) cho phép tiến trình thoát dù timer còn chạy, hữu ích với job nền kiểu metrics, nhưng không giải phóng bộ nhớ của callback.

**Cache/Map/Set tăng mãi.** Dạng phổ biến nhất ở backend: memoize theo input người dùng (khoá là email, URL, id), rate limiter lưu theo IP không bao giờ xoá, dedupe set. Khoá do bên ngoài kiểm soát = kẻ tấn công cũng kiểm soát được kích thước bộ nhớ. Bất kỳ cấu trúc tích luỹ nào cũng cần **ba thứ**: giới hạn kích thước, chính sách đuổi (LRU/TTL), và một số đo hiển thị (`size`) trong metrics.

**Biến toàn cục / module scope.** Module ESM/CJS được cache vĩnh viễn, nên mọi thứ khai báo ở top-level là "rễ" sống suốt đời tiến trình. Trong snapshot, chuỗi giữ thường kết thúc ở `(GC roots)` -> context của module (`context:seen` trong ví dụ file 3). Với Laravel/PHP, bạn quen "static property chỉ sống trong một request"; ở Node, nó sống qua **mọi** request.

**`WeakMap`/`WeakRef`.** Khoá của `WeakMap` không ngăn GC: khi object khoá không còn tham chiếu nào khác, entry tự biến mất. Dùng để gắn dữ liệu phụ vào object (ví dụ thông tin theo `req`). Hạn chế: không duyệt được, không có `size`, và thời điểm entry biến mất do GC quyết định, nên không dùng làm cache theo giá trị khoá kiểu chuỗi (chuỗi không phải khoá hợp lệ của `WeakMap`).

## Tricks & tips thực tế

- **Quy trình đo chuẩn:** làm nóng (vài trăm request) -> `gc()` -> ghi `heapUsed` -> chạy N request cùng loại -> `gc()` -> ghi lại -> lặp ít nhất 3 vòng. Chỉ khi `heapUsed` sau-GC tăng **đều qua các vòng** mới đáng nghi. Lý do: một vòng đơn lẻ lẫn cache lười, JIT, pool; ba vòng đều tăng mới là xu hướng.
- **Thêm số đo vào endpoint nội bộ/health:** `map.size`, `emitter.listenerCount(...)`, số timer tự quản lý, độ dài hàng đợi. Rò rỉ logic thường lộ ra ở đó trước khi memory đủ lớn để thấy.
- **Mọi `on` đi kèm một `off`, hoặc dùng `once`, hoặc `AbortSignal`:** `events.once(emitter, "x", { signal })` và `addEventListener(..., { signal })` tự gỡ khi abort. Lý do: vòng đời của listener phải gắn với vòng đời của việc, không phải của emitter.
- **Giới hạn mọi cache theo thiết kế**, kể cả cache "tạm": `Map` kèm `maxSize` và đuổi phần tử cũ nhất (một `Map` giữ thứ tự chèn, nên khoá đầu tiên là cũ nhất, đủ để cài một FIFO/LRU nhỏ) hoặc TTL. Cache không giới hạn là rò rỉ có kế hoạch.
- **Khoá của cache/Map không được lấy thẳng từ input chưa kiểm soát** (header, query, IP không chuẩn hoá). Chuẩn hoá và giới hạn độ dài, nếu không kẻ tấn công tăng bộ nhớ theo ý muốn.
- **Đặt tên class/hàm rõ ràng** cho object lưu lâu: trong snapshot, "(object)" hay "Object" không giúp được gì, còn `Session`, `RateBucket` thì tìm được ngay (file 3 cho thấy snapshot đếm theo tên constructor).
- **Đừng bịt `MaxListenersExceededWarning` rồi quên:** cảnh báo đó là phát hiện rò rỉ miễn phí. Chỉ nâng giới hạn khi bạn biết đây là số listener hợp lệ (ví dụ nhiều socket cùng chờ một sự kiện) và có chặn trên.
- **Không đo bằng một lần chạy ngắn trên máy dev rồi kết luận "không rò".** Rò rỉ theo khoá (mỗi user mới một entry) cần dữ liệu đa dạng; chạy tải với dữ liệu giống production.
- **Debug nhanh khi nghi closure giữ dữ liệu:** trong snapshot, tìm object lớn, đọc chuỗi retainer; nếu thấy `context` / `system / Context` giữa chuỗi, đó là biến bị closure bắt. Hãy xem phạm vi (scope) quanh dòng tạo closure.

## Liên hệ bài tập

Lab yêu cầu tìm một rò rỉ bằng heap snapshot và/hoặc `--inspect`. Trước khi dùng công cụ nặng, hãy thử phương pháp ở file này: ép GC, ghi `heapUsed` qua vài vòng, thêm các bộ đếm để thu hẹp nghi phạm. Sau đó ghi lại nghi phạm của bạn **trước** khi mở snapshot, rồi đối chiếu: snapshot xác nhận hay bác bỏ giả thuyết?

## Đọc thêm

- [Node.js: Understanding and Tuning Memory](https://nodejs.org/en/learn/diagnostics/memory/understanding-and-tuning-memory)
- [Node.js: `events` (`setMaxListeners`, `events.once` với `signal`)](https://nodejs.org/api/events.html)
- [Chrome DevTools: Memory problems](https://developer.chrome.com/docs/devtools/memory-problems)

## Ghi chú của bạn
