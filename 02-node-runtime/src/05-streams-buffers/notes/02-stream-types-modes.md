# 2. Bốn loại stream, chế độ flowing/paused và `highWaterMark`

Stream là cách xử lý dữ liệu theo từng mảnh (chunk) thay vì cả khối; mỗi stream có một **bộ đệm nội bộ** có giới hạn mềm gọi là `highWaterMark`.

```ts
import { Readable } from "node:stream";

const r = Readable.from(["a", "b", "c"]);
console.log(r.readableFlowing);          // null  (chưa ai đọc)
r.on("data", () => {});
console.log(r.readableFlowing);          // true  (gắn 'data' => flowing)
r.pause();
console.log(r.readableFlowing);          // false (paused chủ động)
```

(Node 24.21 đã chạy.)

## Ý chính

- Bốn loại: **Readable** (nguồn), **Writable** (đích), **Duplex** (hai chiều độc lập, như socket TCP), **Transform** (Duplex mà đầu ra là hàm của đầu vào, như `zlib.createGzip()`).
- Mọi stream là `EventEmitter`. Quan trọng nhất: `data`, `end`, `error`, `close` (Readable); `drain`, `finish`, `error`, `close` (Writable).
- Readable có hai chế độ: **flowing** (dữ liệu tự đẩy qua sự kiện `data`) và **paused** (bạn kéo bằng `read()` khi có `readable`). Vừa tạo xong là `readableFlowing === null`: chưa chảy.
- `highWaterMark` là **ngưỡng** của bộ đệm, đo bằng byte (hoặc số object ở object mode). Nó không phải trần cứng: vượt ngưỡng thì stream *báo hiệu* "dừng đẩy", không từ chối dữ liệu.
- Lỗi `error` không có listener là **ném ra và làm sập tiến trình** (đã chạy ở file 04).

## Lý thuyết chi tiết

**Vì sao cần stream.** Một HTTP response 2 GB, một file log 10 GB, hay một luồng nén dữ liệu đều không thể (hoặc không nên) nằm gọn trong RAM. Laravel có `response()->stream()`, `LazyCollection::cursor()` hay `fopen` + `fgets` (đọc từng dòng) cho cùng mục đích; Node đưa ý tưởng đó vào cả nền tảng: `fs`, `http`, `net`, `zlib`, `crypto`, `process.stdout` đều là stream.

**Giá trị mặc định (Node 24.21 đã đo).**

| Stream | `highWaterMark` |
|---|---|
| `fs.createReadStream` | 65536 byte (64 KiB) |
| `fs.createWriteStream` | 65536 byte |
| `new Readable({...})` mặc định | 65536 byte |
| `Transform` (phía ghi) | 65536 byte |
| Bất kỳ stream nào ở `objectMode` | 16 (object) |

Tài liệu và bài viết cũ ghi 16 KiB cho Readable/Writable; Node 24 đã tăng lên 64 KiB. Đừng thuộc số này, hãy đọc `stream.readableHighWaterMark` / `writableHighWaterMark` khi cần.

**Bốn loại, bốn hàm bạn cài.**

```ts
import { Readable, Writable, Transform } from "node:stream";

const src = new Readable({ read() { /* gọi this.push(chunk) khi có, this.push(null) khi hết */ } });
const sink = new Writable({ write(chunk, _enc, cb) { /* xử lý chunk */ cb(); } });
const upper = new Transform({ transform(chunk, _enc, cb) { cb(null, String(chunk).toUpperCase()); } });
void src; void sink; void upper;
```

- Readable: bạn cài `read()` (hoặc dùng `Readable.from(iterable)` cho phần lớn trường hợp).
- Writable: bạn cài `write(chunk, enc, cb)`. **Bắt buộc gọi `cb()`** khi xong (hoặc `cb(err)`); quên gọi nghĩa là stream coi chunk đó chưa xử lý xong và nghẽn mãi.
- Transform: `transform(chunk, enc, cb)`, tuỳ chọn `flush(cb)` để đẩy phần còn lại khi kết thúc đầu vào.
- Duplex: hai phía độc lập (đọc không liên quan ghi).

**Bên trong Writable.** Mỗi `write()` đưa chunk vào hàng đợi nội bộ; `writableLength` là tổng kích thước đang đợi; `_write` chỉ xử lý **một chunk một lúc**, chunk sau chờ `cb()` của chunk trước. Cái này giải thích vì sao sink chậm thì hàng đợi phình (file 03).

```ts
import { Writable } from "node:stream";

const w = new Writable({ highWaterMark: 10, write(_c, _e, cb) { setTimeout(cb, 5); } });
console.log(w.write("12345"), w.writableLength);   // true 5     (5 < 10)
console.log(w.write("123456"), w.writableLength);  // false 11   (11 >= 10: đã chạm ngưỡng)
console.log(w.writableNeedDrain);                  // true
w.on("drain", () => console.log("drain", w.writableLength)); // drain 0, sau khi hàng đợi cạn
```

Chú ý: chunk thứ hai **vẫn được nhận** (độ dài lên 11) dù `write()` trả `false`. `false` là lời nhắn, không phải lệnh từ chối.

**Flowing vs paused.**

- Gắn listener `data`, gọi `.pipe()`, `.resume()`, hay dùng `for await` thì Readable chuyển sang flowing.
- Gắn listener `readable` rồi gọi `read()` để kéo: paused mode. `read()` trả `null` khi hết dữ liệu hiện có.
- Đừng trộn listener `data` và `readable` trên cùng một stream: theo tài liệu, `readable` được ưu tiên và hành vi trở nên khó đoán (kiến thức từ tài liệu, chưa thử).

```ts
import { createReadStream, writeFileSync } from "node:fs";

writeFileSync("hwm-demo.tmp", Buffer.alloc(200_000, 97));
const r = createReadStream("hwm-demo.tmp", { highWaterMark: 50_000 });
r.once("readable", () => { const c = r.read(); console.log(c?.length); r.destroy(); }); // 50000
```

`highWaterMark` của `createReadStream` cũng chính là **kích thước chunk tối đa** bạn nhận (file lớn thì thường nhận đúng từng cục 50000 như trên). Với socket/HTTP, chunk có kích thước tuỳ gói tin, không đảm bảo.

**Object mode.** Mặc định stream chỉ chuyển `Buffer`/`string`. Với `objectMode: true`, chunk là giá trị JS bất kỳ (trừ `null`, vì `null` là tín hiệu kết thúc), và `highWaterMark` tính bằng **số object** (mặc định 16), không phải byte. Hữu ích cho pipeline dòng -> object (parse CSV, map bản ghi, ghi batch). Cạm bẫy: 16 object có thể lớn tuỳ object, nên bộ nhớ thật không đoán được bằng số lượng.

```ts
import { Readable } from "node:stream";

for await (const x of Readable.from([{ id: 1 }, { id: 2 }])) console.log(x);
console.log(await Readable.from("hello").toArray());   // [ 'hello' ]  một chunk, không tách ký tự
```

`Readable.from(iterable)` tạo object mode theo mặc định, và với **chuỗi hoặc Buffer** nó coi cả giá trị là *một* chunk (không lặp từng ký tự/byte).

**Sự kiện kết thúc: `end`, `finish`, `close`.** `end` (Readable): hết dữ liệu để đọc. `finish` (Writable): đã `end()` và mọi chunk đã flush xuống hệ thống. `close`: tài nguyên (fd, socket) đã đóng; có thể xảy ra mà không có `end`/`finish` nếu stream bị `destroy()`. "Xong việc" đáng tin nhất là `pipeline` resolve (file 04).

## Tricks & tips thực tế

- **Dùng `Readable.from(...)` để dựng nguồn giả hoặc bọc generator, thay vì extends `Readable`.** Lý do: ít code, tự lo `push`/`null`, và hỗ trợ async generator; hợp để tạo dữ liệu thử.
- **Khi viết `Writable`/`Transform`, luôn gọi `cb()` trên mọi nhánh** (kể cả khi bỏ qua chunk, kể cả trong `catch`). Lý do: thiếu một nhánh thì stream treo im lặng, không lỗi, không log.
- **Không tự `new Transform` cho thao tác đơn giản.** Lý do: async generator trong `pipeline` (file 04) ngắn hơn, tự tôn trọng backpressure.
- **Không đặt `highWaterMark` ngẫu hứng.** Lý do: mặc định 64 KiB hợp lý. Tăng (256 KiB-1 MiB) có thể giảm số syscall khi đọc/ghi file lớn nhưng tốn bộ nhớ nhân với số stream đồng thời; hãy đo trước khi đổi.
- **Cẩn thận `objectMode` + `highWaterMark: 16`:** nếu mỗi object chứa mảng lớn, 16 object đã là nhiều MB. Lý do: ngưỡng đếm theo số lượng, không theo dung lượng.
- **Phân biệt "stream xong" với "dữ liệu đã được xử lý hết":** `end` của Readable không bảo đảm đích đã ghi xong. Lý do: đích còn đệm. Đợi `finish` của Writable (hoặc `await pipeline(...)`).
- **Debug stream treo:** in `readableFlowing`, `readableLength`, `writableLength`, `writableNeedDrain`, `destroyed`, `readableEnded`. Lý do: các cờ này cho biết ngay ai đang chờ ai (bộ đệm đầy? chưa có người đọc? `cb` chưa được gọi?).

## Liên hệ bài tập

Trước khi code lab, vẽ ra chuỗi nguồn -> (biến đổi) -> đích của bạn và ghi mỗi mắt xích là loại stream nào, chunk là byte hay object, và `highWaterMark` thực tế của từng mắt xích là bao nhiêu (đọc từ thuộc tính chứ đừng đoán). Hỏi: bước nào có thể là chỗ chậm nhất?

## Đọc thêm

- [Node.js: Stream](https://nodejs.org/api/stream.html)
- [Node.js learn: Backpressuring in Streams](https://nodejs.org/en/learn/modules/backpressuring-in-streams)

## Ghi chú của bạn

