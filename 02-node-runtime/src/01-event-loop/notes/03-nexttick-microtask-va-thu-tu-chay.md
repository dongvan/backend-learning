# 3. `process.nextTick`, microtask và thứ tự chạy thực tế

`process.nextTick` và microtask (Promise, `queueMicrotask`) đều chạy **ngay sau khi callback hiện tại kết thúc**, trước khi event loop sang phase tiếp theo; nhưng chúng ở hai hàng đợi khác nhau và có ưu tiên khác nhau.

```ts
import { readFile } from "node:fs";

readFile(import.meta.filename, () => {
  Promise.resolve().then(() => console.log("promise"));
  process.nextTick(() => console.log("tick"));
});
// Node 24.21: tick, promise
```

## Ý chính

- Có hai hàng đợi chạy "giữa các callback": **nextTick queue** và **microtask queue** (V8). Mỗi lần xả, Node xả **toàn bộ nextTick queue trước**, rồi **toàn bộ microtask queue**, và lặp lại cho tới khi cả hai rỗng.
- Quy tắc trên đúng khi Node vừa chạy xong một callback ở phase nào đó (timers, I/O, immediate) và với script CommonJS. Với **ESM, main module tự chạy trong một microtask**, nên thứ tự **đảo**: Promise trước `nextTick` (xem bên dưới).
- Từ Node 11 trở đi, microtask và nextTick được xả **giữa từng callback**, kể cả giữa hai timer cùng đến hạn (trước đó chỉ xả sau cả phase).
- `async/await` và `.then` đều là microtask. `await x` tiếp tục thân hàm trong một microtask.
- `process.nextTick` là cơ chế riêng của Node, không có trong trình duyệt, và Node khuyến nghị dùng `queueMicrotask` hoặc `setImmediate` trong code mới.
- `setImmediate` KHÔNG phải loại "tick": nó chờ tới phase check của event loop.

## Lý thuyết chi tiết

**Thứ tự xả.** Giả sử callback hiện tại vừa xong. Node làm:

1. Xả nextTick queue đến khi rỗng (kể cả tick mới thêm trong lúc xả).
2. Xả microtask queue đến khi rỗng (kể cả microtask mới thêm trong lúc xả).
3. Nếu bước 2 lại thêm nextTick, quay lại bước 1. Lặp đến khi cả hai rỗng.
4. Mới tiếp tục callback kế hoặc phase kế.

**Thí nghiệm A: CommonJS vs ESM ở main module.** Cùng một nội dung, hai kiểu module (Node 24.21):

```ts
console.log("sync-1");
process.nextTick(() => console.log("tick"));
Promise.resolve().then(() => console.log("promise"));
queueMicrotask(() => console.log("qm"));
console.log("sync-2");
```

| Kiểu module | Output |
|---|---|
| CommonJS (`.cts`) | `sync-1 sync-2 tick promise qm` |
| ESM (`"type": "module"`) | `sync-1 sync-2 promise qm tick` |

Với ESM, mã module được đánh giá bên trong một microtask (module loader chạy bất đồng bộ), nên khi code của bạn chạy xong thì Node **đang ở giữa việc xả microtask queue**, và microtask queue được xả hết trước khi nextTick queue được nhìn tới. Với CJS, code chạy trực tiếp ngoài microtask, nên nextTick đi trước. **Đây là điểm mà nhiều bài viết "nextTick luôn trước Promise" sai khi áp vào file ESM/TypeScript hiện đại.** Quy tắc "nextTick trước Promise" đúng cho code chạy trong callback của event loop (như ví dụ `readFile` ở đầu file) và cho CJS.

**Thí nghiệm B: lồng nhau.** Trong một callback I/O (Node 24.21):

```ts
// bên trong readFile callback
Promise.resolve().then(() => {
  console.log("P1");
  process.nextTick(() => console.log("tick-from-P1"));
}).then(() => console.log("P2"));
process.nextTick(() => console.log("T1"));
// Output: T1 P1 P2 tick-from-P1
```

Giải thích từng bước: xả tick queue (`T1`); xả microtask (`P1`, trong đó thêm một tick; chuỗi `.then` tiếp theo là `P2` được xếp vào microtask queue và **vẫn nằm cùng lượt xả** nên chạy trước); microtask rỗng, quay lại tick queue (`tick-from-P1`). Nghĩa là **nextTick được thêm từ trong microtask phải đợi microtask queue cạn**.

Còn ở main module ESM, cùng đoạn với thêm `process.nextTick` lồng trong tick (Node 24.21):

```ts
Promise.resolve().then(() => {
  console.log("P1");
  process.nextTick(() => console.log("tick-from-P1"));
}).then(() => console.log("P2"));
process.nextTick(() => {
  console.log("T1");
  Promise.resolve().then(() => console.log("promise-from-T1"));
  process.nextTick(() => console.log("T2-from-T1"));
});
// ESM: P1 P2 T1 tick-from-P1 T2-from-T1 promise-from-T1
// CJS: T1 T2-from-T1 P1 promise-from-T1 P2 tick-from-P1
```

Hai kết quả khác nhau đều tuân theo cùng một quy tắc "xả tick queue cạn rồi mới xả microtask cạn"; chỉ khác **điểm bắt đầu**. Cách tự kiểm: tự tay vẽ hai hàng đợi và mô phỏng từng bước, rồi so với output thật.

**Thí nghiệm C: giữa các timer và immediate.**

```ts
setTimeout(() => { console.log("t1"); Promise.resolve().then(() => console.log("p-in-t1")); process.nextTick(() => console.log("tick-in-t1")); }, 0);
setTimeout(() => console.log("t2"), 0);
setImmediate(() => { console.log("i1"); Promise.resolve().then(() => console.log("p-in-i1")); });
setImmediate(() => console.log("i2"));
// Một lần chạy (ESM, main module): i1 p-in-i1 i2 t1 tick-in-t1 p-in-t1 t2
```

Hai điểm: microtask/tick của `t1` chạy **trước** `t2` (xả giữa hai timer cùng phase, hành vi Node >= 11), và tick (`tick-in-t1`) trước promise (`p-in-t1`) vì ở trong callback của event loop. Dòng đầu `i1` đứng trước `t1` là do tính không xác định của timeout/immediate ở main module (file 02), không phải quy tắc.

**Số microtask hop của `await` và `resolve(promise)`.**

```ts
const log: string[] = [];
const inner = Promise.resolve("in");
new Promise((res) => res(inner)).then(() => log.push("A: resolve(promise)"));
new Promise((res) => res("v")).then(() => log.push("B: resolve(value)"));
Promise.resolve().then(() => log.push("c1")).then(() => log.push("c2")).then(() => log.push("c3")).then(() => log.push("c4"));
// sau khi chờ xong: B | c1 | c2 | A | c3 | c4
```

`resolve(promise)` tốn thêm hai lượt microtask (A đến sau c2). Đây là cơ chế "thenable job" của spec. Kết luận thực dụng: **đừng bao giờ dựa vào số lượt microtask**, nhưng khi một câu đố thứ tự "vô lý" xuất hiện, thường là do `resolve(promise)` hoặc `return promise` trong `.then`/async function.

**`await null` cũng nhường một lượt.** `async function a(){ push("a-start"); await null; push("a-after-await") }`; khi gọi `a()` rồi `push("sync-end")` ở ngoài, thứ tự là `a-start > sync-end > a-after-await`. Phần sau `await` luôn bất đồng bộ, kể cả khi giá trị không phải promise. Đây là khác biệt lớn với "hàm đồng bộ" trong PHP, nơi mọi thứ chạy theo dòng.

## Tricks & tips thực tế

- **Dùng `queueMicrotask` hoặc Promise** để hoãn "sau khi hàm hiện tại xong" thay vì `process.nextTick` trong code mới. Lý do: `nextTick` ưu tiên cao hơn cả Promise và dễ gây starvation (file 04); tài liệu Node cũng khuyên dùng `queueMicrotask`.
- **Dùng `process.nextTick` có lý do chính đáng**: lớp EventEmitter/stream cần phát sự kiện `error` hoặc `ready` **sau khi** người gọi kịp `.on(...)`. Nếu phát đồng bộ trong constructor, listener chưa gắn kịp. Đây là lý do chính nextTick tồn tại, bạn sẽ thấy nó trong code stream của Node.
- **Một API chỉ được hoặc luôn đồng bộ, hoặc luôn bất đồng bộ** (tránh "Zalgo"): hàm `get(id, cb)` mà cache hit thì gọi `cb` ngay, cache miss thì gọi sau, khiến thứ tự chạy khó đoán. Sửa bằng `process.nextTick(() => cb(...))` hoặc dùng hàm `async` (luôn trả Promise, luôn bất đồng bộ).
- **Đừng đoán thứ tự trong ESM bằng trí nhớ về CJS**: file `.ts` của repo này sẽ chuyển sang ESM (Bài 8 Phase 01), và main module ESM đảo thứ tự tick/promise. Khi viết ví dụ dự đoán, ghi rõ module nào, hoặc đặt code vào callback I/O/timer để loại bỏ yếu tố này.
- **Debug thứ tự bằng nhãn rõ ràng và chạy thật**: `console.log` có nhãn nguồn (`"P1"`, `"tick-from-P1"`). Đừng suy luận từ trí nhớ khi kết quả quan trọng; `console.log` đồng bộ khi ghi ra terminal/file nên không làm đảo thứ tự.
- **Với PHP**: không có tương đương trực tiếp, vì PHP không có hàng đợi "việc nhỏ chạy ngay sau dòng hiện tại". `register_shutdown_function` và `defer` của Swoole là cái gần nhất về tinh thần, nhưng khác nghĩa.

## Liên hệ bài tập

Lab yêu cầu tự dự đoán rồi chạy kiểm chứng: hãy **ghi dự đoán ra trước khi chạy**, ghi cả kiểu module bạn dùng. Với mỗi dòng sai, viết một câu giải thích theo quy tắc "xả tick cạn, xả microtask cạn, lặp lại" thay vì chép lại output. Thử cùng một đoạn trong CJS (đặt tên `.cts`) và ESM để thấy điểm khởi đầu khác.

## Đọc thêm

- [Node.js: Understanding process.nextTick()](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick#processnexttick)
- [Node.js: `queueMicrotask` (Globals)](https://nodejs.org/api/globals.html#queuemicrotaskcallback)
- [MDN: Using microtasks in JavaScript with queueMicrotask()](https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide)
- [MDN: Using Promises (thứ tự và lỗi)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises)

## Ghi chú của bạn
