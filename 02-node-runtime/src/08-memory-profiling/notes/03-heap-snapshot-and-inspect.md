# 3. Heap snapshot, `--inspect` và đọc retainers

Heap snapshot là **ảnh chụp toàn bộ object còn sống** tại một thời điểm, kèm đồ thị "ai trỏ tới ai". So sánh hai snapshot trả lời câu hỏi: object loại nào tăng, và ai đang giữ chúng.

```ts
import { writeHeapSnapshot } from "node:v8";

const file = writeHeapSnapshot();   // ghi vào thư mục hiện tại, trả về tên file
console.log(file);                  // ví dụ: Heap.20261012.173545.33222.0.001.heapsnapshot
```

(Node 24.21 đã thử.)

## Ý chính

- Ba cách tạo snapshot: gọi `v8.writeHeapSnapshot()` trong code; chạy với `--heapsnapshot-signal=SIGUSR2` rồi gửi tín hiệu; `--heapsnapshot-near-heap-limit=N` (tự chụp khi sắp hết heap); hoặc bấm nút trong tab Memory của Chrome DevTools khi gắn `--inspect`.
- Snapshot **chặn event loop** trong lúc ghi và tốn bộ nhớ rất lớn; **không bao giờ** chụp tuỳ tiện trên instance production đang chịu tải mà không tính trước.
- Cách dùng đúng: chụp **hai (hoặc ba) snapshot** cách nhau một đợt tải, rồi dùng chế độ **Comparison** trong DevTools để xem lớp nào tăng số lượng.
- **Shallow size** là kích thước của chính object; **retained size** là tổng những gì sẽ được giải phóng nếu object đó biến mất. Rò rỉ thường lộ ra ở retained size của một "container" (Map, mảng, closure context).
- **Retainers** là chuỗi tham chiếu từ gốc GC đến object nghi vấn: đọc từ dưới lên để biết biến/cấu trúc nào giữ nó.
- Snapshot chỉ chứa object **còn sống sau một lần GC đầy đủ**; phần bộ nhớ ngoài heap (nội dung `Buffer`) chỉ hiện dưới dạng "vỏ" nhỏ.

## Lý thuyết chi tiết

**Ví dụ nhỏ: chụp trước và sau.** Một `Map` chỉ có `set`, không bao giờ xoá (miền khác với lab: "người truy cập đã thấy"):

```ts
import { writeHeapSnapshot } from "node:v8";
import { statSync } from "node:fs";

class Visitor {
  id: number;
  ua: string;
  constructor(id: number, ua: string) { this.id = id; this.ua = ua; }
}
const seen = new Map<number, Visitor>();   // chỉ thêm, không bao giờ xoá

function track(n: number) {
  for (let i = 0; i < n; i++) seen.set(i, new Visitor(i, "UA-" + i));
}

track(1_000);
const f1 = writeHeapSnapshot("a.heapsnapshot");
track(21_000);
const f2 = writeHeapSnapshot("b.heapsnapshot");
console.log(f1, statSync(f1).size, f2, statSync(f2).size);
```

(Lưu ý cú pháp: `constructor(readonly id: number)` là *parameter property*, Node chạy `.ts` bằng type stripping **không hỗ trợ**; phải khai báo trường riêng như trên, nếu không gặp `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.)

Kết quả thật: snapshot đầu 5,8 MB (khoảng 67.000 node, 284.000 cạnh: một tiến trình Node gần như trống đã có chừng này object nội bộ), snapshot sau 8,7 MB. Phần lớn khác biệt là đúng 20.000 `Visitor` thêm vào. Bạn không cần GUI để kiểm tra điều này, vì file chỉ là JSON; đoạn code dưới đếm object theo tên constructor, chính là điều cột "Constructor" của DevTools làm:

```ts
import { readFileSync } from "node:fs";

type Snap = {
  snapshot: { meta: { node_fields: string[]; node_types: [string[]] }; node_count: number };
  nodes: number[];       // phẳng: mỗi node chiếm node_fields.length số
  strings: string[];     // bảng chuỗi, `name` là chỉ số vào đây
};

function count(file: string, name: string) {
  const s = JSON.parse(readFileSync(file, "utf8")) as Snap;
  const f = s.snapshot.meta.node_fields;                // type,name,id,self_size,edge_count,detachedness
  const w = f.length, iName = f.indexOf("name"), iType = f.indexOf("type");
  const types = s.snapshot.meta.node_types[0];
  let n = 0;
  for (let i = 0; i < s.nodes.length; i += w) {
    if (s.strings[s.nodes[i + iName]!] === name && types[s.nodes[i + iType]!] === "object") n++;
  }
  return n;
}
console.log(count("a.heapsnapshot", "Visitor"), count("b.heapsnapshot", "Visitor"));   // 1000 21000
```

Kết quả: `1000` và `21000`. Đó chính xác là "Delta" mà chế độ so sánh hiển thị: **số lượng tăng cùng một lớp qua hai lần chụp** là dấu hiệu rò rỉ rõ nhất, vì tập dữ liệu hợp lệ thường ổn định giữa các lần chụp.

**Retainers, kiểm chứng từ file.** Duyệt cạnh ngược từ một `Visitor` lên (bỏ qua cạnh `weak`), lấy retainer đầu tiên mỗi bước, ta được:

```text
object:Visitor
<-(internal:516)-  array:                 <- bảng băm bên trong Map
<-(internal:table)- object:Map
<-(context:seen)-  object:system / Context  <- biến `seen` của module, nằm trong context
<-(internal:47)-   synthetic:(Stack roots)
<-(element:[19])-  synthetic:(GC roots)
```

Đọc từ trên xuống: `Visitor` được một mảng (bảng của `Map`) giữ; `Map` được `Context` giữ qua tên `seen`; context được stack giữ; rồi tới `GC roots`. Trong DevTools, bảng **Retainers** ở nửa dưới hiện đúng chuỗi này (tên biến `seen` xuất hiện ở cạnh `context`). Đây là lý do nên đặt tên biến và class có nghĩa: tên chính là đầu mối bạn đọc được.

**Chi phí của việc chụp (Node 24.21, đo một lần trên máy thử).**

| Heap lúc chụp | Kích thước file | Thời gian chặn event loop | RSS đỉnh |
|---|---|---|---|
| Tiến trình trống (~9 MB) | 5,8 MB | khoảng 0,24 s | n/a |
| 300.000 object trong `Map` (`heapUsed` ~61 MB) | 46 MB | 3,4 s (khoảng timer trễ tương ứng 3,45 s) | **610 MB** (trước chụp 135 MB) |
| 1,5 triệu object (`heapUsed` ~208 MB) | khoảng 216 MB | **13,5 s** | **2400 MB** (trước chụp 334 MB) |

Hai điểm cần khắc ghi: (1) trong lúc chụp, một `setInterval` 10 ms **không chạy được lần nào** (khoảng trễ tối đa đo được bằng đúng thời gian chụp), tức mọi request đứng im; (2) RSS đỉnh gấp nhiều lần heap. Trong container giới hạn 512 MB hay 1 GB, chụp heap 200 MB rất có thể kết thúc bằng OOMKilled, đúng lúc bạn đang cần điều tra. Không nên lấy số tuyệt đối làm định mức (phụ thuộc máy, phiên bản), nhưng tỉ lệ "chụp chậm và nặng hơn nhiều so với kích thước heap" là ổn định.

**Snapshot kích hoạt GC trước khi chụp.** Trong một thử nghiệm, chương trình giữ `Map` 1,5 triệu phần tử nhưng không dùng nó sau dòng chụp, snapshot chỉ còn 6 MB: V8 coi biến đã "chết" (không còn được tham chiếu về sau), GC thu hồi, và snapshot không thấy gì. Thêm một lệnh dùng `map.size` **sau** khi chụp thì snapshot mới chứa đủ. Bài học: snapshot phản ánh đồ thị **còn sống**, và "rò rỉ" mà code không còn đụng tới có thể biến mất khi bạn thử tái hiện bằng script rút gọn. Hãy tái hiện đúng đường tham chiếu thật.

**Kích thước file không bằng kích thước heap.** Với `--heapsnapshot-near-heap-limit=1 --max-old-space-size=64` trên chương trình giữ vài trăm mảng lớn (`new Array(100_000)`), snapshot được ghi ngay trước khi chết chỉ có khoảng 5 MB và 58.000 node, trong khi tổng `self_size` là khoảng 70 MB: ít node nhưng mỗi node rất lớn. Đừng suy "snapshot nhỏ nên heap nhỏ"; hãy xem cột Shallow/Retained size. Tiến trình vẫn chết (exit 134) sau khi ghi.

**Chụp bằng tín hiệu (không sửa code).** `node --heapsnapshot-signal=SIGUSR2 app.ts`, rồi `kill -USR2 <pid>`. Đã thử: mỗi tín hiệu tạo một file tên `Heap.<ngày>.<giờ>.<pid>.<tid>.<seq>.heapsnapshot` ở thư mục làm việc hiện tại của tiến trình, quyền `0600` (chỉ chủ sở hữu đọc, vì snapshot chứa dữ liệu thật của bộ nhớ). Gửi tín hiệu hai lần ở hai thời điểm là cách thu hai snapshot cho chế độ so sánh.

**`--inspect`.** `node --inspect=127.0.0.1:9229 app.ts` mở máy chủ WebSocket cho giao thức Chrome DevTools. Đã kiểm chứng: `GET http://127.0.0.1:9333/json/list` trả JSON mô tả target (trường `webSocketDebuggerUrl`, `devtoolsFrontendUrl`), và `/json/version` trả `"Browser": "node.js/v24.21.0"`. Gửi `SIGUSR1` cho một tiến trình Node đang chạy cũng bật inspector (đã thử: in `Debugger listening on ws://127.0.0.1:9229/...`) mà không cần khởi động lại, rất hữu ích khi tiến trình đã chạy sẵn. Biến thể `--inspect-brk` dừng ở dòng đầu. Từ Chrome: mở `chrome://inspect` và chọn target (kiến thức từ tài liệu, chưa thử, vì không mở được giao diện).

**Quy trình trong DevTools (kiến thức từ tài liệu, chưa thử vì không mở GUI).** Tab *Memory* -> "Heap snapshot" -> *Take snapshot*. Thực hiện thao tác nghi ngờ rò rỉ nhiều lần, chụp lại; chọn snapshot sau, đổi view từ *Summary* sang *Comparison*, chọn snapshot gốc để so; sắp xếp theo *# Delta* hoặc *Size Delta*; chọn một dòng (lớp) để xem từng instance; ở khung *Retainers* đọc chuỗi giữ. Có thêm chế độ *Allocation sampling* và *Allocation instrumentation on timeline* cho câu hỏi "ai cấp phát". Chi tiết ở link Chrome DevTools bên dưới.

**Bảo mật.** `--inspect` mặc định chỉ bind `127.0.0.1`. Bind `0.0.0.0` (hay `--inspect=0.0.0.0:9229`) cho phép **bất kỳ ai tới được cổng đó chạy code tuỳ ý** trong tiến trình. Trong k8s hãy dùng `kubectl port-forward` hoặc `kubectl debug`, không expose cổng ra ngoài.

## Tricks & tips thực tế

- **Chụp trên một instance cô lập**: đưa instance ra khỏi load balancer (hoặc dùng một bản sao ở staging chạy tải giả), vì chụp có thể chặn hàng chục giây. Lý do: health check thất bại và K8s có thể restart pod ngay lúc bạn đang chụp, mất luôn bằng chứng.
- **Đảm bảo đủ chỗ**: ước tính RAM cần gấp 3-10 lần `heapUsed`, cộng đĩa trống đủ cho file. Lý do: đã đo RSS đỉnh 4-12 lần heap trong thí nghiệm trên.
- **Chụp hai lần cách nhau một đợt tải đồng nhất** (ví dụ 5 phút, cùng loại request). Lý do: so sánh chỉ có nghĩa khi hai trạng thái khác nhau ở đúng một thứ.
- **Dùng `--heapsnapshot-near-heap-limit=1`** ở môi trường thử để có bằng chứng ngay lúc sắp chết. Lý do: OOM thường xảy ra lúc 3 giờ sáng, không ai ngồi chụp. Lưu ý chính việc ghi snapshot trong lúc gần cạn heap cần bộ nhớ, có thể chết trước khi ghi xong (tài liệu cảnh báo), nên đừng bật mù quáng ở production.
- **Sắp xếp theo retained size, rồi tìm tên bạn nhận ra** (`Session`, `Cache`, class của bạn) trước khi nhìn vào "(string)", "(array)", "(system)". Lý do: đồ thị chứa rất nhiều object nội bộ của V8/Node; tên của bạn là đầu mối đáng tin nhất.
- **Chuỗi nặng có thể chiếm phần lớn snapshot:** nhiều bản sao của cùng một chuỗi (log, JSON) hay `Buffer` nhỏ rời rạc. Với chuỗi, nhìn retainers của chuỗi đó, thường là một mảng/Map đang tích luỹ.
- **Nhớ rằng bộ nhớ ngoài heap không có trong snapshot**: nếu `rss` tăng mà `heapUsed` phẳng, mở snapshot chỉ tốn thời gian. Dùng `process.memoryUsage()` (file 1) để quyết định nên điều tra ở đâu trước.
- **Tránh chụp trong `uncaughtException` hay `SIGTERM` handler** chạy dài: chặn event loop có thể khiến tiến trình bị giết cứng sau grace period, mất snapshot dở dang.
- **Dọn file sau khi dùng:** snapshot chứa dữ liệu thật (token, thông tin người dùng trong bộ nhớ), đừng commit hay gửi cho người không cần biết. Thêm `*.heapsnapshot` và `*.cpuprofile` vào `.gitignore`.
- **So với PHP:** gần nhất là Xdebug/Blackfire profile theo request; nhưng heap snapshot là ảnh của một tiến trình sống lâu, không phải của một request.

## Liên hệ bài tập

Khi làm lab: chụp ít nhất hai snapshot, ghi lại **tên lớp tăng**, delta số lượng, và chuỗi retainers cho một instance cụ thể. Hãy nêu bằng lời "biến nào giữ, và tại sao nó không bao giờ được giải phóng", rồi đề xuất cách sửa và chứng minh bằng một lần đo sau khi sửa. Nếu bạn muốn kiểm tra file mà không cần GUI, đoạn đếm theo tên ở trên là điểm khởi đầu, nhưng đề bài mới là thứ cần làm.

## Đọc thêm

- [Node.js: Using Heap Snapshot](https://nodejs.org/en/learn/diagnostics/memory/using-heap-snapshot)
- [Node.js: module `v8` (`writeHeapSnapshot`)](https://nodejs.org/api/v8.html)
- [Node.js: module `inspector`](https://nodejs.org/api/inspector.html)
- [Chrome DevTools: Memory problems](https://developer.chrome.com/docs/devtools/memory-problems)

## Ghi chú của bạn
