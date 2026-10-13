# 6. Cạm bẫy và tình huống thực tế khi validate bằng Zod

Những lỗi hay gặp khi đưa Zod vào backend, kèm triệu chứng, nguyên nhân và cách sửa. Mọi hành vi nêu "đã chạy" được kiểm bằng Zod 4.6.5, Node 24, `tsc` 7.0.2 với `tsconfig.json` của repo.

```ts
import { z } from "zod";

const ListInvoices = z.object({
  page: z.coerce.number().int().min(1).default(1),
  tag: z.union([z.string().transform((s) => [s]), z.array(z.string())]).default([]),
});
ListInvoices.parse({ tag: "paid" });          // { page: 1, tag: ["paid"] }
ListInvoices.parse({ tag: ["paid", "due"] }); // { page: 1, tag: ["paid", "due"] }
```

## Ý chính

- Phần lớn lỗi không nằm ở Zod mà ở **giả định về dữ liệu đến**: query string luôn là chuỗi, form gửi `""` thay vì vắng mặt, client viết sai tên trường, JSON mất độ chính xác trước khi Zod nhìn thấy.
- Zod làm đúng điều bạn *viết*, không phải điều bạn *định viết*. Cách chắc chắn nhất để biết là **chạy schema với input xấu** (rỗng, `null`, chuỗi rỗng, số khổng lồ, mảng thay vì chuỗi) và đọc `issues`.
- Mỗi lỗi dưới đây có một câu hỏi tự kiểm. Hãy tự trả lời trước khi đọc cách sửa.

## Lý thuyết chi tiết

**Bảng triệu chứng, nguyên nhân, cách sửa.**

| Triệu chứng | Nguyên nhân | Cách sửa |
|---|---|---|
| Client gõ `pagee=2`, API vẫn trả trang 1, không lỗi | `z.object` mặc định **strip**: khoá lạ bị bỏ im lặng | `z.strictObject(...)` cho endpoint cần báo lỗi (`unrecognized_keys`, `path: []`) |
| PATCH `{}` làm trường trở về mặc định | `.partial()` vẫn áp `.default()` | Dẫn xuất PATCH từ schema không có `default` (file 3, 4) |
| `?limit=` (rỗng) thành `0`, `?page=0x10` thành 16 | `z.coerce.number()` gọi `Number()` | Đặt `min`/`max`/`int()`, hoặc regex chuỗi trước rồi `transform(Number)` |
| `?published=false` được hiểu là `true` | `z.coerce.boolean()` coi mọi chuỗi không rỗng là `true` | `z.stringbool()` |
| `?tag=a` cho chuỗi, `?tag=a&tag=b` cho mảng | Thư viện parse query trả hai dạng khác nhau (tuỳ framework) | Union như ví dụ đầu file, kèm `default([])` |
| Form gửi `age=""` cho trường số tuỳ chọn, bị báo lỗi hoặc thành `0` | `""` không phải `undefined` | `z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().optional())` (đã chạy: `""` cho `undefined`, `"5"` cho `5`) |
| `z.string().min(1)` vẫn nhận `"   "` | Chỉ đếm độ dài, không biết khoảng trắng | `z.string().trim().min(1)`; đã chạy: `"   "` bị loại |
| `id` là số lớn (`9007199254740993`) bị sai nhẹ | `JSON.parse` làm tròn về `9007199254740992` **trước** khi Zod chạy; Zod còn từ chối vì vượt safe integer | Cho id đi dưới dạng chuỗi trong API; Zod không "cứu" được độ chính xác đã mất |
| Refine "mật khẩu khớp" không báo gì khi `confirm` bị thiếu | `refine` cấp object bị bỏ qua khi một trường **sai kiểu/thiếu** (đã chạy: chỉ còn `invalid_type`) | Chấp nhận (client sẽ sửa lỗi kiểu trước), hoặc dùng `superRefine` và tự kiểm kiểu bên trong |
| `z.url()` nhận `javascript:alert(1)` | `z.url()` chỉ kiểm cú pháp URL | `z.httpUrl()` chỉ cho `http`/`https` (đã chạy: nhận `false` với `javascript:`) |
| `z.iso.datetime()` từ chối `2026-01-01T00:00:00+07:00` | Mặc định chỉ nhận hậu tố `Z` | `z.iso.datetime({ offset: true })` nếu muốn nhận offset |
| `z.email()` từ chối `a@b` | Đã chạy: `a@b` bị loại (không có TLD) | Chấp nhận, hoặc viết regex riêng nếu cần nhận địa chỉ nội bộ |
| Bug trong `refine` trả 500, không phải 400 | Lỗi ném từ callback **không** thành `ZodError` (đã chạy) | Đúng hành vi; sửa bug. Muốn báo lỗi input từ `transform`, dùng `ctx.issues.push` |
| `z.string().max(1)` nhận `"😀"` | Độ dài tính theo **code point**, không theo `.length` của JS (`"😀".length === 2`) | Biết rằng ký tự ghép (`👨‍👩‍👧`, 5 code point) vẫn tính nhiều; nếu cột DB giới hạn theo byte, kiểm riêng |
| `z.object({}).safeParse(new Date())` thành công | Object schema chấp nhận mọi object không phải `null`/mảng | Chỉ lo khi input *không* đến từ JSON |
| Dùng `r.data` trước khi kiểm `success` nhưng không lỗi biên dịch | Kiểu là `T \| undefined` | Thu hẹp bằng `if (!r.success) return ...` (file 2) |

**Tình huống: kiểm tra sự kiện webhook có nhãn lạ (hai bước).** Đối tác thêm loại sự kiện mới theo thời gian; `discriminatedUnion` trên toàn bộ sẽ coi mọi loại lạ là *lỗi*. Phân tầng: bước 1 chỉ kiểm phong bì, bước 2 mới kiểm nhánh đã biết:

```ts
const Envelope = z.object({ type: z.string() });
const BillingEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("invoice.paid"), amountCents: z.number().int().min(0) }),
  z.object({ type: z.literal("invoice.failed"), reason: z.string() }),
]);
const KNOWN: ReadonlySet<string> = new Set(BillingEvent.options.map((o) => o.shape.type.value));

function classify(raw: unknown): "handled" | "ignored" | "invalid" {
  const env = Envelope.safeParse(raw);
  if (!env.success) return "invalid";                  // không phải sự kiện hợp lệ -> 400
  if (!KNOWN.has(env.data.type)) return "ignored";     // loại mới của đối tác -> ghi log, trả 2xx
  return BillingEvent.safeParse(raw).success ? "handled" : "invalid";
}
```

Đã chạy: `{ type: "customer.created" }` thành `"ignored"`, `{ type: "invoice.paid", amountCents: 5 }` thành `"handled"`, `{ type: "invoice.paid" }` thành `"invalid"`, `3` thành `"invalid"`. Lý do trả 2xx cho loại không biết: nhiều nhà cung cấp webhook thử lại khi nhận lỗi, nên 4xx cho sự kiện bạn không quan tâm tạo ra vòng lặp thử lại vô ích (cần tự xem tài liệu của nhà cung cấp cụ thể).

**Tình huống: tên trường cũ và mới cùng tồn tại (migration).** Client cũ gửi `fullName`, client mới gửi `name`. Chuẩn hoá trong schema, không trong controller:

```ts
const Profile = z
  .object({ name: z.string().min(1).optional(), fullName: z.string().min(1).optional() })
  .transform((p) => ({ name: p.name ?? p.fullName }))
  .refine((p) => p.name !== undefined, { error: "Cần name hoặc fullName", path: ["name"] });
```

Code sau schema chỉ thấy `name`. Khi hết client cũ, xoá `fullName` ở một chỗ.

**Tình huống: phân trang theo cursor.** Cursor là chuỗi mờ do server phát ra; client có thể gửi bất kỳ chuỗi nào. Validate hình dạng (độ dài tối đa, ký tự base64url) trong schema, nhưng giải mã và kiểm chữ ký ở service. Lý do: schema nên thuần và rẻ; việc kiểm "cursor này có phải của tôi phát ra" là nghiệp vụ.

**Tình huống: upload file.** Với multipart/form-data, thư viện upload đã tách file khỏi các trường text; validate **metadata** bằng Zod (tên file, `mimetype`, `size`) nhưng *không tin* `mimetype` do client khai báo cho các quyết định an ninh (cần đọc magic bytes ở tầng lưu trữ). Giới hạn kích thước phải đặt ở tầng đọc body, vì lúc Zod chạy thì dữ liệu đã nằm trong bộ nhớ.

**So sánh với Laravel.** `required|numeric|min:1` trên chuỗi `""`: Laravel có middleware `ConvertEmptyStringsToNull` biến chuỗi rỗng thành `null` cho mọi request, nên `nullable` hoạt động với form. Zod không làm vậy ngầm; bạn quyết định theo từng trường (`preprocess`). Laravel `$request->validated()` chỉ trả các khoá có rule, tương tự strip của Zod.

## Tricks & tips thực tế

- **Mỗi schema mới: viết một bộ "input xấu" cố định** (`undefined`, `null`, `""`, `"   "`, `[]`, `{}`, số rất lớn, chuỗi rất dài, mảng thay vì chuỗi) và chạy qua `safeParse`. Lý do: các lỗi trong bảng trên đều lộ ra ngay ở bộ này, rẻ hơn nhiều so với lộ ra ở production.
- **Test cả đường "input hợp lệ nhưng ở biên"**: `min`, `max`, `max + 1`. Lý do: lỗi off-by-one của luật (`>` thay vì `>=`) chỉ lộ ở biên.
- **Coi `unrecognized_keys` là thông tin sản phẩm.** Lý do: strip im lặng nghĩa là client tin rằng trường của họ đã được lưu. Với API công khai có versioning, strict giúp lộ sớm sai sót tích hợp.
- **Đặt lỗi *ngoại lệ* (webhook loại lạ) ở bước phân loại riêng, không nhét vào union.** Lý do: union nên mô tả cái bạn *xử lý*, còn "bỏ qua" là chính sách vận hành có thể đổi (ví dụ chuyển thành cảnh báo).
- **Chuẩn hoá tên trường cũ/mới trong schema.** Lý do: code nghiệp vụ không phải biết lịch sử API.
- **Không dựa vào chuỗi message của Zod trong test.** Lý do: message mặc định có thể đổi giữa các phiên bản Zod (xem file 2); assert theo `code` và `path`.
- **Khi lỗi lạ xảy ra trên production, log `z.prettifyError` của lỗi *kèm* `requestId`, không log toàn bộ body.** Lý do: body có thể chứa mật khẩu/token, còn `prettifyError` chỉ nêu trường và lý do (giá trị bị sai có thể vẫn xuất hiện trong message của vài loại issue; hãy xem log thật một lần để chắc chắn).

## Liên hệ bài tập

Trước khi viết schema cho bài lab, liệt kê ra giấy mỗi trường của input: nó đến từ đâu (body JSON, query, header), dạng thô của nó là gì, và "không gửi" khác "gửi rỗng" ở trường nào. Sau đó viết bộ input xấu cho riêng bạn và dự đoán kết quả từng dòng *trước khi chạy*. Chỗ dự đoán sai chính là chỗ bạn chưa hiểu schema của mình.

Tình huống mở để tự suy nghĩ (không có đáp án cố định):

1. Một endpoint nhận mảng `items` tối đa 100 phần tử; client gửi 101. Bạn muốn trả lỗi cho *cả mảng* hay chỉ nhận 100 phần tử đầu? Mỗi lựa chọn nghĩa là gì với một client thử lại?
2. Cùng một schema dùng cho tạo mới và cập nhật toàn bộ (PUT). Trường nào nên có `default` ở tạo mới nhưng *bắt buộc* ở PUT, và làm sao dẫn xuất mà không lặp?
3. Cột DB lưu `JSON`. Bạn đọc ra, validate, rồi ghi lại sau khi sửa. Nếu schema hôm nay *strip* một khoá mà phiên bản code mới hơn lại cần, điều gì xảy ra với dữ liệu đã ghi?
4. Client mobile bản cũ gửi `quantity` là chuỗi `"2"`, client web gửi số `2`. Bạn chấp nhận cả hai? Rủi ro nào nếu chấp nhận?
5. `z.string().max(255)` và cột `VARCHAR(255)`: hai bên đếm "ký tự" giống nhau không? Làm sao kiểm chứng trên hệ quản trị bạn dùng?

## Đọc thêm

- [Zod: Defining schemas (string, number, enum, record...)](https://zod.dev/api)
- [Zod: Migration guide (v4)](https://zod.dev/v4/changelog)
- [MDN: `Number()` conversion](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/Number)
- [MDN: Number.MAX_SAFE_INTEGER](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/MAX_SAFE_INTEGER)

## Ghi chú của bạn
