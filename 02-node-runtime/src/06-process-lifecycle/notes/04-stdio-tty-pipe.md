# 4. stdin/stdout/stderr, TTY và pipe

Cùng một `console.log` có thể ghi vào terminal, file hay pipe; Node chọn loại stream khác nhau cho từng trường hợp, và hành vi (màu, đồng bộ, lỗi `EPIPE`) khác theo.

```ts
console.log("stdout.isTTY:", process.stdout.isTTY);        // true ở terminal, undefined khi bị chuyển hướng
console.log("stdout là:", process.stdout.constructor.name); // WriteStream | SyncWriteStream | Socket
```

## Ý chính

- `process.stdin`, `process.stdout`, `process.stderr` là **stream** (Readable/Writable) ứng với file descriptor 0, 1, 2.
- `stdout` dành cho **kết quả** (dữ liệu chương trình sinh ra, để người/chương trình khác dùng), `stderr` dành cho **log và lỗi**. `app > out.txt` chỉ chuyển hướng stdout; log trên stderr vẫn hiện ra terminal. `console.log` ghi stdout, `console.error`/`console.warn` ghi stderr.
- `isTTY` cho biết đầu ra có phải terminal tương tác không. Khi bị chuyển hướng (pipe, file, CI, tiến trình cha `spawn`) thì `isTTY` là `undefined`.
- Loại stream tuỳ đích: terminal -> `tty.WriteStream`; file -> `SyncWriteStream` (đã chạy khi chuyển ra file); pipe -> `net.Socket` (đã chạy với `| cat`).
- Ghi tới pipe mà **đầu đọc đã đóng** (ví dụ `| head -2`) cho `EPIPE`; nếu không bắt `error` trên `stdout`, tiến trình ném lỗi và sập (đã chạy).
- Đọc stdin bằng stream (`for await (const c of process.stdin)`) hoặc `readFileSync(0)` cho script đơn giản.

## Lý thuyết chi tiết

**TTY vs pipe (đã chạy bằng cách bọc trong `script -qec` để có TTY giả, Node 24.21).**

| Chạy | `stdout.isTTY` | `stdout.constructor.name` |
|---|---|---|
| terminal (qua `script`) | `true` | `WriteStream` |
| `node f.ts \| cat` | `undefined` | `Socket` |
| `node f.ts > out.txt` | `undefined` | `SyncWriteStream` |

Đồng thời `process.stdout.columns` (số cột) chỉ có khi là TTY. Một chi tiết nhỏ nhưng dễ thấy: khi là TTY, `console.log` tô màu số/chuỗi/`undefined` trong object in ra (đã thấy mã màu ANSI ở đầu ra `script`); khi là pipe/file thì in thuần chữ. Nghĩa là log ghi ra file không lẫn mã màu, và code của bạn tự thêm màu thì phải kiểm tra `isTTY` (hoặc biến `NO_COLOR` theo quy ước chung) rồi mới tô.

**Đồng bộ hay bất đồng bộ?** Theo tài liệu Node: file và TTY ghi **đồng bộ**; pipe và socket ghi **đồng bộ trên Linux**, bất đồng bộ trên một số nền tảng khác (kiến thức từ tài liệu, chỉ thử trên Linux). Hệ quả: trên Linux, ghi stdout hiếm khi bị cắt khi gọi `process.exit()`, nhưng đừng viết code chỉ đúng trên Linux; khi cần chắc chắn, đợi callback của `write` hoặc `finish`. Đồng bộ cũng có nghĩa là một `console.log` vào pipe chậm (người đọc chậm) **chặn luồng JS** tới khi pipe có chỗ: log quá nhiều là một nguyên nhân giảm throughput thật.

**`EPIPE` (đã chạy).** Chương trình in một triệu dòng, người dùng chạy `node app.ts | head -2`: `head` thoát sau hai dòng, đóng đầu đọc; lần ghi kế tiếp của Node nhận `EPIPE` và, vì không có listener `error` trên `process.stdout`, ném lỗi và dừng chương trình (thấy trace `Error: write EPIPE`). Cách xử lý thường thấy ở công cụ dòng lệnh:

```ts
process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EPIPE") process.exit(0);   // người đọc đã đủ dữ liệu: không phải lỗi của ta
  throw e;
});
for (let i = 0; i < 1e6; i++) console.log("line", i);
```

Chạy `node f.ts | head -2` ra hai dòng, mã thoát của node là 0 (đã chạy). Trong shell, mã thoát của cả pipeline là mã của lệnh cuối (`head`); dùng `${PIPESTATUS[0]}` (bash) hoặc `set -o pipefail` để lấy mã của `node`.

**Đọc stdin.** Hai kiểu hay dùng:

```ts
let s = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) s += chunk;      // stream: không chặn event loop
console.log(JSON.stringify(s));                           // vd: echo -e "a\nb" | node f.ts  ->  "a\nb\n"
```

```ts
import { readFileSync } from "node:fs";
console.log(JSON.stringify(readFileSync(0, "utf8")));     // đồng bộ, fd 0: ngắn gọn cho script
```

Cả hai đã chạy và cho cùng kết quả. `readFileSync(0)` khi stdin là terminal sẽ đợi người dùng gõ tới Ctrl+D; nếu stdin bị đóng/không có thì có thể trả rỗng hoặc ném lỗi tuỳ môi trường (chưa thử hết trường hợp). Với dữ liệu lớn dùng stream và `pipeline`: stdin/stdout chính là Readable/Writable nên ghép trực tiếp vào chuỗi xử lý, ví dụ `await pipeline(process.stdin, transform, process.stdout)`.

**`stdio` khi spawn tiến trình con.** Mặc định `spawn` tạo pipe cho 3 fd; `stdio: "inherit"` cho con dùng chung terminal của cha; `"ignore"` bỏ. Con ghi nhiều ra stdout mà cha không đọc thì pipe đầy, **con bị chặn** (backpressure đúng nghĩa ở mức hệ điều hành). Dùng `exec`/`execFile` thì có giới hạn `maxBuffer` (mặc định 1 MiB ở bản gần đây; kiểm tra bản của bạn), vượt thì bị giết; dữ liệu lớn dùng `spawn` + stream.

**Log của dịch vụ.** Quy ước 12-factor: dịch vụ **ghi log ra stdout/stderr** (thường là JSON mỗi dòng), còn việc gom/lưu là của môi trường (Docker, systemd-journald, Kubernetes, PM2). Đừng tự mở file log và xoay vòng trong app nếu môi trường đã lo.

## Tricks & tips thực tế

- **Kết quả ra stdout, log/lỗi ra stderr.** Lý do: `app > result.json` hay `app | jq` chỉ nhận dữ liệu sạch; log lẫn vào làm hỏng pipeline.
- **Kiểm tra `process.stdout.isTTY` trước khi tô màu hoặc vẽ thanh tiến trình (`\r`).** Lý do: ghi mã ANSI/`\r` vào file hoặc log tập trung làm rác; CI và Docker thường không phải TTY.
- **Bắt `EPIPE` trên `stdout` cho công cụ CLI có thể bị `| head`.** Lý do: đó là cách dùng bình thường, không đáng crash với stack trace.
- **Không `console.log` hàng loạt trong đường nóng của server.** Lý do: ghi đồng bộ vào pipe/file chặn luồng JS; dùng logger có đệm/bất đồng bộ (cân nhắc ở phần logging của project) hoặc giảm mức log.
- **Ghi ra stdout từ stream lớn bằng `pipeline(src, process.stdout)`, nhưng nhớ `{ end: false }` nếu còn muốn ghi tiếp.** Lý do: `pipeline` mặc định gọi `end()` ở đích; `process.stdout` không đóng thật được, nhưng để tránh bất ngờ hãy khai báo tường minh (đã chạy với `end: false` ở ví dụ đa bước).
- **Debug "chạy ở terminal đúng, trong CI/systemd sai":** in `isTTY` của 3 stream, `process.env.TERM`, `NO_COLOR`, `process.stdout.columns`. Lý do: nhiều khác biệt nằm ở TTY hay không (màu, độ rộng, hỏi đáp tương tác).
- **Chương trình tương tác (hỏi y/n) phải kiểm tra `process.stdin.isTTY`** và có tuỳ chọn `--yes`. Lý do: trong CI/cron không ai trả lời, chương trình treo mãi.
- **Với test, chụp stdout bằng cách chạy tiến trình con và đọc pipe, thay vì mock `process.stdout.write`.** Lý do: đúng như cách người dùng/CI thật sự nhìn thấy, gồm cả mã thoát.
- **Để thử hành vi TTY trong môi trường không có terminal (CI, tool tự động)** dùng `script -qec "node f.ts" /dev/null` (Linux, đã chạy). Lý do: giả lập TTY mà không cần terminal thật.

## Liên hệ bài tập

Chương trình ở lab có thể in tiến trình hay log trạng thái: nên đi ra stdout hay stderr, và khác nhau thế nào khi người dùng chạy `prog | tee log.txt`? Nếu bạn in dòng tiến trình có `\r`, nó có ý nghĩa khi `stdout` không phải TTY không? Thử cho chương trình của bạn chạy dưới `| head` để xem có bắt được `EPIPE` không.

## Đọc thêm

- [Node.js: Process I/O](https://nodejs.org/api/process.html#a-note-on-process-io)
- [Node.js: `tty`](https://nodejs.org/api/tty.html)
- [Node.js: Readline / stdin](https://nodejs.org/api/readline.html)

## Ghi chú của bạn

