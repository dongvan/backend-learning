# 2. Truyền dữ liệu: structured clone, transfer, SharedArrayBuffer và Atomics

Dữ liệu giữa main và worker được **copy** bằng thuật toán structured clone; muốn tránh copy hãy **chuyển quyền sở hữu** `ArrayBuffer` (transfer) hoặc **chia sẻ** vùng nhớ bằng `SharedArrayBuffer`, và dùng `Atomics` để đồng bộ.

```ts
import { Worker, isMainThread, parentPort } from "node:worker_threads";

if (isMainThread) {
  const w = new Worker(new URL(import.meta.url));
  const size = 256 * 1024 * 1024;
  const run = async (label: string, transfer: boolean): Promise<void> => {
    const buf = new ArrayBuffer(size);
    const t = performance.now();
    await new Promise<void>((res) => {
      w.once("message", () => res());
      w.postMessage(buf, transfer ? [buf] : []); // đối số thứ hai là danh sách transfer
    });
    console.log(label, (performance.now() - t).toFixed(1), "ms; byteLength sau gửi:", buf.byteLength);
  };
  await run("clone   ", false);
  await run("transfer", true);
  await w.terminate();
} else {
  parentPort?.on("message", () => parentPort?.postMessage("ack"));
}
```

Node 24.21: gửi 256 MiB bằng **clone** mất ~657ms, bằng **transfer** ~1ms (lượt clone chạy đầu tiên nên gồm thêm ~50ms khởi động worker, không đáng kể so với 657ms), và sau transfer `buf.byteLength` ở phía gửi thành `0` (đã "bị lấy đi").

## Ý chính

- `postMessage(value)` dùng **structured clone**: sao chép sâu, hỗ trợ nhiều kiểu hơn JSON (`Date`, `Map`, `Set`, `BigInt`, `RegExp`, `ArrayBuffer`, typed array, `Error`...), có xử lý tham chiếu vòng.
- **Không clone được:** hàm, symbol làm giá trị, một số object host. Gặp thì `postMessage` **ném `DataCloneError`** ngay ở phía gửi.
- **Instance của class** thành object thuần: mất prototype, method và getter (chỉ còn các thuộc tính sở hữu).
- Chi phí clone **tỉ lệ với kích thước** và chạy trên thread gửi (chặn thread đó lúc serialize).
- **Transfer** (`postMessage(buf, [buf])`): không copy, quyền sở hữu chuyển sang bên nhận, bên gửi mất quyền dùng (buffer bị "detached", `byteLength` = 0).
- **`SharedArrayBuffer`:** cả hai bên thấy **cùng** vùng nhớ, không copy, nhưng phải tự tránh race condition bằng `Atomics`.
- Đa số trường hợp thực tế: dữ liệu nhỏ -> cứ clone; dữ liệu nhị phân lớn -> transfer; trạng thái nhỏ chia sẻ liên tục (bộ đếm, cờ) -> `SharedArrayBuffer` + `Atomics`.

## Lý thuyết chi tiết

**Structured clone, nhìn bằng thí nghiệm.**

```ts
import { Worker, isMainThread, parentPort } from "node:worker_threads";

if (isMainThread) {
  class Money {
    amount: number;
    constructor(amount: number) { this.amount = amount; }
    get doubled(): number { return this.amount * 2; }
  }
  const w = new Worker(new URL(import.meta.url));
  w.on("message", (m) => console.log(m));
  const inputs: unknown[] = [
    { d: new Date(0), m: new Map([[1, "a"]]), s: new Set([1]), big: 10n, re: /x/g },
    new Error("e"),
    { fn: () => 1 },
    new Money(5),
  ];
  for (const i of inputs) {
    try { w.postMessage(i); } catch (e) { console.log("postMessage ném:", (e as Error).name, (e as Error).message); }
  }
  setTimeout(() => void w.terminate(), 200);
} else {
  parentPort?.on("message", (m: unknown) => parentPort?.postMessage({ ctor: (m as object).constructor.name, m }));
}
```

Node 24.21 đã thử:

- Object chứa `Date`, `Map`, `Set`, `BigInt`, `RegExp`: đến nơi **đúng kiểu** (khác `JSON.stringify` biến `Date` thành chuỗi, làm `Map`/`Set` thành `{}`, và **ném lỗi** với `BigInt`).
- `Error`: đến nơi vẫn là `Error` với `message`.
- Object chứa hàm: `postMessage ném: DataCloneError () => 1 could not be cloned.` Lỗi ném **đồng bộ ở phía gửi**, nên bắt được bằng `try/catch`.
- `new Money(5)`: worker nhận `ctor: 'Object'` và `{ amount: 5 }`, chỉ còn thuộc tính dữ liệu (`amount`), **không có getter `doubled`**, không là `Money`. Nếu cần hành vi, tái tạo object bằng cách gọi lại constructor ở phía nhận.

Khuyến nghị thiết kế: thông điệp là **dữ liệu thuần có kiểu rõ** (một `type` union cho request và response), không phải đối tượng nghiệp vụ có hành vi. Kiểu thông điệp bằng discriminated union TypeScript là cách tự nhiên để lấy lại an toàn kiểu qua ranh giới thread (kiểu chỉ có ở compile time; ở runtime vẫn nên validate nếu dữ liệu có thể sai).

**Chi phí clone.** Clone cần serialize ở thread gửi rồi deserialize ở thread nhận; với dữ liệu hàng chục/trăm MB, bước này **tự nó là việc CPU nặng chặn event loop của thread gửi**. Thí nghiệm ở đầu file cho thấy 256 MiB: clone ~657ms vs transfer ~1ms (một lần đo, thay đổi theo máy, nhưng chênh lệch cỡ ba bậc là điển hình). Nếu bạn dùng worker để "giảm tải main" nhưng clone một payload lớn qua `postMessage` mỗi lần, main vẫn bận: mục tiêu bị phá.

**Transfer.** Các kiểu transferable thường dùng: `ArrayBuffer`, `MessagePort`, `FileHandle`, (và `ReadableStream` v.v. theo web streams, kiến thức từ tài liệu, chưa thử). Sau khi transfer, bên gửi không dùng được buffer: `buf.byteLength === 0` và đọc typed array trên nó cho kết quả rỗng. Lỗi hay gặp là giữ lại `Uint8Array` của buffer cũ và dùng tiếp sau khi gửi. Lưu ý: `postMessage(typedArray, [typedArray.buffer])` chuyển **cả buffer**; nếu typed array chỉ là một "lát" của buffer lớn hơn, bạn chuyển hết buffer lớn (và nhiều typed array khác dùng chung buffer đó mất dữ liệu). `Buffer` của Node nhỏ thường lấy từ một **pool 8KB dùng chung** (`Buffer.allocUnsafe`), nên transfer `buffer.buffer` của một `Buffer` nhỏ là nguy hiểm: hãy tự cấp `new ArrayBuffer(n)` / `Buffer.alloc` cho dữ liệu cần transfer (cơ chế pool từ tài liệu Node, không chạy thử riêng ở bài này).

**`SharedArrayBuffer` và race condition.** Cả hai thread cùng đọc ghi một vùng nhớ. Thí nghiệm: 4 worker cùng tăng một bộ đếm 200.000 lần, một đếm bằng ghi thường `v[0] = v[0] + 1`, một bằng `Atomics.add`:

```ts
import { Worker, isMainThread, workerData } from "node:worker_threads";

const N = 200_000;
if (isMainThread) {
  const sab = new SharedArrayBuffer(8);
  const view = new Int32Array(sab);
  const workers = Array.from({ length: 4 }, () => new Worker(new URL(import.meta.url), { workerData: sab }));
  await Promise.all(workers.map((w) => new Promise((r) => w.on("exit", r))));
  console.log("kỳ vọng", 4 * N, "| không Atomics (view[0]):", view[0], "| Atomics (view[1]):", Atomics.load(view, 1));
} else {
  const v = new Int32Array(workerData as SharedArrayBuffer);
  for (let i = 0; i < N; i++) {
    v[0] = (v[0] ?? 0) + 1; // đọc-sửa-ghi: không nguyên tử
    Atomics.add(v, 1, 1);   // nguyên tử
  }
}
```

Node 24.21, máy 12 core: kỳ vọng `800000`; không dùng `Atomics` được khoảng 588.000-616.000 (ba lần chạy) (**mất khoảng một phần tư số lần tăng**, và số khác nhau mỗi lần), dùng `Atomics.add` luôn đúng `800000`. Đây là data race kinh điển: hai thread cùng đọc giá trị cũ, cùng ghi cộng một, mất một lần tăng.

`Atomics` cũng cung cấp `wait`/`notify` để **ngủ** chờ tín hiệu thay vì quay vòng:

```ts
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

if (isMainThread) {
  const sab = new SharedArrayBuffer(4);
  const flag = new Int32Array(sab);
  const w = new Worker(new URL(import.meta.url), { workerData: sab });
  w.on("exit", () => console.log("worker thoát; flag =", Atomics.load(flag, 0)));
  setTimeout(() => { Atomics.store(flag, 0, 1); Atomics.notify(flag, 0); }, 100);
} else {
  const f = new Int32Array(workerData as SharedArrayBuffer);
  const r = Atomics.wait(f, 0, 0); // chỉ ngủ nếu f[0] vẫn là 0; chặn thread worker
  console.log("worker thức dậy:", r);
  parentPort?.close();
}
```

Đã thử: `worker thức dậy: ok`, rồi `worker thoát; flag = 1`. `Atomics.wait` **chặn thread hiện tại**, vì vậy chỉ nên gọi trong worker; trong main thread của Node nó không bị cấm cứng, nhưng sẽ đóng băng event loop, nên đừng dùng (ở trình duyệt thì bị cấm trên main thread). Dùng `Atomics.waitAsync` hoặc thông điệp khi cần ở main (kiến thức từ tài liệu, chưa thử).

**Quy tắc cho `Atomics`.** Chỉ dùng trên typed array nguyên (`Int32Array`, `BigInt64Array`...), không trên `Float64Array`. Thao tác phức hợp "kiểm tra rồi làm" vẫn cần `compareExchange` hoặc khoá tự dựng; `Atomics` chỉ bảo đảm từng thao tác đơn lẻ nguyên tử. Dùng `SharedArrayBuffer` chỉ khi thật cần: bộ đếm/cờ nhỏ, hoặc mảng số lớn mà nhiều worker cùng ghi vào các **vùng riêng** (không chồng chéo) rồi cha đọc kết quả, cách này không cần khoá nào.

## Tricks & tips thực tế

- **Đo kích thước thông điệp trước khi tối ưu.** Lý do: clone vài KB gần như miễn phí; tối ưu bằng transfer/SharedArrayBuffer cho dữ liệu nhỏ làm code phức tạp mà không đáng. Chỉ khi payload cỡ MB trở lên thì mới tính.
- **Transfer buffer rồi nhận lại kết quả bằng cách transfer về** (ping-pong). Lý do: tránh copy cả hai chiều; ví dụ worker xử lý ảnh nhận buffer, sửa tại chỗ, trả lại chính buffer đó.
- **Đừng truyền object lớn và phức tạp (cây hàng trăm nghìn node) qua `postMessage` mỗi request.** Lý do: serialize đồ thị object lớn đắt hơn nhiều so với một buffer phẳng cùng kích thước. Nếu có thể, để worker tự đọc dữ liệu từ nguồn gốc (file/DB) rồi chỉ trả kết quả nhỏ.
- **Dùng `try/catch` quanh `postMessage` khi dữ liệu đến từ ngoài.** Lý do: `DataCloneError` ném đồng bộ; nếu dữ liệu lẫn hàm/getter lạ thì phía gửi hỏng chứ không phải worker. Tốt nhất là chuẩn hoá thành object thuần trước khi gửi.
- **Race condition trong `SharedArrayBuffer` không báo lỗi, chỉ cho kết quả sai** (như ~600.000 thay vì 800.000). Khi thấy kết quả "gần đúng và thay đổi mỗi lần chạy", hãy nghĩ ngay tới race; kiểm thử bằng cách chạy nhiều lần và nhiều worker hơn.
- **Cẩn thận `Atomics.wait` ngoài worker.** Lý do: nó đóng băng thread; ở main sẽ chặn mọi request (cùng nguyên nhân với `readFileSync`).
- **Kiểm tra `isMainThread` khi chia sẻ module.** Lý do: nếu một module có side effect (mở kết nối DB) bị worker nạp lại, bạn mở kết nối trong mỗi worker mà không để ý.
- **So với Laravel/PHP:** PHP không có chia sẻ bộ nhớ giữa request, nên bạn đã quen đẩy mọi thứ qua Redis/DB; ở Node, SharedArrayBuffer giúp chia sẻ nhanh trong **một process** nhưng không vượt qua giữa các process hay máy, nơi bạn vẫn cần Redis/DB/queue.

## Liên hệ bài tập

Khi xây worker pool (lab), đo ba thứ: kích thước thông điệp, thời gian clone, và thời gian tính. Nếu đầu vào của bạn là số nguyên nhỏ (fibonacci n) thì clone vô nghĩa; nếu là chuỗi/buffer lớn để băm thì hãy thử cả clone và transfer và so sánh. Với việc cần kết quả từ nhiều worker, thử thiết kế để mỗi worker ghi vào phần riêng của một `SharedArrayBuffer` thay vì gửi kết quả bằng `postMessage`, rồi giải thích vì sao cách này không cần `Atomics.add` còn bộ đếm chung thì cần.

## Đọc thêm

- [Node.js: `worker.postMessage`](https://nodejs.org/api/worker_threads.html#workerpostmessagevalue-transferlist)
- [Node.js: `port.postMessage` và các kiểu transferable](https://nodejs.org/api/worker_threads.html#portpostmessagevalue-transferlist)
- [MDN: Structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
- [MDN: `Atomics`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics)

## Ghi chú của bạn
