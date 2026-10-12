# 4. `child_process`: spawn, exec, execFile, fork, stdio, IPC và an toàn

`child_process` chạy một **process hệ điều hành riêng** (một chương trình khác hoặc một bản Node khác). Bốn hàm chính: `spawn` (luồng, linh hoạt nhất), `exec` (qua shell, gom output), `execFile` (không qua shell, gom output), `fork` (chạy file Node kèm kênh IPC).

```ts
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";

const execP = promisify(exec);
const execFileP = promisify(execFile);

const userInput = "hello; echo INJECTED"; // giả sử đến từ người dùng
const unsafe = await execP(`echo ${userInput}`);
const safe = await execFileP("echo", [userInput]);
console.log("exec    :", JSON.stringify(unsafe.stdout));
console.log("execFile:", JSON.stringify(safe.stdout));
```

Node 24.21 đã thử: `exec` in `"hello\nINJECTED\n"` (lệnh `echo INJECTED` bị chạy thật: **command injection**), `execFile` in `"hello; echo INJECTED\n"` (chuỗi là một đối số nguyên vẹn, không bị diễn giải).

## Ý chính

| Hàm | Qua shell? | Output | Dùng khi |
|---|---|---|---|
| `spawn(cmd, args)` | không (mặc định) | **stream** (`stdout`/`stderr`) | output lớn/dài, cần xử lý dần, chạy lâu |
| `execFile(file, args)` | không | gom vào chuỗi/Buffer, có `maxBuffer` | chạy chương trình, output nhỏ-vừa |
| `exec(commandString)` | **có** (`/bin/sh`) | gom, có `maxBuffer` | cần cú pháp shell (pipe, `&&`, glob) **và** chuỗi lệnh hoàn toàn do bạn kiểm soát |
| `fork(modulePath)` | không | stdio + **kênh IPC** | chạy một file Node làm con, trao đổi thông điệp |
| `execSync`, `spawnSync`... | tuỳ hàm | trả về khi xong | script/CLI; **không dùng trong server** (chặn event loop) |

- **Đừng ghép input người dùng vào chuỗi cho `exec`.** Dùng `execFile`/`spawn` với **mảng đối số**.
- Child process **không chia sẻ bộ nhớ** với cha; giao tiếp bằng stdio (byte) hoặc IPC (thông điệp có tuần tự hoá).
- Có hai kiểu "kết thúc": **exit code** (`0` là thành công) hoặc **signal** (bị kill, `code === null`). Phải xử lý cả hai.
- Lỗi không tìm thấy lệnh (`ENOENT`) đến qua sự kiện `error`, không phải `exit`.
- Khởi động process tốn hơn worker: `node -e 0` mất ~46ms trên máy này (Node 24.21), chưa kể nạp ứng dụng thật.

## Lý thuyết chi tiết

**`spawn`: stream, mức thấp nhất.**

```ts
import { spawn } from "node:child_process";

const c = spawn(process.execPath, ["-e", "for(let i=0;i<3;i++)console.log('dòng',i)"]);
c.stdout.setEncoding("utf8").on("data", (d: string) => console.log("chunk:", JSON.stringify(d)));
c.on("error", (e: NodeJS.ErrnoException) => console.error("không chạy được:", e.code));
c.on("close", (code, signal) => console.log("close", code, signal));
```

Chạy ra: `chunk: "dòng 0\n"`, `chunk: "dòng 1\ndòng 2\n"`, `close 0 null` (đã thử: hai dòng cuối có thể gộp vào một chunk, vì dữ liệu pipe đến theo khối, **không** theo dòng; đừng giả định một `data` = một dòng). `process.execPath` là đường dẫn tới chính binary Node đang chạy, nên ví dụ không phụ thuộc lệnh `node` trong PATH. Sự kiện `close` xảy ra **sau** khi process kết thúc **và** các stream stdio đã đóng; `exit` có thể đến sớm hơn lúc output chưa đọc hết. Muốn đọc đủ output thì dùng `close`.

**stdio.** Tham số `stdio` quyết định ba đầu cuối (stdin, stdout, stderr): mặc định `"pipe"` (cha nhận stream), `"inherit"` (dùng chung terminal của cha, tiện cho script/CLI), `"ignore"` (bỏ). Với `fork`, có thêm kênh IPC. Một lỗi thường gặp: dùng `"pipe"` nhưng **không đọc** stdout/stderr; khi output nhiều, pipe đầy và child bị **block** vì không ghi được (backpressure, nội dung Bài streams). Hoặc đọc hết, hoặc `ignore`/`inherit`.

**`maxBuffer` của `exec`/`execFile`.** Hai hàm này gom toàn bộ output vào bộ nhớ, giới hạn mặc định cỡ 1 MiB (kiến thức từ tài liệu, có thể đổi theo phiên bản). Vượt ngưỡng thì child bị kill và promise reject:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
try {
  await execFileP(process.execPath, ["-e", "process.stdout.write('x'.repeat(2000000))"], { maxBuffer: 1024 });
} catch (e) {
  console.log("lỗi:", (e as NodeJS.ErrnoException).code);
}
```

Đã thử: `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`. Với output lớn/không biết trước kích thước, dùng `spawn` và xử lý stream.

**Mã thoát và signal.** `promisify(exec)` reject khi exit code khác 0, với `error.code` là mã thoát (đã thử `exec("exit 3")` cho `code: 3`) và có `stdout`/`stderr` đính kèm. Khi bị kill bằng signal, `exit` có `code === null` và `signal` là tên signal. Có timeout:

```ts
import { spawn } from "node:child_process";

const s = spawn("sleep", ["10"], { timeout: 100 }); // hết 100ms thì gửi SIGTERM
s.on("close", (code, signal) => console.log("kết thúc:", code, signal, "killed =", s.killed));
```

Đã thử: `kết thúc: null SIGTERM killed = true`. `child.kill(signal)` gửi signal thủ công. Một child bắt `SIGTERM` thì có thể dọn dẹp rồi thoát; `SIGKILL` không bắt được. (Đã thử: child đăng ký `process.on("SIGTERM")` in ra "child nhận SIGTERM" và thoát code 0.)

**Command injection: bản chất và cách phòng.** `exec` truyền **cả chuỗi** cho `/bin/sh -c`, nên các ký tự đặc biệt của shell (`;`, `&&`, `|`, `` ` ``, `$(...)`, xuống dòng) được diễn giải. Với `execFile`/`spawn` và mảng đối số, Node gọi chương trình trực tiếp, mỗi phần tử là **một đối số nguyên vẹn** không qua shell. Nhưng còn hai cạm bẫy:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const userInput = "a.txt; echo PWNED";

console.log("shell:true  ->", JSON.stringify((await run("echo", [userInput], { shell: true })).stdout));
console.log("mặc định    ->", JSON.stringify((await run("echo", [userInput])).stdout));
console.log("không '--'  ->", JSON.stringify((await run("echo", ["-n", "x"])).stdout)); // "-n" bị hiểu là cờ của echo
```

Node 24.21: `shell: true` làm `execFile` **mất an toàn lại** (in `"a.txt\nPWNED\n"`) và Node phát cảnh báo `DEP0190` (đối số bị nối chuỗi, không escape); `-n` bị `echo` hiểu là **cờ** nên in `"x"` không có xuống dòng. Cái thứ hai gọi là **argument injection**: input người dùng bắt đầu bằng `-` có thể thành tuỳ chọn của chương trình. Cách phòng:

1. Đừng dùng `exec`/`shell: true` với bất kỳ phần nào do người dùng ảnh hưởng.
2. Nếu chương trình hỗ trợ, đặt `--` trước đối số vị trí để mọi thứ sau đó là dữ liệu (`ls -- "$name"`), hoặc **kiểm tra** input (allowlist: ký tự cho phép, độ dài, không bắt đầu bằng `-`).
3. Dùng thư viện/API chuyên dụng thay vì shell khi có (nén, resize ảnh...), và chạy child với quyền tối thiểu.
4. Không bao giờ ghép đường dẫn người dùng vào lệnh mà không `path.resolve` + kiểm tra thuộc thư mục cho phép (path traversal).

Đây là lớp lỗi tương tự `shell_exec`/`exec` ghép chuỗi trong PHP (phải dùng `escapeshellarg`); mô hình mảng đối số của `execFile`/`spawn` an toàn hơn vì **không có bước escape** để quên.

**`fork` và IPC.** `fork(modulePath, args)` chạy file Node làm child và mở kênh IPC hai chiều: cha dùng `child.send(msg)` và `child.on("message")`, con dùng `process.send(msg)` và `process.on("message")`:

```ts
import { fork } from "node:child_process";

if (process.send === undefined) {
  const child = fork(import.meta.filename, ["arg1"]);
  child.on("message", (m) => { console.log("parent nhận", m); child.send({ cmd: "bye" }); });
  child.on("exit", (code, sig) => console.log("child exit", code, sig));
  child.send({ cmd: "hi", d: new Date(0), m: new Map([[1, 2]]), big: 1 });
} else {
  process.on("message", (m: { cmd: string }) => {
    if (m.cmd === "bye") process.disconnect?.(); // đóng IPC để child tự thoát
    else process.send?.({ got: m, pid: process.pid, argv: process.argv.slice(2) });
  });
}
```

Đã thử trên Node 24.21 (chạy `.ts` trực tiếp): con nhận `argv` là `['arg1']`, `pid` khác cha; phía cha thấy `got: { cmd: 'hi', d: '1970-01-01T00:00:00.000Z', m: {}, big: 1 }`: **mặc định IPC dùng JSON**, nên `Date` thành chuỗi và `Map` thành `{}` (và BigInt sẽ ném lỗi). Muốn giữ kiểu như structured clone, đặt `serialization: "advanced"` trong option `fork` (đã thử: `Date` và `Map` giữ nguyên). Kênh IPC giữ **event loop của cha và con sống**: nếu con không `process.disconnect()` (hoặc cha không `child.disconnect()`/kill), cả hai không tự thoát. Ví dụ trên dùng `process.send === undefined` để phân biệt cha/con trong cùng file (với `fork`, `process.send` chỉ tồn tại ở con).

**`execSync` chặn event loop.**

```ts
import { execSync, exec } from "node:child_process";

const t = performance.now();
execSync("sleep 0.3");
console.log("execSync chặn main:", (performance.now() - t).toFixed(0), "ms");
let ticks = 0;
const iv = setInterval(() => ticks++, 10);
exec("sleep 0.3", () => { clearInterval(iv); console.log("exec async: main vẫn chạy", ticks, "tick"); });
```

Đã thử: `execSync` ~308ms với **0** tick của timer trong lúc đó (main bị đóng băng), còn `exec` bất đồng bộ cho ~29 tick 10ms (main vẫn phục vụ). Lý do giống mọi API `*Sync`: dùng được ở script khởi động, không dùng trong request.

**Child process vs worker thread.**

| | Worker thread | Child process |
|---|---|---|
| Cô lập | cùng process, heap riêng | process hệ điều hành riêng |
| Khởi động | ~50-60ms (đã đo) | ~46ms cho `node -e 0` (đã đo), nặng hơn khi ứng dụng lớn |
| Chia sẻ bộ nhớ | `SharedArrayBuffer` | không |
| Chạy chương trình không phải Node | không | có (ffmpeg, python, git) |
| Chết do crash native/OOM | có thể ảnh hưởng process | không ảnh hưởng cha |
| Giới hạn tài nguyên | `resourceLimits` (heap) | cgroup, ulimit, quyền người dùng riêng |

Chọn theo nhu cầu: việc JS CPU ngắn -> worker; chương trình ngoài hoặc cần cô lập mạnh -> child process.

## Tricks & tips thực tế

- **Mặc định `execFile`/`spawn` + mảng đối số; coi `exec` là ngoại lệ phải có lý do.** Lý do: không có bước escape thì không có chỗ quên escape; command injection là lỗ hổng nghiêm trọng (thực thi mã tuỳ ý trên server).
- **Luôn gắn `on("error")` cho `spawn`.** Lý do: lệnh không tồn tại (`ENOENT`) phát sự kiện `error` (đã thử); không có listener thì ném lỗi làm sập process.
- **Xử lý cả `code` và `signal` ở `close`.** Lý do: bị kill thì `code === null`; kiểm tra `code === 0` mà bỏ qua signal thì coi nhầm thành công hoặc báo lỗi mơ hồ.
- **Đặt `timeout` (và `killSignal`) cho child chạy chương trình ngoài.** Lý do: ffmpeg/ảnh hỏng/đầu vào lạ có thể treo vô thời hạn và giữ tài nguyên; `timeout` bảo đảm cuối cùng bị dọn.
- **Dùng `process.execPath` thay vì chuỗi `"node"`** khi chạy Node con. Lý do: bảo đảm cùng phiên bản/binary, và không phụ thuộc PATH của môi trường (cron, systemd, container).
- **Truyền biến môi trường tối thiểu** (`env: { PATH: ... }`) khi chạy chương trình không tin cậy. Lý do: mặc định child kế thừa `process.env` của cha (có thể chứa secret như `DB_PASSWORD`, API key).
- **Đừng truyền secret qua tham số dòng lệnh.** Lý do: đối số hiện trong `ps`/`/proc` cho người dùng khác trên máy; dùng biến môi trường hoặc stdin.
- **Dọn child khi cha thoát.** Lý do: child không tự chết khi cha crash (ở nhiều trường hợp trở thành process mồ côi, `detached` hay không tuỳ cấu hình); lắng nghe `SIGTERM`/`exit` ở cha và `kill()` các child, hoặc dùng `AbortSignal` (`signal` option) để huỷ.
- **Debug:** `NODE_DEBUG=child_process node app.js` log hoạt động của module (từ tài liệu, chưa thử); in `child.pid` và `child.spawnargs` khi lỗi; chạy lại đúng lệnh ở terminal để tách "lỗi ở Node" khỏi "lỗi ở chương trình con".
- **So với Laravel:** `Symfony\Process` (dùng trong Artisan) tương ứng `spawn`/`execFile` với mảng đối số; dạng chuỗi tương ứng `exec`. Cũng như ở Symfony, dạng mảng là mặc định nên dùng, còn `Process::fromShellCommandline` (tương ứng `exec`) chỉ khi thật cần cú pháp shell.

## Liên hệ bài tập

Phần lab "dùng child process chạy một lệnh": hãy dùng một lệnh vô hại và có output kiểm chứng được (ví dụ chạy `node -e` hoặc một lệnh hệ thống sẵn có), nhận stdout bằng stream, xử lý `ENOENT`, exit code khác 0, và timeout. Thử cố ý truyền input có `;` hoặc bắt đầu bằng `-` vào cả `exec` và `execFile` để tự quan sát khác biệt (chỉ với lệnh vô hại như `echo`). Nếu làm thêm `fork`, thử gửi một `Date`/`Map` qua IPC với hai chế độ `serialization` và ghi lại sự khác nhau.

## Đọc thêm

- [Node.js: Child process](https://nodejs.org/api/child_process.html)
- [Node.js: `child_process.spawn` và `shell` option (cảnh báo bảo mật)](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options)
- [Node.js: IPC `serialization` options](https://nodejs.org/api/child_process.html#advanced-serialization)
- [Node.js: Process (`process.send`, signal events)](https://nodejs.org/api/process.html)

## Ghi chú của bạn
