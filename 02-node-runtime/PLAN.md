# Phase 02 — Kế hoạch bài học

Thứ tự theo phụ thuộc kiến thức. Thời lượng dự kiến 4–6 tuần, có thể điều chỉnh theo tiến độ thực tế.
Thư mục bài: `src/NN-<tên-bài>/` (đã có `notes/`; `EXERCISE.md` tạo khi bắt đầu bài).

## Bài học

| # | Bài | Nội dung | Bài tập (tóm tắt) | Phụ thuộc |
|---|---|---|---|---|
| 1 | Event loop, microtasks, timers | Các phase của libuv, `nextTick` vs microtask vs `setImmediate`, event loop lag | Dự đoán thứ tự output của ~8 đoạn code rồi chạy kiểm chứng; script đo event loop lag | Phase 01 |
| 2 | Promise, async/await, error propagation | Trạng thái Promise, lan truyền lỗi, `Promise.all/allSettled/race/any`, unhandled rejection, `AbortSignal` | Tự viết `withTimeout`, `retry` có backoff, `mapLimit` | 1 |
| 3 | libuv, I/O concurrency, CPU vs I/O-bound | Async I/O của OS vs thread pool, concurrency vs parallelism | Benchmark chặn event loop; đọc file song song vs tuần tự | 1–2 |
| 4 | Worker Threads, child processes | `worker_threads`, structured clone, `SharedArrayBuffer`, `child_process`, IPC | Worker pool cho tác vụ CPU-bound so với main thread; chạy một lệnh bằng child process | 3 |
| 5 | Streams, Buffer, backpressure | 4 loại stream, `pipeline`, `highWaterMark`, `drain`, đo RSS | Xử lý file CSV/log lớn bằng stream, tôn trọng backpressure, đo memory | 2–3 |
| 6 | File system, signals, process lifecycle, IPC | `fs/promises`, ghi file an toàn, `SIGINT`/`SIGTERM`, exit code, `fork` + `process.send` | Chương trình xử lý signal đúng cách, PID/lock file, IPC parent–child | 4–5 |
| 7 | TCP, HTTP, WebSocket, graceful shutdown | `node:net`, `node:http`, timeouts, giao thức WebSocket, drain kết nối | TCP echo server, HTTP server thuần, graceful shutdown | 5–6 |
| 8 | Memory, profiling, debugging | V8 heap, GC, memory leak, heap snapshot, `--cpu-prof`, `--inspect` | Tìm một memory leak bằng heap snapshot và đọc profile | 1–7 |
| 9 | Project: HTTP server nhỏ | Routing, middleware, centralized error handling, structured logging | HTTP server không framework đủ 4 thành phần, có test | 1–8 |

Đề chi tiết của từng bài nằm trong `EXERCISE.md`, chỉ tạo khi bắt đầu bài đó.

## Tiêu chí đánh giá mỗi bài

- [ ] `tsc --noEmit` sạch, không dùng `any` (nếu có thì ghi lý do).
- [ ] Chạy được và cho kết quả đo thật trên máy bạn (thời gian, bộ nhớ, thứ tự log), kèm giải thích vì sao ra kết quả đó.
- [ ] Có test cho phần logic có thể test; xử lý lỗi và đóng tài nguyên (listener, timer, socket, file) đúng cách.
- [ ] Tiến trình thoát sạch: không treo, không để lại tiến trình con hay cổng đang chiếm.
- [ ] Giải thích lại được bằng lời: Node đang làm gì ở mỗi bước (event loop, thread pool, kernel).
- [ ] Đã review và refactor.
- [ ] `PROGRESS.md` được cập nhật kèm bằng chứng.

## Definition of Done (Phase 02)

Theo ROADMAP §8, kèm tiêu chí riêng của Phase 02:

- [ ] Giải thích được cách Node.js xử lý I/O và tác vụ CPU-bound.
- [ ] Phân biệt asynchronous I/O với parallel CPU execution, và chọn đúng giải pháp (worker, process riêng, queue) cho từng loại tải.
- [ ] Giải thích được thứ tự thực thi của `nextTick`, microtask, timer và `setImmediate`.
- [ ] Hiểu backpressure và xử lý stream đúng cách (`pipeline`, `drain`).
- [ ] Hiểu và triển khai graceful shutdown (signal, drain kết nối, đóng tài nguyên).
- [ ] Biết đọc memory profile, tìm leak bằng heap snapshot và xử lý lỗi runtime.
- [ ] Tự triển khai bài tập, không phụ thuộc hoàn toàn vào AI.
- [ ] Project HTTP server nhỏ hoàn thành (routing, middleware, centralized error handling, structured logging), có test, đã review và refactor.
- [ ] Có ghi chú kiến thức; `PROGRESS.md` đã cập nhật.
- [ ] Qua bài kiểm tra cuối phase (câu hỏi đánh giá do agent đặt, bạn trả lời).

Chưa đạt đủ thì luyện tiếp; không bắt đầu NestJS (Phase 03).
