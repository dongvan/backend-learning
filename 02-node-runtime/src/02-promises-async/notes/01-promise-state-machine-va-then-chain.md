# 1. Promise: state machine và then-chain

Promise là đối tượng đại diện cho một kết quả sẽ có sau; nó chuyển trạng thái **một lần** (pending → fulfilled hoặc rejected) và mỗi `.then/.catch/.finally` trả về **một promise mới**, nên lỗi lan dọc chuỗi cho tới khi có ai bắt.

```ts
const r = await Promise.resolve(1)
  .then((x) => { if (x > 0) throw new Error("boom"); return x; })
  .then(() => console.log("bị bỏ qua"))
  .catch((e: Error) => `phục hồi sau: ${e.message}`);
console.log(r); // phục hồi sau: boom
```

## Ý chính

- 3 trạng thái: **pending**, **fulfilled** (có value), **rejected** (có reason). Đã settled (fulfilled/rejected) thì **bất biến**; `resolve`/`reject` gọi thêm lần nữa bị bỏ qua.
- `.then(onFulfilled, onRejected)` trả về promise **mới**. Giá trị của promise mới lấy từ giá trị trả về của handler; nếu handler **ném lỗi** thì promise mới bị rejected.
- Lỗi **lan xuống** theo chuỗi, nhảy qua mọi `.then` không có handler lỗi, cho tới `.catch` đầu tiên. Sau `.catch` chuỗi trở lại trạng thái bình thường.
- Handler của `.then` luôn chạy **bất đồng bộ** (microtask), kể cả khi promise đã resolve sẵn.
- Một handler trả về promise khác (thenable) thì promise mới **theo** promise đó (flatten), nhưng tốn thêm microtask.
- `new Promise((resolve, reject) => ...)`: executor chạy **đồng bộ** ngay; chỉ lỗi ném **đồng bộ** trong executor mới thành reject.

## Lý thuyết chi tiết

**State machine.**

```
pending ──resolve(value)──> fulfilled
   └──────reject(reason)──> rejected
```

Một promise "resolved" khác "fulfilled": `resolve(otherPromise)` khóa promise vào `otherPromise` (vẫn pending) cho tới khi `otherPromise` settled. Đây là chi tiết spec hay gây nhầm lẫn thuật ngữ, nhưng hệ quả thực dụng là "resolve bằng promise thì chậm thêm vài microtask".

`util.inspect` hiện trạng thái (Node 24.21 đã thử): `Promise { <pending> }`, `Promise { 1 }`, `Promise { <rejected> Error: r ... }`. Hữu ích khi debug trong REPL hoặc `console.log(promise)`, nhưng **không có API chính thức để đọc trạng thái trong code**; thiết kế đó là có chủ ý, để bạn `await`/`then` thay vì đứng kiểm tra.

**Chuỗi `.then`: giá trị và lỗi.** Thí nghiệm chạy thật (Node 24.21):

```ts
const r = await Promise.resolve(1)
  .then((x) => { console.log("a", x); throw new Error("boom"); })
  .then(() => console.log("bị bỏ qua"))
  .catch((e: Error) => { console.log("catch:", e.message); return "phục hồi"; })
  .then((v) => { console.log("then sau catch:", v); return Promise.resolve(42); })
  .finally(() => { console.log("finally"); return "bị bỏ"; });
console.log("kết quả:", r);
// a 1 / catch: boom / then sau catch: phục hồi / finally / kết quả: 42
```

Ba điều rút ra: (1) `.then` thứ hai không chạy vì có lỗi đang lan; (2) `.catch` **trả về giá trị** nghĩa là lỗi đã được xử lý, chuỗi tiếp tục bình thường với giá trị đó; (3) giá trị trả về của `.finally` bị **bỏ qua** (kết quả vẫn là 42), trừ khi `finally` ném lỗi hoặc trả promise bị reject.

**`then(a, b)` khác `then(a).catch(b)`.**

```ts
await Promise.resolve()
  .then(() => { throw new Error("x"); }, () => console.log("không chạy"))
  .catch((e: Error) => console.log("bắt ở catch sau:", e.message));
```

Handler lỗi `b` trong cặp `then(a, b)` **không** bắt lỗi do `a` ném. Chỉ `then(a).catch(b)` bắt được. Vì thế luôn dùng `.catch` riêng (hoặc `try/catch` với `await`).

**Executor và lỗi bất đồng bộ.**

```ts
await new Promise(() => { throw new Error("in executor"); })
  .catch((e: Error) => console.log("executor:", e.message)); // bắt được (đồng bộ)

process.on("uncaughtException", (e) => console.log("uncaught:", (e as Error).message));
new Promise(() => { setTimeout(() => { throw new Error("trong timer"); }, 0); })
  .catch(() => console.log("không chạy"));
// uncaught: trong timer   (catch KHÔNG bắt được)
```

`throw` trong callback của timer chạy ở một **call stack khác**, sau khi executor đã trả về, nên promise không biết gì; lỗi rơi thành `uncaughtException`. Đây là lý do cần "promisify" API callback thay vì ném lỗi trong callback: phải gọi `reject(err)` thủ công.

**Thứ tự và số microtask.** `resolve(promise)` tốn thêm lượt (file 03 của Bài 1): `new Promise(res => res(inner)).then(A)` chạy sau `.then().then()` hai bước của một chuỗi độc lập (đã thử: `B | c1 | c2 | A | c3 | c4`). Đừng dựa vào số lượt, nhưng hãy biết `return promise` trong một `then`/async function không "miễn phí".

**Anti-pattern: async executor.** (Đã thử, Node 24.21.)

```ts
const p = new Promise<string>(async (resolve) => {
  await Promise.resolve();
  throw new Error("trong async executor"); // lỗi KHÔNG làm p reject
  resolve("x");
});
```

Executor `async` luôn trả promise của chính nó; `new Promise` bỏ qua giá trị trả về đó nên lỗi trở thành **unhandled rejection** (process sập, exit 1 ở Node 24.21) chứ không làm `p` rejected, và nếu bắt thì `p` treo vĩnh viễn. Quy tắc: không bao giờ truyền `async` vào executor; nếu cần await, viết hàm `async` bình thường thay vì `new Promise`.

**Khi nào mới cần `new Promise`?** Chỉ để bọc API **callback/sự kiện** (như `setTimeout`, `EventEmitter`, hoặc API cũ); ngoài ra dùng `async function` hoặc `.then`. Công cụ hiện đại: `Promise.withResolvers()` trả `{ promise, resolve, reject }` (đã thử trên Node 24.21; TypeScript cần `lib` ES2024 trở lên mới có kiểu, ví dụ `"target": "ES2024"`, không thì `tsc` báo `Property 'withResolvers' does not exist`).

## Tricks & tips thực tế

- **Luôn `return` promise trong `.then`** (hoặc dùng `async/await`). Quên `return` làm chuỗi không chờ promise đó và lỗi của nó thành unhandled; đây là lỗi kinh điển khi refactor callback hell thành chain.
- **Kết thúc chuỗi bằng `.catch`** (hoặc `await` trong `try/catch`) ở **một nơi có chủ đích**, ví dụ error middleware. Lý do: một chuỗi không ai bắt cuối cùng sẽ thành unhandled rejection và, mặc định, làm sập process (file 04).
- **Ném `Error`, không ném string/object thường**. Chỉ `Error` có `stack`; reject bằng string cho log "UnhandledPromiseRejection: ... reason: chỉ là string" rất khó truy nguồn (đã thử, Node in `ERR_UNHANDLED_REJECTION` không có stack).
- **Bọc callback API bằng `new Promise` chỉ ở rìa** hệ thống, một lần, rồi dùng `async/await` ở mọi nơi khác. Đặt rìa này trong một module riêng để dễ test.
- **Đừng "kể lể" lỗi rồi nuốt**: `.catch(console.error)` ở giữa chuỗi biến lỗi thành `undefined` ở các bước sau, che bug. Chỉ bắt khi bạn có cách **xử lý thật** (phục hồi, thử lại, dịch lỗi) hoặc ở biên cuối.
- **Dùng `.finally` để dọn dẹp** (đóng kết nối, `clearTimeout`) vì nó chạy cho cả hai nhánh và không đổi kết quả, tương tự `finally` của PHP `try/catch/finally`.
- **Thấy `UnhandledPromiseRejection` thì tìm promise nào không được chờ**: dùng `node --trace-warnings` hoặc handler `process.on("unhandledRejection", (reason, promise) => ...)` để in ra, và nhớ rằng stack có thể đã mất vì chuỗi `.then` (file 05).
- **So với PHP**: PHP thuần không có promise (ReactPHP/Amp mới có); đóng góp thực tế là `try/catch` đồng bộ của bạn không bắt được lỗi trong callback hoặc promise đã bị bỏ rơi. Laravel `Http::pool`/`async` chỉ là chờ nhiều request, khác mô hình.

## Liên hệ bài tập

`retry` và `withTimeout` trong `EXERCISE.md` đều chính là các chuỗi promise có xử lý lỗi: trước khi viết, hãy vẽ trạng thái của từng promise trong ba kịch bản (thành công ngay, lỗi rồi thành công, lỗi mãi). Gợi ý hướng: hỏi "promise này settle ở đâu, ai sở hữu trách nhiệm xử lý lỗi của nó?" cho mỗi promise bạn tạo ra. Và tự kiểm tra: nếu thao tác thua cuộc về sau cũng lỗi thì chuyện gì xảy ra?

## Đọc thêm

- [MDN: Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)
- [MDN: Using Promises](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises)
- [Node.js: Understanding Promises (learn)](https://nodejs.org/en/learn/asynchronous-work/javascript-asynchronous-programming-and-callbacks)

## Ghi chú của bạn
