# 3. Backpressure: `write()`, `drain` và bộ nhớ

Backpressure là cơ chế để nguồn nhanh **chờ** đích chậm; nó nằm ở giá trị trả về của `write()` và sự kiện `drain`.

```ts
import { Writable } from "node:stream";
import { once } from "node:events";

const sink = new Writable({ write(_c, _e, cb) { setImmediate(cb); } }); // đích chậm giả lập
for (let i = 0; i < 1000; i++) {
  if (!sink.write(Buffer.alloc(16 * 1024))) await once(sink, "drain"); // dừng khi bộ đệm đầy
}
sink.end();
```

## Ý chính

- `writable.write(chunk)` trả `false` khi `writableLength >= highWaterMark`. Nghĩa: "bộ đệm đã đầy, hãy dừng ghi tới khi có `drain`".
- `write()` trả `false` **vẫn nhận chunk**. Nếu bạn bỏ qua và cứ ghi tiếp, mọi chunk dồn vào bộ nhớ: RAM tăng tuyến tính theo lượng dữ liệu nguồn nhanh hơn đích.
- Backpressure **không phải lỗi**, không ném gì cả. Vì im lặng nên bug này chỉ lộ ra khi dữ liệu lớn hoặc đích chậm (production), không lộ ở máy dev với file nhỏ.
- `pipe()`, `pipeline()` và `for await` đã xử lý backpressure cho bạn. Bạn chỉ phải tự xử lý khi gọi `write()` trực tiếp trong vòng lặp.
- Backpressure lan ngược: đích chậm làm trung gian đầy, rồi làm nguồn tạm dừng đọc. Nhờ vậy bộ nhớ của cả chuỗi bị chặn quanh tổng các `highWaterMark`.

## Lý thuyết chi tiết

**Vòng phản hồi.**

1. Nguồn gọi `dest.write(chunk)`.
2. Chunk vào hàng đợi của Writable; `_write` xử lý từng chunk một, gọi `cb()` khi xong.
3. Nếu sau khi thêm, `writableLength >= highWaterMark` thì `write()` trả `false` và `writableNeedDrain` thành `true`.
4. Khi hàng đợi cạn hết, Writable phát `drain`. Nguồn tiếp tục.

Với `pipe`, nguồn là Readable: khi `write()` trả `false` thì `pipe` gọi `src.pause()`, và gọi `src.resume()` khi `drain`. Với `fs.createReadStream` là nguồn, `pause()` có nghĩa là thôi gọi `read()` xuống file, nên đĩa cũng được nghỉ.

**Thí nghiệm: bỏ qua và tôn trọng backpressure (đã chạy, Node 24.21).** Sink giả lập chậm (mỗi chunk xử lý xong ở vòng `setImmediate` kế tiếp), nguồn ghi 20 000 chunk 16 KiB mới (tổng ~320 MB). Mỗi chunk là một `Buffer.alloc` mới.

```ts
import { Writable } from "node:stream";
import { once } from "node:events";

const mode = process.argv[2] ?? "ignore";
const slow = new Writable({ write(_c, _e, cb) { setImmediate(cb); } });
let peakBuf = 0, peakRss = 0;
const snap = () => { peakBuf = Math.max(peakBuf, slow.writableLength); peakRss = Math.max(peakRss, process.memoryUsage().rss); };
for (let i = 0; i < 20_000; i++) {
  const ok = slow.write(Buffer.alloc(16 * 1024, 1));
  if (!ok && mode === "respect") await once(slow, "drain");
  if (i % 500 === 0) snap();
}
slow.end(); await once(slow, "finish");
console.log(mode, "peak writableLength MB", (peakBuf / 1048576).toFixed(0), "peak RSS MB", (peakRss / 1048576).toFixed(0));
```

Kết quả (một lần chạy, máy WSL2 của tôi; số tuyệt đối thay đổi, tỉ lệ thì không):

| Chế độ | `writableLength` đỉnh | RSS đỉnh |
|---|---|---|
| `ignore` (bỏ qua `false`) | **305 MB** (gần như cả 20 000 chunk dồn vào hàng đợi trước khi đích kịp xử lý) | **382 MB** |
| `respect` (đợi `drain`) | ~0 MB ở các điểm đo (không vượt 64 KiB) | **84 MB** |

(Baseline của tiến trình Node trống khoảng 44-60 MB RSS. Nếu thấy bạn tự chạy ra số khác thì bình thường; thứ cần so là tỉ lệ.) Chỉ chunk đầu tiên được đưa vào `_write` ngay; các chunk sau chờ `cb` của chunk trước, mà vòng lặp đồng bộ không nhường event loop nên `cb` của sink (ở `setImmediate`) **không thể chạy** giữa chừng, và 20 000 chunk nằm hết trong hàng đợi. Đây là điểm mấu chốt: bỏ qua backpressure trong một vòng `for` đồng bộ là trường hợp tệ nhất.

**Phát hiện đáng nhớ: dùng lại cùng một Buffer che mất vấn đề.** Phiên bản đầu của thí nghiệm này ghi cùng một `chunk` (một object `Buffer` duy nhất, 20 000 lần): hàng đợi vẫn đạt ~313 MB `writableLength` (số được cộng theo độ dài), nhưng RSS đỉnh chỉ 70 MB vì hàng đợi giữ 20 000 *tham chiếu* tới cùng một vùng nhớ. `writableLength` là con số logic, RSS mới là bộ nhớ thật; muốn tái hiện rò rỉ thật, mỗi chunk phải là dữ liệu riêng như ngoài đời (đọc từ DB, từ socket, đọc từng dòng).

**Vì sao `await once(w, "drain")` có thể treo.** Nếu đích bị `destroy()` hoặc lỗi trước khi phát `drain`, `drain` không bao giờ đến. `once` từ `node:events` reject nếu stream phát `error` trong lúc đợi, nhưng nếu stream chỉ `close` mà không lỗi thì promise không tự kết thúc (suy ra từ tài liệu, chưa thử). Dùng `pipeline`/`for await` tránh được tình huống này.

**Backpressure trong HTTP/socket.** `res.write()` (response HTTP) và `socket.write()` cũng là Writable: client đọc chậm làm `write()` trả `false`. Server bỏ qua và `write` hàng triệu dòng cho một client mạng chậm sẽ đẩy bộ nhớ server lên tương ứng, và nhiều client chậm cùng lúc có thể làm OOM cả tiến trình (nguyên lý đúng với mọi dạng "client chậm"; chưa đo ở đây).

**Ghi tới `process.stdout`.** `console.log` trong vòng lặp triệu lần cũng là Writable. Theo tài liệu Node: file và TTY ghi đồng bộ; pipe ghi đồng bộ trên Linux nhưng bất đồng bộ trên một số nền tảng khác (xem Bài 6, file 04; phần nền tảng khác chưa thử). Đã chạy: `node app.js | head -2` với vòng `console.log` lớn gây `EPIPE` làm tiến trình ném lỗi (file 04 của bài 6 nêu cách xử lý).

**Cạm bẫy `highWaterMark` của Transform ở giữa.** Một `pipeline` đọc -> transform -> ghi có **bốn** bộ đệm (phía đọc của nguồn, phía ghi và phía đọc của transform, phía ghi của đích; mỗi cái 64 KiB mặc định). Bộ nhớ tối đa theo lý thuyết quanh tổng các mức đó, cộng bất kỳ thứ gì bạn gom trong transform. Nếu trong `transform` bạn `await` thứ chậm (gọi DB từng dòng), thì backpressure sẽ làm nguồn chậm theo, đúng ý. Nhưng nếu bạn `push` nhiều chunk con từ mỗi chunk vào (nhân lên), phải kiểm tra giá trị trả về của `this.push()`.

## Tricks & tips thực tế

- **Nếu phải `write()` trong vòng lặp, luôn dạng `if (!w.write(x)) await once(w, "drain")`.** Lý do: đây là cách duy nhất để vòng lặp *nhường* và đích có cơ hội tiêu thụ; không có nó, bộ nhớ tăng theo dữ liệu.
- **Ưu tiên `pipeline` + generator thay vì tự viết vòng `write`.** Lý do: backpressure, lỗi và dọn dẹp đều được xử lý (file 04).
- **Đo, đừng đoán:** in `process.memoryUsage().rss` định kỳ (hoặc `process.memoryUsage.rss()`, nhanh hơn), cùng `stream.writableLength`. Lý do: `writableLength` cho biết hàng đợi, RSS cho biết thật sự tốn bao nhiêu; hai số lệch nhau như ở thí nghiệm trên cho bạn manh mối về việc dữ liệu có đang bị chia sẻ.
- **Kiểm thử với đích chậm giả lập** (`setTimeout(cb, 1)` trong `write`) và nguồn nhanh. Lý do: bug backpressure không lộ khi đích nhanh như `/dev/null` hay file nhỏ trên SSD.
- **Đừng kỳ vọng `--max-old-space-size` chặn được kiểu phình này.** Lý do: Buffer nằm ngoài heap V8 (thể hiện ở `external`/`arrayBuffers` trong `memoryUsage()`), nên giới hạn heap không áp cho nó (suy ra từ cơ chế, chưa thử riêng trường hợp này); cách chắc chắn là kiểm soát luồng dữ liệu.
- **Đặt giới hạn cho thứ bạn gom** (mảng chunk, chuỗi nối): kiểm tra tổng kích thước và huỷ nếu vượt. Lý do: backpressure chỉ bảo vệ stream; một mảng `chunks.push(c)` trong `on("data")` tự phá nó.
- **Không bao giờ `await` bên trong listener `on("data")` mà không `pause()`:** listener `async` không làm nguồn đợi, các sự kiện `data` vẫn đến liên tục, nên chạy chồng chéo và không thứ tự. Lý do: EventEmitter không đợi promise của listener. Dùng `for await` (tự tuần tự và có backpressure).

## Liên hệ bài tập

Lab yêu cầu tôn trọng backpressure và đo memory. Hãy thử bằng thí nghiệm của riêng bạn: ghép một nguồn nhanh với đích chậm theo cả hai cách (có/không tôn trọng `write()`), và ghi lại RSS đỉnh của từng cách trên cùng dữ liệu. Hỏi: nếu mọi chunk là cùng một object thì số liệu có phản ánh đúng thực tế không? Trong chuỗi của bạn, chỗ nào có thể là "đích chậm"?

## Đọc thêm

- [Node.js learn: Backpressuring in Streams](https://nodejs.org/en/learn/modules/backpressuring-in-streams)
- [Node.js: `writable.write()` và sự kiện `drain`](https://nodejs.org/api/stream.html#writablewritechunk-encoding-callback)

## Ghi chú của bạn

