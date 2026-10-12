# 5. File lớn, `readline` và Web Streams

Với file lớn, đọc nguyên khối (`readFile`) đòi RAM tỉ lệ với kích thước file; stream/readline chỉ giữ vài chunk, và bạn **đo** được sự khác biệt.

```ts
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

let n = 0;
for await (const _line of createInterface({ input: createReadStream("some.log"), crlfDelay: Infinity })) { void _line; n++; }
console.log(n);
```

## Ý chính

- `readFile` nạp **toàn bộ** vào bộ nhớ (Buffer, rồi thường thêm một chuỗi). File 100 MB tốn >200 MB RSS; file lớn hơn RAM/giới hạn thì lỗi hoặc OOM.
- Stream đọc theo chunk 64 KiB: RSS gần như phẳng bất kể kích thước file.
- `readline` (`createInterface`) tách dòng từ stream, xử lý `\n`, `\r\n` và ranh giới chunk. Dùng cùng `for await`.
- Tự tách dòng từ chunk phải xử lý: dòng bị cắt giữa hai chunk, ký tự UTF-8 bị cắt (file 01), và `\r` thừa của `\r\n`.
- **Web Streams** (`ReadableStream`, `TransformStream`) là chuẩn của trình duyệt, có sẵn trong Node, dùng chung với `fetch`. Chuyển qua lại bằng `Readable.toWeb` / `Readable.fromWeb`.
- Đo bộ nhớ bằng RSS của tiến trình thật, chạy mỗi phương án trong **tiến trình riêng**.

## Lý thuyết chi tiết

**Đo RSS thật (đã chạy, Node 24.21).** Tạo file log giả khoảng 106 MB (1,5 triệu dòng), đếm số dòng bằng bốn cách, mỗi cách một tiến trình riêng, lấy RSS đỉnh mỗi 5 ms. Tiến trình Node trống: ~44 MB.

```ts
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

const mode = process.argv[2]!, file = process.argv[3]!;
let peak = 0;
const t = setInterval(() => { peak = Math.max(peak, process.memoryUsage.rss()); }, 5);
let lines = 0;

if (mode === "readFile") {
  lines = (await readFile(file, "utf8")).split("\n").length - 1;
} else if (mode === "stream") {
  await pipeline(createReadStream(file), new Transform({
    transform(chunk: Buffer, _enc, cb) { for (const byte of chunk) if (byte === 10) lines++; cb(); },
  }));
} else {
  for await (const _l of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) { void _l; lines++; }
}
clearInterval(t);
console.log(mode, lines, "peak RSS MB", (Math.max(peak, process.memoryUsage.rss()) / 1048576).toFixed(0));
```

Cách chạy: `node measure.ts readFile big.log` rồi các mode khác (mỗi lần một tiến trình). Kết quả của tôi:

| Cách | RSS đỉnh | Thời gian |
|---|---|---|
| `readFile(f, "utf8")` rồi `split` | **234 MB** | 475 ms |
| `readFile(f)` (Buffer), đếm byte bằng `for...of` (biến thể không có trong đoạn mã trên) | 174 MB | 1430 ms |
| `createReadStream` + `Transform` đếm `\n` | **102 MB** | 1008 ms |
| `readline` + `for await` | **88 MB** | 436 ms |

Rút ra:

1. Hai cách đọc cả file (174-234 MB) tốn nhiều hơn kích thước file; cách stream ở mức ~90-100 MB, **không đổi** nếu file lớn gấp 10 (suy luận theo cơ chế; chỉ đo ở 106 MB, vì không tạo file lớn hơn).
2. RSS của stream (88-102 MB) cao hơn baseline 44 MB vì V8 chưa vội thu gom rác (GC lười), không vì giữ dữ liệu. Muốn tách phần dữ liệu thật khỏi phần "rác chưa thu", hãy theo dõi `heapUsed` thay vì chỉ RSS.
3. **Thời gian không phải lúc nào cũng "stream chậm hơn/nhanh hơn":** ở đây `readFile` rồi `split` nhanh (475 ms), `readline` nhanh tương đương (436 ms), còn cách `for...of` từng byte là điểm nghẽn CPU (1,0-1,4 s) và **không liên quan** tới việc có stream hay không. Vòng lặp từng byte trong JS chậm hơn `buf.indexOf(10)`; stream chỉ quyết định bộ nhớ, còn thời gian phụ thuộc phần xử lý.
4. Con số tuyệt đối thay đổi theo máy, GC, kích thước file. Đừng trích số của tôi; hãy tự đo với dữ liệu của bạn.

Tạo dữ liệu giả để đo (đã dùng, khác với lab vì chỉ sinh dữ liệu): một vòng ghi có backpressure vào `createWriteStream`.

```ts
import { createWriteStream } from "node:fs";
import { once } from "node:events";

const out = createWriteStream("fake.log");
const line = "2026-10-12T10:00:00Z INFO user=12345 path=/api/orders status=200 ms=17\n";
for (let i = 0; i < 1_500_000; i++) {
  if (!out.write(line)) await once(out, "drain");   // bắt buộc có backpressure, ngay cả khi sinh dữ liệu
}
out.end(); await once(out, "finish");
```

**`readline`.** `createInterface({ input })` trả đối tượng vừa là EventEmitter (`line`, `close`) vừa là async iterable. Điểm mạnh: nó xử lý ranh giới chunk và UTF-8 cho bạn. Đã chạy với chunk nhỏ 7 byte để ép ranh giới nằm giữa dòng và giữa ký tự:

```ts
import { createReadStream, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

writeFileSync("rl-demo.tmp", "dòng một\ndòng hai\r\ndòng ba");
const out: string[] = [];
for await (const l of createInterface({ input: createReadStream("rl-demo.tmp", { highWaterMark: 7 }), crlfDelay: Infinity })) out.push(l);
console.log(out); // [ 'dòng một', 'dòng hai', 'dòng ba' ]  (\r\n đã được xử lý, dòng cuối không có \n vẫn có mặt)
```

`crlfDelay: Infinity` bảo `readline` luôn coi `\r\n` là một dấu xuống dòng dù `\r` và `\n` đến ở hai chunk khác nhau. Bỏ nó thì có nguy cơ tách thành hai dòng nếu hai ký tự cách xa nhau (tài liệu: mặc định 100 ms; chưa thử tái hiện).

**Tự tách dòng (khi cần nhanh hơn hoặc kiểm soát hoàn toàn).** Phải giữ phần dở của chunk cuối cho lần sau, và dùng `StringDecoder` để không phá ký tự đa byte:

```ts
import { createReadStream, writeFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

writeFileSync("sp-demo.tmp", "dòng một\ndòng hai\r\ndòng ba");
let carry = "";
const dec = new StringDecoder("utf8");
const lines: string[] = [];
for await (const c of createReadStream("sp-demo.tmp", { highWaterMark: 7 })) {
  carry += dec.write(c as Buffer);
  const parts = carry.split("\n");
  carry = parts.pop() ?? "";           // phần chưa có \n: giữ lại
  lines.push(...parts);
}
carry += dec.end();
if (carry) lines.push(carry);
console.log(lines); // [ 'dòng một', 'dòng hai\r', 'dòng ba' ]  <- \r còn nguyên: readline đã lo hộ
```

Chú ý `\r` còn sót ở `dòng hai\r`: tự tách dòng không xử lý CRLF. Và ngược lại, nếu một dòng có thể dài vô hạn (file không có `\n`), `carry` phình mãi; cần đặt trần.

**`setEncoding` để chunk là chuỗi.** `createReadStream(f, { encoding: "utf8" })` dùng decoder trong stream, mỗi chunk là chuỗi hợp lệ UTF-8 (đã chạy với chunk 7 byte: không có `�`), nhưng ranh giới dòng vẫn do bạn lo.

**Web Streams ở mức giới thiệu.** Chuẩn WHATWG: `ReadableStream`, `WritableStream`, `TransformStream`, với `pipeThrough`/`pipeTo` và backpressure qua hàng đợi nội bộ. Có sẵn ở global trong Node; `fetch()` trả `response.body` là `ReadableStream`. So với Node streams: API khác (không có `EventEmitter`, `write()` trả Promise/`ready`), chạy giống nhau ở trình duyệt, Deno, Bun, edge runtime. Node streams vẫn là nền của `fs`, `http`, `net`, `zlib`, nên backend Node dùng chủ yếu Node streams, và chuyển đổi khi cần:

```ts
import { Readable } from "node:stream";

const rs = new ReadableStream<string>({ start(c) { c.enqueue("a"); c.enqueue("b"); c.close(); } });
const upper = rs.pipeThrough(new TransformStream<string, string>({
  transform(chunk, ctl) { ctl.enqueue(chunk.toUpperCase()); },
}));
const out: string[] = [];
for await (const x of upper) out.push(x);
console.log(out);                                   // [ 'A', 'B' ]  (ReadableStream cũng là async iterable ở Node 24.21)

const res = new Response("xyz");
const node = Readable.fromWeb(res.body as never);   // Web -> Node  (as never: typings hai bên chưa khớp hoàn toàn)
console.log(node.readableObjectMode);               // false
```

`Readable.toWeb(nodeReadable)` đi chiều ngược lại (đã chạy với `createReadStream`, đọc đủ 100/100 byte). Ép kiểu `as never`/`as unknown as ...` ở biên là hiện tượng thường gặp vì typings của `node:stream/web` và lib DOM không trùng khớp; đây là điểm cần cẩn thận, không phải cách "đúng" tối ưu.

**Cạm bẫy khi đo RSS.** `process.memoryUsage().rss` là bộ nhớ vật lý của cả tiến trình (heap V8, Buffer ngoài heap, code, thư viện). Đo từ trong tiến trình bằng `setInterval` có thể bỏ sót đỉnh ngắn (và timer cũng không chạy khi vòng lặp đang bận); `process.resourceUsage().maxRSS` (KB trên Linux, đã chạy, trả 180480 trong một thử nghiệm khác) cho đỉnh thật sự khi kết thúc. Đo từ bên ngoài bằng `/usr/bin/time -v node ...` (dòng "Maximum resident set size") cũng được (chưa thử).

## Tricks & tips thực tế

- **Với file text lớn cần xử lý theo dòng: `readline` + `for await` trước, tự tách dòng sau.** Lý do: `readline` đã đúng về CRLF, UTF-8 và ranh giới chunk, và ở phép đo trên nhanh bằng cách đọc cả file.
- **Luôn `crlfDelay: Infinity` khi đọc file theo dòng.** Lý do: đảm bảo `\r\n` là một dấu xuống dòng; file từ Windows hay gặp.
- **Đặt trần cho thứ bạn gom** (kích thước dòng, số phần tử mảng trong bộ nhớ, bảng đếm theo khoá). Lý do: stream chỉ bảo vệ khỏi việc nạp *toàn bộ file*; `Map` đếm theo `userId` với hàng triệu khoá vẫn phình.
- **Đo trong tiến trình riêng, mỗi phương án một lần chạy.** Lý do: bộ nhớ của lần chạy trước còn trong tiến trình (heap chưa trả về OS), làm số liệu sau sai.
- **Chọn phép đo phù hợp:** dùng `process.memoryUsage.rss()` (rẻ hơn `memoryUsage()`), và theo dõi `heapUsed` để tách phần JS, `external`/`arrayBuffers` để tách Buffer. Lý do: biết bộ nhớ đi đâu mới tối ưu đúng chỗ.
- **Đừng dùng `for...of` từng byte để đếm/duyệt trên Buffer lớn khi có `buf.indexOf(10, pos)`**: đo của tôi là cách byte-by-byte tốn 1,0-1,4 s so với 0,4 s của `readline` cho 106 MB. Lý do: vòng lặp JS từng byte chạy chậm hơn hàm tìm kiếm viết bằng C++ (số liệu đo thật nêu ở trên; `indexOf` tôi chưa đo riêng).
- **Khi dữ liệu là CSV có ngoặc kép chứa dấu xuống dòng, tách theo `\n` là sai.** Lý do: `"a\nb"` nằm trong một ô; cần parser CSV đúng chuẩn, đừng tự split.
- **Chọn Web Streams khi code phải chạy cả ở trình duyệt/edge; chọn Node streams cho phần lớn backend Node.** Lý do: hệ sinh thái Node (`fs`, `http`, `zlib`) dựng trên Node streams, còn Web Streams cho tính di động.
- **Debug rò bộ nhớ dưới tải:** chạy với `node --inspect` rồi chụp heap snapshot từ Chrome DevTools, hoặc `--heapsnapshot-signal=SIGUSR2` (chưa thử) để chụp khi gửi tín hiệu. Lý do: chụp hai snapshot cách nhau và so sánh cho thấy đối tượng nào tăng.

## Liên hệ bài tập

Lab cần đo memory khi xử lý file lớn. Tạo một file đủ lớn (vài trăm nghìn dòng trở lên, vài chục MB là đủ để thấy khác biệt, và **đừng** vượt vài trăm MB trên máy học), chạy phương án nạp cả file và phương án stream trong hai tiến trình riêng, ghi lại RSS đỉnh. Tự hỏi: số của bạn có đổi thế nào khi file gấp đôi? Và nếu bạn gom kết quả theo khoá (ví dụ đếm theo trường nào đó), cái gì mới là thứ giới hạn bộ nhớ thật sự?

## Đọc thêm

- [Node.js: readline](https://nodejs.org/api/readline.html)
- [Node.js: Web Streams API](https://nodejs.org/api/webstreams.html)
- [Node.js: `process.memoryUsage()`](https://nodejs.org/api/process.html#processmemoryusage)
- [Node.js learn: Backpressuring in Streams](https://nodejs.org/en/learn/modules/backpressuring-in-streams)

## Ghi chú của bạn

