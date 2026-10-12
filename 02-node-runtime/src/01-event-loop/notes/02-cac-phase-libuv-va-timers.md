# 2. Các phase của libuv và timers

Mỗi vòng lặp (một "tick" của event loop) đi qua các phase theo thứ tự cố định, mỗi phase có hàng đợi callback riêng.

```ts
import { readFile } from "node:fs";

readFile(import.meta.filename, () => {
  setTimeout(() => console.log("timeout"), 0);
  setImmediate(() => console.log("immediate"));
});
// Node 24.21 đã thử 5 lần: luôn là immediate trước, timeout sau
```

## Ý chính

- Thứ tự các phase trong một vòng (theo tài liệu libuv/Node): **timers → pending callbacks → idle/prepare → poll → check → close callbacks**, rồi lặp lại.
- **timers**: chạy callback của `setTimeout`/`setInterval` đã đến hạn.
- **pending callbacks**: một số callback lỗi hệ thống bị hoãn từ vòng trước (ít gặp trong code ứng dụng).
- **poll**: lấy sự kiện I/O mới và chạy callback I/O. Nếu không còn gì chạy, vòng lặp **ngủ ở đây** chờ I/O hoặc đến hạn timer gần nhất.
- **check**: callback của `setImmediate`.
- **close callbacks**: sự kiện `close` (ví dụ `socket.on("close")`).
- Giữa **mỗi callback** (không phải mỗi phase), Node xả `process.nextTick` queue rồi microtask queue (file 03).
- `setTimeout(fn, 0)` thực chất là `setTimeout(fn, 1)`; **không chính xác về thời gian**, chỉ đảm bảo "không sớm hơn".
- `setTimeout(0)` vs `setImmediate` ở **main module**: thứ tự **không xác định**. Trong **callback I/O**: `setImmediate` luôn trước.

## Lý thuyết chi tiết

**Sơ đồ một vòng.**

```
   ┌─> timers ─> pending ─> idle/prepare ─> poll ─> check ─> close ─┐
   └────────────────────────────────────────────────────────────────┘
```

Phase poll là phase quan trọng: nó tính xem được phép chờ bao lâu. Có `setImmediate` đang chờ thì không ngủ (để sang check ngay); có timer sắp đến hạn thì ngủ đến đúng hạn đó; không có gì thì ngủ vô hạn nếu còn handle sống, hoặc thoát vòng nếu không còn gì. (Kiến thức từ tài liệu libuv, chưa tự đo cơ chế tính thời gian chờ.)

**`setTimeout(0)` vs `setImmediate` ở main module: ngẫu nhiên thật.** Chạy một file chỉ có hai dòng (`setTimeout(..., 0)` và `setImmediate(...)`) 40 lần mỗi kiểu (Node 24.21, WSL2, 12 lõi):

| Kiểu module | `immediate` trước | `timeout` trước |
|---|---|---|
| CommonJS (`.cts`) | 34 | 6 |
| ESM (`.ts` với `"type":"module"`) | 38 | 2 |
| CJS khi máy đang tải nặng (8 process ngốn CPU) | 26/30 | 4/30 |

Ngược với cách nhiều tài liệu kể ("timeout thường trước"), trên máy này `immediate` thắng áp đảo, nhưng **không phải luôn luôn**. Lý do cơ chế: khởi động vòng lặp tốn thời gian; nếu từ lúc đặt timer đến lúc vòng lặp bắt đầu đã trôi qua >= 1ms thì timer đến hạn ngay ở phase timers đầu tiên; nếu chưa thì vòng lặp đi qua poll rồi check, `immediate` chạy trước. Nó phụ thuộc tốc độ máy và tải. **Không bao giờ viết code dựa vào thứ tự này.**

**Trong I/O callback thì xác định.** Bạn đang ở phase poll, phase kế tiếp là check, nên `setImmediate` luôn chạy trước timer của vòng sau. Đã thử 5 lần: luôn `immediate` rồi `timeout`. Đây là lý do `setImmediate` tồn tại: "chạy ngay sau khi I/O xong của vòng này".

**Phase close.** Thí nghiệm: trong callback `end` của một HTTP response, đặt `setImmediate`, `setTimeout(0)` và lắng nghe `socket.on("close")`. Kết quả 3 lần chạy giống nhau: `immediate` → `socket close` → `timeout`. Tức close callbacks chạy sau check và trước timers của vòng kế, khớp sơ đồ.

**Timer được sắp theo thời điểm đến hạn, không theo thứ tự gọi.** Đã thử:

```ts
setTimeout(() => console.log("A:0"), 0);
setTimeout(() => console.log("B:1"), 1);
setTimeout(() => console.log("C:2"), 2);
setTimeout(() => console.log("D:-5"), -5);
// Node 24.21: A:0 B:1 D:-5 C:2  (kèm TimeoutNegativeWarning)
```

0 và âm đều bị ép thành 1ms; `D` và `B` cùng 1ms nên giữ thứ tự gọi, `C` (2ms) sau cùng. Delay lớn hơn 2^31-1 ms (~24,8 ngày) cũng bị ép về 1ms kèm `TimeoutOverflowWarning` (đã thử: timer `2 ** 31` bắn gần như ngay lập tức). Đây là cạm bẫy khi tính "hết hạn sau 30 ngày" bằng timer.

**Timer chỉ đảm bảo "không sớm hơn".** Khi thread JS bận, timer phải chờ:

```ts
const t0 = performance.now();
setTimeout(() => console.log("A(50ms)", (performance.now() - t0).toFixed(0)), 50);
setTimeout(() => console.log("B(60ms)", (performance.now() - t0).toFixed(0)), 60);
const end = performance.now() + 200;
while (performance.now() < end); // chặn 200ms
```

Kết quả thật: `A(50ms)` bắn ở 203ms và `B(60ms)` cũng ở 203ms. Cả hai trễ ~150ms và bị dồn vào cùng một lần, khoảng cách 10ms giữa chúng biến mất. Không có chuyện "bù" thời gian.

**Sai số khi event loop rảnh.** 20 lần `await sleep(10)` (`node:timers/promises`) có độ trễ vượt 10ms từ 0.44ms đến 1.11ms (Node 24.21). Với `setInterval(fn, 20)` mà mỗi callback làm việc 5ms, 20 tick tốn 429ms thay vì 400ms: `setInterval` **trôi dần** (drift), không tự hiệu chỉnh về mốc tuyệt đối.

## Tricks & tips thực tế

- **Không dùng timer để đo thời gian hay đảm bảo thứ tự.** Dùng `performance.now()` (đơn điệu) để đo khoảng thời gian; dùng `Date.now()` chỉ để lấy giờ lịch. Timer có sai số và có thể trễ tùy ý khi event loop bận.
- **Với job định kỳ cần chính xác, tự tính mốc kế tiếp** (`next = start + n * interval`) rồi `setTimeout(next - now)` thay vì `setInterval`, vì `setInterval` trôi dần như đã đo (429ms thay vì 400ms).
- **Không dùng `setInterval` cho tác vụ async có thể chạy lâu hơn chu kỳ**: callback sau có thể bắt đầu khi callback trước chưa xong, chồng chất. Dùng vòng lặp `while` với `await sleep(interval)` để đảm bảo mỗi lần chạy xong mới đến lần sau.
- **Dùng `timers/promises`** (`import { setTimeout as sleep } from "node:timers/promises"`) cho `await sleep(ms)`: gọn hơn bọc `new Promise` và hỗ trợ `AbortSignal` để huỷ (xem Bài 2).
- **Gọi `.unref()` cho timer nền** (cleanup cache, gửi metrics) để chúng không ngăn process thoát. Lý do: timer mặc định là handle "ref", giữ event loop sống; test sẽ treo nếu quên.
- **`clearTimeout` timer khi không cần nữa**, nhất là timer timeout của một request đã hoàn tất: timer chưa huỷ giữ closure (và mọi object nó tham chiếu) tới khi đến hạn, gây rò bộ nhớ tạm và có thể giữ process sống.
- **Chia việc đồng bộ dài bằng `setImmediate`** để nhường event loop cho I/O: xử lý một lô, rồi `await new Promise(r => setImmediate(r))`. Dùng `setTimeout(0)` cũng nhường nhưng bị ép tối thiểu 1ms và chịu sai số; `setImmediate` nhường thẳng sang vòng sau. (Với việc nặng thật sự, hãy dùng Worker Threads thay vì chia nhỏ.)
- **Debug "tại sao timer không chạy đúng giờ"**: nghi ngờ event loop bị chặn trước, không nghi timer. Đo lag (file 04).

## Liên hệ bài tập

Phần dự đoán output trong `EXERCISE.md` có kết hợp I/O và timer: hãy tự viết ít nhất một đoạn chạy `setTimeout`/`setImmediate` **trong** callback I/O và một đoạn ở main module. Chạy đoạn thứ hai nhiều lần (vòng `for` trong shell) và ghi lại tỉ lệ; giải thích bằng cơ chế ở trên thay vì bằng "thứ tự cố định".

## Đọc thêm

- [Node.js: The Event Loop, Timers, and process.nextTick()](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick)
- [libuv: Design overview (The I/O loop)](https://docs.libuv.org/en/v1.x/design.html)
- [Node.js: Timers](https://nodejs.org/api/timers.html)

## Ghi chú của bạn
