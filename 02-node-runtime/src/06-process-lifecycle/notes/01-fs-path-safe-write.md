# 1. File system: `fs/promises`, `path` và ghi file an toàn

Dùng `fs/promises` cho code async; tính đường dẫn từ vị trí file code (`import.meta.dirname`), không từ thư mục chạy; và ghi file quan trọng theo kiểu "ghi tạm rồi `rename`".

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const text = await readFile(join(import.meta.dirname, "settings.json"), "utf8"); // không phụ thuộc cwd
console.log(text.length);
```

(Ví dụ giả định bạn có file `settings.json` cạnh file code.)

## Ý chính

- Ba kiểu API cho cùng việc: **callback** (`fs.readFile(p, cb)`), **sync** (`fs.readFileSync`), **promise** (`fs/promises`). Dùng `fs/promises` trong code bình thường; `*Sync` chỉ lúc khởi động (đọc config) hoặc script CLI; callback chủ yếu ở code cũ.
- `*Sync` **chặn event loop**: mọi request khác đứng chờ. Trong server đang chạy, một `readFileSync` file lớn làm cả dịch vụ khựng.
- Đường dẫn tương đối tính theo **`process.cwd()`** (thư mục nơi bạn chạy lệnh), không theo vị trí file code. Dùng `import.meta.dirname` / `import.meta.filename` (ESM, Node 20.11+/21.2+) hoặc `fileURLToPath(import.meta.url)`.
- `path.join` chỉ nối; `path.resolve` ra đường dẫn **tuyệt đối** và coi đoạn bắt đầu bằng `/` là gốc mới. Cả hai đều **không** chống path traversal bằng tự thân.
- Ghi file: `writeFile` **cắt (truncate) file trước rồi mới ghi**, nên người đọc/mất điện giữa chừng thấy file rỗng hoặc dở. Ghi vào file tạm cùng thư mục rồi `rename` thì thay thế nguyên tử.
- Flag `wx` = tạo file chỉ khi chưa tồn tại (nguyên tử): nền tảng cho lock file.
- Lỗi `fs` có `code` (`ENOENT`, `EEXIST`, `EACCES`, `EPERM`, `EMFILE`, `EXDEV`...). Dựa vào `code`, không dựa vào `message`.

## Lý thuyết chi tiết

**Ba kiểu API và event loop.** Phương thức `fs` (callback/promise) chạy việc đĩa ở thread pool của libuv (mặc định 4 thread), không chặn JS. `readFileSync` chạy ngay trên luồng JS và chặn. So sánh với PHP: PHP-FPM mỗi request một process nên `file_get_contents` chặn chỉ request đó; Node một luồng JS phục vụ mọi request, nên chặn ở đâu là chặn tất cả. Vì vậy `*Sync` an toàn ở lúc khởi động (trước khi `listen`) và nguy hiểm khi nằm trong handler.

```ts
import { readFile } from "node:fs/promises";

try {
  await readFile("/nope");
} catch (e) {
  const err = e as NodeJS.ErrnoException;
  console.log(err.code, err.syscall, err.errno, err.path);   // ENOENT open -2 /nope
}
```

**Đường dẫn trong ESM.** `__dirname` và `__filename` **không tồn tại** trong ES module (đã chạy: `typeof __dirname === "undefined"`). Thay bằng:

```ts
import { fileURLToPath } from "node:url";

console.log(import.meta.dirname);                       // thư mục chứa file này
console.log(import.meta.filename);                      // đường dẫn tuyệt đối của file này
console.log(fileURLToPath(import.meta.url) === import.meta.filename); // true
console.log(process.cwd() === import.meta.dirname);     // true hay false tuỳ bạn đứng ở đâu khi chạy
```

`import.meta.dirname`/`filename` có từ Node 20.11 / 21.2; ở bản cũ hơn dùng `dirname(fileURLToPath(import.meta.url))`. `import.meta.url` là URL kiểu `file:///...`: đưa nó cho `new URL("./data.json", import.meta.url)` cũng hợp lệ và nhiều API `fs` nhận trực tiếp URL.

Đã kiểm tra: `cd / && node /đường/dẫn/file.ts` vẫn in đúng `import.meta.dirname`, còn `process.cwd()` thì là `/`. Chạy bằng `npm run`, systemd, cron, PM2, Docker thì `cwd` thường khác bạn nghĩ; code dựa vào cwd là nguồn bug "chạy được trên máy tôi".

**`path`.**

```ts
import { join, resolve, basename, extname, relative, sep } from "node:path";

console.log(resolve("a", "../b"));        // <cwd>/b
console.log(join("/x", "..", "y"));       // /y
console.log(resolve("/x", "/y"));         // /y     (đoạn bắt đầu bằng / làm "reset")
console.log(join("/x", "/y"));            // /x/y   (join chỉ nối)
console.log(basename("/a/b.tar.gz"), extname("/a/b.tar.gz")); // b.tar.gz .gz
console.log(relative("/a/b", "/a/c/d"), sep);                  // ../c/d /
```

`path.join` và `resolve` khác ở chỗ đoạn tuyệt đối: người dùng gửi tên file `/etc/passwd` và bạn `resolve(base, name)` sẽ ra `/etc/passwd`, ngoài thư mục gốc.

**Path traversal (đã chạy).** Chuẩn hoá rồi kiểm tra tiền tố:

```ts
import { resolve, sep } from "node:path";

const base = resolve("/srv/uploads");
function safe(name: string): string | null {
  const p = resolve(base, name);
  return p.startsWith(base + sep) ? p : null;        // base + sep để "/srv/uploads-evil" không lọt
}
console.log(safe("a.txt"), safe("../x"), safe("/etc/passwd"));
// /srv/uploads/a.txt null null
```

Lưu ý: kiểm tra chuỗi không thấy **symlink** (link trong `uploads` trỏ ra ngoài). Nếu quan trọng, `realpath` rồi mới so sánh (cơ chế tài liệu, chưa thử).

**Ghi file an toàn (đã chạy).** `writeFile(path, data)` mở bằng flag `w`: cắt file về 0 byte, rồi ghi. Nếu tiến trình chết hoặc người khác đọc ở giữa, họ thấy file rỗng/dở. Mẫu an toàn:

```ts
import { open, rename, rm, readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function atomicWrite(path: string, data: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;   // cùng thư mục => cùng filesystem
  const fh = await open(tmp, "wx", 0o600);                  // wx: không đè file có sẵn
  try {
    await fh.writeFile(data);
    await fh.sync();                                        // ép xuống đĩa trước khi rename
  } finally {
    await fh.close();
  }
  try {
    await rename(tmp, path);                                // thay thế nguyên tử
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

const dir = await mkdtemp(join(tmpdir(), "atomic-"));
const target = join(dir, "state.json");
await atomicWrite(target, '{"v":1}');
await atomicWrite(target, '{"v":2}');
console.log(await readFile(target, "utf8"));                // {"v":2}
await rm(dir, { recursive: true });
```

`rename` trong cùng một filesystem là nguyên tử trên POSIX: người đọc thấy bản cũ hoặc bản mới, không bao giờ nửa chừng. **Khác filesystem thì `rename` thất bại** với `EXDEV` (đã chạy: `/tmp` -> `/dev/shm` trên WSL2). Vì vậy file tạm đặt cùng thư mục đích, không đặt ở `os.tmpdir()`. `fh.sync()` (fsync) bảo đảm dữ liệu xuống đĩa trước khi đổi tên, tránh mất điện cho ra file rỗng sau `rename`; có giá về tốc độ, dùng cho dữ liệu quan trọng. Muốn bền hẳn, fsync cả thư mục (chưa thử).

**Flag `wx` và lock.** Mở bằng `wx` ném `EEXIST` nếu file đã có, và việc "kiểm tra rồi tạo" là một thao tác nguyên tử ở nhân. Đã chạy:

```ts
import { writeFile, rm } from "node:fs/promises";

const p = "wx-demo.lock";
await writeFile(p, String(process.pid), { flag: "wx" });          // lần đầu: tạo
try {
  await writeFile(p, "x", { flag: "wx" });                        // lần hai
} catch (e) {
  console.log((e as NodeJS.ErrnoException).code);                 // EEXIST
}
await rm(p);
```

Tại sao không `if (!existsSync(p)) writeFile(p)`? Giữa kiểm tra và ghi có khoảng hở: hai tiến trình cùng thấy "chưa có" rồi cùng tạo (lỗi TOCTOU, time-of-check to time-of-use). `wx` đóng khoảng hở đó. Phần "file lock có thể bị bỏ lại khi tiến trình chết" xem file 03.

**Quyền (mode) và `umask`.** `mode` khi tạo file bị **`umask` của tiến trình che bớt**: yêu cầu `0o666` với umask `022` ra `0o644` (đã chạy: `umask` 22, file ra 644). `chmod` thì đặt đúng mode sau đó (666). Với file bí mật, mở bằng `0o600` ngay lúc tạo (như `atomicWrite` ở trên) thay vì tạo xong mới `chmod`: giữa hai lệnh, file đã ở quyền rộng.

**`mkdir` và `rm`.** `mkdir(p, { recursive: true })` tạo cả chuỗi thư mục, không lỗi nếu đã tồn tại, và trả `undefined` nếu không tạo gì (đã chạy); không có `recursive` thì ném `EEXIST`. `rm(p, { recursive: true, force: true })` tương đương `rm -rf`: cẩn thận biến đường dẫn rỗng hoặc sai.

**`fs.watch`: cạm bẫy.** API theo dõi thay đổi dựa vào cơ chế hệ điều hành (inotify trên Linux), **không nhất quán** giữa nền tảng; tài liệu cảnh báo thẳng. Đã chạy trên Linux (Node 24.21): `appendFile` và `writeFile` mỗi lần cho một sự kiện `change`, nhưng ghi nguyên tử kiểu "ghi tạm rồi rename" cho cả loạt sự kiện (`rename:a.txt.tmp`, `change:a.txt.tmp`, `rename:a.txt.tmp`, `rename:a.txt`). Cạm bẫy khác (theo tài liệu và kinh nghiệm chung, chưa thử hết): trùng sự kiện, thiếu `filename` ở vài nền tảng, editor lưu file bằng rename làm watcher mất file cũ, giới hạn số watcher inotify, mount WSL/Docker/NFS không phát sự kiện. Cần theo dõi thay đổi thật sự thì debounce (gom sự kiện trong vài chục ms), đọc lại trạng thái file thay vì tin vào loại sự kiện, hoặc dùng thư viện chuyên (chokidar). Đừng dựa vào `fs.watch` cho logic nghiệp vụ.

**`EMFILE` / fd.** Mỗi file mở dùng một file descriptor; mở quá nhiều đồng thời (ví dụ `Promise.all` 10 000 `readFile`) gặp `EMFILE: too many open files`. Giới hạn số lượng đồng thời (hàng đợi/semaphore tự viết, hoặc xử lý theo lô). Luôn `close()` FileHandle (dùng `try/finally`, hoặc `await using` nếu bản Node/TS của bạn hỗ trợ: chưa thử).

## Tricks & tips thực tế

- **Tính đường dẫn từ `import.meta.dirname`, không từ cwd.** Lý do: cwd phụ thuộc cách tiến trình được khởi chạy (cron, systemd, Docker `WORKDIR`, PM2), còn vị trí file code thì cố định.
- **Chỉ dùng `*Sync` trong bước khởi động hoặc script CLI.** Lý do: trong handler nó chặn mọi request; lúc khởi động thì chưa có request nào để chặn, và code đơn giản hơn.
- **File config/state quan trọng: ghi tạm cùng thư mục + `rename`.** Lý do: tránh người đọc thấy file nửa chừng, và tránh mất cả bản cũ khi chết giữa lúc ghi.
- **Bắt lỗi theo `code`.** `ENOENT` -> 404 hoặc "chưa có"; `EEXIST` -> xung đột; `EACCES`/`EPERM` -> cấu hình quyền sai; `EMFILE` -> giới hạn tài nguyên. Lý do: `message` thay đổi giữa phiên bản và hệ điều hành.
- **Đừng dùng `existsSync` rồi mới mở.** Cứ mở và bắt `ENOENT`. Lý do: tránh TOCTOU, và bớt một syscall.
- **Với tên file từ người dùng: `resolve` + kiểm tra `startsWith(base + sep)`; tốt hơn nữa là không dùng tên của họ, tự sinh tên (UUID) và lưu tên gốc trong DB.** Lý do: loại bỏ cả lớp lỗi path traversal và ký tự lạ trên mọi hệ điều hành.
- **`os.tmpdir()` chỉ cho file tạm không cần `rename` sang chỗ khác.** Lý do: dễ vướng `EXDEV`; dùng `mkdtemp` (như ví dụ) để có thư mục tạm riêng, không đụng nhau.
- **Dọn file tạm trong `finally`, nhưng cũng dọn khi khởi động** (file `.tmp` mồ côi của lần chết trước). Lý do: `finally` không chạy khi tiến trình bị `SIGKILL`/mất điện.
- **Debug `EACCES`:** `ls -ld` thư mục cha (cần quyền `x` để vào, `w` để tạo/xoá file), kiểm tra user chạy tiến trình (`process.getuid?.()`) và `umask`. Lý do: ghi file cần quyền ở **thư mục**, không chỉ ở file.
- **Với WSL:** làm việc trong filesystem Linux (`~`, `/var/www`) thay vì `/mnt/c`. Lý do: `/mnt/c` chậm hơn và `fs.watch`/permission hoạt động khác (theo kinh nghiệm chung, chưa đo ở đây).

## Liên hệ bài tập

Lab về PID/lock file chạm trực tiếp vào bài này: một lock file được tạo thế nào để hai tiến trình không thể cùng tạo thành công, và nếu tiến trình chết thì sao? Thử ghi file trạng thái theo hai cách (ghi thẳng và ghi tạm + rename) rồi tự "chết giữa chừng" bằng cách kill để xem khác biệt. Hỏi: file lock nên nằm ở thư mục nào, và ai dọn nó?

## Đọc thêm

- [Node.js: File system](https://nodejs.org/api/fs.html)
- [Node.js: Path](https://nodejs.org/api/path.html)
- [Node.js: `fs.watch` caveats](https://nodejs.org/api/fs.html#caveats)

## Ghi chú của bạn

