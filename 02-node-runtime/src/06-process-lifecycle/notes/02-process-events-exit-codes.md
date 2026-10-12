# 2. `process`: argv, env, exit code và các sự kiện vòng đời

`process` là đối tượng toàn cục mô tả tiến trình đang chạy; điều quan trọng nhất ở backend là **cách tiến trình kết thúc** và **mã thoát** mà hệ điều hành/orchestrator nhìn thấy.

```ts
process.on("exit", (code) => console.log("exit", code));
process.exitCode = 2;                      // đặt mã thoát nhưng KHÔNG dừng ngay
setTimeout(() => console.log("timer vẫn chạy"), 10);
// in: timer vẫn chạy / exit 2   (mã thoát của tiến trình: 2)
```

## Ý chính

- `process.exit(n)` kết thúc **ngay**: callback/timer đang chờ bị bỏ, I/O dở có thể mất. `process.exitCode = n` chỉ đặt mã, để tiến trình **tự thoát** khi hết việc. Ưu tiên `exitCode`.
- Mã thoát: `0` = thành công; khác `0` = lỗi. Shell, cron, systemd, Docker, Kubernetes, CI đọc mã này. Tiến trình bị signal giết có mã `128 + số signal` (SIGTERM = 143, SIGINT = 130) theo quy ước của shell.
- Hai sự kiện cuối đời: `beforeExit` (event loop trống, **có thể** lên lịch thêm việc, tiến trình sẽ chạy tiếp) và `exit` (đã chắc chắn thoát, **chỉ đồng bộ**).
- `uncaughtException` (ném lỗi không ai bắt) và `unhandledRejection` (Promise reject không ai xử lý) là hai cửa sổ để **ghi log rồi thoát**, không phải để "sống tiếp".
- Mặc định Node hiện đại: `throw` không bắt -> in lỗi, thoát mã `1`. `unhandledRejection` không có handler -> cũng ném thành uncaught, mã `1` (từ Node 15). Cả hai đã chạy ở Node 24.21.
- `process.argv` = `[đường dẫn node, đường dẫn script, ...tham số]`; `process.env` là chuỗi (mọi giá trị đều thành `string`).

## Lý thuyết chi tiết

**`exit` vs `exitCode` (đã chạy, Node 24.21).**

```ts
const mode = process.argv[2]!;
process.on("beforeExit", (c) => console.log("beforeExit", c));
process.on("exit", (c) => { console.log("exit", c, process.exitCode); setTimeout(() => console.log("KHÔNG BAO GIỜ"), 0); });

if (mode === "exit") { setTimeout(() => console.log("timer không chạy"), 10); process.exit(3); }
else if (mode === "exitCode") { process.exitCode = 4; setTimeout(() => console.log("timer chạy"), 10); }
```

| Chạy | Kết quả in | Mã thoát |
|---|---|---|
| `node f.ts exit` | `exit 3 3` (timer bị bỏ, **không** `beforeExit`) | 3 |
| `node f.ts exitCode` | `timer chạy`, `beforeExit 4`, `exit 4 4` | 4 |

Trong `exit` handler chỉ làm được việc **đồng bộ**; `setTimeout` bên trong không bao giờ chạy (đã chạy). Muốn ghi log cuối, dùng `writeSync`/`console.error` đồng bộ, đừng dựa vào I/O bất đồng bộ.

**Vì sao `process.exit()` nguy hiểm.** Nó không đợi: dữ liệu còn đệm trong `stdout`/`stderr` (khi là pipe/socket ở một số nền tảng), HTTP response đang gửi dở, connection DB chưa đóng, log chưa flush. Trên Linux file/TTY/pipe ghi đồng bộ theo tài liệu nên ít mất log hơn, nhưng đừng coi đó là bảo đảm di động. Cách đúng: dừng nhận việc mới, đợi việc đang chạy xong (xem file 03), rồi để event loop tự cạn, hoặc đặt `exitCode` và chỉ gọi `process.exit` ở cuối cùng như một "búa" sau thời hạn. So với PHP: `exit()` của PHP vẫn chạy shutdown function và destructor; `process.exit()` của Node không chạy gì ngoài các listener `exit`.

**`beforeExit`.** Phát khi event loop **trống** (không timer, không socket, không I/O). Listener có thể lên lịch việc mới (đã chạy: lên lịch `setTimeout` 2 lần thì tiến trình "sống thêm" hai vòng rồi `exit`). Nó **không** phát khi gọi `process.exit()` hay khi lỗi uncaught. Đừng dùng để dọn dẹp bắt buộc: dùng khi muốn "làm tiếp nếu còn việc nền".

**`uncaughtException`.** Phát khi một lỗi nổi lên tới đáy ngăn xếp mà không có `catch`. Nếu có listener, Node **không** thoát nữa (đã chạy):

```ts
import { createServer } from "node:http";

const mode = process.argv[2];
process.on("uncaughtException", (err, origin) => {
  console.error("uncaughtException:", err.message, origin);   // origin: "uncaughtException" hoặc "unhandledRejection"
  if (mode === "survive") { console.log("tiếp tục sống..."); return; }   // KHÔNG nên
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 100).unref();                           // ghi log xong rồi thoát
});
const srv = createServer().listen(0);
setTimeout(() => { throw new Error("A"); }, 10);
setTimeout(() => { console.log("server còn mở:", srv.listening); }, 50);
setTimeout(() => srv.close(), 300);
```

Chạy `survive`: lỗi được in, tiến trình **tiếp tục** (server vẫn `listening`, thoát mã 0). Chạy mặc định: thoát mã 1. Vì sao không nên sống tiếp:

1. Lúc lỗi, ngăn xếp đã bị tung (unwind). Bạn không biết bộ phận nào hỏng: transaction dở, lock chưa nhả, biến chia sẻ ở trạng thái nửa vời, connection pool bị đánh dấu sai.
2. Node tài liệu hoá chính xác: sau `uncaughtException`, trạng thái tiến trình không đảm bảo; handler chỉ để dọn dẹp **đồng bộ** rồi thoát. Nó là "lưới an toàn cuối", không phải `catch` tổng.
3. Tiến trình "zombie sống" nguy hơn tiến trình chết: không phục vụ đúng, nhưng health check vẫn xanh, orchestrator không restart.

Mẫu đúng: ghi log lỗi đầy đủ (kể cả `err.stack`), **cố gắng** đóng gọn (server.close, flush log) trong thời hạn ngắn, rồi `process.exit(1)` để PM2/systemd/Kubernetes khởi động lại sạch. Thêm `uncaughtExceptionMonitor` nếu chỉ muốn quan sát (nó không ngăn crash).

**`unhandledRejection`.** Promise bị reject mà đến cuối lượt event loop vẫn không có `.catch`/`await` bao. Từ Node 15, mặc định là `throw` (chế độ `throw`) -> thành `uncaughtException` -> thoát mã 1. Đã chạy:

```ts
// mặc định: không có handler
Promise.reject(new Error("w"));       // in lỗi + "Node.js v24.21.0", thoát mã 1
// reject giá trị không phải Error:
Promise.reject(42);                   // UnhandledPromiseRejection: ... The promise rejected with the reason "42".
```

Nếu bạn gắn `process.on("unhandledRejection", ...)` thì Node **không** thoát nữa (đã chạy: handler in ra, tiến trình sống tiếp). Cờ `--unhandled-rejections=warn` hạ xuống cảnh báo và tiến trình sống (đã chạy, vẫn in `sống`). Hai cái này làm bug im lặng nếu bạn không thoát: hãy nhớ nguyên tắc ở trên.

Cách tránh nguồn gốc: luôn `await` hoặc `.catch` mọi Promise; bật lint `no-floating-promises`; với hàm "bắn rồi quên" (gửi mail nền), tự bọc `.catch(logError)`. Phần error propagation của Promise đã nằm ở bài Promise/async; ở đây chỉ nhắc điểm chạm với process.

**`process.argv` và `env`.**

```ts
console.log(process.argv.slice(2));        // tham số của bạn, vd: node cli.ts a --flag=1  ->  [ 'a', '--flag=1' ]
console.log(process.execArgv);             // cờ của chính node: [ '--max-old-space-size=100' ]
console.log(process.env.NOPE);             // undefined (không phải chuỗi "undefined")
process.env.NUM = String(5);               // gán luôn thành chuỗi
```

Đã chạy: gán `process.env.X = 1` thì đọc lại `typeof` là `"string"` (`"1"`): **mọi biến env là chuỗi**, kể cả `"false"` (truthy). Phân tích số/boolean/URL bằng Zod ở điểm khởi động (xem Bài 9 của Phase 01). Node 20+ có `node --env-file=.env app.ts` đọc file `.env` (chưa thử ở đây); `parseArgs` từ `node:util` để phân tích cờ CLI, tiện hơn đọc `argv` thô (chưa thử).

**Mã thoát nên dùng.** Quy ước đơn giản: `0` ok, `1` lỗi chung, `2` dùng sai (tham số). Mã khác `0` cho từng loại lỗi chỉ cần nếu có ai đó (script, CI) phân nhánh theo nó. Với tiến trình bị signal giết, shell báo `128 + n`: đã chạy `kill -TERM` -> `143`, `kill -INT` -> `130`, `kill -HUP` -> `129`. Lưu ý trong Node, `child.on("exit", (code, signal))` cho `code = null` và `signal = "SIGTERM"` khi bị signal giết (đã chạy ở file 03), không phải 143.

## Tricks & tips thực tế

- **Ưu tiên `process.exitCode = n` và để tiến trình tự thoát; chỉ `process.exit()` như phương án cuối sau thời hạn.** Lý do: `exit()` bỏ việc đang chờ, có thể mất log/dữ liệu.
- **Trong `uncaughtException` và `unhandledRejection`: ghi log rồi thoát (mã 1).** Lý do: trạng thái đã không đáng tin; để supervisor restart sạch tốt hơn là chạy tiếp ở trạng thái lạ.
- **`setTimeout(() => process.exit(1), 100).unref()` sau khi log.** Lý do: cho log kịp flush, và `.unref()` để timer này không giữ tiến trình sống nếu đã tự thoát sớm.
- **Phân biệt lỗi lập trình và lỗi vận hành.** `ECONNREFUSED`, input sai là lỗi vận hành: bắt tại chỗ, không để rơi tới `uncaughtException`. Lý do: `uncaughtException` chỉ nên là bug thật.
- **Validate `process.env` một lần ở khởi động, thoát mã `1` với thông báo rõ nếu thiếu.** Lý do: lỗi cấu hình phát hiện ngay lúc deploy tốt hơn gặp `undefined` ở request thứ 1000.
- **Không log `process.env` nguyên khối.** Lý do: chứa secret (DB password, API key) sẽ vào hệ thống log.
- **Debug "tiến trình không chịu thoát":** log `process.getActiveResourcesInfo()` (Node 17.3+, chưa thử ở đây) để xem timer/socket nào còn sống; tìm timer cần `.unref()`, connection pool chưa `close()`. Lý do: tiến trình chỉ tự thoát khi event loop trống.
- **Debug "thoát im lặng":** gắn `process.on("exit", c => console.error("exit", c, new Error().stack))`. Lý do: biết ai gọi `process.exit` và mã nào.
- **Trong test, đừng để code dưới test gọi `process.exit`:** mock hoặc tách logic ra hàm trả kết quả, chỉ `main()` mới đổi thành mã thoát. Lý do: `exit` giết luôn runner của test.

## Liên hệ bài tập

Lab cần chương trình có mã thoát đúng. Tự hỏi: khi nhận SIGTERM, chương trình thoát với mã bao nhiêu và vì sao con số đó có ý nghĩa với người gọi? Thử cố ý `throw` ở một timer và gắn/không gắn `uncaughtException`, quan sát mã thoát và liệu phần dọn dẹp (xoá lock file) có chạy không. Tiến trình bị `kill -9` thì phần dọn dẹp ở `exit` handler có chạy không (kỳ vọng của bạn trước khi thử là gì)?

## Đọc thêm

- [Node.js: Process (events, exit codes)](https://nodejs.org/api/process.html)
- [Node.js: `process.exitCode`](https://nodejs.org/api/process.html#processexitcode)
- [Node.js: Warning on `uncaughtException`](https://nodejs.org/api/process.html#warning-using-uncaughtexception-correctly)
- [Node.js: `unhandledRejection`](https://nodejs.org/api/process.html#event-unhandledrejection)

## Ghi chú của bạn

