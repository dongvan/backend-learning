# 5. Cạm bẫy và tình huống thực tế với hàm và async

Kiểu của hàm async đúng không có nghĩa là hành vi đúng: phần lớn bug thật nằm ở thứ tự thực thi, lỗi bị nuốt, và tài nguyên bị rò, những thứ `Promise<T>` không mô tả. Mọi ví dụ code trong ghi chú này đã được `tsc` kiểm chứng với cấu hình repo (TS 7.0.2) và các kết quả "chạy thật" đã thử trên Node 24.21.

```ts
import { setTimeout as sleep } from "node:timers/promises";   // cần "types": ["node"]

declare function charge(invoiceId: number): Promise<boolean>;

export async function chargeAll(ids: readonly number[]): Promise<boolean[]> {
  return Promise.all(ids.map((id) => charge(id)));
}
export { sleep };
```

## Ý chính

- JavaScript chạy code của bạn trên **một luồng**, nhưng mỗi `await` là một điểm nhường: giữa hai `await`, code khác (request khác) có thể chạy và sửa trạng thái chung. Đó là nguồn của race condition kiểu "kiểm tra rồi mới trừ".
- `Promise.race` không huỷ promise thua cuộc. Timer hoặc request thua vẫn chạy tiếp và có thể giữ tiến trình sống.
- Một Promise bị reject mà không ai xử lý làm tiến trình Node **thoát với mã 1** (mặc định từ Node 15), khác hẳn PHP nơi lỗi chỉ kết thúc một request.
- Callback kiểu `() => void` chấp nhận hàm async, nên `forEach(async ...)` biên dịch êm nhưng không chờ gì cả.
- Với `Promise.all` trên danh sách lớn, kiểu đúng nhưng tải sai: cần giới hạn đồng thời.
- Compiler bắt được một số lỗi `await` (TS2801, TS1308, TS1309, TS2794), nhưng không bắt Promise bị bỏ rơi hoặc lỗi thứ tự.

## Lý thuyết chi tiết

**1. Race condition giữa hai `await` (đã chạy thật).**

```ts
import { setTimeout as sleep } from "node:timers/promises";

let balance = 100;

export async function withdraw(amount: number): Promise<boolean> {
  if (balance >= amount) {          // kiểm tra
    await sleep(5);                 // I/O: nhường cho request khác
    balance -= amount;              // trừ: dựa trên kết quả kiểm tra đã cũ
    return true;
  }
  return false;
}
// await Promise.all([withdraw(80), withdraw(80)])  -> [ true, true ], balance = -60
```

Cả hai lời gọi cùng thấy `balance >= 80` trước khi bên nào kịp trừ. Compiler không có cách nào biết. Hai hướng sửa:

- Đưa kiểm tra và ghi vào **một thao tác nguyên tử** ở nơi giữ trạng thái thật (DB: `UPDATE accounts SET balance = balance - 80 WHERE id = ? AND balance >= 80` rồi kiểm tra số dòng ảnh hưởng, hoặc transaction + khoá hàng). Đây là cách đúng ở backend, tương đương `DB::transaction` kèm `lockForUpdate()` trong Laravel.
- Với trạng thái trong bộ nhớ của một tiến trình, tuần tự hoá bằng một hàng đợi Promise:

```ts
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(() => undefined, () => undefined);   // lỗi của task không làm kẹt hàng đợi
    return result;
  }
}
```

Dùng `mutex.run(() => withdraw(80))` cho cả hai lời gọi thì kết quả là `[true, false]` và `balance` còn 20 (đã thử). Lưu ý: mutex trong bộ nhớ **không** bảo vệ khi chạy nhiều tiến trình/nhiều instance. Khi scale ngang, chỉ DB (hoặc Redis lock) mới là nguồn sự thật.

**2. `Promise.race` làm timeout: timer thua cuộc làm tiến trình sống lâu.**

```ts
// Phiên bản ngây thơ:
// await Promise.race([work, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000))]);
```

Đã thử: `work` xong ngay nhưng tiến trình chỉ thoát sau ~3 giây, vì timer chưa bị huỷ. Với script/CLI/test, đây là kiểu "chạy xong mà không thoát". Phiên bản dọn dẹp bằng `AbortController` (kiểu hợp lệ trong repo, lib ES2022 + `@types/node`):

```ts
import { setTimeout as sleep } from "node:timers/promises";

export async function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  const ac = new AbortController();
  const timer = sleep(ms, undefined, { signal: ac.signal }).then(() => {
    throw new Error(`timeout after ${ms}ms`);
  });
  try {
    return await Promise.race([p, timer]);
  } finally {
    ac.abort();       // huỷ timer dù p thắng hay thua
  }
}
```

Đã thử: `raceTimeout(Promise.resolve("fast"), 3000)` thoát tức thì, `raceTimeout(sleep(200), 20)` ném `timeout after 20ms`. Lưu ý `timer` bị huỷ sẽ reject với `AbortError`; vì `Promise.race` đã "xong" nên rejection này không gây unhandled (đã chạy không có cảnh báo), nhưng nếu bạn tách timer ra dùng riêng thì phải `.catch`.

Với `fetch` và nhiều API Node, cách chuẩn là truyền một `AbortSignal` để **thật sự dừng** công việc, không chỉ ngừng chờ:

```ts
export async function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  return work(AbortSignal.timeout(ms));   // hết giờ: signal abort, work ném lỗi
}
```

Đã thử `fetch(url, { signal: AbortSignal.timeout(20) })` tới địa chỉ không phản hồi: lỗi có `name === "TimeoutError"`.

**3. Promise bị bỏ rơi làm sập tiến trình (đã chạy thật).**

```text
Promise.reject(new Error("floating"));      // không await, không catch
setTimeout(() => console.log("never printed?"), 50);
-> in stack trace của Error, "Node.js v24.21.0", exit code = 1; dòng log sau KHÔNG được in
```

Nếu đăng ký `process.on("unhandledRejection", handler)` thì tiến trình **không** sập (đã thử: `handler got floating`, rồi `still alive`, exit 0). Đừng coi đó là giải pháp: handler chỉ nên log rồi thoát có kiểm soát, vì trạng thái ứng dụng sau lỗi có thể đã hỏng. So với PHP-FPM: một lỗi chỉ giết một request; trong Node một server phục vụ mọi request, nên lỗi không ai bắt giết tất cả.

Cách "bắn rồi quên" chủ ý và an toàn:

```ts
declare function audit(msg: string): Promise<void>;

export function handler(): string {
  void audit("x").catch((e: unknown) => console.error(e));   // void: ghi rõ là cố ý; catch: không sập
  return "ok";
}
```

`void` báo cho người đọc (và rule lint `no-floating-promises`) rằng việc không chờ là có chủ ý; `.catch` mới là thứ ngăn sập.

**4. `return` trong `try` và `finally` (đã chạy thật).**

```text
async function noAwait()  { try { return Promise.reject(new Error("boom")); } catch { return "caught"; } }
async function withAwait() { try { return await Promise.reject(new Error("boom")); } catch { return "caught"; } }
-> withAwait: "caught";  noAwait: lỗi "boom" thoát ra ngoài, catch không chạy
async function fin() { try { throw new Error("lost"); } finally { return "swallowed"; } }
-> "swallowed"  (lỗi bị nuốt hoàn toàn, không cảnh báo)
```

Hai điều cần nhớ: (a) bỏ `await` sau `return` trong `try` làm `catch`/`finally` không bảo vệ gì; (b) `return` trong `finally` ghi đè cả giá trị lẫn lỗi. Một số rule lint (ví dụ `no-unsafe-finally`) bắt trường hợp (b).

**5. `forEach(async ...)` và `map(parseInt)` (đã chạy thật).**

```text
[1, 2].forEach(async (x) => { await sleep(5); out.push(x); });
console.log(out.length)        -> 0 (ngay lập tức), 2 sau ~20ms
["1","2","3"].map(parseInt)    -> [1, NaN, NaN]
```

Cái đầu: `forEach` không chờ Promise. Cái sau: `map` gọi `parseInt(value, index, array)`, nên `index` thành radix. Cả hai biên dịch sạch vì kiểu đối số khớp (hàm ít tham số hơn/nhiều tham số optional gán được). Quy tắc: truyền hàm "trần" làm callback chỉ khi bạn biết chữ ký đầy đủ của nó; nếu không, viết arrow `(s) => parseInt(s, 10)`.

**6. Tuần tự và song song cho cùng kiểu, khác hẳn thời gian (đã chạy thật).**

```text
for (const ms of [50, 50, 50]) await sleep(ms);           -> ~150ms
await Promise.all([50, 50, 50].map((ms) => sleep(ms)));   -> ~50ms
```

Chọn tuần tự khi các bước phụ thuộc nhau, hoặc khi cần bảo vệ hạ tầng (rate limit, thứ tự ghi). Chọn song song khi độc lập.

**7. `Promise.all` fail-fast nhưng không huỷ (đã chạy thật).** Một promise reject sau 10ms, promise kia (30ms) vẫn chạy xong và có side effect sau khi `all` đã reject. Nếu promise đó là "ghi vào DB", dữ liệu vẫn được ghi trong khi caller đã nhận lỗi. Thiết kế thao tác nhiều bước thành transaction, hoặc dùng `allSettled` rồi tự quyết định.

`Promise.any` ngược lại: chỉ reject khi tất cả reject, bằng `AggregateError` có mảng `errors` (đã thử: `AggregateError`, 2 lỗi, message `All promises were rejected`).

**8. Giới hạn đồng thời bằng worker pool nhỏ.**

```ts
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;                       // đồng bộ giữa kiểm tra và tăng: an toàn trong một luồng
      results[i] = await fn(items[i] as T, i);   // noUncheckedIndexedAccess: items[i] là T | undefined
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
```

Đã thử với 6 phần tử, `limit = 2`: kết quả giữ đúng thứ tự `[2, 4, 6, 8, 10, 12]` và số tác vụ chạy đồng thời tối đa là 2. Chú ý `as T`: nếu `T` chứa `undefined` thì `as T` vẫn đúng, còn nếu bạn viết `items[i]!` thì mất chỉ báo của compiler khi `T` là kiểu nullable. Cũng chú ý nếu `fn` ném lỗi thì `Promise.all` reject ngay, các worker khác vẫn chạy tiếp (xem mục 7).

**9. Retry với backoff, generic giữ kiểu.**

```ts
import { setTimeout as sleep } from "node:timers/promises";

export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { times: number; delayMs: number },
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.times; attempt++) {
    try {
      return await fn(attempt);          // return await: để catch bên dưới thật sự bắt được
    } catch (e) {
      lastError = e;                      // e: unknown
      if (attempt < opts.times) await sleep(opts.delayMs * attempt);
    }
  }
  throw lastError;                        // ném lại lỗi cuối cùng (kiểu unknown vẫn ném được)
}
```

`retry(() => uploadChunk(1), { times: 3, delayMs: 100 })` có kiểu `Promise<{ etag: string }>` (đã thử, `T` suy ra từ callback). Cạm bẫy thiết kế: chỉ retry lỗi **tạm thời** (mạng, 503), không retry lỗi nghiệp vụ (400, hết hàng), và chỉ retry thao tác **idempotent**; nếu không, bạn nhân đôi một lần thanh toán.

**10. Giá trị mặc định tính lại mỗi lần gọi (đã chạy thật).** `function f(a = []) { a.push(1); return a.length; }` gọi hai lần đều trả `1`, vì biểu thức mặc định được đánh giá **mỗi lần gọi**. Khác Python (mặc định tính một lần). PHP chỉ cho mặc định là biểu thức hằng (và `new` từ PHP 8.1), TS/JS cho bất kỳ biểu thức nào, kể cả tham chiếu tham số đứng trước.

**11. `lib` quyết định API nào "tồn tại", `target` không polyfill.**

```text
[3, 1, 2].toSorted()
-> TS2550: Property 'toSorted' does not exist on type 'number[]'. Do you need to change your
   target library? Try changing the 'lib' compiler option to 'es2023' or later.
```

Repo dùng `lib: ["ES2022"]` nên các API ES2023 trở lên (như `toSorted`, `findLast`) bị coi là không tồn tại, dù Node 24 chạy được. Hai hướng: nâng `lib`/`target` lên khớp phiên bản Node bạn triển khai, hoặc dùng `[...arr].sort()`. Nâng `lib` chỉ là lời hứa với compiler rằng runtime có API đó; không có polyfill nào được thêm.

**12. Hàm tạo Promise bằng `new Promise` quên `resolve`/`reject`** làm Promise treo mãi, `await` không bao giờ xong và không có lỗi nào. Bọc API callback bằng `new Promise` thì phải bảo đảm mọi nhánh (kể cả nhánh lỗi) gọi `resolve` hoặc `reject`. Ưu tiên bản Promise có sẵn (`node:timers/promises`, `node:fs/promises`) hoặc `util.promisify`.

## Tricks & tips thực tế

- **Trước khi viết `await` giữa "kiểm tra" và "ghi", hỏi: nếu hai request chạy xen kẽ ở đây thì sao?** Lý do: bug race không bị bắt bởi test đơn luồng và không có lỗi compile; hậu quả là sai số liệu tiền/kho.
- **Dùng `AbortSignal` thay vì chỉ `race` với timer.** Lý do: `race` chỉ ngừng chờ, công việc thua cuộc vẫn chạy và tốn tài nguyên; signal mới dừng được (với API hỗ trợ).
- **Mọi hàm "bắn rồi quên" phải có `.catch` bên trong.** Lý do: một rejection không ai bắt làm sập cả server (exit code 1).
- **Viết helper `retry`/`mapLimit`/`raceTimeout` một lần, dùng chung** và test bằng timer giả của Vitest (`vi.useFakeTimers()`, Bài 11). Lý do: logic thời gian rải rác khắp nơi là nơi bug ẩn.
- **Giữ `catch` nhỏ và có mục đích**: bắt lỗi cụ thể bằng `instanceof` rồi ném lại phần còn lại (`throw e`). Lý do: `catch` nuốt mọi thứ giấu cả lỗi lập trình (TypeError) lẫn lỗi hạ tầng.
- **Khi test kết quả "sai nhưng không báo lỗi", log thứ tự**: đặt `console.log("start A")`/`"end A"` quanh các `await` để thấy xen kẽ. Lý do: bug async thường là bug thứ tự, không phải bug giá trị.
- **Đừng truyền hàm có tham số optional/rest thẳng làm callback** (`parseInt`, `Number` với `map(Number)` thì an toàn vì chỉ nhận một đối số có nghĩa; `parseInt` thì không). Lý do: `map` luôn truyền thêm index và mảng.
- **Đo thời gian bằng `performance.now()`** khi so tuần tự/song song, không đoán. Lý do: con số chứng minh được lợi ích, và cho bạn thấy khi nào giới hạn đồng thời làm chậm hơn mức cần.
- **So với PHP/Laravel**: Laravel Queue (`dispatch`) tách công việc nền ra tiến trình khác có retry/`failed_jobs`; Node làm "nền" trong cùng tiến trình nên bạn phải tự lo retry, timeout, giới hạn đồng thời (hoặc dùng queue thật như BullMQ ở phase sau). `DB::transaction` + `lockForUpdate` là lời giải cho race ở mục 1, bất kể ngôn ngữ.

## Liên hệ bài tập

Các câu dưới đây để bạn tự nghĩ, không có đáp án sẵn trong notes:

- Trong hàm async của bài lab, có chỗ nào giữa hai `await` mà trạng thái dùng chung có thể bị đổi bởi lời gọi khác không? Bạn sẽ chứng minh bằng cách nào (gợi ý: hai lời gọi `Promise.all` với `sleep` ngắn ở giữa)?
- Nếu hàm của bạn có timeout, bạn có đo được tiến trình thoát sau bao lâu khi công việc xong sớm không?
- Nếu callback của bạn được người khác truyền vào hàm async, hàm nhận callback có chờ và bắt lỗi nó không? Kiểu `() => void` hay `() => Promise<void>` mô tả đúng hơn ý định?
- Với `satisfies`/`as const` ở `04-satisfies-as-const.md`: thêm một giá trị vào union thì đoạn code nào lỗi theo, và đoạn nào lẳng lặng không lỗi?

## Đọc thêm

- [Node.js: `unhandledRejection` (process events)](https://nodejs.org/api/process.html#event-unhandledrejection)
- [Node.js: Timers Promises API](https://nodejs.org/api/timers.html#timers-promises-api)
- [MDN: `AbortSignal.timeout()`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static)
- [MDN: Using promises, error handling](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises)
- [TSConfig: `lib`](https://www.typescriptlang.org/tsconfig/#lib)

## Ghi chú của bạn
