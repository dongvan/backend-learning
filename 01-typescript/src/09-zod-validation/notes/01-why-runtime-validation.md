# 1. Vì sao cần validate lúc chạy, và schema là nguồn sự thật

Kiểu của TypeScript biến mất sau khi biên dịch, nên không bảo vệ được dữ liệu đến từ bên ngoài. Zod mô tả hình dạng dữ liệu một lần và cho bạn cả **kiểm tra lúc chạy** lẫn **kiểu tĩnh**.

```ts
import { z } from "zod";

const RegisterBody = z.object({
  email: z.email(),
  password: z.string().min(8),
});
type RegisterBody = z.infer<typeof RegisterBody>; // { email: string; password: string }

function register(raw: unknown): RegisterBody {
  return RegisterBody.parse(raw); // ném ZodError nếu sai, trả dữ liệu đã kiểm chứng nếu đúng
}
```

## Ý chính

- TypeScript chỉ kiểm tra lúc biên dịch. Mọi dữ liệu vào từ HTTP body, query string, header, biến môi trường, DB, message queue, file JSON đều là **chưa tin cậy**, dù bạn có gán kiểu cho nó.
- `JSON.parse(...) as T`, `req.body as T` và `as` nói chung **không kiểm tra gì**. Đó là lời hứa của bạn với compiler, không phải bằng chứng.
- Quy trình đúng: nhận dữ liệu ở kiểu `unknown`, đưa qua schema, nhận về kiểu đã được chứng minh. Từ đó trở vào trong, code tin kiểu.
- **Schema là nguồn sự thật duy nhất**: kiểu suy ra từ schema (`z.infer`), không viết tay `type` song song rồi cố giữ cho hai thứ khớp nhau.
- Validate ở **ranh giới** (controller, consumer, loader cấu hình), không rải khắp business logic.

## Lý thuyết chi tiết

**Kiểu bị xoá (type erasure).** Sau `tsc`, file JS không còn `type`, `interface`. Đoạn dưới biên dịch sạch nhưng nổ lúc chạy:

```ts
type NewUser = { email: string; age: number };
const body = JSON.parse('{"email": 5}') as NewUser; // compile OK
body.age.toFixed(1); // TypeError: Cannot read properties of undefined (reading 'toFixed')
```

Đã chạy thật: lỗi xảy ra *sau* đó, ở chỗ khác, xa nguồn gốc. Với dữ liệu sai hình dạng, lỗi có thể thành dữ liệu rác lưu vào DB mà không ai biết.

**`unknown` là kiểu đúng cho dữ liệu vào** (xem Bài 1, `unknown` vs `any`). `JSON.parse` trả `any`, nên hãy gán ngay: `const raw: unknown = JSON.parse(text)`. Từ `unknown` bạn buộc phải thu hẹp, và schema chính là bộ thu hẹp (narrowing) tự động cho cả một cấu trúc lồng nhau.

**Một nguồn sự thật.** Cách làm cũ hay gặp:

```ts
// Hai nơi phải sửa cùng lúc, sớm muộn sẽ lệch nhau
interface CreateArticle { title: string; tags: string[] }
function validateCreateArticle(x: unknown): x is CreateArticle { /* viết tay */ return true; }
```

Với Zod, đảo chiều: schema trước, kiểu suy ra từ schema. Sửa schema là kiểu tự đổi theo, và mọi chỗ dùng kiểu sai sẽ báo lỗi compile.

**Ba kiểu suy ra: `infer`, `input`, `output`.**

```ts
const Query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  q: z.string().trim().optional(),
});

type QueryInput = z.input<typeof Query>;   // { page?: unknown; q?: string | undefined }   (đầu vào của parse)
type QueryOutput = z.output<typeof Query>; // { page: number; q?: string | undefined }       (kết quả của parse)
type Same = z.infer<typeof Query>;         // z.infer là bí danh của z.output
```

- `z.output<S>` (`z.infer<S>`): hình dạng **sau** khi parse, tức thứ code nghiệp vụ nhận được. Đây là thứ bạn dùng 90% thời gian.
- `z.input<S>`: hình dạng **được phép đưa vào** `parse`. Khác `output` khi schema có `default`, `coerce`, `transform`, `preprocess` (chi tiết ở file 3).
- Dùng `input` khi viết hàm tạo dữ liệu test, form phía client, hay SDK gọi API: "tôi được gửi gì lên".

**Hai tầng khác nhau cần cả hai.** Schema chỉ chứng minh *hình dạng* ("email trông giống email"), không chứng minh *nghiệp vụ* ("email chưa tồn tại", "user có quyền"). Cái sau vẫn là việc của service và DB (unique index).

**So sánh với Laravel.**

| Laravel | Zod |
|---|---|
| `FormRequest::rules()` trả mảng chuỗi `'email' => 'required\|email'` | Schema là code TS, có kiểu |
| `$request->validated()` trả mảng `array` không có kiểu | `schema.parse()` trả object có kiểu chính xác |
| Fail thì tự redirect/422 (framework làm hộ) | Ném `ZodError` hoặc trả `{ success: false }`, bạn tự quyết định, tự map ra HTTP |
| Chạy trước controller nhờ container | Bạn tự gọi ở ranh giới (hoặc nhờ NestJS pipe/middleware sau này) |
| Chỉ chạy cho request | Dùng được cho mọi thứ: env, queue, file, response từ API ngoài |

Điểm khác đáng nhớ: PHP không có kiểu tĩnh nên `validated()` trả mảng lỏng; TypeScript thì kiểu của kết quả *là* sản phẩm của validate.

## Tricks & tips thực tế

- **Cấm `as` trên dữ liệu ngoài.** Lý do: `as` tắt kiểm tra mà không thêm bảo vệ nào. Khi review, thấy `req.body as Something` hay `JSON.parse(x) as Something` thì coi là lỗi.
- **Khai báo biến `raw: unknown` ở ranh giới.** Lý do: ép bạn không dùng nó trước khi validate, compiler sẽ chặn.
- **Đặt tên trùng cho schema và kiểu**: `const RegisterBody = ...` và `type RegisterBody = z.infer<typeof RegisterBody>`. Giá trị và kiểu nằm ở hai không gian tên khác nhau nên hợp lệ, và import một tên là được cả hai.
- **Validate cả dữ liệu từ hệ thống của chính bạn khi nó đi qua ranh giới lỏng** (cột JSON trong DB, cache Redis, queue). Lý do: dữ liệu cũ do phiên bản code cũ ghi vẫn có thể sai hình dạng so với kiểu hiện tại.
- **Validate biến môi trường lúc khởi động** (`PORT`, `DATABASE_URL`) và để tiến trình chết ngay nếu thiếu. Lý do: lỗi cấu hình hiện ra tại giây đầu tiên thay vì nửa đêm khi một request chạm vào.
- **Debug "kiểu nói một đằng, runtime một nẻo"**: tìm `as`, `any`, `!` (non-null assertion) và `@ts-ignore` dọc đường dữ liệu đi từ ngoài vào; chỗ nào có chúng là chỗ kiểu có thể nói dối.
- **Đừng validate lại ở mọi tầng.** Sau khi parse ở ranh giới, truyền kiểu đã suy ra đi tiếp. Parse lặp lại tốn CPU và làm lẫn trách nhiệm.
- **Zod là phụ thuộc runtime**, không phải kiểu "chỉ dev". Repo này dùng Zod 4.x (`zod@^4.6.5`); tài liệu/blog viết cho Zod 3 có nhiều API khác (sẽ chỉ ra ở các file sau). Khi tra cứu, kiểm tra bản của tài liệu.
- **Lưu ý cấu hình repo**: `tsconfig.json` hiện không khai báo `types`, nên `console` và các kiểu Node không tự có mặt trong code trong `src/` của phase này nếu không có `@types/node` được nạp. Nếu bạn gặp "Cannot find name 'console'", đó là vấn đề cấu hình kiểu (liên quan Bài 8), không phải lỗi Zod. Các ví dụ trong notes dùng comment để ghi kết quả thay vì `console.log`.

## Liên hệ bài tập

Bài lab yêu cầu schema cho input tạo Order. Hãy tự hỏi: mỗi trường lấy từ ngoài vào có thể là gì ngoài kiểu bạn mong muốn (thiếu, `null`, chuỗi thay vì số)? `z.infer` cho bạn kiểu nào, và `z.input` khác ở trường nào? Kiểm tra bằng cách đưa `unknown` rác vào `safeParse` và đọc kết quả.

## Đọc thêm

- [Zod: Introduction](https://zod.dev/)
- [Zod: Basic usage](https://zod.dev/basics)
- [TypeScript: `unknown`](https://www.typescriptlang.org/docs/handbook/2/functions.html#unknown)

## Ghi chú của bạn

