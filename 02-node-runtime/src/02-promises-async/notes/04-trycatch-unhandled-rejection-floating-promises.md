# 4. `try/catch`, unhandled rejection và floating promises

Một promise bị reject mà không ai gắn handler là "unhandled rejection", và từ Node 15 hành vi mặc định là **làm sập process** (exit code 1); nguyên nhân thường gặp là "floating promise": gọi hàm async mà không `await`/`.catch`.

```ts
import { setTimeout as sleep } from "node:timers/promises";

void sleep(10).then(() => { throw new Error("quên catch"); });
setTimeout(() => console.log("không bao giờ in ra"), 100);
// Node 24.21: process sập ở ~10ms, in stack, exit 1
```

## Ý chính

- `try/catch` bắt lỗi của promise **chỉ khi bạn `await` nó bên trong `try`**. Gọi hàm async không await rồi mong `catch` bắt thì không được.
- Unhandled rejection = promise rejected mà đến cuối lượt xử lý (sau khi microtask queue cạn) vẫn chưa có handler. Mặc định Node 24.21 (chế độ `throw`): phát `unhandledRejection`; nếu không có listener thì ném như `uncaughtException` và **process thoát với code 1**.
- Chế độ điều khiển bằng `--unhandled-rejections=`: `throw` (mặc định), `strict`, `warn`, `none`, `warn-with-error-code`.
- Handler async trong `EventEmitter`, `setTimeout`, `setInterval` là nguồn floating promise phổ biến nhất: giá trị trả về (promise) bị bỏ đi.
- **Đừng dùng `process.on("unhandledRejection")` để "nuốt" lỗi**; dùng để log rồi thoát có kiểm soát.
- Lint `@typescript-eslint/no-floating-promises` bắt phần lớn trường hợp ngay lúc viết code.

## Lý thuyết chi tiết

**`try/catch` và `await`.** `try/catch` đồng bộ chỉ bắt lỗi ném **trong lúc stack của nó đang chạy**. Với `await`, hàm bị treo, và khi promise reject, `await` **ném lại** lỗi tại đúng vị trí, trong phạm vi `try` đang bao. Nếu bạn không `await`, lỗi xảy ra ở lúc khác, ở nơi `try` đã đóng:

```ts
import { EventEmitter } from "node:events";

const bus = new EventEmitter();
bus.on("order", async () => { throw new Error("handler async hỏng"); });
try { bus.emit("order"); console.log("emit xong, try/catch không bắt được"); } catch { /* không tới đây */ }
// Node 24.21: in dòng "emit xong...", rồi process sập vì unhandled rejection (exit 1)
```

`emit` gọi listener đồng bộ, listener trả về promise (bị `emit` bỏ qua). Lỗi nằm trong promise đó, không ai chờ.

Node có tùy chọn `captureRejections` giải quyết riêng trường hợp này: `new EventEmitter({ captureRejections: true })` chuyển promise bị reject của listener thành sự kiện `'error'` (đã thử: handler `'error'` in ra `handler async hỏng`, process không sập). Hữu ích nhưng bạn vẫn phải gắn listener cho `'error'`.

**Định nghĩa thời điểm "unhandled".** Node kiểm tra sau mỗi lượt xả microtask: promise rejected mà chưa có handler đến lúc đó bị coi là unhandled. Gắn handler **muộn** hơn một chút thì bị coi là xử lý muộn:

```ts
process.on("unhandledRejection", (reason, promise) => console.log("unhandledRejection:", (reason as Error).message, promise));
process.on("rejectionHandled", () => console.log("rejectionHandled"));
const p = Promise.reject(new Error("muộn"));
setTimeout(() => { p.catch(() => console.log("catch muộn")); }, 20);
// Node 24.21: unhandledRejection: muộn Promise { <rejected> ... }  -> catch muộn -> rejectionHandled ; exit 0
```

Có listener `unhandledRejection` thì process không sập (listener được ưu tiên). `rejectionHandled` báo promise đã được xử lý muộn. Bài học: **gắn handler ngay lập tức**, không để "để sau".

**Các chế độ `--unhandled-rejections`** (Node 24.21, thử với script "quên catch" + timer 100ms):

| Chế độ | Hành vi quan sát được | Exit |
|---|---|---|
| `throw` (mặc định) | in stack như uncaughtException, process dừng, timer 100ms **không** chạy | 1 |
| `strict` | tương tự throw (ném như uncaught kể cả khi có handler `unhandledRejection`, theo tài liệu) | 1 |
| `warn` | in `UnhandledPromiseRejectionWarning`, tiếp tục chạy | 0 |
| `none` | im lặng hoàn toàn (timer chạy bình thường) | 0 |
| `warn-with-error-code` | cảnh báo như `warn` rồi đặt exit code | 1 |

Dòng `strict`: đã thử chỉ khi không có handler, kết quả giống `throw`; phần "kể cả khi có handler" là kiến thức từ tài liệu, chưa thử. Trước Node 15 mặc định là `warn` (chỉ cảnh báo), nên bài cũ trên mạng nói "chỉ in warning" đã lỗi thời.

**Reject với giá trị không phải `Error`.** `Promise.reject("chỉ là string")` không bắt: Node in `UnhandledPromiseRejection: This error originated either by throwing inside of an async function without a catch block, or by rejecting a promise which was not handled with .catch(). The promise rejected with the reason "..."` với `code: 'ERR_UNHANDLED_REJECTION'`, **không có stack** chỉ về nguồn gốc (đã thử). Lý do thêm để luôn ném `Error`.

**Tại sao Node chọn sập process?** Một rejection không ai xử lý nghĩa là có đường lỗi bạn chưa nghĩ tới, trạng thái chương trình có thể không còn nhất quán (kết nối giữa chừng, transaction mở). Sập rồi để supervisor (PM2, Kubernetes, systemd) khởi động lại thường an toàn hơn tiếp tục chạy sai. So sánh PHP-FPM: lỗi không bắt chỉ giết **request** đó, worker vẫn sống; trong Node một lỗi như vậy có thể giết **tất cả** request đang chạy trong process.

**Floating promise.** Là biểu thức kiểu Promise mà kết quả bị bỏ rơi (không `await`, không `return`, không `.catch`, không `void`). Ví dụ phổ biến: `sendEmail(user)` trong handler (quên `await`), `array.forEach(async ...)`, `setInterval(async () => {...})`, `emitter.on("x", async ...)`. Dùng `void` có chủ ý (`void sendMetrics()`) để đánh dấu "cố ý không chờ" **chỉ khi hàm đó tự bắt lỗi bên trong** (hoặc bạn gắn `.catch`).

## Tricks & tips thực tế

- **Bật `@typescript-eslint/no-floating-promises` khi có lint**: nó chỉ ra mọi chỗ thiếu `await`/`.catch`/`void`. Lý do: compile của TS không bắt được, vì bỏ rơi giá trị là hợp lệ.
- **Mọi handler "bắn rồi quên" phải tự bắt lỗi**: `void notify().catch((e) => logger.error({ err: e }, "notify failed"))`. Lý do: không ai khác sẽ bắt, và mặc định lỗi làm sập process.
- **Với `setInterval(async ...)` và `emitter.on(..., async ...)`, bọc thân trong `try/catch`** và log. Hoặc dùng wrapper dùng chung để tất cả handler async đi qua một nơi xử lý lỗi.
- **Cài handler cấp process làm lưới an toàn, không phải xử lý chính**: `process.on("unhandledRejection", (r) => { logger.fatal({ err: r }); process.exit(1) })` (hoặc để mặc định `throw`). Lý do: nuốt lỗi rồi chạy tiếp để lại trạng thái hỏng; chết nhanh + restart + log rõ là an toàn hơn. Nhớ flush log trước khi thoát (graceful shutdown ở phần sau của phase).
- **Đừng chạy `--unhandled-rejections=none` ở production** để "hết crash": đó là che bug. Chỉ dùng `warn` tạm khi di chuyển code cũ, kèm kế hoạch dọn.
- **Debug "process tự thoát/sập khó hiểu"**: chạy `node --trace-warnings` hoặc `--trace-uncaught`, xem `reason`/`promise` trong handler `unhandledRejection`, hoặc thử `--unhandled-rejections=strict` để lỗi nổi lên rõ. Lỗi `ERR_UNHANDLED_REJECTION` kèm reason không phải `Error` gợi ý có chỗ `Promise.reject("...")` hay `throw "..."`.
- **Cạm bẫy "tạo trước, await sau"** (file 02): promise lỗi sớm hơn khi bạn chưa gắn handler gây sập process dù `try/catch` có mặt. Cách tránh: `Promise.all`/`allSettled`.
- **`try/catch` quá rộng nuốt lỗi lập trình**: chỉ bắt lỗi bạn biết xử lý, hoặc bắt rồi kiểm tra `instanceof` và **ném lại** (`throw e`) với lỗi khác. Trong `catch (e)`, `e` có kiểu `unknown` (do `strict`): thu hẹp bằng `instanceof Error` trước khi đọc `.message`.
- **Test đường lỗi**: viết test cho hàm async ném lỗi (Vitest `rejects`), như Phase 01 Bài 11. Lý do: lỗi async là lỗi production hay gặp nhất mà ít được test.
- **Express 4 không bắt lỗi từ handler async** (cần wrapper hoặc Express 5), còn NestJS/Fastify xử lý promise reject của handler. Kiến thức từ tài liệu framework, chưa thử ở đây; sẽ gặp lại ở Phase sau.

## Liên hệ bài tập

`retry` trong `EXERCISE.md` là nơi lỗi bất đồng bộ được bắt và quyết định thử lại hay bỏ cuộc: tự hỏi lỗi nào **nên** retry (mạng) và lỗi nào **không** (bug, input sai), và lỗi cuối cùng được ném ra như thế nào để người gọi thấy đủ ngữ cảnh. Thử cố ý để một promise bị bỏ rơi trong code lab và quan sát process sập, rồi thử thêm handler `unhandledRejection` để thấy sự khác biệt.

## Đọc thêm

- [Node.js: `process` event `unhandledRejection`](https://nodejs.org/api/process.html#event-unhandledrejection)
- [Node.js: CLI `--unhandled-rejections`](https://nodejs.org/api/cli.html#--unhandled-rejectionsmode)
- [Node.js: `EventEmitter` captureRejections](https://nodejs.org/api/events.html#capture-rejections-of-promises)
- [typescript-eslint: no-floating-promises](https://typescript-eslint.io/rules/no-floating-promises/)

## Ghi chú của bạn
