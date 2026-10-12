# 3. Signals, shutdown và vòng đời trong container/systemd/PM2

Signal là cách hệ điều hành nhờ một tiến trình dừng (hoặc báo sự việc); tiến trình backend phải bắt `SIGTERM`/`SIGINT`, dọn dẹp, rồi thoát, và hiểu `SIGKILL` không thể bắt.

```ts
const keepAlive = setInterval(() => {}, 1000);     // giữ tiến trình sống (giả lập server)
process.on("SIGTERM", () => {
  console.log("nhận SIGTERM, dọn dẹp...");
  clearInterval(keepAlive);                        // hết việc => event loop trống => tự thoát mã 0
});
console.log("pid", process.pid);                   // thử: kill -TERM <pid>
```

## Ý chính

- **`SIGTERM` (15)**: "hãy dừng", tín hiệu chuẩn của `kill`, systemd, Docker/Kubernetes, PM2. **`SIGINT` (2)**: Ctrl+C trong terminal. **`SIGHUP` (1)**: terminal đóng, hoặc quy ước "đọc lại cấu hình" của nhiều daemon. **`SIGKILL` (9)**: giết ngay, **không bắt được, không bỏ qua được**; **`SIGSTOP`** cũng vậy.
- Không có handler thì hành vi mặc định là **chết ngay** (không chạy `finally`, không `exit` event). Đã chạy: `child.on("exit")` nhận `code=null signal=SIGTERM`.
- Có handler thì **bạn chịu trách nhiệm tự thoát**. Handler rỗng nghĩa là tiến trình **từ chối chết** (đã chạy: gửi hai SIGTERM, tiến trình vẫn sống tới khi bị SIGKILL).
- Đăng ký handler cho signal **không** giữ tiến trình sống (đã chạy: `process.on("SIGTERM", ...)` trong script không có việc gì khác vẫn thoát bình thường).
- Mẫu shutdown: nhận signal -> ngừng nhận việc mới -> đợi việc đang chạy -> đóng tài nguyên -> thoát (`exitCode`), kèm **hẹn giờ cưỡng bức** trước hạn mà orchestrator sẽ SIGKILL.
- Signal thứ hai (người dùng nhấn Ctrl+C lần nữa) thường nên nghĩa là "thoát ngay".
- Với `process.on("SIGKILL", ...)`: Node ném `uv_signal_start EINVAL` (đã chạy).

## Lý thuyết chi tiết

**Gửi signal bằng tay.**

```bash
node app.ts &            # chạy nền, lấy PID
kill -TERM <pid>         # hoặc kill <pid> (mặc định là TERM)
kill -INT <pid>          # giống Ctrl+C
kill -KILL <pid>         # kill -9: không thể bắt
kill -0 <pid>            # không gửi gì: chỉ kiểm tra PID còn sống và mình có quyền gửi
```

Trong Node: `process.kill(pid, "SIGTERM")` (tên gây hiểu nhầm: chỉ **gửi** signal), `child.kill("SIGTERM")` cho tiến trình con, `process.kill(pid, 0)` kiểm tra tồn tại.

**Thí nghiệm bốn kịch bản (đã chạy, Node 24.21).** Cha `spawn` một con, gửi signal bằng `child.kill`, theo dõi `exit`:

| Handler trong con | Gửi | Kết quả cha thấy |
|---|---|---|
| không có (con vẫn có interval giữ sống) | SIGTERM | `code=null signal=SIGTERM` (chết ngay) |
| có: `clearInterval` | SIGTERM | `code=0 signal=null` (thoát êm) |
| có: đợi 200 ms dọn rồi `clearInterval` | SIGINT | `cleanup done`, `code=0` |
| handler chỉ in (không dừng gì) | SIGTERM x2 rồi SIGKILL | nhận 2 lần, vẫn sống; `code=null signal=SIGKILL` |

Qua shell (`kill` từ bash, tiến trình Node không có handler): SIGTERM -> `143`, SIGINT -> `130`, SIGHUP -> `129` (128 + số signal, quy ước của shell). Chương trình cha Node không thấy "143" mà thấy `signal`.

Một đoạn khung cha-con để thử tay (cố ý chỉ là kỹ thuật con, không phải bài giải): 

```ts
import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });
child.on("exit", (code, signal) => console.log("con thoát:", { code, signal }));
setTimeout(() => child.kill("SIGTERM"), 300);   // con không có handler => signal=SIGTERM
// con đã bị giết bởi hệ điều hành; cha vẫn tự thoát vì không còn gì chờ
```

**Hẹn giờ cưỡng bức.** Handler thực tế cần một "búa": nếu dọn dẹp quá lâu thì tự thoát trước khi bị SIGKILL, và `.unref()` để timer này không tự giữ tiến trình:

```ts
const keepAlive = setInterval(() => {}, 1000);
let shuttingDown = false;
process.on("SIGTERM", () => {
  if (shuttingDown) return;                          // chống chạy lại khi nhận signal lặp
  shuttingDown = true;
  setTimeout(() => process.exit(1), 5000).unref();   // hạn cuối, rồi thoát cưỡng bức
  clearInterval(keepAlive);                          // thay bằng: server.close(), pool.end(), ...
});
```

(Ví dụ chạy được; phần dọn dẹp thật là việc của bạn.) Lý do `shuttingDown`: nếu orchestrator hay người dùng gửi lần hai, bạn không muốn chạy dọn dẹp hai lần song song.

**`process.on` vs `once`.** `once("SIGINT", ...)` gỡ handler sau lần đầu, nên lần Ctrl+C thứ hai quay về hành vi mặc định (chết ngay). Đó là một cách đơn giản để có "nhấn hai lần là buộc dừng", nhưng hành vi tường minh (đếm lần) dễ đọc hơn.

**Windows.** Signal chỉ mô phỏng một phần (`SIGINT`, `SIGTERM` có hạn; `process.kill` với SIGTERM thường giết thẳng). Tài liệu viết cho Linux/macOS; hãy dev/chạy trong WSL hoặc container cho khớp production.

**Tiến trình con và nhóm tiến trình.** Ctrl+C trong terminal gửi SIGINT tới **cả nhóm tiến trình foreground** (cha và con cùng nhận), nhưng `kill <pid>` chỉ gửi cho đúng PID đó. Muốn cha giết con khi cha nhận SIGTERM, cha phải chủ động `child.kill()` trong handler. Con spawn `detached: true` ở nhóm riêng nên không nhận Ctrl+C. Con có thể thành mồ côi (orphan) nếu cha chết bằng SIGKILL; với `fork` có kênh IPC, con nhận sự kiện `disconnect` (đã chạy: xem file 05).

**PID 1 trong container (đã chạy bằng `unshare --pid --fork --mount-proc node ...`).** Trong một PID namespace, tiến trình có PID 1 **không nhận hành vi mặc định của signal**: kernel bỏ qua SIGTERM nếu tiến trình PID 1 không tự đăng ký handler. Thí nghiệm: Node làm PID 1, tiến trình con gửi `kill -TERM 1`:

- Không có handler: Node **không chết** (đã chờ 2 giây, vẫn in "vẫn sống", sau đó tự thoát vì hết việc, mã 0).
- Có handler: `got TERM`, thoát đúng.

Đây là lý do `docker stop` (gửi SIGTERM, 10 giây sau SIGKILL) có thể chậm đúng 10 giây với app Node không có handler SIGTERM, hoặc khi `CMD` dùng dạng shell (`CMD npm start` thì PID 1 là `sh`/`npm`, không chuyển signal xuống Node). Các cách tránh (từ tài liệu Docker, chưa thử trong ghi chú này): dùng dạng exec `CMD ["node", "app.js"]`, hoặc `docker run --init` / `tini` làm PID 1, và luôn có handler SIGTERM trong app.

**systemd, PM2, Kubernetes (kiến thức từ tài liệu, chưa thử).**

- systemd: `systemctl stop` gửi SIGTERM, đợi `TimeoutStopSec` (mặc định thường 90s), rồi SIGKILL. `Restart=on-failure` restart khi thoát mã khác 0 hoặc bị signal; vì vậy thoát `1` sau uncaughtException có ý nghĩa.
- PM2: `pm2 stop/restart/reload` gửi SIGINT (mặc định), đợi `kill_timeout` (mặc định 1600 ms) rồi SIGKILL; `kill_timeout` đặt được trong file cấu hình. Chế độ cluster còn dùng IPC (`process.send('ready')` với `wait_ready`).
- Kubernetes: khi xoá pod gửi SIGTERM, đợi `terminationGracePeriodSeconds` (mặc định 30s), rồi SIGKILL. Cùng lúc, pod bị gỡ khỏi Service nhưng việc này **không tức thời**: một vài request vẫn có thể đến trong giây đầu, nên app thường chờ ngắn trước khi đóng cổng.

Hệ quả chung: thời hạn của bạn là thời hạn của orchestrator (vài giây đến vài chục giây). Dọn dẹp phải có giới hạn thời gian ngắn hơn nó.

**Liên hệ PHP.** Bạn đã gặp `pcntl_signal` (`SIGTERM` trong Artisan queue worker `queue:work` dừng sau job hiện tại: đó chính là graceful shutdown). Khác biệt: PHP-FPM do máy chủ quản lý vòng đời; trong Node, **chính tiến trình bạn viết** là server nên bạn tự lo.

**PID file / lock file và `kill(pid, 0)`.** Ghi PID vào file để biết "đã có bản chạy rồi". Vấn đề: file còn đó sau khi tiến trình chết (SIGKILL, mất điện). Cách kiểm tra "PID đó còn sống không": `process.kill(pid, 0)` không gửi gì, chỉ ném `ESRCH` nếu PID không tồn tại, hoặc `EPERM` nếu tồn tại nhưng không có quyền gửi (tức là còn sống). Đã chạy:

```ts
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}
console.log(alive(process.pid), alive(999999), alive(1));   // true false true
```

Cạm bẫy: PID **được tái sử dụng**; một lock cũ có PID `4242` có thể nay thuộc tiến trình khác hoàn toàn. Phương án chắc hơn là khoá thật bằng cơ chế hệ điều hành (`flock`, chưa có API tích hợp sẵn trong Node), hoặc kiểm tra thêm thời điểm khởi động/tên tiến trình. Với bài học, kiểm tra PID là đủ, miễn bạn biết giới hạn. Phần tạo file nguyên tử bằng `wx` nằm ở file 01.

## Tricks & tips thực tế

- **Luôn đăng ký `SIGTERM` (và `SIGINT` cho dev).** Lý do: không có handler thì bị giết giữa chừng; trong container PID 1 thì thậm chí không chết đúng hạn, `docker stop` chờ trọn 10 giây.
- **Đặt hạn cuối bằng `setTimeout(...).unref()`.** Lý do: dọn dẹp treo (một connection không đóng) không được làm tiến trình sống mãi; `unref` để timer không giữ tiến trình khi đã tự thoát.
- **Chống chạy lại shutdown bằng cờ.** Lý do: signal có thể đến nhiều lần (Ctrl+C liên tục, orchestrator gửi lặp).
- **Đặt `process.exitCode` thay vì gọi `process.exit` trong handler, rồi để event loop tự cạn.** Lý do: `exit()` có thể cắt log/ghi dở (xem file 02); chỉ `exit` cưỡng bức khi hết hạn.
- **Xoá PID/lock file ở cả đường `SIGTERM` lẫn `exit`, nhưng thiết kế mà không cần: kiểm tra PID cũ còn sống khi khởi động.** Lý do: `SIGKILL`/mất điện không chạy handler nào, nên file mồ côi luôn có thể xảy ra.
- **Thử bằng tay trước khi tin:** chạy app, `kill -TERM <pid>`, xem log và `echo $?`. Với `kill -9` thì xem file tạm còn lại gì. Lý do: shutdown là mã ít khi chạy; không thử là không biết nó có chạy.
- **Trong Docker dùng dạng exec cho `CMD` và `ENTRYPOINT`, hoặc `--init`.** Lý do: shell làm PID 1 không chuyển signal xuống Node (kiến thức từ tài liệu Docker; phần PID 1 bên trên đã chạy).
- **Tránh làm việc nặng/async chưa giới hạn trong handler signal.** Lý do: handler chạy trên event loop như mọi callback, có thể xung đột với việc đang dở; hãy đặt cờ "đang tắt" rồi để luồng chính tự dừng.
- **`SIGUSR1` bị Node dùng cho inspector/debugger** (theo tài liệu: bắt đầu debugger), nên đừng dùng nó cho logic riêng; `SIGUSR2` thì dùng được. Lý do: đăng ký sai signal sẽ xung đột với công cụ debug (chưa thử).
- **Debug "dừng chậm đúng N giây":** đó thường là hạn của orchestrator rồi SIGKILL. Kiểm tra có handler không, handler có thực sự dừng mọi thứ giữ event loop (server, interval, pool, kết nối keep-alive) không; `process.getActiveResourcesInfo()` (chưa thử) liệt kê cái còn sống.

## Liên hệ bài tập

Lab yêu cầu xử lý SIGINT/SIGTERM đúng cách với PID/lock file. Tự đặt các câu hỏi và dùng thí nghiệm để trả lời: chương trình có dọn lock file khi nhận SIGTERM không? khi bị `kill -9` thì lần chạy sau có phát hiện lock cũ không và quyết định thế nào? nhấn Ctrl+C hai lần thì sao? mã thoát khi dừng bằng signal là bao nhiêu và vì sao bạn chọn số đó? Viết kịch bản kiểm thử bằng `kill` từ shell hoặc từ tiến trình cha, có timeout, rồi dọn tiến trình con.

## Đọc thêm

- [Node.js: Signal events](https://nodejs.org/api/process.html#signal-events)
- [Node.js: `process.kill()`](https://nodejs.org/api/process.html#processkillpid-signal)
- [Node.js: Child process: `subprocess.kill()`](https://nodejs.org/api/child_process.html#subprocesskillsignal)

## Ghi chú của bạn

