# 2. Routing và parse request (query, body) an toàn

Router là bảng ánh xạ `(method, path)` sang handler; việc khó không phải khớp chuỗi mà là **các trường hợp biên**: 404 hay 405, thứ tự, ký tự đã mã hoá, và việc tin vào dữ liệu client gửi. Phần parse body quyết định server của bạn bị hạ gục bởi một request 2 GB hay không.

```ts
// Khớp đường dẫn theo từng đoạn: chỉ minh hoạ ý tưởng (chưa có method, 404/405, wildcard)
function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = Object.create(null) as Record<string, string>;
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!, val = s[i]!;
    if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(val);
    else if (seg !== val) return null;
  }
  return params;
}
console.log(matchPath("/users/:id", "/users/42"));   // [Object: null prototype] { id: '42' }
```

(Node 24.21 đã thử. Đoạn trên **cố tình chưa đủ** cho project: nó có những lỗ hổng được nêu ở bên dưới để bạn tự phát hiện và xử lý.)

## Ý chính

- Khớp theo **method + path**. Cùng path khác method là **405 Method Not Allowed** (kèm header `Allow`), path không tồn tại là **404 Not Found**. Hai trường hợp khác nhau, client xử lý khác nhau.
- `req.url` chứa **cả query string** và chưa được giải mã. Cần tách path và query trước khi khớp.
- Thứ tự khớp là ngữ nghĩa: `/users/me` phải thắng `/users/:id`. Cách an toàn: ưu tiên đoạn tĩnh hơn đoạn tham số, hoặc khớp theo thứ tự đăng ký và ghi rõ quy ước.
- Mọi thứ từ client là **chưa đáng tin**: path (`%` hỏng), query (khoá lặp, `__proto__`), header (`content-type`, `content-length` có thể nói dối), body (kích thước, JSON hỏng).
- Body phải đọc **có giới hạn**: kiểm tra `Content-Length` sớm và **đếm byte thực nhận** (chunked không có `Content-Length`).
- Lỗi do client gây ra phải trả 4xx (400, 404, 405, 413, 415, 422), không bao giờ 500 và không bao giờ làm sập tiến trình.

## Lý thuyết chi tiết

**404 vs 405.** Với bảng tuyến `GET /users/:id`, `POST /users`:

| Request | Kết quả | Lý do |
|---|---|---|
| `GET /users/42` | khớp | |
| `DELETE /users/42` | **405**, `Allow: GET` | path khớp một tuyến nhưng method thì không |
| `GET /nope` | **404** | không tuyến nào khớp path |
| `OPTIONS /users/42` | thường 204 + `Allow` | tuỳ bạn hỗ trợ CORS/preflight hay không |
| `HEAD /users/42` | như `GET` nhưng không có body | Node tự bỏ body khi `res` trả lời một `HEAD` (đã thử: handler vẫn chạy, `content-length: 5` được giữ, body rỗng), nhưng bạn cần quyết định có khớp `GET` cho `HEAD` không |

Thuật toán gợi ý: khớp **path** trước, gom các method của những tuyến khớp path; nếu có tuyến method khớp thì chạy, nếu tập method không rỗng mà không có method khớp thì 405 với `Allow` là tập đó, nếu rỗng thì 404. Điều này nghĩa là bạn không thể thoát vòng lặp ở lần khớp path đầu tiên mà không xét method; hãy tự nghĩ cấu trúc dữ liệu hợp lý.

**Tham số `:id` và những gì ví dụ trên bỏ sót.** Chạy thật (Node 24.21):

```text
matchPath("/users/:id", "/users/42")    -> [Object: null prototype] { id: '42' }
matchPath("/users/:id", "/users/a%20b") -> { id: 'a b' }            // đã giải mã
matchPath("/users/:id", "/users")       -> null
matchPath("/users/:id", "/users/42/")   -> { id: '42' }             // dấu / thừa vẫn khớp
matchPath("/users/:id", "/users/%E0%A4%A") -> ném URIError          // lỗ hổng!
```

- `decodeURIComponent` **ném `URIError: URI malformed`** với chuỗi `%` không hợp lệ. Nếu không bắt, một request do kẻ xấu gửi (`GET /users/%E0%A4%A`) sẽ ném lỗi trong handler và (tuỳ bạn đã chặn lỗi ở đâu) trả 500 thay vì 400, hoặc tệ hơn là làm sập tiến trình nếu lỗi thoát khỏi mọi `catch`. Quyết định: giải mã ở đâu, bắt lỗi ở đâu, và trả 400.
- `filter(Boolean)` biến `/users/42/`, `/users//42` và `//users/42` thành cùng một đường dẫn. Đó là một **quyết định về dấu `/` cuối** (strict hay chấp nhận), không phải mặc định hiển nhiên; nên nêu rõ trong thiết kế (cân nhắc cache, SEO, tính nhất quán API; nhiều API chọn chuẩn hoá hoặc từ chối).
- `Object.create(null)` cho `params` để khoá như `__proto__`, `constructor` là khoá thường (xem phần query bên dưới).
- `%2F` giải mã thành `/` **sau khi** đã tách đoạn: `/files/a%2Fb` là một tham số `a/b`, không phải hai đoạn. Đúng như mong muốn, nhưng nếu bạn giải mã **trước** khi tách thì nghĩa đổi. Giải mã từng đoạn **sau** khi tách.
- Tham số chỉ là chuỗi: `id = "42"` chưa phải số. Kiểm tra và ép kiểu (`Number.isInteger`...), và coi `"42abc"`, `"-1"`, `"1e3"` là cần xử lý có chủ ý.

**Thứ tự khớp và độ phức tạp.** Duyệt tuyến tính qua danh sách đăng ký, khớp đầu tiên thắng: đơn giản, dễ đoán, thứ tự đăng ký quyết định ưu tiên (đăng ký `/users/me` trước `/users/:id`). Chi phí là `O(số tuyến)` mỗi request. Đã đo (Node 24.21): 1000 tuyến mỗi tuyến một regex, tuyến khớp nằm cuối, mất khoảng **97 µs** mỗi lần tra cứu, so với **0,01 µs** cho `Map.get` theo khoá chính xác (`"GET /r999/x"`). Với dự án 10-30 tuyến, tuyến tính hoàn toàn đủ (vài micro giây); điều quan trọng là bạn **hiểu và nêu được** đánh đổi. Các hướng cải thiện khi số tuyến lớn: `Map` cho tuyến tĩnh thuần (`method + path`) rồi mới thử tuyến có tham số; hoặc cây tiền tố theo đoạn (trie/radix tree) nơi mỗi đoạn là một bước xuống, độ phức tạp theo độ sâu đường dẫn thay vì số tuyến. Đừng tối ưu sớm: đo trước.

**Tách path và query.** `req.url` là *request-target* nguyên bản: `/users/42?active=1&tag=a&tag=b`. Hai cách: `new URL(req.url, "http://localhost")` rồi lấy `pathname`/`searchParams`, hoặc tự cắt ở `?`. Cạm bẫy của cách đầu (đã thử):

```ts
const raw = "//evil.com/users?x=1";
const u = new URL(raw, "http://localhost");
console.log(u.host, u.pathname);   // evil.com /users   (đoạn "//evil.com" bị coi là host!)
```

URL dạng `//host/path` là "network-path reference": `new URL` coi `evil.com` là host và `pathname` chỉ còn `/users`. Router của bạn sẽ khớp `/users` trong khi client gửi một thứ khác hẳn: dễ gây nhầm lẫn bảo mật (bỏ qua kiểm tra theo prefix) hay open redirect nếu sau này bạn dựng URL từ `host`. Hãy quyết định: từ chối `req.url` không bắt đầu bằng một dấu `/` duy nhất, hoặc tự cắt chuỗi và không dùng `host` của `URL`. Ngoài ra `new URL` ném `TypeError` với đầu vào méo mó; phải bắt.

**Query string: khoá lặp và `__proto__`.** `?a=1&a=2&__proto__=x&b` (đã thử):

- `searchParams.get("a")` trả `"1"` (giá trị đầu), `getAll("a")` trả `["1","2"]`. Nêu rõ quy ước của API: lấy giá trị đầu, giá trị cuối, hay mảng, hay báo lỗi 400.
- Gom vào object bằng gán thông thường `obj[k] = v` với `obj = {}`: khoá `__proto__` bị **âm thầm bỏ qua** (setter trên prototype nhận một chuỗi và không làm gì; khoá mất, không có ô nhiễm prototype trong trường hợp này).
- `Object.fromEntries(searchParams)`: **tạo khoá sở hữu tên `__proto__`** (khoá thường, không đụng prototype: đã thử `Object.getPrototypeOf(o2) === Object.prototype` vẫn `true`), nhưng sau đó nếu bạn đem object này `merge`/`Object.assign`/deep-clone kiểu tự viết vào một object khác thì có thể gây **prototype pollution**. Dùng `Map` hoặc `Object.create(null)` cho dữ liệu khoá do người dùng quyết định, và không bao giờ tự viết deep-merge đệ quy trên dữ liệu ngoài.
- Query luôn là chuỗi; số, boolean, ngày phải được parse và kiểm tra (giới hạn `limit`, ví dụ tối đa 100).

**Đọc body có giới hạn.** `req` là stream; khởi điểm an toàn gồm bốn kiểm tra:

1. **Content-Type**: chỉ chấp nhận loại bạn hỗ trợ (`application/json`, có thể kèm `; charset=utf-8`), còn lại **415 Unsupported Media Type**.
2. **Giới hạn kích thước hai lớp**: nếu `Content-Length` khai báo lớn hơn giới hạn thì từ chối ngay (**413 Payload Too Large**) mà chưa đọc gì; đồng thời **đếm byte thực** khi đọc (client có thể nói dối hoặc dùng `Transfer-Encoding: chunked` không có `Content-Length`), vượt giới hạn thì dừng đọc.
3. **Parse JSON bọc `try/catch`**: JSON hỏng là lỗi của client, trả **400**, không phải 500.
4. **Body rỗng** là trường hợp riêng (`JSON.parse("")` ném lỗi): quyết định "body rỗng nghĩa là gì" cho từng tuyến.

Một thí nghiệm kiểm chứng (Node 24.21, server tự dựng với giới hạn 1 KiB, client là `fetch`, giả lập từng tình huống) cho kết quả:

```text
ok                       200 {"got":{"a":1}}
json hỏng                400 {"error":"invalid json"}
sai content-type         415 {"error":"need json"}
quá lớn (Content-Length) 413 {"error":"payload too large"}
quá lớn 20MB             413 {"error":"payload too large"}
chunked quá lớn          413 {"error":"payload too large"}
```

Điểm cốt lõi của giới hạn kích thước, ở mức khái niệm:

```ts
// Ý tưởng đếm byte (không phải hàm hoàn chỉnh)
let size = 0;
for await (const chunk of req) {
  size += (chunk as Buffer).length;
  if (size > LIMIT) { /* dừng đọc, trả 413, đóng kết nối */ }
  /* ... gom chunk ... */
}
```

Khi từ chối sớm (413/415) mà client vẫn đang gửi body, hãy cân nhắc trả lời kèm `Connection: close` để đóng kết nối, thay vì giữ lại kết nối keep-alive trong khi phần body còn lại vẫn đang chảy vào socket. Với client là `fetch` ở thí nghiệm trên (body 20 MB) kết quả vẫn nhận được 413, nhưng đừng giả định mọi client đều xử lý êm; hãy tự đặt câu hỏi: nếu bạn trả lời mà không đọc hết body thì chuyện gì xảy ra với kết nối?

**Giới hạn mặc định của `node:http` (Node 24.21 đã đọc từ `http.Server`).** `headersTimeout` 60000 ms (thời gian tối đa nhận đủ header), `requestTimeout` 300000 ms (tối đa nhận toàn bộ request), `keepAliveTimeout` 5000 ms, `http.maxHeaderSize` 16384 byte (16 KiB), `maxRequestsPerSocket` 0 (không giới hạn), `server.timeout` 0. Các giá trị này đã bảo vệ một phần trước client chậm (slowloris) và header quá to, nhưng **không** giới hạn kích thước body; việc đó là của bạn. Kiến thức từ tài liệu: tăng/giảm các timeout này tuỳ ứng dụng (upload lớn cần `requestTimeout` dài hơn).

**Server tự phản hồi một số lỗi parse.** Gửi dòng yêu cầu hỏng (`GARBAGE LINE`) qua socket thô: Node tự trả `HTTP/1.1 400 Bad Request` và đóng kết nối (đã thử, mã lỗi `HPE_INVALID_METHOD`), không đi qua middleware của bạn. Muốn tuỳ chỉnh hãy lắng nghe sự kiện `clientError` của server (file 3).

## Tricks & tips thực tế

- **Chuẩn hoá path trước khi khớp, và giải mã từng đoạn sau khi tách.** Lý do: giải mã trước làm `%2F` thành dấu phân cách thật, dẫn tới khớp sai tuyến hoặc vượt thư mục (path traversal nếu sau này ánh xạ ra hệ thống file).
- **Mọi `decodeURIComponent`/`JSON.parse`/`new URL` phải nằm trong đường bắt lỗi trả 400.** Lý do: input hỏng là chuyện thường ngày trên Internet; cả ba đều ném khi gặp dữ liệu méo mó.
- **Dùng `Map`/`Object.create(null)` cho params và query.** Lý do: khoá do client chọn (`__proto__`, `constructor`, `toString`) có thể va chạm với thuộc tính có sẵn của `{}`.
- **Trả `Allow` cho 405 và `Content-Type: application/json` cho lỗi JSON.** Lý do: là một phần của hợp đồng HTTP; client và công cụ kiểm thử dựa vào chúng.
- **Đặt giới hạn body nhỏ theo mặc định (ví dụ 100 KiB đến 1 MiB) và nâng riêng cho tuyến cần.** Lý do: mặc định rộng rãi là đòn bẩy DoS rẻ nhất; nâng chủ động theo tuyến thì rõ ràng.
- **Không `Buffer.concat` vô hạn rồi mới kiểm tra kích thước.** Lý do: kiểm tra sau khi đã nạp hết vào RAM thì quá muộn; phải dừng đọc ngay khi vượt.
- **Giải mã body bằng `utf8` có chủ ý** (`buffer.toString("utf8")`): byte không hợp lệ thành ký tự thay thế `U+FFFD` chứ không ném lỗi; nếu cần nghiêm ngặt dùng `new TextDecoder("utf-8", { fatal: true })`.
- **Test bằng các request độc hại thật:** `curl 'http://localhost:3000/users/%E0%A4%A'`, body JSON lỗi, body quá lớn bằng `head -c 5000000 /dev/zero | curl --data-binary @- ...`. Lý do: các lỗi này chỉ lộ khi gửi đúng thứ khó chịu.
- **So với Laravel:** `Route::get('/users/{id}')` và route model binding tự lo giải mã, 404, 405 (`MethodNotAllowedHttpException`), `$request->validate()` trả 422. Ở đây từng việc đó là của bạn; điều đáng học là *mỗi* mã lỗi tương ứng một quyết định thiết kế cụ thể.
- **Dùng thư viện validation (như Zod ở Phase 01) hay kiểm tra tay?** Kiểm tra đề bài có cho thêm dependency không (repo yêu cầu không thêm dependency ngoài nhu cầu bài học). Nếu không, hãy viết hàm kiểm tra kiểu nhỏ, trả danh sách lỗi; nếu có, vẫn giữ nguyên tắc: **kiểm tra ở biên, rồi dùng kiểu đã kiểm tra** (Bài 9 Phase 01).

## Liên hệ bài tập

Trong project, hãy lập bảng test cho router: ít nhất 404, 405 (có `Allow`), tham số, `/users/me` so với `/users/:id`, dấu `/` cuối, `%` hỏng, query khoá lặp. Với body: JSON hỏng (400), sai `Content-Type` (415), quá lớn (413) cho cả trường hợp có và không có `Content-Length`. Tự trả lời: bạn chọn cấu trúc dữ liệu nào cho bảng tuyến và độ phức tạp tra cứu của nó là gì? Chỉ có hướng; lời giải là của bạn.

## Đọc thêm

- [Node.js: module `http` (`IncomingMessage`, timeouts)](https://nodejs.org/api/http.html)
- [Node.js: module `url` (`URL`, `URLSearchParams`)](https://nodejs.org/api/url.html)
- [Node.js: Anatomy of an HTTP Transaction](https://nodejs.org/en/learn/http/anatomy-of-an-http-transaction)

## Ghi chú của bạn
