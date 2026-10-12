# 2. Async I/O thật của OS và thread pool của libuv

Không phải mọi thao tác "bất đồng bộ" của Node đều chạy cùng một cơ chế: **mạng** dùng I/O không chặn của hệ điều hành (epoll), còn **file system, `dns.lookup`, một số hàm `crypto`/`zlib`** chạy trên **thread pool** có sẵn 4 thread.

```ts
import { pbkdf2 } from "node:crypto";

const t0 = performance.now();
const job = () =>
  new Promise<number>((res) =>
    pbkdf2("pw", "salt", 300_000, 64, "sha512", () => res(performance.now() - t0)),
  );
const done = await Promise.all(Array.from({ length: 5 }, job));
console.log(done.map((ms) => Math.round(ms)).join(" ms, ") + " ms");
```

Node 24.21, máy 12 core, mặc định: bốn tác vụ đầu xong quanh ~200ms, tác vụ thứ năm xong quanh ~400ms. Có 12 core rảnh mà tác vụ thứ năm vẫn phải xếp hàng, vì thread pool chỉ có 4 thread.

## Ý chính

- **Mạng (TCP, UDP, HTTP, TLS socket, pipe):** socket được đặt ở chế độ non-blocking, kernel báo "sẵn sàng" qua `epoll` (Linux). **Không tốn thread nào** trong lúc chờ, nên một process giữ được hàng chục nghìn kết nối.
- **Thread pool (`UV_THREADPOOL_SIZE`, mặc định 4):** dùng cho việc mà OS không cung cấp I/O bất đồng bộ dùng chung được, hoặc việc là tính toán nặng chạy "bất đồng bộ" bằng cách đẩy sang thread khác: `fs.*`, `dns.lookup`, `crypto.pbkdf2/scrypt/randomBytes/...`, `zlib` bất đồng bộ.
- Các tác vụ vượt quá số thread **xếp hàng**; chúng chờ trong hàng đợi chung của **cả process**. Một loại tác vụ nặng có thể làm "đói" loại khác (ví dụ đã đo: `dns.lookup` và `fs.readFile` bị chậm khi 4 `pbkdf2` đang chiếm pool).
- `dns.lookup` (mặc định của `http`/`net` khi connect theo hostname) dùng pool; `dns.resolve*` đi qua thư viện c-ares, **không** dùng pool.
- "Bất đồng bộ" **không** có nghĩa là "chạy song song trên nhiều core cho JS". Nó có nghĩa là thread JS không bị chặn trong lúc chờ.

## Lý thuyết chi tiết

**Vì sao mạng khác file?** Linux có cơ chế đa hợp sự kiện (`epoll`) cho socket: bạn đăng ký hàng nghìn socket, gọi một lệnh chờ, kernel trả về danh sách socket đã sẵn sàng. Một thread phục vụ hết. Với file thông thường, `epoll` không dùng được (file thường luôn "sẵn sàng" theo nghĩa của `epoll`, còn việc đọc thực sự có thể chặn do đĩa). Vì vậy libuv đẩy các lời gọi `read`, `open`, `stat`... **blocking** sang một thread trong pool, và thread JS nhận callback khi xong. (Libuv gần đây có thể dùng `io_uring` trên Linux cho một số thao tác file; đó là kiến thức từ tài liệu/phiên bản libuv, chưa thử, nên đừng giả định mọi `fs` luôn qua pool trong mọi phiên bản.)

**Bảng "chạy ở đâu"** (tổng hợp từ tài liệu Node/libuv; hai hàng cuối đã đo trong bài này):

| Thao tác | Chạy ở | Ghi chú |
|---|---|---|
| `net`, `http`, `tls`, `dgram` (socket) | epoll/non-blocking, thread JS | không dùng pool |
| `fs.readFile`, `fs.stat`, `fs.promises.*`... | thread pool | trừ `fs.watch` dùng cơ chế khác |
| `dns.lookup` | thread pool (gọi `getaddrinfo` blocking) | đọc cả `/etc/hosts`, theo cấu hình hệ thống |
| `dns.resolve4/6/...`, `Resolver` | c-ares, thread JS | hỏi thẳng DNS server, không đọc `/etc/hosts` |
| `crypto.pbkdf2`, `scrypt`, `randomBytes`, `generateKeyPair` (bản callback/promise) | thread pool | bản `*Sync` chặn thread JS |
| `zlib.gzip/deflate/...` bản bất đồng bộ | thread pool | bản `*Sync` chặn thread JS |
| `child_process` | tiến trình riêng, tín hiệu + pipe | không dùng pool |
| `setTimeout` | chính vòng lặp (timer heap) | không có thread nào "đếm giờ" |

**Thí nghiệm 1: pool bão hoà.** Chạy `n` tác vụ `pbkdf2` song song và đo thời gian xong. Mã đầy đủ:

```ts
import { pbkdf2 } from "node:crypto";
import { availableParallelism } from "node:os";

function one(): Promise<number> {
  const t = performance.now();
  return new Promise((res, rej) =>
    pbkdf2("pw", "salt", 300_000, 64, "sha512", (e) => (e ? rej(e) : res(performance.now() - t))),
  );
}
console.log("cores", availableParallelism(), "UV_THREADPOOL_SIZE", process.env.UV_THREADPOOL_SIZE ?? "(mặc định)");
for (const n of [1, 2, 4, 5, 8, 12]) {
  const t = performance.now();
  const each = await Promise.all(Array.from({ length: n }, one));
  console.log(`n=${n} tổng=${(performance.now() - t).toFixed(0)}ms, mỗi tác vụ ${Math.min(...each).toFixed(0)}-${Math.max(...each).toFixed(0)}ms`);
}
```

Kết quả Node 24.21, `availableParallelism() = 12` (làm tròn; số thay đổi nhẹ giữa các lần chạy):

| n | mặc định (pool = 4) | `UV_THREADPOOL_SIZE=12` |
|---|---|---|
| 1, 2, 4 | tổng ~200-220ms | tổng ~215-230ms |
| 5 | ~400-430ms (một tác vụ phải chờ vòng 2) | ~240ms |
| 8 | ~410ms | ~285ms |
| 12 | ~610-640ms (ba "đợt" 4+4+4) | ~360ms |

Hình dạng bậc thang (200 → 400 → 600ms) là dấu hiệu nhận biết thread pool bão hoà: thời gian của tác vụ lẻ nhảy lên đúng bội của thời gian một tác vụ. Với pool 12, 12 tác vụ mất ~360ms chứ không phải ~200ms: tăng tốc không tuyến tính khi nhiều thread cùng chạy (tranh chấp CPU/bộ nhớ, và `availableParallelism()` đếm luồng logic, không phải core vật lý; nguyên nhân chính xác chưa phân tích). Đừng kỳ vọng tuyến tính.

**Thí nghiệm 2: một loại việc làm đói loại khác.** Cho 4 `pbkdf2` nặng (~1 giây mỗi cái) chiếm hết pool, rồi đo ba thao tác nhỏ:

```ts
import { pbkdf2 } from "node:crypto";
import { lookup } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { createServer, connect } from "node:net";

async function time(label: string, fn: () => Promise<unknown>): Promise<void> {
  const t = performance.now();
  await fn();
  console.log(`${label.padEnd(34)} ${(performance.now() - t).toFixed(1)}ms`);
}
const tcpPing = () =>
  new Promise<void>((resolve) => {
    const srv = createServer((s) => s.end("ok")).listen(0, () => {
      const addr = srv.address();
      if (addr === null || typeof addr === "string") return;
      const c = connect(addr.port, "127.0.0.1");
      c.on("data", () => {});
      c.on("close", () => { srv.close(); resolve(); });
    });
  });

const probes: [string, () => Promise<unknown>][] = [
  ["dns.lookup(localhost)", () => lookup("localhost")],
  ["fs.readFile", () => readFile(import.meta.filename)],
  ["TCP loopback", tcpPing],
];
for (const [name, fn] of probes) await time(`[rảnh]     ${name}`, fn);
for (const [name, fn] of probes) {
  const busy = Array.from({ length: 4 }, () =>
    new Promise<void>((r) => pbkdf2("p", "s", 1_000_000, 64, "sha512", () => r())));
  await new Promise((r) => setTimeout(r, 20)); // để 4 tác vụ kịp chiếm pool
  await time(`[4 pbkdf2] ${name}`, fn);
  await Promise.all(busy);
}
```

Kết quả Node 24.21 (nhiều lần chạy, số dao động nhưng hình dạng giống nhau):

```text
[rảnh]     dns.lookup(localhost)   ~6-9ms   (lần đầu gồm khởi tạo)
[rảnh]     fs.readFile             ~1ms
[rảnh]     TCP loopback            ~8-18ms  (lần đầu gồm khởi tạo)
[4 pbkdf2] dns.lookup(localhost)   ~590-735ms
[4 pbkdf2] fs.readFile             ~600-845ms
[4 pbkdf2] TCP loopback            ~1-7ms
```

`dns.lookup` và `fs.readFile` bị kéo từ vài ms lên **~0,6-0,85 giây** vì xếp hàng sau `pbkdf2`; TCP loopback (epoll) **không bị ảnh hưởng**. Đây chính là kiểu sự cố production: endpoint đăng nhập băm mật khẩu bằng `pbkdf2`/`scrypt`/bcrypt-native đang tải cao, và đột nhiên các request chỉ đọc file hoặc gọi API ngoài theo hostname cũng chậm, dù chúng "không liên quan".

**Thí nghiệm 3: `dns.lookup` vs `dns.resolve`.** Với 4 `pbkdf2` đang chiếm pool, gọi `Resolver.resolve4` tới một địa chỉ DNS không tồn tại (để khỏi cần mạng):

```ts
import { pbkdf2 } from "node:crypto";
import { Resolver } from "node:dns/promises";

const r = new Resolver({ timeout: 300, tries: 1 });
r.setServers(["127.0.0.1:5399"]); // không có DNS server nào ở đây, chỉ để xem nó chạy ở đâu
const busy = Array.from({ length: 4 }, () =>
  new Promise<void>((res) => pbkdf2("p", "s", 1_000_000, 64, "sha512", () => res())));
await new Promise((res) => setTimeout(res, 20));
const t = performance.now();
const out = await r.resolve4("example.test").catch((e: NodeJS.ErrnoException) => e.code);
console.log("resolve4 xong sau", (performance.now() - t).toFixed(0), "ms ->", out);
await Promise.all(busy);
```

Đã thử: `resolve4` trả lỗi `ECONNREFUSED` sau ~1-23ms (các lần chạy khác nhau) trong khi pool bị chiếm, tức là **không** xếp hàng sau `pbkdf2`, khác với `lookup` ở thí nghiệm 2. (Thí nghiệm này không dùng mạng thật nên chỉ chứng minh "không dùng pool", không đo tốc độ tra cứu DNS thật.)

**Đổi kích thước pool.** `UV_THREADPOOL_SIZE` đọc **một lần**, lúc pool được khởi tạo (lần đầu có việc cần pool). Hai cách đặt, đã thử trên Linux, Node 24.21:

```ts
import { pbkdf2 } from "node:crypto";

process.env.UV_THREADPOOL_SIZE = "8"; // phải đặt TRƯỚC lần đầu dùng thread pool
const t = performance.now();
await Promise.all(Array.from({ length: 8 }, () => new Promise<void>((r) => pbkdf2("p", "s", 300_000, 64, "sha512", () => r()))));
console.log("8 tác vụ:", (performance.now() - t).toFixed(0), "ms");
```

Kết quả: ~317ms (pool 8 có hiệu lực). Nếu chạy một `pbkdf2` xong **rồi** mới gán `process.env.UV_THREADPOOL_SIZE`, 8 tác vụ mất ~492ms: **quá muộn, bị bỏ qua**. Tài liệu Node cho biết cách gán trong code không đáng tin trên mọi nền tảng (nhất là Windows); biến môi trường đặt trước khi khởi động process (`UV_THREADPOOL_SIZE=16 node server.js`) là cách chắc chắn. Giới hạn trên của libuv là 1024 (kiến thức từ tài liệu, chưa thử).

**Một thread pool, nhiều "khách".** Pool là tài nguyên **chung** của cả process (kể cả thư viện native như `bcrypt` hay `sharp` nếu chúng dùng libuv work queue). Tăng pool không tăng tốc độ tính toán nếu số core không đủ; nó chỉ cho phép nhiều tác vụ chạy đồng thời hơn, đổi lại tranh chấp CPU và tăng bộ nhớ.

## Tricks & tips thực tế

- **Băm mật khẩu: dùng bản bất đồng bộ, và biết rằng nó ăn thread pool.** Lý do: bản `Sync` chặn mọi request; bản async không chặn thread JS nhưng 4 lần đăng nhập đồng thời đã chiếm hết pool và làm chậm `fs`/`dns.lookup`. Nếu đăng nhập là đường nóng, hãy giới hạn số hash đồng thời (xem file 04) hoặc tăng `UV_THREADPOOL_SIZE` có tính toán.
- **Đừng đặt `UV_THREADPOOL_SIZE` > số core "cho chắc".** Lý do: việc ở pool phần lớn là CPU (hash, nén); thêm thread vượt số core không nhanh hơn mà còn tranh nhau CPU và tăng độ trễ của từng tác vụ. Với pool chủ yếu cho `fs`/`dns` (chờ đĩa/mạng), số lớn hơn có lợi. Đo với tải thật trước khi đổi.
- **Triệu chứng nhận biết pool nghẽn:** CPU của thread JS thấp (event loop lag thấp), nhưng các API dùng `fs`, `dns.lookup`, `crypto` chậm đồng loạt và độ trễ tăng theo bậc thang. Event loop lag cao thì ngược lại, là nghẽn ở thread JS (file 04).
- **Kết nối theo hostname trong `http`/`net` gọi `dns.lookup` mỗi lần.** Với dịch vụ gọi API ngoài nhiều, hãy dùng keep-alive (tái dùng socket nên ít tra cứu) và/hoặc cache DNS ở tầng ứng dụng/hệ điều hành. Lý do: mỗi lookup tiêu một slot pool và có thể chặn ~vài ms đến vài giây khi DNS chậm, làm đói các tác vụ `fs`.
- **`dns.lookup` và `dns.resolve` có thể cho kết quả khác nhau.** `lookup` tôn trọng `/etc/hosts`, `nsswitch`, mDNS của hệ điều hành; `resolve` chỉ hỏi DNS server. Một hostname chỉ có trong `/etc/hosts` (hay dùng trong Docker/dev) sẽ `resolve` thất bại nhưng `lookup` thành công.
- **Đừng giả định `fs` async nhanh hơn sync cho file nhỏ.** Mỗi lời gọi async tốn chi phí chuyển giao qua pool (xếp hàng, đánh thức thread, quay lại loop). Ở lúc khởi động (đọc config) dùng `readFileSync` hoàn toàn hợp lý; trong request handler thì dùng async để không chặn các request khác.
- **Debug nhanh:** `UV_THREADPOOL_SIZE=1 node app.js` làm nghẽn pool một cách có chủ đích; nếu ứng dụng chậm hơn hẳn thì bạn đang phụ thuộc nhiều vào pool. Kết hợp với `monitorEventLoopDelay` (file 04) để phân biệt "pool đói" và "thread JS bị chặn".

## Liên hệ bài tập

Lab "đọc nhiều file song song vs tuần tự" chạy trên thread pool. Hãy dự đoán: với 200 file nhỏ, song song nhanh gấp bao nhiêu lần tuần tự, và nếu đổi `UV_THREADPOOL_SIZE` thì kết quả đổi thế nào? Sau đó đo và giải thích chênh lệch bằng khái niệm "tối đa 4 thao tác `fs` đồng thời" và cache của hệ điều hành (lần đọc thứ hai nhanh hơn lần đầu). Cũng thử đo với số lượng file và kích thước khác nhau để thấy lúc nào song song không còn giúp ích.

## Đọc thêm

- [Node.js: `dns.lookup` vs `dns.resolve` (Implementation considerations)](https://nodejs.org/api/dns.html#implementation-considerations)
- [Node.js: Don't Block the Event Loop (hoặc Block the Worker Pool)](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)
- [libuv: Thread pool work scheduling](https://docs.libuv.org/en/v1.x/threadpool.html)
- [Node.js: `crypto.pbkdf2`](https://nodejs.org/api/crypto.html#cryptopbkdf2password-salt-iterations-keylen-digest-callback)

## Ghi chú của bạn
