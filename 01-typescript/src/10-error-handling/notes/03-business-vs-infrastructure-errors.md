# 3. Lỗi nghiệp vụ và lỗi hạ tầng

Hai loại lỗi có nguyên nhân, người xử lý và cách phản hồi khác hẳn nhau; trộn chúng làm client nhận thông tin sai và bạn mù lòa khi debug.

```ts
class NotFound extends Error { readonly code = "NOT_FOUND" as const; }       // nghiệp vụ: client biết và sửa được
class DatabaseError extends Error {                                         // hạ tầng: client không làm gì được
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DatabaseError";
  }
}
```

## Ý chính

- **Lỗi nghiệp vụ (domain/business)**: luật của hệ thống bị vi phạm theo cách dự kiến (email trùng, ticket đã đóng, không đủ quyền, input sai). Client có thể và nên được biết, thường có thể sửa và thử lại. Phản hồi: 4xx với mã lỗi ổn định.
- **Lỗi hạ tầng (infrastructure)**: thứ nằm ngoài luật nghiệp vụ hỏng (DB mất kết nối, timeout, đĩa đầy, bug). Client không xử lý được. Phản hồi: 5xx, thông điệp chung chung, chi tiết chỉ ở log.
- **Lỗi lập trình (bug)**: `undefined is not a function`, vi phạm invariant. Cũng là 5xx và cần được sửa, không "xử lý".
- Bọc lỗi hạ tầng ở tầng truy cập dữ liệu thành lỗi của bạn **kèm `cause`**, để các tầng trên không phụ thuộc vào kiểu lỗi của driver.
- Đừng biến lỗi hạ tầng thành "lỗi nghiệp vụ" (ví dụ coi mọi lỗi DB là 404) và ngược lại.

## Lý thuyết chi tiết

**Bảng phân loại.**

| | Nghiệp vụ | Hạ tầng | Bug |
|---|---|---|---|
| Ví dụ | `TicketClosedError`, email trùng | DB timeout, Redis down | `TypeError`, invariant sai |
| Dự kiến? | Có | Có thể, nhưng không do client | Không |
| Client sửa được? | Thường có | Không | Không |
| Kênh trong code | `Result`/lỗi có kiểu | `throw` | `throw` (đừng bắt) |
| HTTP | 400/403/404/409/422 | 500/502/503/504 | 500 |
| Log | Mức info/warn, ít chi tiết | Mức error, đầy đủ cause | Mức error + cảnh báo |
| Retry? | Không, kết quả sẽ y hệt | Có thể (kèm giới hạn) | Không |

Cột "Retry" quan trọng: retry lỗi nghiệp vụ là vô ích (và có thể nguy hiểm: tạo trùng); retry lỗi hạ tầng tạm thời thường hợp lý nhưng phải có giới hạn và idempotency.

**Bọc lỗi hạ tầng với `cause`.** Tầng repository dịch lỗi driver thành lỗi của ứng dụng, đồng thời giữ lỗi gốc:

```ts
class DomainError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}
class TicketNotFound extends DomainError {}

async function findTicket(id: string): Promise<{ id: string }> {
  try {
    return await queryTicket(id);            // có thể ném lỗi của driver hoặc TicketNotFound
  } catch (cause) {
    if (cause instanceof DomainError) throw cause;                     // lỗi nghiệp vụ: để nguyên
    throw new DatabaseError(`findTicket(${id}) failed`, { cause });    // lỗi lạ: gói lại, giữ cause
  }
}
```

(`queryTicket` giả định là hàm truy cập DB của bạn.) Đã chạy với bản giả: lỗi `ECONNRESET` đi ra là `DatabaseError` có `cause` đúng, còn lỗi nghiệp vụ đi qua nguyên vẹn. Hai điểm mấu chốt: (1) lỗi nghiệp vụ không bị bọc thành lỗi hạ tầng; (2) bên trên không cần biết driver cụ thể nào.

**Một số lỗi của driver thực ra là lỗi nghiệp vụ.** Ví dụ vi phạm unique constraint (Postgres mã `23505`) khi đăng ký email trùng: nguyên nhân do dữ liệu của client, nên dịch thành `EmailTaken` (409) thay vì 500. Kiểm tra bằng hàm thu hẹp theo `code` (xem file 2) trong tầng repository, để bên trên chỉ thấy lỗi nghiệp vụ. Kiểm tra "tồn tại chưa" rồi ghi có race condition; unique index là nơi bảo đảm, bắt lỗi vi phạm rồi dịch.

**Lỗi hạ tầng và retry.** Chỉ retry thao tác **idempotent** hoặc có khoá idempotency; dùng backoff và giới hạn số lần. Retry mù khi ghi (tạo order) có thể tạo trùng. Đây là chủ đề sâu hơn ở các phase sau; ở Phase 01 bạn chỉ cần biết nó là lý do để *phân loại* lỗi ngay từ đầu.

**Lỗi hiểu theo "ai là người phải làm gì".**

- Nghiệp vụ: *người dùng/client* phải làm gì đó khác đi.
- Hạ tầng: *vận hành* (bạn) cần biết; người dùng chỉ cần thử lại sau.
- Bug: *lập trình viên* cần sửa.

Thông điệp, mức log và cảnh báo (alert) đều bám theo câu hỏi này.

**Validation là lỗi nghiệp vụ ở rìa.** `ZodError` đến từ input của client, nên là loại "nghiệp vụ/dữ liệu" (400/422). Nó được chuyển thành lỗi của contract ở ranh giới (file 5). Còn `ZodError` phát sinh khi *dữ liệu của chính bạn* (đọc từ DB/cache) sai hình dạng là lỗi hạ tầng/bug (500), vì client không có lỗi nào ở đây. Cùng một lớp lỗi, hai nguồn khác nhau: quyết định theo **chỗ nó phát sinh**, không theo lớp.

**So sánh PHP/Laravel.** Laravel phân biệt qua `Handler::render`: `ValidationException` thành 422, `ModelNotFoundException` thành 404, `AuthorizationException` thành 403, còn lại 500 (và ẩn chi tiết khi `APP_DEBUG=false`). Bộ phân loại này hoàn toàn khớp với bảng trên; khác ở chỗ TypeScript bạn tự viết nó, và nên viết với kiểu chặt.

## Tricks & tips thực tế

- **Phân loại lỗi ngay lúc thiết kế, không phải khi đã có bug production.** Lý do: mỗi loại cần HTTP status, mức log và alert khác nhau; sửa sau khi các tầng đã trộn lẫn tốn công hơn nhiều.
- **Bắt lỗi ở tầng thấp chỉ để *dịch*, không để *nuốt*.** Lý do: tầng thấp biết lỗi driver cụ thể nhất, tầng cao không nên biết.
- **Luôn truyền `{ cause }` khi bọc.** Lý do: không có `cause`, lỗi gốc (và stack của nó) biến mất, log chỉ còn "findTicket failed" không biết vì sao.
- **Log lỗi hạ tầng đúng một lần, ở ranh giới.** Lý do: log ở mọi tầng rồi ném lại tạo cùng một lỗi lặp nhiều dòng, khó theo dõi và tốn dung lượng.
- **Đừng trả `error.message` của lỗi hạ tầng cho client.** Lý do: có thể chứa tên bảng, câu SQL, địa chỉ nội bộ (`connect ECONNREFUSED 10.0.0.5:5432`).
- **Không dùng lỗi nghiệp vụ cho luồng điều khiển bình thường trong vòng lặp nóng.** Lý do: tạo `Error` có chi phí (capture stack); với đường nóng, `Result` rẻ hơn và rõ hơn.
- **Debug 500 khó hiểu**: lấy `requestId` từ response, tìm log cùng id, đọc chuỗi `cause` (dùng hàm `rootCause` ở file 2) để thấy nguyên nhân gốc. Lý do: lỗi bọc nhiều tầng, thông điệp trên cùng thường chỉ là "X failed".
- **Test cả hai nhánh của hàm bọc lỗi**: nhánh lỗi nghiệp vụ đi qua nguyên vẹn và nhánh lỗi lạ bị bọc kèm `cause`. Lý do: đây là chỗ dễ viết ngược (bọc nhầm lỗi nghiệp vụ thành 500).
- **Cẩn thận lỗi do thư viện ném không phải `Error`**: chuẩn hoá bằng `toError` ở rìa (file 2) trước khi phân loại.

## Liên hệ bài tập

Trong contract tạo Order, hãy sắp từng lỗi bạn nghĩ ra vào ba cột: nghiệp vụ, hạ tầng, bug. Lỗi nào nên là một nhánh của kiểu lỗi trong contract (client thấy), lỗi nào không nên xuất hiện trong contract (client chỉ thấy lỗi chung)? Thử trả lời: nếu DB mất kết nối giữa chừng, response của bạn chứa gì và log của bạn chứa gì?

## Đọc thêm

- [MDN: Error `cause`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause)
- [MDN: HTTP response status codes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status)
- [TypeScript: Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)

## Ghi chú của bạn

