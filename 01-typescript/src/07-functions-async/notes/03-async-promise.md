# 3. `Promise<T>`, `async/await` và lỗi bất đồng bộ

Hàm `async` luôn trả `Promise<T>`; `await` bóc `Promise<T>` ra `T`. Kiểu của lỗi thì **không** nằm trong `Promise`, và đó là chỗ bạn phải tự thiết kế.

```ts
async function loadUser(id: number): Promise<{ id: number; name: string }> {
  return { id, name: "An" };         // trả giá trị thường, TS tự bọc vào Promise
}

async function main(): Promise<string> {
  const user = await loadUser(1);    // user: { id: number; name: string }
  return user.name;
}
export { main };
```

## Ý chính

- `async function f(): Promise<T>`: trong thân hàm bạn `return` giá trị kiểu `T` (không phải `Promise<T>`). Nếu `return` một Promise thì kết quả không bị bọc hai lớp.
- `Promise<T>` chỉ mô tả giá trị khi **thành công**. Lỗi `reject` là `any` ở runtime và **không có kiểu** trong chữ ký.
- Trong `catch (e)`, với `strict` thì `e` là `unknown` (`useUnknownInCatchVariables`). Phải narrow trước khi dùng.
- `Promise.all` giữ tuple kiểu theo từng phần tử; `Promise.allSettled` trả union `fulfilled | rejected` cần narrow theo `status`.
- Promise "bị bỏ rơi" (gọi hàm async mà không `await`, không `.catch`) là nguồn bug số một: lỗi biến thành unhandled rejection và có thể làm sập tiến trình Node.
- `Awaited<T>` (bài 4) là kiểu bóc Promise đệ quy; TS dùng nó để định kiểu cho `await` và `Promise.all`.

## Lý thuyết chi tiết

**Kiểu trả về của hàm async.** Chú thích `Promise<T>` tường minh là nên, nhất là với hàm export. Nếu bỏ chú thích, TS suy ra `Promise<kiểu của các return>`. Viết `async function f(): T` (không có `Promise`) là lỗi:

```ts
// @ts-expect-error  The return type of an async function must be the global Promise<T> type
async function bad(): number {
  return 1;
}
export { bad };
```

**`await` với giá trị không phải Promise** vẫn hợp lệ (trả lại chính giá trị). Ngược lại quên `await` sẽ để lại kiểu `Promise<T>` và thường báo lỗi kiểu ở chỗ dùng tiếp:

```ts
declare function getCount(): Promise<number>;

async function demo(): Promise<number> {
  const c = getCount();
  // @ts-expect-error  Operator '+' cannot be applied to types 'Promise<number>' and 'number'
  return c + 1;                 // quên await: TS bắt được vì c là Promise<number>
}
export { demo };
```

Cảnh báo: TS bắt được khi bạn *dùng* giá trị. Nó **không** bắt được trường hợp gọi hàm async mà bỏ qua kết quả (fire-and-forget vô tình); chỉ lint (`@typescript-eslint/no-floating-promises`) bắt được.

**`Promise.all` giữ tuple.** Vì lời gọi nhận tuple/mảng, kết quả có kiểu theo từng vị trí:

```ts
declare function getUser(id: number): Promise<{ name: string }>;
declare function getOrders(id: number): Promise<string[]>;

async function dashboard(id: number): Promise<number> {
  const [user, orders] = await Promise.all([getUser(id), getOrders(id)]);
  // user: { name: string }, orders: string[]
  return user.name.length + orders.length;
}
export { dashboard };
```

Với mảng cùng kiểu (`Promise.all(ids.map(getUser))`), kết quả là `{ name: string }[]`. `Promise.all` **reject ngay khi một promise reject** (fail-fast); các promise còn lại vẫn chạy tiếp, chỉ là kết quả bị bỏ đi.

**`Promise.allSettled`** luôn thành công và trả mảng kết quả từng cái. Mỗi phần tử có dạng `PromiseSettledResult<T>`, union có phân biệt bằng `status`:

```ts
declare function sendEmail(to: string): Promise<string>;

async function notifyAll(list: string[]): Promise<{ ok: string[]; failed: string[] }> {
  const results = await Promise.allSettled(list.map(sendEmail));
  const ok: string[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") ok.push(r.value);      // r: PromiseFulfilledResult<string>
    else failed.push(`${list[i] ?? "?"}: ${String(r.reason)}`);   // r.reason: any
  });
  return { ok, failed };
}
export { notifyAll };
```

Lưu ý: `list[i]` có kiểu `string | undefined` do `noUncheckedIndexedAccess`; `r.reason` là `any` (đúng như `reject` không có kiểu).

**`Promise.race` / `Promise.any`**: `race` trả kết quả của promise xong đầu tiên (kể cả reject); `any` trả cái thành công đầu tiên và chỉ reject (bằng `AggregateError`) khi tất cả reject. Kiểu kết quả là union các `T` (tương ứng `Awaited`).

**Lỗi trong async: ba mức thiết kế.**

1. **Ném lỗi, bắt ở ranh giới** (try/catch hoặc middleware). `catch (e)` cho `unknown`:

```ts
class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function toMessage(e: unknown): string {
  if (e instanceof HttpError) return `HTTP ${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

async function safeLoad(run: () => Promise<string>): Promise<string> {
  try {
    return await run();             // phải có await, nếu không try/catch không bắt được
  } catch (e) {                     // e: unknown
    return toMessage(e);
  }
}
export { safeLoad };
```

Chú ý `return await run()` bên trong `try`: nếu viết `return run()` thì Promise được trả ra ngoài trước khi nó reject, nên `catch` không bao giờ chạy cho lỗi bất đồng bộ.

2. **Trả giá trị mô tả thành công/thất bại** (kiểu `Result<T, E>` ở Bài 10). Lỗi trở thành một phần của kiểu, compiler buộc người gọi xử lý. Hợp với lỗi nghiệp vụ dự kiến (hết hàng, sai mật khẩu).
3. **Hybrid**: lỗi nghiệp vụ dùng `Result`, lỗi hạ tầng (mất kết nối DB) ném ra và bắt ở tầng trên cùng.

**`finally` và dọn dẹp.** `finally` chạy cho cả hai nhánh; dùng để đóng kết nối, giải phóng lock. Cẩn thận: `return` trong `finally` ghi đè giá trị trả về và nuốt lỗi.

**Kiểu hàm trả Promise, ở ranh giới callback.**

```ts
type Job = (payload: unknown) => Promise<void>;

async function runAll(jobs: Job[], payload: unknown): Promise<void> {
  for (const job of jobs) {
    await job(payload);             // tuần tự
  }
}
export { runAll };
```

Tuần tự (`for ... await`) và song song (`Promise.all(jobs.map(...))`) cho cùng kiểu kết quả nhưng khác hẳn về hành vi (thứ tự, tải lên DB, fail-fast). Kiểu không cho bạn biết điều đó.

**Top-level await** chỉ dùng được trong module ESM (`module` là `ES2022`/`ESNext`/`NodeNext` và file được Node coi là ESM, tức `package.json` có `"type": "module"` hoặc file `.mts`). Trong CommonJS (hiện trạng repo này) top-level `await` bị báo lỗi. Chi tiết ở Bài 8.

## Tricks & tips thực tế

- **Luôn `await` hoặc `.catch` mọi Promise bạn tạo ra; bật lint `no-floating-promises`.** Lý do: TS không bắt được Promise bỏ rơi, và lỗi trong đó thành `unhandledRejection`, mặc định Node (từ v15) làm sập tiến trình.
- **Trong `try`, dùng `return await`.** Lý do: không có `await`, `catch`/`finally` chạy trước khi Promise kết thúc, nên không bắt được lỗi.
- **Không viết `catch (e: any)`.** Giữ `unknown` rồi narrow bằng `instanceof`. Lý do: bạn có thể bắt phải thứ không phải `Error` (string, object), `e.message` sẽ là `undefined` ở runtime mà compiler không biết.
- **Hàm bọc narrow lỗi dùng chung** như `toMessage` ở trên, đặt một chỗ. Lý do: tránh lặp `instanceof` rải rác, đảm bảo log thống nhất.
- **Dùng `allSettled` khi các tác vụ độc lập** (gửi email hàng loạt, ghi log đa đích) và `all` khi cần tất cả cùng thành công (nạp dữ liệu cho một response). Lý do: `all` fail-fast và bỏ rơi kết quả của các promise còn lại.
- **Giới hạn song song khi map trên danh sách lớn.** `Promise.all(rows.map(callApi))` với 10.000 phần tử mở 10.000 request cùng lúc. Chia theo lô (chunk) hoặc dùng thư viện giới hạn đồng thời. Lý do: kiểu chạy đúng nhưng hệ thống/đối tác sập vì quá tải.
- **Đặt kiểu trả về tường minh cho hàm async export.** Lý do: tránh lộ kiểu suy ra khổng lồ vào `.d.ts` và khi sửa thân hàm mà vô tình đổi kiểu, người gọi sẽ lỗi ngay tại chỗ định nghĩa thay vì chỗ sử dụng.
- **Hàm không async nhưng trả Promise** vẫn ổn, nhưng nếu nó `throw` đồng bộ trước khi trả Promise thì người gọi nhận *ngoại lệ đồng bộ*, không phải rejected Promise. Dùng `async` để mọi lỗi đều thành rejection. Lý do: người gọi chỉ cần một cơ chế bắt lỗi.
- **`await` trong vòng lặp `forEach` không hoạt động như bạn nghĩ**: `arr.forEach(async x => await f(x))` không chờ gì cả (`forEach` bỏ qua giá trị trả về, tức Promise). Dùng `for...of` hoặc `Promise.all(arr.map(...))`. Lý do: callback kiểu `void` chấp nhận hàm trả Promise (xem `01-function-types.md`), nên TS im lặng.
- **Debug**: khi kiểu kết quả là `Promise<...>` ở chỗ đáng lẽ là giá trị, đó là dấu hiệu quên `await`. Khi kiểu bị `any`, thường do `.json()` hoặc `JSON.parse`; gán ngay cho `unknown` rồi validate (Zod, Bài 9).
- **So với PHP/Laravel**: PHP truyền thống chạy đồng bộ, mỗi request một tiến trình, nên "quên chờ" hầu như không tồn tại. Laravel Queue/Job gần với "fire and forget" nhưng có cơ chế retry, failed_jobs. Trong Node, Promise bị bỏ rơi không có ai thu gom lỗi. Bạn phải tự bảo đảm mọi Promise đều có người chịu trách nhiệm.

## Liên hệ bài tập

Nếu hàm trong bài lab có phần bất đồng bộ (đọc config, gọi API giả lập), hãy chú thích `Promise<T>` tường minh và quyết định tường minh lỗi sẽ được ném hay trả về dưới dạng giá trị. Thử cố ý bỏ `await` ở một chỗ và xem compiler báo gì, rồi thử bỏ `await` ở chỗ gọi fire-and-forget và để ý compiler im lặng.

## Đọc thêm

- [Handbook: Functions, Promise return types](https://www.typescriptlang.org/docs/handbook/2/functions.html#return-type-void)
- [`useUnknownInCatchVariables`](https://www.typescriptlang.org/tsconfig/#useUnknownInCatchVariables)
- [MDN: Promise.allSettled](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled)

## Ghi chú của bạn
