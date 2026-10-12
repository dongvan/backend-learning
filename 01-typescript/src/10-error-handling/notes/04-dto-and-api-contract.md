# 4. DTO, domain model và API contract

Contract là thoả thuận hình dạng dữ liệu giữa client và server: request, response thành công và response lỗi; DTO là kiểu của dữ liệu **ở ngoài ranh giới**, tách khỏi mô hình domain bên trong.

```ts
// Domain: kiểu giàu nghĩa, có trường nội bộ
type Ticket = {
  readonly id: string;
  readonly title: string;
  readonly status: "open" | "closed";
  readonly createdAt: Date;
  readonly internalNote: string;
  readonly assigneeId: string | null;
};

// DTO: hình dạng công khai, chỉ chứa kiểu JSON
type TicketDto = {
  id: string;
  title: string;
  status: "open" | "closed";
  createdAt: string; // ISO 8601
  assigneeId: string | null;
};

function toTicketDto(t: Ticket): TicketDto {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    assigneeId: t.assigneeId,
  };
}
```

## Ý chính

- **Domain model** phục vụ nghiệp vụ bên trong (có `Date`, brand, trường nội bộ). **DTO** (Data Transfer Object) phục vụ giao tiếp bên ngoài (chỉ kiểu JSON, chỉ trường công khai).
- Tách chúng để thay đổi nội bộ (đổi cột DB, thêm trường nội bộ) không vô tình đổi API, và để không lộ dữ liệu nhạy cảm.
- Một **contract** gồm ba phần: hình dạng request, hình dạng response thành công, và **hình dạng lỗi** (cũng nhất quán). Lỗi là một phần của contract, không phải thứ "xảy ra bên ngoài".
- Chuyển đổi giữa DTO và domain qua **hàm mapper tường minh** (`toTicketDto`), không `{ ...entity }`.
- Request DTO validate bằng schema (Bài 9: input); response DTO được tạo bởi mapper, tuỳ chọn kiểm lại bằng schema trong test.
- JSON chỉ có chuỗi, số, boolean, null, mảng, object. `Date`, `Map`, `Set`, `bigint`, `undefined` không đi qua đường dây nguyên vẹn.

## Lý thuyết chi tiết

**Hai chiều chuyển đổi.**

```text
HTTP body (unknown) --schema.parse--> Request DTO --mapper/service--> Domain model
Domain model --mapper--> Response DTO --JSON.stringify--> HTTP body
```

Vào: `unknown` -> DTO có kiểu (Bài 9). Ra: domain -> DTO bằng mapper thuần. Mapper là nơi duy nhất biết hai hình dạng, nên là nơi dễ test nhất.

**Cạm bẫy spread làm lộ trường.** Trường nội bộ lọt ra ngoài mà compiler **không** báo:

```ts
const t: Ticket = {
  id: "1", title: "x", status: "open", createdAt: new Date(0),
  internalNote: "secret", assigneeId: null,
};

// Biên dịch được! Spread không bị kiểm tra "excess property"
const leaked: TicketDto = { ...t, createdAt: t.createdAt.toISOString() };
// leaked thực sự chứa internalNote: "secret"  (đã chạy)
```

Kiểm tra "thuộc tính thừa" của TS chỉ áp dụng cho object literal viết tay, không áp dụng cho trường đến từ spread. Vì vậy mapper nên liệt kê từng trường (allow-list), không dùng spread. Lớp bảo vệ thứ hai: parse response qua schema **strip** (Bài 9), bỏ mọi khoá không khai báo:

```ts
import { z } from "zod";

const TicketDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["open", "closed"]),
  createdAt: z.iso.datetime(),
  assigneeId: z.string().nullable(),
});

TicketDtoSchema.parse({ ...t, createdAt: t.createdAt.toISOString() });
// { id, title, status, createdAt, assigneeId }  <- internalNote đã bị loại (đã chạy)
```

**Serialize `Date` và các kiểu lạ.** `JSON.stringify` chuyển `Date` thành chuỗi ISO (`"1970-01-01T00:00:00.000Z"`), bỏ khoá giá trị `undefined`, giữ `null`, và **ném lỗi với `bigint`** ("Do not know how to serialize a BigInt", đã chạy). Hệ quả: kiểu TypeScript của object trước khi stringify (có `Date`) khác kiểu mà client nhận (`string`). Đó là lý do cần DTO tách riêng với `createdAt: string`. Id dạng `bigint` hay số lớn nên đi dưới dạng chuỗi.

**Contract lỗi: hình dạng nhất quán.** Mọi endpoint trả lỗi cùng một dạng để client viết một chỗ xử lý:

```ts
type ApiError<C extends string = string> = {
  error: {
    code: C;                                   // mã máy đọc được, ổn định: "NOT_FOUND"
    message: string;                           // câu cho người đọc, có thể đổi
    details?: readonly { path: string; message: string }[]; // lỗi theo trường (validation)
    requestId: string;                         // để người dùng báo và bạn tra log
  };
};
type Success<T> = { data: T };
```

Nguyên tắc thiết kế:

- `code` là một **tập hữu hạn, được tài liệu hoá, ổn định**; client `switch` theo nó. Chuỗi `message` có thể đổi mà không phá client.
- Lỗi validation mang `details` với `path` (đường dẫn trường) để client tô đúng ô.
- `requestId` nối response với log phía server.
- Với `ApiError<C>` generic, mỗi endpoint khai báo tập `code` có thể trả: contract của endpoint đó là `Success<T> | ApiError<"INVALID_INPUT" | "OUT_OF_STOCK">`, nên client (hoặc test) có kiểu chính xác.

Hình dạng khác cũng hợp lệ: RFC 9457 (Problem Details for HTTP APIs) chuẩn hoá `type`, `title`, `status`, `detail`, `instance` cho lỗi. Chọn một dạng, ghi lại và theo nhất quán; không có dạng nào "đúng duy nhất".

**Versioning và thay đổi.** Thêm trường tuỳ chọn vào response là thay đổi *tương thích*; đổi tên/xoá trường, đổi kiểu, đổi ý nghĩa `code` là thay đổi *phá vỡ*. DTO tách khỏi domain giúp bạn đổi nội bộ mà giữ nguyên contract.

**Kiểu cho contract trong TypeScript.** Một cách gọn là mô tả mỗi thao tác bằng một type chứa request/response/lỗi:

```ts
type Contract<Req, Res, ErrCode extends string> = {
  request: Req;
  response: Success<Res> | ApiError<ErrCode>;
};
```

Đây chỉ là gợi ý về cách *nghĩ*: tài liệu OpenAPI, tRPC hay schema Zod dùng chung giữa client/server đều giải quyết cùng bài toán ở quy mô lớn; chưa cần tới ở phase này.

**So sánh PHP/Laravel.** `JsonResource` (API Resource) của Laravel chính là mapper domain -> DTO: bạn liệt kê tường minh các trường trả ra (`'id' => $this->id`), `$hidden` trên Model ẩn trường như `password`. Rủi ro cũng giống: `return $model` hay `->toArray()` thẳng ra response lộ cột nội bộ. `FormRequest` tương ứng request DTO + validate. Laravel `ValidationException` trả `{ message, errors }` là một contract lỗi mặc định; trong TS bạn tự định nghĩa contract lỗi của mình.

## Tricks & tips thực tế

- **Mapper liệt kê từng trường (allow-list).** Lý do: thêm cột mới vào entity sẽ không tự lọt ra API; spread hay `Object.assign` thì lọt, và compiler không cảnh báo (đã chạy thật).
- **Không dùng chung một type cho request, domain và response.** Lý do: ba thứ có vòng đời thay đổi khác nhau; dùng chung khiến mỗi thay đổi nội bộ có nguy cơ phá API.
- **Đặt tên theo vai trò**: `CreateTicketRequest`, `Ticket` (domain), `TicketResponse`. Lý do: đọc code biết ngay đang ở phía nào của ranh giới.
- **Thời gian trong API là chuỗi ISO 8601 UTC**, trong domain là `Date`. Lý do: không mơ hồ múi giờ, và `toISOString()`/`z.coerce.date()` chuyển đổi dễ.
- **Tiền: số nguyên đơn vị nhỏ nhất (cent) kèm mã tiền tệ, hoặc chuỗi thập phân.** Lý do: số thực nhị phân sai số (`0.1 + 0.2`), và `bigint` không serialize được.
- **Thêm `requestId` vào mọi response lỗi ngay từ đầu.** Lý do: khi người dùng báo "bị lỗi", đây là sợi dây duy nhất nối với log.
- **Test hợp đồng (contract test) cho mapper**: một test xác nhận response không chứa trường nội bộ (`expect(Object.keys(dto))` bằng danh sách mong đợi). Lý do: bắt lỗi lộ dữ liệu trước production.
- **Đừng đưa lỗi hạ tầng vào `code` của contract.** Lý do: client không làm gì được; chỉ cần `INTERNAL`. Tránh tạo hợp đồng ngầm vào chi tiết triển khai.
- **Đừng dùng `any` để lách kiểu response.** Lý do: mất hết bảo vệ ở chính nơi dữ liệu rời hệ thống.
- **Debug "client nhận thiếu/dư trường"**: in kết quả của mapper và so với kiểu DTO; kiểm tra có spread hay `toJSON` tự động nào chen vào không.

## Liên hệ bài tập

Contract tạo Order của lab nên khai báo ba thứ: request (Order input đã validate ở Bài 9), response thành công, và các lỗi có kiểu. Hãy thử viết ra domain model của Order và DTO response của nó: trường nào không nên rời hệ thống, trường nào cần đổi kiểu (ngày, tiền)? Rồi đặt câu hỏi: mỗi mã lỗi trong contract của bạn, client dùng nó để làm gì?

## Đọc thêm

- [MDN: `JSON.stringify`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify)
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457)
- [TypeScript: Object types (excess property checks)](https://www.typescriptlang.org/docs/handbook/2/objects.html)
- [Zod: API](https://zod.dev/api)

## Ghi chú của bạn

