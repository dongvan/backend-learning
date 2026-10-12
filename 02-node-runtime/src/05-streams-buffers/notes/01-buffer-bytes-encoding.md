# 1. Buffer: bytes, encoding và những cạm bẫy

`Buffer` là mảng byte của Node. Chuỗi chỉ trở thành byte khi bạn chọn **encoding**, và byte chỉ trở lại thành chuỗi khi bạn chọn đúng encoding đó.

```ts
import { Buffer } from "node:buffer";

const b = Buffer.from("Chào 👋", "utf8");
console.log("Chào 👋".length, b.length);          // 7 10  (độ dài chuỗi != số byte)
console.log(b.toString("hex"));                    // 4368c3a06f20f09f918b
console.log(b.toString("base64"));                 // Q2jDoG8g8J+Riw==
```

(Node 24.21 đã chạy.) Ba con số khác nhau: 7 đơn vị UTF-16, 10 byte UTF-8, và chuỗi hex/base64 là hai cách *viết* cùng 10 byte đó.

## Ý chính

- `Buffer` là lớp con của `Uint8Array` với thêm tiện ích (`toString(enc)`, `readUInt32BE`, `equals`, `concat`...). Mọi API nhận `Uint8Array` đều nhận `Buffer`.
- **Chuỗi không có byte; encoding mới có.** `string.length` đếm đơn vị UTF-16, `Buffer.byteLength(s)` đếm byte UTF-8. Hai số này chỉ bằng nhau với ASCII.
- `hex`, `base64`, `base64url` là cách *biểu diễn* byte thành chữ để in/truyền qua JSON, không phải mã hoá bảo mật.
- Cắt Buffer UTF-8 ở ranh giới tuỳ ý có thể cắt ngang một ký tự, và ghép lại bằng `toString()` từng mảnh sẽ ra ký tự lỗi `�` (U+FFFD). Phải dùng `Buffer.concat` trước rồi mới giải mã, hoặc `StringDecoder` / `TextDecoder` với `stream: true`.
- `Buffer.allocUnsafe(n)` **không xoá bộ nhớ**: có thể chứa dữ liệu cũ. `Buffer.alloc(n)` luôn trả toàn số 0.
- `buf.subarray()` (và `slice`) **chia sẻ bộ nhớ**, không sao chép.

## Lý thuyết chi tiết

**Buffer là view trên ArrayBuffer.** Đây là chỗ khác `string` của PHP: PHP string *vốn là* chuỗi byte (`strlen` đếm byte, `mb_strlen` mới đếm ký tự). JS string là chuỗi ký tự Unicode, còn byte nằm ở `Buffer`/`Uint8Array`. Nên mọi chuyển đổi qua lại đều là một quyết định về encoding, và thiếu nó là nguồn bug lớn nhất khi đọc file, socket, hash.

```ts
import { Buffer } from "node:buffer";

const b = Buffer.from("Chào 👋", "utf8");
console.log(b instanceof Uint8Array);                        // true
const u8 = new Uint8Array(b.buffer, b.byteOffset, b.length); // view, không copy
console.log(u8 instanceof Buffer);                           // false: Uint8Array thuần
console.log(Buffer.from(u8).equals(b));                      // true: Buffer.from(u8) COPY
const sub = b.subarray(0, 2); sub[0] = 0x58;                 // sửa qua view
console.log(b.toString("utf8", 0, 2));                       // "Xh": b cũng đổi
```

**Pool nội bộ.** Buffer nhỏ (`Buffer.from("a")`, `allocUnsafe` nhỏ) được cấp từ một `ArrayBuffer` dùng chung 64 KiB (`Buffer.poolSize` = 65536 ở Node 24.21; tài liệu cũ ghi 8 KiB). Hệ quả: `buf.buffer.byteLength` **không** phải kích thước của `buf`, và `buf.byteOffset` thường khác 0. Khi truyền `buf.buffer` cho API khác (ví dụ `new Float32Array(buf.buffer)`) mà bỏ qua `byteOffset`/`length` thì bạn đọc nhầm cả vùng của Buffer khác.

```ts
import { Buffer } from "node:buffer";

console.log(Buffer.from("a").buffer.byteLength, Buffer.from("a").byteOffset);
// 65536 và một offset khác 0 (giá trị offset thay đổi theo lần chạy)
console.log(Buffer.alloc(10000).buffer.byteLength);          // 10000: alloc không dùng pool
```

**Encoding hay gặp.**

| Encoding | Dùng cho | Ghi chú |
|---|---|---|
| `utf8` (mặc định) | Văn bản hiện đại | 1-4 byte/ký tự; byte không hợp lệ thành `�`, **không ném lỗi** |
| `hex` | Hash, ID, debug | 2 ký tự/byte; ký tự không hợp lệ làm chuỗi bị cắt im lặng (`Buffer.from("zz","hex").length === 0`, đã chạy) |
| `base64` / `base64url` | Nhúng nhị phân vào JSON, JWT, URL | `base64url` thay `+/` bằng `-_` và bỏ `=` |
| `latin1` / `binary` | Dữ liệu cũ, 1 byte = 1 ký tự | Đọc file Windows-1252/ISO-8859-1 |
| `utf16le` | Windows API, vài định dạng | 2 byte/đơn vị |

Đọc sai encoding không ném lỗi, nó cho ra rác:

```ts
import { Buffer } from "node:buffer";

const l1 = Buffer.from("café", "latin1");     // <Buffer 63 61 66 e9>
console.log(l1.toString("utf8"));              // "caf�"   (0xe9 đơn lẻ không phải UTF-8 hợp lệ)
console.log(l1.toString("latin1"));            // "café"
```

Node không có sẵn mọi charset (ví dụ `windows-1258` của tiếng Việt cũ): dùng `TextDecoder("windows-1258")` nếu bản Node có ICU đầy đủ (chưa thử), nếu không thì cần thư viện ngoài.

**Cắt giữa ký tự UTF-8.** Một ký tự có thể chiếm nhiều byte, và một chunk của stream có thể kết thúc giữa chừng. Đã chạy:

```ts
import { Buffer } from "node:buffer";
import { StringDecoder } from "node:string_decoder";

const full = Buffer.from("Chào bạn 👋 xin chào", "utf8");
const a = full.subarray(0, 9), c = full.subarray(9);          // cắt ngay giữa "ạ"
console.log(a.toString() + c.toString());                    // "Chào b��n 👋 xin chào"  (hỏng)

const d = new StringDecoder("utf8");
console.log(d.write(a) + d.write(c) + d.end());              // "Chào bạn 👋 xin chào"  (đúng)

const td = new TextDecoder();
console.log(td.decode(a, { stream: true }) + td.decode(c, { stream: true }) + td.decode()); // đúng
console.log(Buffer.concat([a, c]).toString());               // đúng: ghép byte trước, giải mã sau
```

`StringDecoder` (module `node:string_decoder`) giữ lại phần byte dở của ký tự cho lần `write` sau. Cách ngắn hơn trên stream: `readable.setEncoding("utf8")` (stream tự dùng decoder bên trong), hoặc nhận Buffer rồi tự gom.

**`allocUnsafe` và tại sao tồn tại.** `alloc` phải ghi 0 vào toàn vùng nhớ; `allocUnsafe` bỏ bước đó và nhanh hơn, vì bạn hứa sẽ ghi đè toàn bộ. Chạy thử 2000 lần `allocUnsafe(64)`: 1793 lần buffer chứa byte khác 0 (là rác từ pool), còn `alloc(64)` luôn sạch. Rủi ro an ninh là có thật: nếu bạn cấp `allocUnsafe`, ghi một phần, rồi gửi *cả buffer* ra client thì lộ dữ liệu cũ của request khác (kiểu lỗi Heartbleed thu nhỏ).

**So sánh.** `buf1 == buf2` so sánh *tham chiếu* (hai Buffer cùng nội dung vẫn `false`); dùng `buf1.equals(buf2)` hoặc `Buffer.compare`. Để so sánh chữ ký/token chống timing attack dùng `crypto.timingSafeEqual`.

**Đọc/ghi số nhị phân.** Giao thức nhị phân dùng `readUInt16BE/LE`, `writeUInt32LE`... Byte order phải khớp đặc tả:

```ts
import { Buffer } from "node:buffer";

const h = Buffer.alloc(6);
h.writeUInt16BE(0xcafe, 0);   // ca fe
h.writeUInt32LE(1, 2);        // 01 00 00 00
console.log(h, h.readUInt16BE(0)); // <Buffer ca fe 01 00 00 00> 51966
```

## Tricks & tips thực tế

- **Luôn ghi rõ encoding khi chuyển `Buffer` <-> `string`, kể cả `utf8`.** Lý do: mặc định `utf8` có thể không đúng với file/giao thức, và việc ghi tường minh khiến người đọc thấy đây là điểm quyết định.
- **Khi gom chunk của stream, gom `Buffer[]` rồi `Buffer.concat(chunks).toString("utf8")` một lần**, đừng `str += chunk`. Lý do: `str += chunk` ngầm gọi `chunk.toString()` từng mảnh và phá ký tự đa byte ở ranh giới (đã chạy ở trên); ngoài ra bạn nên đặt trần kích thước, xem file 05.
- **Dùng `Buffer.alloc`, chỉ dùng `allocUnsafe` khi đo được lợi ích và chắc chắn ghi đè toàn bộ.** Lý do: lợi ích về tốc độ thường nhỏ trong code nghiệp vụ, còn rủi ro rò rỉ dữ liệu là nghiêm trọng.
- **Không truyền `buf.buffer` đi đâu mà không kèm `byteOffset` và `length`.** Lý do: pool khiến `buf.buffer` lớn hơn `buf` và chứa dữ liệu của Buffer khác. Nếu cần ArrayBuffer sở hữu riêng, dùng `buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)` (copy).
- **Kiểm tra độ dài bằng `Buffer.byteLength(str)` khi giới hạn theo byte** (giới hạn cột DB, header, payload). Lý do: `str.length` đếm sai với tiếng Việt và emoji, vừa dưới giới hạn theo `length` nhưng vượt theo byte.
- **Dùng `base64url` cho token trong URL/cookie.** Lý do: `base64` chuẩn có `+`, `/`, `=` cần escape trong URL.
- **Debug byte lạ:** `console.log(buf)` in `<Buffer ...>` (cắt sau 50 byte), `buf.toString("hex")` để xem đủ, và so với bảng UTF-8 (tiếng Việt có dấu thường là 2-3 byte: `c3 a0` là `à`). Thấy `ef bf bd` trong dữ liệu nghĩa là đã có một lần giải mã lỗi biến thành `�` rồi ghi lại, dữ liệu gốc đã mất.
- **`Buffer.from(string, "hex")` im lặng cắt khi gặp ký tự sai**; kiểm tra bằng regex hoặc so độ dài (`buf.length * 2 === str.length`). Lý do: nó không ném lỗi.
- **Nếu có thể, dùng `Uint8Array` ở code dùng chung với trình duyệt/Web API**, và `Buffer` ở code chỉ chạy trên Node. Lý do: `Buffer` là API riêng của Node; `Uint8Array` + `TextEncoder`/`TextDecoder` chạy mọi nơi.

## Liên hệ bài tập

Khi đọc file lớn theo chunk, tự hỏi: chunk đầu/cuối có thể kết thúc giữa một ký tự hoặc giữa một dòng không? Nếu bạn đếm dòng bằng cách tìm byte `\n` (0x0A), có cần giải mã sang chuỗi không (gợi ý: `0x0A` không bao giờ xuất hiện bên trong một ký tự UTF-8 nhiều byte)? Nếu cần chuỗi, giữ phần dở của dòng cuối chunk ở đâu?

## Đọc thêm

- [Node.js: Buffer](https://nodejs.org/api/buffer.html)
- [Node.js: string_decoder](https://nodejs.org/api/string_decoder.html)

## Ghi chú của bạn

