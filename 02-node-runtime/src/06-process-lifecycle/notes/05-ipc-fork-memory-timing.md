# 5. IPC với `fork`, đo bộ nhớ/thời gian, và chạy trong WSL/Linux

`child_process.fork()` chạy một file Node khác trong tiến trình riêng, kèm một **kênh IPC** để hai bên gửi message bằng `process.send()` và sự kiện `message`.

```ts
// parent.ts
import { fork } from "node:child_process";

const child = fork(new URL("./worker.ts", import.meta.url));
child.on("message", (m) => { console.log("cha nhận:", m); child.disconnect(); });
child.send({ job: "square", n: 7 });
```

```ts
// worker.ts
process.on("message", (m: { job: string; n: number }) => {
  process.send?.({ job: m.job, result: m.n * m.n });   // process.send chỉ tồn tại khi được fork có IPC
});
```

(Chạy `node parent.ts`; con tự thoát vì sau `disconnect` không còn gì giữ nó sống. Đã kiểm tra mẫu tương tự ở Node 24.21.)

## Ý chính

- `fork` = `spawn` của chính Node + kênh IPC. Mỗi con là **một tiến trình hệ điều hành** với heap V8 và event loop riêng; **không chia sẻ bộ nhớ** với cha.
- Message đi qua kênh bị **tuần tự hoá**. Mặc định `serialization: "json"`: mất `Date`, `Map`, hàm (đã chạy: `Date` thành chuỗi, `Map` thành `{}`, hàm bị lược). `serialization: "advanced"` dùng structured clone (giữ `Date`, `Map`; hàm thì ném lỗi `could not be cloned`; đã chạy).
- Trong con, `process.send` và `process.connected` chỉ có khi nó được fork có kênh IPC; ở tiến trình Node thường chúng là `undefined` (đã chạy). Với TypeScript, `process.send` có kiểu có thể `undefined` nên phải dùng `?.`.
- Có listener `message` trong con thì **kênh IPC giữ con sống**; muốn con thoát, một bên gọi `disconnect()` hoặc con gọi `process.exit`.
- Cha chết thì kênh đóng, con nhận sự kiện `disconnect` (đã chạy, kể cả khi cha bị SIGKILL); con **không** tự thoát: bạn phải xử lý `disconnect` nếu muốn con dừng theo.
- IPC phù hợp tách tiến trình (cô lập lỗi, dùng nhiều lõi CPU, giao việc nền), không phải để chuyền dữ liệu lớn: mỗi message tốn công tuần tự hoá/sao chép.

## Lý thuyết chi tiết

**Kiểu hoá protocol.** Mô hình message bằng discriminated union (như bài 2 của Phase 01), dùng `type` làm khoá phân biệt, và kiểm tra dữ liệu **ở cả hai đầu** vì message đến từ tiến trình khác, không phải bảo đảm của compiler. Một mẫu ngắn:

```ts
type ToChild = { type: "task"; id: number; payload: string } | { type: "stop" };
type ToParent = { type: "done"; id: number; ms: number } | { type: "error"; id: number; message: string };

process.on("message", (m: ToChild) => {
  if (m.type === "stop") { process.disconnect?.(); return; }
  const t0 = process.hrtime.bigint();
  // ... xử lý m.payload ...
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  process.send?.({ type: "done", id: m.id, ms } satisfies ToParent);
});
```

(Đoạn này đủ để gõ kiểu, chưa phải chương trình hoàn chỉnh; `satisfies` cần TS 4.9+.) Ở cha, `child.on("message", (m: ToParent) => ...)`. Ghi nhớ: kiểu chỉ là lời hứa lúc compile, dữ liệu thật phải được kiểm tra (Zod) nếu độ tin cậy quan trọng.

**Kiểm chứng tuần tự hoá (đã chạy, Node 24.21).** Cha gửi `{ type, d: new Date(0), m: new Map([["a",1]]), f() {} }`:

| `serialization` | Con nhận `d` | `m instanceof Map` | `f` |
|---|---|---|---|
| `"json"` (mặc định) | `string` | `false` | không có |
| `"advanced"` | `object` (Date) | `true` | gửi hàm thì lỗi `f(){} could not be cloned`; gán `undefined` thì qua |

Nên coi IPC như HTTP nội bộ: gửi dữ liệu thuần (JSON-able), tránh giả định kiểu giàu.

**Vòng đời kênh IPC (đã chạy).**

- Tiến trình thường (không fork): `typeof process.send` = `undefined`, `process.connected` = `undefined`.
- Một bên `disconnect()` -> cả hai bên phát `disconnect`, `connected` thành `false`; con thoát nếu không còn gì giữ sống.
- Cha bị `SIGKILL` (đã chạy: `kill -9` chính nó sau 300 ms): con nhận `disconnect` ("parent channel closed"), rồi chạy tiếp tới hết timer của nó (1,5 s) và tự thoát. **Con không tự chết theo cha.** Trong production, con nên lắng nghe `disconnect` và tự dọn rồi thoát, nếu không sẽ thành tiến trình mồ côi còn giữ cổng/lock.
- `child.on("exit", (code, signal))` là nơi nhận mã thoát/signal; `child.on("error")` cho lỗi **spawn** (không tìm thấy file, không đủ quyền) hoặc lỗi gửi message.

**`fork` vs `spawn` vs `exec` vs `worker_threads`.** `fork` luôn chạy một script Node, có IPC. `spawn` chạy lệnh bất kỳ, giao tiếp qua stdio. `exec`/`execFile` gom đầu ra vào bộ đệm có giới hạn (`maxBuffer`) rồi trả một lần. `worker_threads` là **luồng** trong cùng tiến trình, có thể chia sẻ bộ nhớ (SharedArrayBuffer) và rẻ hơn, nhưng lỗi nặng (OOM) vẫn kéo cả tiến trình xuống; so sánh chi tiết nằm ở bài Worker Threads và child processes.

**Chạy file `.ts` bằng `fork` (Node 24.21).** Node 24 chạy `.ts` trực tiếp bằng type stripping, nên `fork(new URL("./worker.ts", import.meta.url))` chạy được (đã chạy). Với bản Node cũ hơn hoặc code dùng `enum`/`namespace`/parameter property (không được type stripping hỗ trợ), phải biên dịch trước hoặc dùng `tsx`. Truyền đường dẫn bằng `import.meta.url` thay vì chuỗi tương đối để không phụ thuộc cwd (file 01).

**`process.memoryUsage()` (đã chạy).**

```ts
const mb = (n: number) => (n / 1048576).toFixed(1);
const show = (tag: string) => {
  const m = process.memoryUsage();
  console.log(tag.padEnd(9), `rss=${mb(m.rss)} heapUsed=${mb(m.heapUsed)} heapTotal=${mb(m.heapTotal)} external=${mb(m.external)} arrayBuffers=${mb(m.arrayBuffers)}`);
};
show("start");
const keep: Buffer[] = [];
for (let i = 0; i < 50; i++) keep.push(Buffer.alloc(1024 * 1024, 1));
show("50MB buf");
const objs: object[] = [];
for (let i = 0; i < 500_000; i++) objs.push({ i, s: "x" + i });
show("500k objs");
console.log(keep.length, objs.length);
```

Một lần chạy của tôi:

```
start     rss=61.7 heapUsed=7.9  heapTotal=9.6  external=10.4 arrayBuffers=2.8
50MB buf  rss=113.0 heapUsed=8.3 heapTotal=9.6  external=60.6 arrayBuffers=52.8
500k objs rss=172.2 heapUsed=55.1 heapTotal=73.5 external=57.9 arrayBuffers=50.1
```

(`console.log(keep.length, ...)` ở cuối để giữ `keep` sống: nếu không dùng `keep` sau đó, V8 có thể thu gom nó và `arrayBuffers` tụt về gần 0 ở dòng cuối; tôi đã gặp đúng chuyện đó ở bản thử đầu.) Điều cần nhìn:

- `Buffer` lớn làm tăng `external`/`arrayBuffers` và RSS, **không** làm tăng `heapUsed`: nó nằm ngoài heap V8. Vì vậy `--max-old-space-size` không giới hạn được Buffer (suy từ số đo này).
- Object JS làm tăng `heapUsed`/`heapTotal`.
- `rss` là tổng bộ nhớ vật lý của tiến trình (heap + external + code + stack + native), thường lớn hơn tổng các phần còn lại.
- `process.memoryUsage.rss()` rẻ hơn gọi cả `memoryUsage()`, hợp để lấy mẫu thường xuyên; `process.resourceUsage().maxRSS` (KB trên Linux) cho đỉnh RSS suốt đời tiến trình (đã chạy).

**Đo thời gian.** `process.hrtime.bigint()` trả nanosecond dạng `bigint`, **đồng hồ đơn điệu** (không nhảy khi đổi giờ hệ thống), nên là lựa chọn để đo khoảng thời gian; `Date.now()` có thể nhảy. `performance.now()` (toàn cục) trả mili-giây dạng số thực, cũng đơn điệu và dễ dùng. `process.hrtime()` (dạng mảng `[giây, nano]`) là API cũ. `process.uptime()` là giây từ khi tiến trình bắt đầu. `process.cpuUsage()` cho thời gian CPU user/system (micro giây), phân biệt với thời gian chờ I/O: tiến trình chờ mạng có thời gian "tường" lớn nhưng CPU thấp.

```ts
const t0 = process.hrtime.bigint();
let x = 0;
for (let i = 0; i < 1e7; i++) x += i;                    // công việc cần đo
const ms = Number(process.hrtime.bigint() - t0) / 1e6;    // bigint -> number: an toàn với khoảng thời gian ngắn
console.log(ms > 0, x > 0);                               // lần chạy của tôi: ~19 ms cho vòng lặp này
```

Đo một lần cho số ồn: JIT còn "nóng" lên, GC xen vào. Lặp nhiều lần và lấy trung vị cho kết luận nghiêm túc.

**Chạy trong WSL/Linux.** Môi trường của repo là WSL2 (Linux 6.x). Điều đáng biết:

- Signal, PID, `kill`, `fork`, `unshare` hoạt động như Linux thật (các thí nghiệm ở bài này chạy ở đó). Hành vi signal trên Windows gốc khác, nên chạy trong WSL cho khớp production.
- Làm việc trong filesystem Linux (`/home/...`, `/var/www/...`), **không** ở `/mnt/c/...`: chậm hơn, và `fs.watch`/quyền file khác (kinh nghiệm chung, chưa đo ở đây).
- Mỗi thư mục `/tmp` và `/dev/shm` ở WSL là filesystem khác nhau: `rename` giữa chúng gặp `EXDEV` (đã chạy).
- Đo bộ nhớ: RSS Linux là con số dễ so với production; `ps -o pid,rss,cmd -p <pid>` (KB) cho cái nhìn từ ngoài.
- Lưu ý với signal từ shell: `kill %1`/`wait` trong bash script để lấy mã thoát của job nền; `$!` là PID tiến trình nền gần nhất.

## Tricks & tips thực tế

- **Gõ kiểu hai chiều cho message và validate dữ liệu nhận.** Lý do: IPC là biên giữa hai tiến trình độc lập, dữ liệu có thể sai hoặc từ phiên bản code khác.
- **Con luôn xử lý `disconnect` (và `SIGTERM`) để tự dọn và thoát.** Lý do: cha chết bằng SIGKILL không tự giết con; con thành mồ côi giữ tài nguyên.
- **Cha luôn nghe `exit` và `error` của mỗi con, và giữ danh sách con để `kill()` khi cha tắt.** Lý do: không có ai nhận lỗi spawn/crash thì việc giao đi biến mất im lặng; cha tắt mà quên con thì để lại tiến trình rác.
- **Dùng `serialization: "json"` mặc định và gửi dữ liệu thuần; chỉ dùng `"advanced"` khi thật sự cần `Map`/`Date`/`ArrayBuffer`.** Lý do: dễ debug, giống hợp đồng JSON; và `"advanced"` làm hàm gây lỗi.
- **Đặt giới hạn thời gian cho phản hồi từ con** (timer + `kill`). Lý do: con treo thì cha chờ vô hạn.
- **Đo bằng `hrtime.bigint()` và `process.memoryUsage.rss()`, ghi cả "trước/sau" và lặp lại.** Lý do: một con số đơn lẻ chịu ảnh hưởng của JIT, GC; xu hướng mới đáng tin.
- **Khi RSS tăng mà `heapUsed` phẳng**, nhìn `external`/`arrayBuffers` (Buffer, stream đệm) hoặc bộ nhớ native. **Khi `heapUsed` tăng không ngừng**, nghi rò object (Map/mảng toàn cục, listener không gỡ): chụp heap snapshot (bài memory/profiling). Lý do: hai trường hợp cần công cụ khác nhau.
- **Debug IPC im lặng:** log `child.connected`, `child.killed`, `child.exitCode`, `child.signalCode`; trong con log `process.connected`. Lý do: biết kênh đã đóng hay con đã chết trước khi nghi code logic.
- **Không dùng `fork` để làm việc mà `await` I/O đã đủ** (gọi HTTP, đọc file). Lý do: I/O không chặn event loop; chỉ CPU nặng hoặc cần cô lập lỗi mới đáng một tiến trình riêng (bài CPU-bound).
- **Dựng sẵn "thoát an toàn" trước khi dựng "chạy":** mỗi tiến trình có đường dừng rõ (message `stop`, signal, hạn cuối). Lý do: tiến trình rác khó phát hiện hơn bug logic.

## Liên hệ bài tập

Lab yêu cầu IPC giữa cha và con. Thiết kế trước: các loại message (liệt kê bằng union), ai khởi tạo, ai quyết định dừng, và chuyện gì xảy ra nếu một bên chết bất ngờ (thử `kill -9` mỗi bên, quan sát `exit`/`disconnect` ở bên còn lại). Kiểm tra không còn tiến trình mồ côi sau mỗi lần thử (`ps`). Cũng đo thời gian và RSS của cha và con riêng: tiến trình con có tăng tổng bộ nhớ không?

## Đọc thêm

- [Node.js: `child_process.fork()`](https://nodejs.org/api/child_process.html#child_processforkmodulepath-args-options)
- [Node.js: IPC and `subprocess.send()`](https://nodejs.org/api/child_process.html#subprocesssendmessage-sendhandle-options-callback)
- [Node.js: `process.memoryUsage()`](https://nodejs.org/api/process.html#processmemoryusage)
- [Node.js: `process.hrtime.bigint()`](https://nodejs.org/api/process.html#processhrtimebigint)

## Ghi chú của bạn

