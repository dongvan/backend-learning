# 6. Cạm bẫy và tình huống thực tế khi xử lý lỗi

Các lỗi hay gặp khi viết xử lý lỗi trong backend Node/TypeScript, kèm triệu chứng, nguyên nhân, cách sửa. Hành vi nêu "đã chạy" được kiểm trên Node 24, `tsc` 7.0.2, với `tsconfig.json` của repo.

```ts
async function noAwait(): Promise<string> {
  try { return fails(); } catch { return "caught"; }  // catch KHÔNG bao giờ chạy
}
```

## Ý chính

- Hầu hết lỗi xử lý lỗi nảy sinh từ **ranh giới bất đồng bộ** (`await` thiếu, `Promise.all`), từ **mất thông tin khi đi qua ranh giới** (JSON, `structuredClone`, log) và từ **phân loại sai** (thử lại thứ không thử lại được).
- Compiler giúp được với phần *kiểu* (quên thu hẹp `Result`, quên ánh xạ một lỗi), nhưng không giúp với phần *dòng chạy* (quên `await`, `finally` nuốt lỗi). Phần sau cần test và review.
- Mỗi lỗi bên dưới nên được tái hiện một lần trong sandbox của bạn để nhớ lâu.

## Lý thuyết chi tiết

**Bảng triệu chứng, nguyên nhân, cách sửa.**

| Triệu chứng | Nguyên nhân | Cách sửa |
|---|---|---|
| `error TS18046: 'e' is of type 'unknown'` khi viết `e.message` | `catch` là `unknown` (strict) | `e instanceof Error ? e.message : String(e)` hoặc `toError(e)` (file 2) |
| `catch (e: Error)` báo `TS1196` | Chỉ cho phép chú thích `any`/`unknown` | Bỏ chú thích, thu hẹp trong thân `catch` |
| `try { return fn(); } catch {}` không bắt lỗi của `fn()` (hàm async) | `return` Promise không `await` rời `try` trước khi reject | `return await fn()` |
| Hàm `finally { return x }` làm lỗi biến mất | `return` trong `finally` ghi đè `throw` | Chỉ dọn dẹp trong `finally` |
| `if (e instanceof AppError) 500; else if (e instanceof NotFound) 404` luôn ra 500 | Kiểm lớp cha trước | Kiểm lớp con trước, hoặc `switch` theo `code` |
| `instanceof NotFound` thành `false` sau khi qua worker/queue | `structuredClone`/`postMessage` trả `Error` thường, mất lớp con và thuộc tính tự thêm (đã chạy) | Truyền `code` + dữ liệu thuần, dựng lại lỗi phía nhận |
| `JSON.stringify(err)` ra `{}` hoặc thiếu `message`/`stack`/`cause` | Các thuộc tính này non-enumerable (đã chạy) | `serializeError` tự viết (file 2), hoặc logger hỗ trợ lỗi |
| Log hiển thị `Error: ...` thay vì tên lớp | Lớp con quên gán `this.name` (đã chạy: lớp `Transient` không đặt `name` cho `name === "Error"`) | `this.name = new.target.name` ở lớp gốc |
| `fetch` "không ném lỗi" mà vẫn lỗi | 4xx/5xx vẫn resolve (đã chạy: `status: 500`, `ok: false`) | Kiểm `res.ok`, dịch sang `UpstreamError` (file 3) |
| Thử lại đơn hàng làm trùng đơn | Thử lại thao tác không idempotent | Khoá idempotency, hoặc không thử lại lúc ghi |
| `Promise.all` báo một lỗi nhưng các việc khác vẫn ghi dữ liệu | `Promise.all` không huỷ các việc còn lại; lỗi sau bị bỏ qua (đã chạy) | `allSettled` + bù trừ, hoặc làm tuần tự trong transaction |
| Tiến trình chết với `ERR_UNHANDLED_REJECTION` | Promise reject không ai bắt, trên Node 24 là lỗi chết tiến trình (đã chạy, thoát mã `1`) | `await` ở mọi nơi; một `catch` ở ranh giới; **không** nuốt bằng `process.on("unhandledRejection")` |
| Response 200 với `NaN` thành `null` | `JSON.stringify` đổi `NaN`/`Infinity` thành `null` (đã chạy) | Validate số trước khi xuất |
| `TypeError: Do not know how to serialize a BigInt` | `bigint` không đi qua JSON (đã chạy) | Chuyển sang chuỗi trong DTO |
| `const w = err({ kind: "empty" })` rồi gán vào `Result<T, E>` bị `TS2322` | Tag `kind` bị mở rộng thành `string` khi không có kiểu đích | Gán kiểu cho `w`, hoặc `err<E>(...)` (file 1) |
| `Promise<Result<...>>` mà `.ok` báo `TS2339` | Quên `await` | `await` trước khi kiểm `ok` |

**Tình huống: thanh toán thành công nhưng ghi DB thất bại.** Đây là lỗi *phân tán*: bên ngoài (nhà cung cấp thanh toán) đã đổi trạng thái, bên trong thì chưa. Không có `try/catch` nào hoàn tác được tiền đã trừ. Hướng thiết kế: (1) gửi khoá idempotency cho nhà cung cấp để thử lại an toàn, (2) ghi *ý định* (trạng thái "đang chờ") vào DB **trước** khi gọi bên ngoài, (3) một tiến trình đối soát (reconcile) sửa các bản ghi "đang chờ" quá lâu. Điều cần nhớ về lỗi: ở ranh giới này, "thất bại" có thể nghĩa là "chưa biết". Hãy thể hiện nó bằng một nhánh lỗi riêng (`{ kind: "unknown_outcome" }`) thay vì ép thành thành công hay thất bại.

**Tình huống: nhập CSV hàng loạt.** Mỗi dòng có thể sai. Hai chính sách: *dừng ở lỗi đầu tiên* (`all`) hoặc *gom mọi lỗi* (`collect`) rồi báo cả danh sách kèm số dòng; cả hai viết gọn bằng `Result` (xem file 7). Chọn theo người dùng: người nhập file muốn thấy toàn bộ lỗi một lần, không phải sửa-và-thử-lại hàng chục lần. Còn lỗi hạ tầng (mất kết nối DB giữa chừng) thì dừng hẳn, không gom.

**Tình huống: worker xử lý hàng đợi.** Phân loại để quyết định *thử lại hay bỏ vào hàng chờ lỗi (dead-letter)*: lỗi nghiệp vụ (dữ liệu sai) thử lại vô ích, đưa thẳng vào dead-letter kèm lý do; lỗi hạ tầng tạm thời thử lại với backoff và giới hạn; bug thì dừng và cảnh báo. Message đến worker là dữ liệu chưa tin cậy (Bài 9): parse bằng schema; nếu sai, đó là lỗi nghiệp vụ của *người gửi*, không phải bug của worker.

**Tình huống: webhook nhận từ đối tác.** Trả 2xx nhanh sau khi *ghi nhận* (lưu vào hàng đợi) rồi xử lý bất đồng bộ; xử lý lâu ngay trong request dễ gặp timeout phía đối tác và họ gửi lại, sinh trùng lặp. Mọi sự kiện cần xử lý idempotent theo id sự kiện.

**Tình huống: mức log cho từng loại lỗi.** Gợi ý khởi điểm (không phải chuẩn): nghiệp vụ ở `info`/`warn` (đếm bằng metric thay vì đọc từng dòng), hạ tầng ở `error` kèm `cause`, bug ở `error` kèm cảnh báo (alert). Lý do: nếu mọi `NotFound` ở mức `error`, đội trực sẽ quen bỏ qua cảnh báo và bỏ sót lỗi thật.

**So sánh với Laravel.** `report()`/`render()` của `Handler` gom ghi log và dịch; `$dontReport` liệt kê những exception không cần ghi log (kiểu `ValidationException`), tương ứng chính sách mức log ở trên. Laravel `DB::transaction(fn)` tự rollback khi closure ném exception; khi bạn dùng `Result` thay vì ném, nhớ rằng *trả lỗi không rollback*: kiểm tra cách thư viện transaction ở TypeScript bạn chọn xử lý (cần tự kiểm chứng), và thường phải ném để hoàn tác.

## Tricks & tips thực tế

- **Mỗi hàm bất đồng bộ trả `Result` hoặc ném, đừng lẫn hai.** Lý do: bên gọi phải nhớ kiểm cả `r.ok` lẫn `try/catch`, và sớm muộn quên một trong hai.
- **`process.on("unhandledRejection")` chỉ để ghi log rồi thoát có kiểm soát.** Lý do: tiến trình đã ở trạng thái không biết; tiếp tục chạy như không có gì làm lỗi lan âm thầm.
- **Viết test "lỗi đi qua ranh giới" cho mỗi kênh**: HTTP (status + body), queue (có thử lại không), log (có `requestId`, không có dữ liệu nhạy cảm). Lý do: đây là các nơi mất thông tin nhiều nhất.
- **Lỗi nghiệp vụ mang đủ dữ liệu để client hành động** (`sku` nào hết hàng, hạn mức còn lại). Lý do: lỗi chỉ có chuỗi message buộc client phân tích văn bản.
- **Đếm lỗi theo `code` bằng metric** (counter có nhãn `code`). Lý do: xu hướng tăng đột biến của một `code` là tín hiệu sớm của bug hay tấn công, không cần đọc log.
- **Đặt giới hạn cho độ dài chuỗi `cause`** khi ghi log (như `depth >= 3` ở `serializeError`). Lý do: chuỗi nguyên nhân vòng hay quá sâu làm log phình hoặc treo.
- **Khi review `catch`, hỏi ba câu**: lỗi này có thể là gì (kể cả không phải `Error`)? Mình làm gì với nó (dịch, bù trừ, hay ném lại)? Còn ai biết nó đã xảy ra? Lý do: `catch` không trả lời được câu nào là `catch` nên xoá.

## Liên hệ bài tập

Trước khi viết contract cho bài lab, tự trả lời (không có đáp án cố định):

1. Hành động của bạn gọi một dịch vụ ngoài rồi ghi DB. Liệt kê các điểm có thể thất bại theo thứ tự thời gian. Ở điểm nào "không biết kết quả" là có thể, và response của bạn nói gì với client khi đó?
2. Một lỗi nghiệp vụ nên là nhánh của `Result` hay là lớp ném? Với cùng lỗi đó, hai quy ước đổi gì ở phía gọi, ở transaction, và ở test?
3. Client gửi lại cùng một request vì mất mạng giữa chừng. Điều gì trong thiết kế của bạn bảo đảm kết quả không đổi?
4. Bạn muốn đếm "số lần gặp từng loại lỗi nghiệp vụ trong tuần". Dữ liệu nào cần có trong lỗi, và nó nằm trong log hay metric?
5. Một lỗi hạ tầng lặp lại 1000 lần trong một phút. Bạn muốn log 1000 dòng, hay một dòng kèm bộ đếm? Mất gì, được gì?

## Đọc thêm

- [MDN: `Promise.all`, `allSettled`, `any`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)
- [Node.js: `process` event `unhandledRejection`](https://nodejs.org/api/process.html#event-unhandledrejection)
- [MDN: `structuredClone`](https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone)
- [MDN: `fetch` (lỗi mạng và `Response.ok`)](https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch)
- [MDN: `try...catch` và `finally`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/try...catch)

## Ghi chú của bạn
