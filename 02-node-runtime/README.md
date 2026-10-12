# Phase 02 — Node.js Runtime và Internals

Nguồn định hướng: [`../ROADMAP.md`](../ROADMAP.md) (Phase 02, §8 Definition of Done).
Kế hoạch bài học: [`PLAN.md`](./PLAN.md). Tiến độ: [`../PROGRESS.md`](../PROGRESS.md).

## Mục tiêu

- Giải thích được cách Node.js xử lý I/O và tác vụ CPU-bound.
- Phân biệt asynchronous I/O với parallel CPU execution.
- Hiểu backpressure, graceful shutdown và vòng đời tiến trình.
- Biết đọc memory profile, debug và xử lý lỗi runtime.
- Xây một HTTP server nhỏ không dùng framework để nắm những gì framework (NestJS, Express) đang làm hộ.

## Phạm vi

Trong phạm vi: event loop, Promise/async, libuv và thread pool, Worker Threads, child process, streams và Buffer, file system, signals, IPC, TCP/HTTP/WebSocket, memory và profiling. Chỉ dùng module có sẵn của Node (`node:*`).

Ngoài phạm vi: NestJS, database, message queue, framework HTTP. Không chuyển sang Phase 03 khi chưa đạt Definition of Done trong `PLAN.md`.

## Điều kiện vào phase

Phase 01 phải đạt Definition of Done (xem `../01-typescript/PLAN.md`). Tài liệu trong thư mục này có thể đọc trước, nhưng việc làm lab chỉ bắt đầu khi Phase 01 xong. Bài 8 của Phase 01 (ESM và `tsconfig`) là nền tảng trực tiếp cho cách chạy code ở đây.

## Cách học

Mỗi bài theo vòng lặp: **giải thích → đề bài → bạn tự làm → review → giải thích lại → cập nhật tiến độ**, như Phase 01.

- Notes nằm ở `src/NN-<tên-bài>/notes/`, đọc theo số thứ tự file. Mỗi file có mục "Ghi chú của bạn" để bạn tự bổ sung.
- Đề bài nằm ở `src/NN-<tên-bài>/EXERCISE.md`, chỉ tạo khi bắt đầu bài đó.
- Ví dụ trong notes là TypeScript ESM, chạy trên Node 24 (đã thử với 24.21). Notes ghi rõ chỗ nào là hành vi phụ thuộc phiên bản.
- Rất nhiều bài là thí nghiệm: kết quả đo (thứ tự log, thời gian, bộ nhớ) khác nhau giữa các máy. Hãy tự chạy và tin vào số liệu của máy bạn.

## Thiết lập (khi bắt đầu phase)

Phase này chưa có `package.json` hay `tsconfig.json`; sẽ tạo khi bắt đầu Bài 1, dựa trên những gì bạn học ở Bài 8 của Phase 01 (ESM, `module: NodeNext`, `types: ["node"]`). Không thêm dependency ngoài nhu cầu bài học.

## Tài liệu chính thức

- [Node.js API](https://nodejs.org/api/)
- [Node.js Learn](https://nodejs.org/en/learn)
- [libuv design overview](https://docs.libuv.org/en/v1.x/design.html)
- [Diagnostics guides](https://nodejs.org/en/learn/diagnostics)
