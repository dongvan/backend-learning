# 5. `AbortSignal`, `promisify`, `events.once` và stack trace async

Promise không có cơ chế huỷ; Node/Web dùng `AbortSignal` để báo "dừng việc này", `util.promisify` và `events.once` đưa API callback/sự kiện vào thế giới Promise, và stack trace async có những lỗ hổng bạn cần biết.

```ts
import { setTimeout as sleep } from "node:timers/promises";

try {
  await sleep(1000, undefined, { signal: AbortSignal.timeout(50) });
} catch (e) {
  console.log((e as Error).name, "| cause:", ((e as Error).cause as Error).name);
  // Node 24.21: AbortError | cause: TimeoutError
}
```

## Ý chính

- `AbortController` tạo `signal`; gọi `controller.abort(reason?)` thì `signal.aborted` thành `true`, bắn sự kiện `abort`, và các API nhận `signal` (fetch, `timers/promises`, `fs/promises`, `events.once`, `http`...) dừng và reject.
- `AbortSignal.timeout(ms)` tạo signal tự abort sau `ms` với lý do là `TimeoutError` (DOMException); `AbortSignal.any([...])` gộp nhiều signal.
- Huỷ là **hợp tác**: chỉ có tác dụng với code **chủ động kiểm tra** `signal`. Một promise thuần tự bạn viết không tự dừng.
- `util.promisify(fn)` biến hàm kiểu callback `(…args, (err, value) => void)` thành hàm trả Promise; **chỉ đúng** với quy ước error-first.
- `events.once(emitter, "name")` trả promise fulfill với **mảng đối số** của sự kiện; reject nếu emitter phát `'error'` trước.
- Stack trace async của V8 theo vết các `await`, nhưng **mất** qua `.then` chain thuần và qua `return promise` không `await`.

## Lý thuyết chi tiết

**AbortController/AbortSignal: số đo thật (Node 24.21).**

```ts
// 1) timeout
await sleep(1000, undefined, { signal: AbortSignal.timeout(50) });
// -> AbortError, code 'ABORT_ERR', "The operation was aborted", ~53 ms; .cause là TimeoutError

// 2) abort thủ công kèm lý do
const ac = new AbortController();
setTimeout(() => ac.abort(new Error("client ngắt")), 20);
await sleep(1000, undefined, { signal: ac.signal });
// -> AbortError; e.cause = Error "client ngắt"; ac.signal.reason = Error "client ngắt"

// 3) signal đã abort từ trước: API reject ngay
await sleep(10, undefined, { signal: ac.signal }); // AbortError

// 4) lý do mặc định của AbortSignal.timeout
// signal.reason.name === "TimeoutError", message "The operation was aborted due to timeout"
```

Điểm quan trọng: với `timers/promises`, lỗi bạn nhận là `AbortError` còn lý do gốc nằm ở `error.cause`; còn với `fetch`, lỗi ném ra thẳng là `TimeoutError` (đã thử: `fetch` tới server không bao giờ trả lời với `AbortSignal.timeout(100)` cho `TimeoutError - The operation was aborted due to timeout`). Vì vậy khi bắt lỗi do huỷ, đừng so sánh một tên duy nhất; kiểm tra `signal.aborted` / `signal.reason` hoặc cả `AbortError` lẫn `TimeoutError`.

Khác: `signal.throwIfAborted()` ném `signal.reason` ngay nếu đã abort (đã thử: ném chính `Error: client ngắt`). Gọi `abort()` lần hai không có tác dụng, sự kiện `abort` chỉ bắn một lần (đã thử với `{ once: true }`). `AbortSignal.any([timeoutSignal, userSignal])` abort khi bất kỳ signal nào abort (theo tài liệu cần Node 20.3+; đã chạy được trên 24.21).

**Cách tác vụ tự viết hợp tác với signal.** Tác vụ nhận `signal` thì phải (a) kiểm tra `signal.aborted`/`throwIfAborted()` giữa các bước; (b) lắng nghe `abort` để dừng việc đang chạy (đóng socket, huỷ truy vấn); (c) truyền `signal` xuống các API bên dưới. Nếu không, `abort()` không làm gì với tác vụ đó, giống `Promise.race` timeout: chỉ làm người gọi bỏ đi, việc nền vẫn chạy (file 03).

**`util.promisify`.** Chuyển hàm theo quy ước Node `(…args, cb(err, value))`:

```ts
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";

const rb = await promisify(randomBytes)(8); // Buffer 8 byte
```

Chỉ lấy **một** giá trị thành công (đối số thứ hai của callback); API gọi callback nhiều giá trị thì phải có `promisify.custom`. Thử với hàm không theo quy ước error-first:

```ts
function legacy(cb: (ok: boolean) => void) { setTimeout(() => cb(true), 1); }
// promisify(legacy) reject với true: đối số đầu bị hiểu là err
```

Đã thử: promise reject với giá trị `true`. Lý do: `promisify` luôn coi tham số đầu là lỗi nếu truthy. Giải pháp: tự bọc bằng `new Promise` hoặc gắn `legacy[promisify.custom] = ...`. Một số hàm đã có `promisify.custom` sẵn (ví dụ `fs.exists`, `setTimeout`: đã thấy `exists custom: function`). Với module `fs`, `dns`, `stream`… Node đã có bản promise sẵn (`node:fs/promises`, `node:timers/promises`, `node:stream/promises`): **ưu tiên dùng chúng** thay vì tự `promisify`.

`util.callbackify` làm ngược lại; lưu ý hàm async reject với giá trị falsy (`null`) bị bọc thành `Error` có `code === "ERR_FALSY_VALUE_REJECTION"` (đã thử).

**`events.once` và `events.on`.**

```ts
import { once, EventEmitter } from "node:events";
const ee = new EventEmitter();
setTimeout(() => ee.emit("ready", 1, "two"), 10);
console.log(await once(ee, "ready")); // [ 1, 'two' ]  (mảng đối số)
```

Hành vi đã thử (Node 24.21):

- Nếu emitter phát `'error'` trong lúc chờ thì `once` **reject** với lỗi đó (`reject: hỏng`).
- Sự kiện **phát trước** khi gọi `once` thì mất: `await once(ee, "ready")` sau `ee.emit("ready")` treo mãi (đã thử với `race` thêm timer 30ms để thoát). Đây là điều kiện chạy đua kinh điển: gắn listener (gọi `once`) **trước** khi kích hoạt thao tác sẽ phát sự kiện.
- Hỗ trợ `{ signal }`: huỷ thì reject `AbortError` (đã thử).
- Ví dụ thực tế: `server.listen(0); await once(server, "listening")` để biết cổng đã sẵn sàng.
- `events.on(emitter, "tick")` trả async iterator: `for await (const [v] of on(em, "tick"))` nhận từng sự kiện (đã thử, nhận 1, 2, 3). Nhớ `break`/signal để kết thúc, nếu không vòng lặp chờ mãi.

**Stack trace async.** V8 theo vết "async stack trace" qua `await`. Đã thử một chuỗi `controller → service → repo` bằng `await`, lỗi ném ở `repo`:

```
Error: db down
    at repo (c1.ts:2:47)
    at async service (c1.ts:3:28)
    at async controller (c1.ts:4:31)
    at async c1.ts:5:7
```

Đầy đủ khung gọi. Ba tình huống khác (cùng lần chạy):

| Tình huống | Stack có gì |
|---|---|
| Chuỗi `.then` thuần (`repoP().then(x => x)`) | chỉ `at c1.ts:7:55` và `at async c1.ts:9:7`: **mất** khung `repoP`/`serviceP` |
| `readFile` callback (lỗi hệ thống) | chỉ có message `ENOENT...`, **không có stack** tới code của bạn |
| `async function f() { return g(); }` (không await) và `g` reject | stack **thiếu khung `f`** (đã thử: chỉ thấy `readFile`, `loadNoAwait`/`wrapper` biến mất) |

Hệ quả: `return await` (trong hàm async) và dùng `await` thay vì `.then` giúp lỗi truy được nguồn. V8 chỉ theo vết async qua `await`; đó là lý do `return await` đôi khi đáng giá dù thừa về chức năng.

## Tricks & tips thực tế

- **Mọi thao tác ra ngoài (HTTP, DB) nên nhận `AbortSignal`** và đặt timeout bằng `AbortSignal.timeout(ms)`. Lý do: không timeout thì một dependency treo kéo cả request và đẩy connection pool tới cạn; và `Promise.race` timeout không dừng tác vụ thật.
- **Đừng tự dựng timeout bằng `race` + `setTimeout` khi có `AbortSignal.timeout`**: ít code hơn, không bỏ sót `clearTimeout`, và quan trọng nhất là thao tác nền thật sự bị huỷ nếu API hỗ trợ signal. (Nhưng bài lab yêu cầu tự viết `withTimeout`: ở đó hãy tự nghĩ tới việc dọn timer.)
- **Truyền `signal` xuống cho các tầng dưới thay vì tạo signal mới ở mỗi tầng**; dùng `AbortSignal.any` để gộp "client ngắt kết nối" với "hết thời gian". Lý do: một lần huỷ lan hết cây tác vụ.
- **Nhận biết lỗi do huỷ để không retry nhầm hay log như lỗi nghiêm trọng**: kiểm tra `signal.aborted` hoặc `error.name === "AbortError" | "TimeoutError"`. Lý do: tên lỗi khác nhau theo API (đã thấy ở trên), và retry sau khi bị huỷ là sai.
- **Gỡ listener `abort` khi xong** nếu bạn tự `addEventListener("abort", ...)` trên signal sống lâu (dùng `{ once: true }` hoặc `removeEventListener`). Lý do: signal giữ tham chiếu tới listener, gây rò rỉ (Node có thể cảnh báo `MaxListenersExceededWarning` khi quá nhiều, kiến thức từ tài liệu, chưa thử).
- **Ưu tiên API `*/promises` có sẵn** hơn `promisify`: tránh lỗi sai quy ước callback, có `signal`, có kiểu TypeScript đúng.
- **Dùng `once` với `signal`/timeout khi chờ sự kiện bên ngoài** (kết nối, `listening`, `ready`). Lý do: chờ vô hạn nếu sự kiện không bao giờ đến.
- **Tránh race "phát trước khi lắng nghe"**: tạo promise từ `once(...)` **trước**, rồi gọi thao tác kích hoạt, rồi mới `await`. Ví dụ: `const ready = once(server, "listening"); server.listen(0); await ready;`.
- **Debug stack bị cụt**: đặt `await` thay cho `.then`; `return await` trong hàm async; bọc lỗi với `{ cause }` (ES2022) để giữ lỗi gốc khi ném lại. Có thể dùng `node --stack-trace-limit=50` nếu stack bị cắt ở độ sâu mặc định (10 khung). Cờ này là kiến thức từ V8/Node docs, chưa thử ở đây.
- **Với PHP/Laravel**: các tùy chọn `timeout`/`connect_timeout` của Guzzle (hoặc `Http::timeout()`) tương ứng việc bạn đặt `AbortSignal.timeout` cho `fetch`. Hãy luôn đặt timeout tường minh thay vì dựa vào mặc định của thư viện (mặc định của `fetch`/undici là kiến thức từ tài liệu, chưa đo ở đây).

## Liên hệ bài tập

`withTimeout` là bài chạm mọi thứ ở đây: kết quả cần phân biệt "hết giờ" với "lỗi thật", và việc dọn dẹp (timer, tác vụ nền) có thể làm đúng hoặc sai. Gợi ý: so sánh giải pháp của bạn với `AbortSignal.timeout` trên hai tiêu chí: tác vụ nền có thực sự dừng không, và `process` có thoát đúng giờ không. `retry` có backoff nên đo bằng `signal` để người gọi có thể ngắt chuỗi thử lại giữa chừng.

## Đọc thêm

- [Node.js: `AbortController`](https://nodejs.org/api/globals.html#class-abortcontroller)
- [MDN: AbortSignal (timeout, any, throwIfAborted)](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal)
- [Node.js: `util.promisify`](https://nodejs.org/api/util.html#utilpromisifyoriginal)
- [Node.js: `events.once` và `events.on`](https://nodejs.org/api/events.html#eventsonceemitter-name-options)
- [Node.js: Timers Promises API](https://nodejs.org/api/timers.html#timers-promises-api)

## Ghi chú của bạn
