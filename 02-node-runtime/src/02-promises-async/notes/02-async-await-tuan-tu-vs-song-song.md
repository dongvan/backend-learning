# 2. `async/await`: cú pháp trên Promise, tuần tự vs song song

`async function` luôn trả về Promise, và `await` tạm dừng hàm đó (không phải thread) cho tới khi promise settled; bản thân `await` không làm gì song song, **song song đến từ việc bạn bắt đầu nhiều thao tác trước khi await chúng**.

```ts
import { setTimeout as sleep } from "node:timers/promises";

const t = performance.now();
const [a, b] = await Promise.all([sleep(100, "a"), sleep(100, "b")]);
console.log(a, b, Math.round(performance.now() - t), "ms"); // ~100 ms, không phải 200
```

## Ý chính

- `async function f()` luôn trả `Promise`; `return x` = resolve với x, `throw e` = reject với e.
- `await p` ≈ `p.then(phần còn lại của hàm)`: phần sau `await` chạy trong một **microtask**, kể cả khi `p` không phải promise (`await 5`, `await null`).
- `await` **chỉ dừng hàm hiện tại**; event loop vẫn chạy các việc khác. Đó chính là bất đồng bộ không chặn.
- Tuần tự vs song song do **thời điểm tạo promise** quyết định: `await` trong `for` thì mỗi lần mới **bắt đầu** thao tác sau khi lần trước xong.
- Dùng `Promise.all(items.map(fn))` để chạy chồng; nhưng cẩn thận không giới hạn đồng thời (xem tips).
- `array.forEach(async ...)` **không** chờ gì cả; `await` không có tác dụng với `forEach`.
- Trong `try/catch`: `return promise` khác `return await promise` (xem dưới).

## Lý thuyết chi tiết

**Mô tả cơ chế.** Trình biên dịch/V8 biến `async function` thành máy trạng thái: mỗi `await` là một điểm dừng, lưu lại các biến cục bộ, rồi đăng ký phần còn lại như callback của promise. Khi promise settled, một microtask chạy tiếp thân hàm. Vì vậy `async/await` **không** thêm tính năng mới cho Promise; nó là cú pháp đọc như code đồng bộ. Hệ quả: mọi quy tắc về microtask ở Bài 1 áp dụng.

Thí nghiệm (Node 24.21):

```ts
const log: string[] = [];
async function a() { log.push("a-start"); await null; log.push("a-after-await"); }
a();
Promise.resolve().then(() => log.push("then-1")).then(() => log.push("then-2"));
log.push("sync-end");
// sau khi chờ: a-start > sync-end > a-after-await > then-1 > then-2
```

Phần trước `await` đầu tiên chạy **đồng bộ** (`a-start` đứng trước `sync-end`). Từ `await` trở đi mới bất đồng bộ.

**Tuần tự hay song song: số đo thật.** Năm cách xử lý 5 id, mỗi lần gọi `sleep(100)` (Node 24.21):

| Cách | Thời gian | Ghi chú |
|---|---|---|
| `for (const id of ids) await fetchUser(id)` | 519 ms | tuần tự |
| `await Promise.all(ids.map(fetchUser))` | 100 ms | song song |
| `ids.forEach(async id => { await fetchUser(id) })` | **0 ms** | không chờ, hàm return trước khi xong; lỗi thành unhandled |
| `reduce` nối `.then` | 503 ms | tuần tự (cách viết cổ điển) |
| `const ps = ids.map(fetchUser); for (const p of ps) await p;` | 101 ms | song song, vì đã tạo hết promise trước |

Dòng cuối rất đáng nhớ: promise bắt đầu chạy **ngay khi được tạo**, không phải khi `await`. `await` chỉ là điểm bạn chờ. Nhưng chú ý bẫy của kiểu này: nếu một promise sau lỗi **sớm** trong khi bạn còn đang `await` promise đứng trước, nó chưa có handler nên thành unhandled rejection. Thí nghiệm:

```ts
const slowOk = sleep(100);
const fastBad = sleep(10).then(() => { throw new Error("fail sớm"); });
try { await slowOk; await fastBad; } catch (e) { console.log("caught", (e as Error).message); }
```

Kết quả thật (Node 24.21): process **sập** với exit 1 vì `fastBad` bị rejected lúc 10ms khi chưa ai gắn handler (bạn mới `await fastBad` lúc 100ms), dù `try/catch` có ở đó. Dùng `Promise.all([slowOk, fastBad])` để gắn handler cho cả hai cùng lúc.

**Khi nào tuần tự là đúng?** Khi bước sau phụ thuộc kết quả bước trước (đọc user rồi đọc đơn của user), khi thứ tự là ngữ nghĩa (áp migration lần lượt), hoặc khi cần giới hạn tải lên hệ thống bên dưới (ví dụ gọi API bên ngoài có rate limit). Khi các bước **độc lập** thì tuần tự chỉ lãng phí thời gian: 5 truy vấn độc lập 100ms mất 500ms thay vì 100ms.

**`return` vs `return await` trong `try`.**

```ts
async function fail(): Promise<string> { throw new Error("fail"); }
async function noAwait() { try { return fail(); } catch { return "đã bắt"; } }
async function withAwait() { try { return await fail(); } catch { return "đã bắt"; } }
// noAwait()  -> reject "fail" (catch KHÔNG chạy)
// withAwait()-> "đã bắt"
```

`return fail()` trả promise ra ngoài khối `try` trước khi nó reject, nên `catch` bị bỏ qua (đã thử). Trong `try/catch/finally` muốn bắt lỗi của promise thì phải `await` nó. Ngoài `try`, `return promise` và `return await promise` có cùng kết quả nhưng khác stack trace (file 05).

**`await` ở top-level.** ESM cho phép `await` ở ngoài hàm (Node 24.21 trong file `.ts` ESM chạy được). Nếu promise bạn await **không bao giờ settle** (ví dụ `Promise.race([])`), Node in `Warning: Detected unsettled top-level await` và thoát với **exit code 13** (đã thử). Hữu ích để nhận biết khi script "tự dừng im lặng".

**TypeScript.** Hàm `async` trả `Promise<T>`; `noImplicitReturns` bắt hàm async quên return ở một số nhánh; kiểu của `await` trên `Promise<T>` là `T`. Hàm không nên trả `Promise<void>` mà bạn quên await: xem lint `no-floating-promises` ở file 04.

## Tricks & tips thực tế

- **Khi các thao tác độc lập, dùng `Promise.all`**; khi cần giới hạn số lượng đồng thời, dùng một hàng đợi/giới hạn (bài lab `mapLimit`). Lý do: `Promise.all(10000 items)` bắn 10000 request cùng lúc, làm cạn pool kết nối DB (thường 10-20) hoặc dính rate limit.
- **Không dùng `forEach` với callback `async`**; dùng `for...of` (tuần tự) hoặc `Promise.all(arr.map(...))` (song song). Lý do: `forEach` bỏ qua giá trị trả về nên không có gì để chờ, lỗi cũng không có nơi để lan tới.
- **Cẩn thận `await` trong vòng lặp lớn**: mỗi `await` là một lượt về event loop (microtask hoặc I/O); với I/O thật thì chính là chi phí chờ, còn với dữ liệu sẵn có (cache) thì tốn microtask mà không nhường cho I/O (Bài 1 file 04).
- **Gắn handler cho mọi promise ngay khi tạo nếu bạn sẽ await sau**: hoặc dùng `Promise.all`/`allSettled`, hoặc `p.catch(() => {})` chủ ý kèm await lại sau. Lý do: bẫy `fastBad` ở trên.
- **Trong `try/catch`, ghi nhớ `return await`** khi bạn muốn bắt lỗi hoặc có `finally` cần chờ thao tác xong (ví dụ giải phóng connection sau khi truy vấn xong). Quên `await` ở đây làm `finally` chạy sớm trước khi truy vấn kết thúc.
- **Đừng `await` bên trong `Promise.all` map một cách thừa**: `Promise.all(ids.map(async (id) => await fetchUser(id)))` hợp lệ nhưng thừa; `ids.map(fetchUser)` đủ. Tuy nhiên hàm `async` bọc thêm là chỗ tốt để thêm xử lý cho từng phần tử.
- **Bắt đầu tác vụ độc lập sớm, await muộn**: `const a = getA(); const b = getB(); const [x, y] = await Promise.all([a, b])`. Lý do: giảm tổng latency; trong Laravel bạn hay chạy các truy vấn lần lượt vì không có lựa chọn, ở Node đây là một tối ưu "miễn phí".
- **Với PHP**: mọi dòng đều tuần tự và chặn; `await` trông giống nhưng không chặn thread. Đừng suy ra "await = sleep".

## Liên hệ bài tập

`mapLimit` trong `EXERCISE.md` chính là vấn đề "song song nhưng có trần". Trước khi viết, tự trả lời: promise nào đang chạy tại thời điểm t? Ai quyết định khi nào bắt đầu promise tiếp theo? Thứ tự kết quả có giữ theo đầu vào không và nếu có thì lưu ở đâu? Thử cả hai thái cực (limit = 1 và limit = số phần tử) để đối chiếu với bảng số đo ở trên (519ms vs 100ms).

## Đọc thêm

- [MDN: async function](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function)
- [MDN: await](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await)
- [Node.js: Modules ESM (top-level await)](https://nodejs.org/api/esm.html#top-level-await)

## Ghi chú của bạn
