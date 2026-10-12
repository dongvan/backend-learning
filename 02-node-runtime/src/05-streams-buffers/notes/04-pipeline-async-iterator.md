# 4. `pipeline`, `stream/promises` và async iterator

`pipeline` nối các stream, truyền lỗi và **dọn dẹp tất cả** khi có lỗi; `pipe()` không làm cả hai việc đó.

```ts
import { createReadStream, createWriteStream, writeFileSync } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

writeFileSync("notes-demo.tmp", "xin chào\n".repeat(1000));
await pipeline(createReadStream("notes-demo.tmp"), createGzip(), createWriteStream("notes-demo.tmp.gz"));
console.log("xong, an toàn để dùng file .gz");
```

## Ý chính

- `pipe()`: nối stream **nhưng không chuyển lỗi**. Lỗi ở một mắt xích không đóng các mắt xích khác; file descriptor và bộ nhớ có thể rò rỉ.
- `pipeline` từ `node:stream/promises` trả Promise: resolve khi **mọi** stream đã xong, reject với lỗi đầu tiên, và `destroy()` mọi stream còn lại.
- Giữa các stream có thể chèn **async generator** (hoặc hàm async) làm bước biến đổi; nó tự tôn trọng backpressure.
- `for await (const chunk of readable)` đọc stream như vòng lặp thường, có backpressure, và `break` sẽ `destroy()` stream.
- `pipeline` nhận `{ signal }` (AbortSignal) để huỷ cả chuỗi (timeout, client ngắt kết nối).
- Phải gắn listener `error` cho stream nào bạn dùng ngoài `pipeline`, nếu không `error` ném và làm sập tiến trình.

## Lý thuyết chi tiết

**Thí nghiệm: `pipe` vs `pipeline` khi có lỗi giữa chừng (đã chạy, Node 24.21).** Chèn một Transform luôn lỗi `boom` vào giữa đọc file và ghi file.

```ts
import { createReadStream, createWriteStream, writeFileSync } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

writeFileSync("p-demo.tmp", "x".repeat(1_000_000));
const boom = () => new Transform({ transform(_c, _e, cb) { cb(new Error("boom")); } });

const src = createReadStream("p-demo.tmp"), dst = createWriteStream("p-dst1.tmp");
const mid = boom(); mid.on("error", (e) => console.log("pipe: lỗi", e.message));
src.pipe(mid).pipe(dst);
await new Promise((r) => setTimeout(r, 100));
console.log("pipe:     src.destroyed", src.destroyed, "dst.destroyed", dst.destroyed); // false false

const src2 = createReadStream("p-demo.tmp"), dst2 = createWriteStream("p-dst2.tmp");
try { await pipeline(src2, boom(), dst2); } catch (e) { console.log("pipeline bắt:", (e as Error).message); }
console.log("pipeline: src.destroyed", src2.destroyed, "dst.destroyed", dst2.destroyed); // true true
src.destroy(); dst.destroy();
```

Kết quả: với `pipe`, `src` và `dst` **không bị đóng** (`destroyed === false`): file nguồn và file đích còn mở, `dst` không bao giờ nhận `end`. Với `pipeline`, cả hai bị huỷ, và lỗi gốc `boom` đến được `catch`. Trong server chạy lâu, mỗi request lỗi rò một fd thì chẳng bao lâu gặp `EMFILE` (hết file descriptor).

**Điều pipeline không làm: xoá file đích dở.** `pipeline` huỷ stream ghi, nhưng file `dst` có thể đã có nội dung một phần trên đĩa. Việc xoá hoặc ghi vào tên tạm rồi `rename` là của bạn (Bài 6, file 01).

**Hình dạng các tham số.**

```ts
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

await pipeline(
  Readable.from(["a,b\n", "c,d\ne,f"]),
  async function* (source: AsyncIterable<string>) {   // bước biến đổi bằng async generator
    let n = 0;
    for await (const chunk of source) n += chunk.split("\n").length - 1;
    yield `newlines=${n}\n`;
  },
  new Writable({ write(c, _e, cb) { process.stdout.write(c); cb(); } }),
);
// in: newlines=2
```

Bước giữa là một hàm nhận nguồn (async iterable) và trả async iterable (generator). Bạn `yield` kết quả; backpressure xuất hiện tự nhiên: generator chỉ chạy tiếp khi phía sau *kéo* (gọi `next()`), tức đích sẵn sàng. Ngắn hơn và ít cạm bẫy hơn một `Transform` tự viết.

**Biến thể callback và promise.** `import { pipeline } from "node:stream"` là bản callback (`pipeline(a, b, c, (err) => {...})`), `node:stream/promises` là bản promise. Chọn bản promise cho code `async/await`. Nếu quên `await` bản promise, lỗi của pipeline thành unhandled rejection (xem Bài 6, file 02).

**Huỷ bằng `AbortSignal` (đã chạy).**

```ts
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

const ac = new AbortController();
const forever = Readable.from((async function* () {
  for (let i = 0; ; i++) { yield String(i); await new Promise((r) => setTimeout(r, 5)); }
})());
setTimeout(() => ac.abort(), 50);
try {
  await pipeline(forever, new Writable({ write(_c, _e, cb) { cb(); } }), { signal: ac.signal });
} catch (e) {
  console.log((e as Error).name, (e as { code?: string }).code); // AbortError ABORT_ERR
}
```

Hữu ích cho "client đã ngắt thì dừng đọc file/DB", hoặc timeout tổng.

**`for await` trên stream.** Readable là async iterable: mỗi vòng lặp nhận một chunk, và stream chỉ đọc tiếp khi vòng lặp kết thúc thân vòng. Đó là backpressure ngầm.

```ts
import { createReadStream, writeFileSync } from "node:fs";

writeFileSync("it-demo.tmp", "abcdefghij".repeat(10));
const r = createReadStream("it-demo.tmp", { highWaterMark: 16 });
let n = 0;
for await (const c of r) { n += (c as Buffer).length; if (n >= 32) break; }
console.log(r.destroyed, n);   // true 32: break tự destroy stream (không rò fd)
```

Lưu ý kiểu: chunk có kiểu `any` trong typings của stream, nên ép `as Buffer` hoặc gán kiểu. Nếu stream có encoding (`setEncoding`/`{ encoding: "utf8" }`) thì chunk là `string`.

**Ném lỗi trong thân vòng.** `throw` trong `for await` cũng `destroy()` stream. Nhưng bạn vẫn cần `try/catch` bao ngoài; không thì thành rejection của hàm async.

**Toán tử Readable (đã chạy).** `Readable.from([1,2,3,4]).filter(...).map(...).toArray()` cho `[20, 40]` ở Node 24.21. Các toán tử (`map`, `filter`, `take`, `drop`, `flatMap`, `toArray`, `forEach`...) tiện cho script và thử nhanh; vì `toArray()` nạp **hết** vào RAM nên không dùng nó cho dữ liệu lớn. Một số toán tử từng được ghi là experimental ở bản cũ; phiên bản 24.21 mình dùng không cảnh báo, nhưng hãy kiểm tra tài liệu phiên bản bạn chạy.

**Lỗi không bắt = sập tiến trình (đã chạy).** `createReadStream("khong-ton-tai.txt")` mà không có listener `error` và không đưa vào `pipeline` sẽ in `Unhandled 'error' event` rồi tiến trình thoát. Đây là quy tắc chung của `EventEmitter`: sự kiện tên `error` không có listener thì bị ném. Với `pipeline`/`for await` thì lỗi được chuyển thành reject/throw nên bắt bằng `try/catch`.

**Xem thêm `stream.compose`, `finished`.** `finished(stream, cb)` (hoặc bản promise) báo khi stream xong/lỗi/đóng, dùng cho stream đơn lẻ không nằm trong pipeline. Dùng `pipeline` khi nối từ hai stream trở lên.

## Tricks & tips thực tế

- **Mặc định dùng `await pipeline(...)` từ `node:stream/promises`.** Lý do: một chỗ duy nhất để bắt lỗi và đảm bảo mọi fd được đóng; `pipe()` cho code nhanh mà lỗi nặng.
- **Với bước biến đổi, thử async generator trước, `Transform` sau.** Lý do: generator ít boilerplate, không quên `cb`, và backpressure tự nhiên; chỉ cần Transform khi muốn tái dùng như một đối tượng stream.
- **Phát lại lỗi theo ngữ cảnh:** `catch (e) { throw new Error("import file X thất bại", { cause: e }) }`. Lý do: lỗi stream thường chỉ có `ENOENT`/`boom`, thiếu bối cảnh; `cause` giữ cả chuỗi lỗi gốc.
- **Ghi file kết quả vào tên tạm, `pipeline` xong mới `rename`.** Lý do: `pipeline` huỷ stream nhưng không dọn file đích dở; người đọc không bao giờ thấy file nửa chừng.
- **Truyền `{ signal }` khi pipeline gắn với request/timeout.** Lý do: không có nó, client ngắt kết nối mà server vẫn đọc hết file.
- **Đừng `await` trong `.on("data")`, hãy dùng `for await`.** Lý do: `async` listener không làm nguồn dừng chờ (xem file 03).
- **Khi `pipeline` treo không resolve:** kiểm tra có mắt xích nào quên gọi `cb()` (Writable/Transform), hoặc nguồn không bao giờ `push(null)`. In `readableFlowing`/`writableNeedDrain`/`destroyed` ở từng mắt xích. Lý do: pipeline chỉ resolve khi mọi stream `finish`/`end`.
- **`toArray()` và `readFile`-qua-stream tự gom `chunks.push` là dấu hiệu mùi:** nếu cuối cùng bạn vẫn có cả dữ liệu trong RAM thì stream không đem lại lợi ích. Lý do: lợi ích của stream đến từ việc *không* giữ toàn bộ.

## Liên hệ bài tập

Lab yêu cầu dùng `pipeline`. Thử cho một mắt xích của bạn ném lỗi giữa chừng rồi quan sát: lỗi nào ra ở `catch`, các stream có `destroyed` không, file đích còn lại ở trạng thái gì? Thử thêm `AbortSignal` với timeout ngắn để thấy pipeline dừng sớm. Hỏi: nếu muốn tiến trình báo "đang xử lý dòng thứ N" thì chèn nó vào chỗ nào mà không phá backpressure?

## Đọc thêm

- [Node.js: `stream.pipeline`](https://nodejs.org/api/stream.html#streampipelinesource-transforms-destination-options)
- [Node.js: Streams promises API](https://nodejs.org/api/stream.html#streams-promises-api)
- [Node.js: Readable async iterator](https://nodejs.org/api/stream.html#readablesymbolasynciterator)

## Ghi chú của bạn

