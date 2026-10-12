# 3. `Promise.all`, `allSettled`, `race`, `any`

Bốn combinator gộp nhiều promise thành một, khác nhau ở chỗ **khi nào settle** và **xử lý lỗi thế nào**; điểm chung quan trọng: chúng **không hủy** promise còn lại.

```ts
import { setTimeout as sleep } from "node:timers/promises";

const [a, b] = await Promise.all([sleep(30, "a"), sleep(10, "b")]);
console.log(a, b); // a b  (thứ tự theo đầu vào, không theo thứ tự hoàn thành)
```

## Ý chính

| | Fulfill khi | Reject khi | Kết quả |
|---|---|---|---|
| `all` | **tất cả** fulfilled | **một** cái reject (lỗi đầu tiên) | mảng giá trị, đúng thứ tự đầu vào |
| `allSettled` | tất cả settled (không bao giờ reject) | không | mảng `{status, value\|reason}` |
| `race` | cái settle **đầu tiên** là fulfilled | cái settle đầu tiên là rejected | giá trị/lỗi của cái đầu tiên |
| `any` | cái fulfilled **đầu tiên** | **tất cả** reject → `AggregateError` | giá trị của cái đầu tiên thành công |

- Không combinator nào **hủy** các promise khác; tác vụ "thua" vẫn chạy đến cuối và tốn tài nguyên.
- `all`/`allSettled` giữ **thứ tự đầu vào**; `race`/`any` chỉ trả một giá trị.
- Mảng rỗng: `all([])` và `allSettled([])` fulfill ngay với `[]`; `any([])` reject (`AggregateError`); `race([])` **không bao giờ settle**.
- Phần tử không phải promise được coi như đã resolve (`Promise.all([1, p])` hợp lệ).

## Lý thuyết chi tiết

**Thí nghiệm tổng hợp (Node 24.21).** Với `ok(v, ms)` = `sleep(ms, v)` và `bad(m, ms)` = promise reject sau `ms`:

```ts
await Promise.all([ok("a", 30), ok("b", 10)]);                    // [ 'a', 'b' ]
await Promise.all([ok("a", 30), bad("x", 10), bad("y", 20)]);     // reject: Error x
await Promise.allSettled([ok("a", 10), bad("x", 5)]);
// [ { status: 'fulfilled', value: 'a' }, { status: 'rejected', reason: Error: x ... } ]
await Promise.race([ok("slow", 30), bad("fast-fail", 5)]);        // reject: fast-fail
await Promise.any([bad("x", 5), ok("later", 20)]);                // 'later'
await Promise.any([bad("x", 5), bad("y", 6)]);
// AggregateError: message "All promises were rejected", errors: [Error x, Error y]
```

**`all`: fail-fast.** Promise kết quả reject **ngay** khi có lỗi đầu tiên (ở trên là `x` ở 10ms, không chờ `y` ở 20ms). Các promise còn lại vẫn chạy nhưng kết quả bị bỏ.

Lỗi thứ hai có thành unhandled không? Đã thử: `Promise.all([bad("x", 5), bad("y", 10)]).catch(...)`, chỉ in `caught x`, handler `unhandledRejection` **không** bị gọi cho `y`. Lý do: `Promise.all` đã gắn handler vào **mọi** promise đầu vào, nên lỗi sau bị nuốt im lặng. Hệ quả: **bạn mất dấu lỗi thứ hai** (log thiếu); nếu cần biết mọi lỗi dùng `allSettled`.

**`allSettled`: không fail-fast, không throw.** Phù hợp khi mỗi tác vụ độc lập và bạn muốn báo cáo từng phần (gửi thông báo cho 100 người dùng, ghi nhận ai lỗi). Nhớ kiểm tra `status`; TypeScript thu hẹp được `PromiseSettledResult<T>` theo `status` (đây là discriminated union, đúng thứ bạn đã học ở Phase 01). Phần `reason` là giá trị lỗi gốc (có `stack` kèm `at async Promise.allSettled (index 1)`, đã thấy trong output).

**`race`: cuộc đua cả thành công lẫn thất bại.** Cái settle trước thắng, **kể cả khi là lỗi** (`fast-fail` thắng `slow` ở trên). Hay dùng cho timeout: đua tác vụ với một timer reject. Hai điểm hay quên:

1. Tác vụ thua vẫn chạy. Đã thử: `race([sleep(10), side])` với `side` kết thúc ở 100ms: `race` xong ở 11ms nhưng "tác vụ thua vẫn chạy xong ở 105ms". Với request HTTP/DB, tốn tài nguyên và có thể gây tác dụng phụ (ghi DB xong dù người gọi đã bỏ đi). Muốn dừng thật phải dùng `AbortSignal` (file 05).
2. Timer dùng làm đối thủ nếu không bị `clearTimeout` thì **giữ process sống** đến khi đến hạn và giữ closure; trong test hoặc CLI, script không thoát đúng hạn.

`Promise.race([])` treo vĩnh viễn; nếu đang `await` nó ở top-level thì Node thoát với exit code 13 (đã thử), trong server thì request treo mãi.

**`any`: "cái nào xong trước, bỏ qua lỗi".** Hợp với "gọi nhiều replica/mirror, lấy cái nhanh nhất". Khi **tất cả** lỗi ném `AggregateError` với `.errors` chứa mọi lỗi theo thứ tự đầu vào (đã thử: `['x','y']`, `instanceof AggregateError` là `true`). Cần TypeScript target/lib ES2021 trở lên cho `any` và `AggregateError`; repo của Phase 01 target mới hơn nên không vấn đề.

**So với PHP.** Laravel `Http::pool(...)` tương ứng `Promise.all` cho các request HTTP: kết quả theo thứ tự, nhưng không có `race/any` sẵn. `Concurrency::run` (Laravel 11+) chạy closure song song bằng **process** riêng; còn `Promise.all` trong Node chạy **chồng I/O trong cùng thread**, chi phí rất khác (xem phần CPU-bound).

## Tricks & tips thực tế

- **Chọn `allSettled` khi bạn cần biết mọi lỗi** hoặc chấp nhận thành công một phần; chọn `all` khi một lỗi nghĩa là cả thao tác vô nghĩa. Lý do: `all` che lỗi thứ hai trở đi (đã đo), nên log thiếu chi tiết khi sự cố.
- **`all` với số phần tử không giới hạn là lỗi thiết kế**: giới hạn đồng thời (batch hoặc `mapLimit`). Lý do: pool DB nhỏ, rate limit bên ngoài, file descriptor hữu hạn.
- **Dọn timer trong cuộc đua timeout**: nếu tự dựng bằng `race`, hãy `clearTimeout` trong `finally`; hoặc dùng `AbortSignal.timeout(ms)` / `sleep` có `signal` để khỏi lo (file 05). Lý do: timer sống giữ process và tốn bộ nhớ.
- **Đừng dùng `race` để "chọn kết quả tốt nhất"**: nó chọn cái **đến trước**, kể cả lỗi. Cần "thành công đầu tiên" thì dùng `any`.
- **Gắn nhãn lỗi khi dùng `all`/`any`**: lỗi từ promise thứ 7 của 20 không cho biết nguồn. Bọc từng cái bằng `.catch((e) => { throw new Error("task " + i, { cause: e }); })` (option `cause` từ ES2022; Node 16.9+ đã hỗ trợ) để giữ ngữ cảnh.
- **Thứ tự kết quả của `all` là thứ tự đầu vào**: bạn có thể dựa vào đó, khác với thứ tự hoàn thành. Nếu cần xử lý theo thứ tự hoàn thành, dùng `for await` trên iterator tự dựng hoặc event.
- **Kiểu TypeScript**: truyền tuple (`as const` hoặc literal mảng) vào `Promise.all([pA, pB])` được kiểu tuple `[A, B]`; truyền mảng động `Promise<T>[]` được `T[]`. Với `noUncheckedIndexedAccess`, truy cập `results[0]` trên mảng động có thể `undefined`; tuple thì không.

## Liên hệ bài tập

`withTimeout` và `mapLimit` trong `EXERCISE.md` đều dựa trên các combinator này nhưng bạn không được dùng thư viện. Gợi ý hướng: nghĩ xem `race` giải quyết phần nào của timeout và **không** giải quyết phần nào (tác vụ thua, timer còn sống). Với `mapLimit`, thử hỏi: nếu một tác vụ lỗi giữa chừng thì các tác vụ đang chạy và chưa bắt đầu nên ra sao, và `all`/`allSettled` hợp với chiến lược nào?

## Đọc thêm

- [MDN: Promise.all](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all)
- [MDN: Promise.allSettled](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled)
- [MDN: Promise.race](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/race)
- [MDN: Promise.any](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/any)
- [MDN: Promise concurrency (so sánh các combinator)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise#promise_concurrency)

## Ghi chú của bạn
