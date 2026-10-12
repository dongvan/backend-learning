# 5. `cluster`, chọn công cụ, và so sánh với Laravel queue worker/Horizon

`cluster` chạy **nhiều process Node cùng lắng nghe một cổng**, để một server HTTP dùng được nhiều core. Nó là công cụ để **scale phục vụ request**, khác với Worker Threads (dời tính toán khỏi event loop).

```ts
import cluster from "node:cluster";
import { createServer } from "node:http";
import { availableParallelism } from "node:os";

if (cluster.isPrimary) {
  const n = 3;
  for (let i = 0; i < n; i++) cluster.fork();
  let ready = 0;
  cluster.on("listening", async () => {
    if (++ready < n) return;
    const pids = new Set<string>();
    for (let i = 0; i < 12; i++) {
      pids.add(await (await fetch("http://127.0.0.1:34567", { headers: { connection: "close" } })).text());
    }
    console.log("pid đã phục vụ:", [...pids], "| cores", availableParallelism());
    for (const w of Object.values(cluster.workers ?? {})) w?.kill();
  });
} else {
  createServer((_q, r) => r.end(String(process.pid))).listen(34567);
}
```

Node 24.21: 3 worker cùng `listen(34567)` **không lỗi `EADDRINUSE`**, 12 request (mỗi request một kết nối mới) được 3 pid khác nhau phục vụ. Lưu ý: nếu client **tái dùng kết nối** (keep-alive, mặc định của `fetch`), các request chung một kết nối đi vào cùng một worker; lần thử đầu không có `connection: close` chỉ thấy 2 pid trong 12 request. Phân phối theo **kết nối**, không theo request.

## Ý chính

- `cluster.fork()` tạo process con (bản sao của chương trình, `cluster.isPrimary === false`), tất cả chia sẻ một cổng nghe: process chính (primary) nhận kết nối rồi phân cho các worker (mặc định **round-robin** trên Linux/macOS, `cluster.schedulingPolicy === cluster.SCHED_RR`).
- Mỗi worker là **process riêng**: heap riêng, event loop riêng, **không chia sẻ** biến (cache trong bộ nhớ, session in-memory, WebSocket state): phải đưa ra ngoài (Redis/DB).
- `cluster` chủ yếu dùng để **dùng hết core** cho server HTTP I/O-bound; trong container hay Kubernetes, thường scale bằng **nhiều container/pod** thay vì `cluster` trong một container, còn PM2 (`pm2 -i`) và systemd là các cách quen thuộc để chạy nhiều process.
- `cluster` **không** giải quyết việc CPU nặng cho từng request: request nặng vẫn chặn worker nhận nó (và các request cùng worker). Với việc nặng, dùng worker pool/queue.
- Giám sát: primary nghe `exit` của worker để **fork lại** khi worker chết.

## Lý thuyết chi tiết

**Cách `cluster` chia cổng.** Primary mở socket lắng nghe, nhận kết nối, rồi chuyển file descriptor của kết nối cho một worker theo round-robin (chính sách mặc định ngoài Windows). Worker gọi `listen(34567)` thực ra là **xin** primary cho nghe; không có nhiều socket cùng bind một cổng, nên không `EADDRINUSE`. Thí nghiệm ở đầu file xác nhận phân theo kết nối. Một tuỳ chọn khác là chính sách "để hệ điều hành chia" (`SCHED_NONE`) khi nhiều worker cùng accept trên một socket; nó thường phân phối **không đều** (kiến thức từ tài liệu, chưa thử).

**Vì sao cần nhiều process?** Một process Node chỉ chạy JS trên một core. Máy 12 core mà chỉ một process thì 11 core rảnh (kể cả khi tải lên cao). Nhiều process => nhiều event loop => dùng được nhiều core, và nếu một process crash, các process kia vẫn phục vụ (cô lập lỗi mức process).

**Cái giá: trạng thái.** Dữ liệu trong bộ nhớ mỗi worker không thấy được nhau. Ví dụ rate limit đếm trong `Map` của process cho kết quả sai (mỗi worker đếm riêng, tổng limit = N × limit), session lưu trong bộ nhớ làm người dùng "mất đăng nhập" khi request tới worker khác, cache cục bộ bị lỗi thời không đồng nhất. Giải pháp: lưu trạng thái ở dịch vụ dùng chung (Redis/DB). Đây là điều quen thuộc của PHP-FPM: bạn đã không thể giữ trạng thái giữa các request/worker và phải dùng Redis/DB/cache. Ở Node, nếu chạy **một** process, biến toàn cục "có vẻ" chạy ổn, và vỡ lúc scale lên N process: nên thiết kế stateless ngay từ đầu.

**Chi phí.** Mỗi process nạp lại toàn bộ ứng dụng: RSS thường vài chục đến vài trăm MB mỗi process (tuỳ ứng dụng), và `fork` một process cùng chương trình cho khởi động tương đương `node` + nạp app (đã đo `node -e 0` ~46ms, ứng dụng thật nhiều hơn). Nhiều process cũng mở nhiều kết nối DB hơn (mỗi process một pool): với 8 process và pool 10 là 80 kết nối; phải tính vào giới hạn `max_connections` của DB.

**Bảng chọn công cụ.**

| Mục tiêu | Công cụ | Lý do |
|---|---|---|
| Dùng hết core để phục vụ nhiều request (I/O) | nhiều process: `cluster`, PM2, nhiều container | mỗi process có event loop riêng |
| Một request cần tính nặng JS (ms đến giây), cần kết quả ngay | Worker pool | dời CPU khỏi event loop, không cần broker |
| Chạy chương trình ngoài/cô lập code | `child_process` (`spawn`/`execFile`) | cô lập mức OS |
| Việc dài/ bền/ retry/ lập lịch | Queue + worker process riêng | job sống sót qua restart |
| Trao đổi thông điệp Node-Node giữa process cha-con | `fork` + IPC | kênh sẵn có |

**So sánh trực tiếp với Laravel.**

| Khái niệm Laravel | Tương ứng Node | Khác biệt đáng lưu ý |
|---|---|---|
| PHP-FPM: N process, mỗi request một process | `cluster`/PM2/container: N process Node, mỗi process nhiều request đồng thời | Node chịu nhiều request/process nhưng việc CPU chặn các request cùng process |
| `artisan queue:work` (process bền kéo job) | worker process riêng (BullMQ worker...) hoặc worker pool trong process | Queue bền (Redis) vs pool trong bộ nhớ (mất khi chết) |
| Horizon (giám sát, scale số worker, retry, metric) | PM2/supervisor/Kubernetes + thư viện queue có dashboard | Node không có "một cục" tương đương mặc định; bạn ghép |
| `Process`/`shell_exec` | `child_process` | cùng nguy cơ injection khi ghép chuỗi |
| Octane (Swoole/RoadRunner: giữ app trong bộ nhớ) | Node mặc định đã giữ app trong bộ nhớ | cùng cạm bẫy: trạng thái rò rỉ giữa request, biến static/global |
| `Queue::fake()`, `dispatch()` trả ngay | `POST` -> 202 + id; việc chạy nơi khác | luồng bất đồng bộ phải thiết kế rõ trạng thái |

Điểm then chốt: Laravel **buộc** bạn tách web và việc nặng (vì PHP-FPM không có cách nào khác), còn Node cho bạn chạy tính toán nặng ngay trong web process, dễ dàng và **nguy hiểm**. Quy tắc an toàn: mọi việc CPU không-nhỏ phải ra khỏi main thread.

**Lên kế hoạch scale theo thứ tự.** (1) Tối ưu thuật toán/DB, cache; (2) nếu CPU main thread còn cao: đưa việc nặng ra worker pool hoặc queue; (3) nếu vẫn thiếu năng lực: nhiều process/container (scale ngang); (4) nếu cần bền/retry/lập lịch: queue + worker service. Mỗi bước thêm độ phức tạp vận hành, nên đừng nhảy tới bước 4 khi bước 1-2 đủ.

## Tricks & tips thực tế

- **Trong container/Kubernetes, thường chạy một process Node mỗi container rồi scale số bản sao.** Lý do: orchestrator đã có health check, restart, phân tải và giới hạn tài nguyên theo container; thêm `cluster` bên trong làm chồng lớp giám sát (hai lớp restart) và khó đọc số liệu. `cluster`/PM2 hợp với VM đơn lẻ không có orchestrator.
- **Kiểm tra trạng thái trong bộ nhớ trước khi scale ngang.** Lý do: rate limit, cache, session, hàng đợi in-memory, lock `Map` đều sai khi có N process; chuyển sang Redis/DB trước.
- **Fork lại worker chết, nhưng chống crash-loop (backoff, giới hạn số lần).** Lý do: worker lỗi lúc khởi động mà bị fork lại vô hạn sẽ ngốn CPU và log; cần đặt ngưỡng và cảnh báo.
- **Đặt tổng số kết nối DB = số process × kích thước pool.** Lý do: lỗi "too many connections" khi scale ngang là sự cố rất phổ biến.
- **Khi test phân phối tải, dùng kết nối mới (hoặc nhiều client) thay vì một kết nối keep-alive.** Lý do: phân phối theo kết nối (đã quan sát: keep-alive làm 12 request chỉ đến 2 trong 3 worker); thử nghiệm sai khiến bạn tưởng cluster chia không đều.
- **Dùng sticky session cho WebSocket/Socket.IO khi nhiều process.** Lý do: nhiều kết nối/handshake của một client phải về cùng process hoặc trạng thái phải chia sẻ qua adapter (Redis); nếu không client bị ngắt lạ (từ tài liệu Socket.IO, chưa thử ở bài này).
- **Giám sát từng process riêng:** đo event loop lag, RSS, số kết nối theo từng pid. Lý do: trung bình toàn cụm che giấu một worker đang bị chặn.
- **Đừng nhầm lẫn "nhiều worker threads" với "cluster".** Lý do: cluster mở rộng **phục vụ** request (I/O), worker threads mở rộng **tính toán** trong một process. Kết hợp cả hai là hợp lệ: N process, mỗi process có pool nhỏ.

## Liên hệ bài tập

Bài tập không bắt buộc `cluster`, nhưng khi viết phần kết luận lab, hãy trả lời bằng bảng chọn công cụ ở trên: với worker pool và child process bạn vừa làm, nêu một tình huống backend thực tế (ví dụ nén tệp tải lên, tính toán báo cáo, gọi công cụ chuyển đổi) phù hợp nhất với từng công cụ và một tình huống nên dùng queue (kiểu Laravel `dispatch`). Nếu còn thời gian, thử chạy ví dụ `cluster` đầu file, thay số worker, và quan sát vì sao keep-alive làm lệch phân phối.

## Đọc thêm

- [Node.js: Cluster](https://nodejs.org/api/cluster.html)
- [Node.js: Worker threads](https://nodejs.org/api/worker_threads.html)
- [Node.js: Child process](https://nodejs.org/api/child_process.html)
- [Laravel: Queues](https://laravel.com/docs/queues)
- [Laravel: Horizon](https://laravel.com/docs/horizon)

## Ghi chú của bạn
