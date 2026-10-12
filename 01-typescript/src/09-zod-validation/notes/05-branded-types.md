# 5. Branded types: làm cho "chuỗi đã kiểm chứng" khác "chuỗi bất kỳ"

Cho hai giá trị cùng kiểu `string` nhưng khác ý nghĩa (id bài viết và id bình luận) thành hai kiểu **không gán lẫn cho nhau** được.

```ts
import { z } from "zod";

const ArticleId = z.string().min(1).brand<"ArticleId">();
type ArticleId = z.infer<typeof ArticleId>;
const CommentId = z.string().min(1).brand<"CommentId">();
type CommentId = z.infer<typeof CommentId>;

function deleteComment(_a: ArticleId, _c: CommentId): void {}

const aid = ArticleId.parse("a1");
const cid = CommentId.parse("c1");
deleteComment(aid, cid);
// @ts-expect-error: đảo thứ tự bị compiler bắt, dù cả hai đều là string
deleteComment(cid, aid);
```

## Ý chính

- Structural typing (Bài 1) coi mọi `string` là một. Brand thêm một "dấu" chỉ tồn tại trong hệ thống kiểu, không có thật lúc chạy, để compiler phân biệt.
- Brand mạnh nhất khi **chỉ có cửa duy nhất tạo ra giá trị có brand**: hàm parse/validate. Cầm được `ArticleId` nghĩa là giá trị đã qua kiểm tra.
- Zod: `.brand<"Tên">()`. Thủ công: `T & { readonly [brand]: "Tên" }`.
- Brand **không có chi phí runtime**: giá trị vẫn là chuỗi thường (đã kiểm: `typeof id === "string"`), brand chỉ là kiểu.
- Brand tới kiểu gốc thì gán ngược được (`const s: string = id` hợp lệ), nhưng kiểu gốc không gán vào brand được.
- Phân biệt "dữ liệu chưa tin cậy" và "dữ liệu đã validate" bằng brand là một mục của Definition of Done Phase 01.

## Lý thuyết chi tiết

**Vấn đề.** Ba tham số cùng là `string`:

```ts
function assignTicket(ticketId: string, userId: string): void { /* ... */ }
assignTicket(user.id, ticket.id); // compile OK, bug âm thầm
```

Trong Laravel/PHP bạn đối mặt vấn đề tương tự và thường chỉ phòng bằng đặt tên. Brand biến nó thành lỗi biên dịch.

**Brand bằng Zod.**

```ts
const UserId = z.uuid().brand<"UserId">();
type UserId = z.infer<typeof UserId>; // string & z.$brand<"UserId">

const id = UserId.parse("550e8400-e29b-41d4-a716-446655440000");
function getUser(_id: UserId): number { return 1; }

getUser(id);
// @ts-expect-error: string thường không có brand
getUser("550e8400-e29b-41d4-a716-446655440000");

const plain: string = id; // OK: brand gán ngược về string được
```

`z.input<typeof UserId>` vẫn là `string`: input của `parse` là chuỗi bất kỳ; chỉ **output** mang brand (mặc định). Zod 4 còn nhận tham số thứ hai chỉ hướng (`"in"`, `"out"`), nhưng dạng mặc định là bạn cần.

**Brand trong object schema.**

```ts
const ProductId = z.uuid().brand<"ProductId">();
const CategoryId = z.uuid().brand<"CategoryId">();
const Product = z.object({ id: ProductId, categoryId: CategoryId, name: z.string() });
// z.infer<typeof Product> có id và categoryId là hai kiểu brand khác nhau
```

Object tạo ngoài schema (ví dụ `const p: z.infer<typeof Product> = { categoryId: "x", ... }`) bị compiler chặn vì `"x"` không có brand. Đã kiểm chứng bằng `@ts-expect-error`.

**Brand thủ công** (khi không dùng Zod, hoặc brand cho kiểu không xuất phát từ schema):

```ts
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

type Slug = Brand<string, "Slug">;

function toSlug(s: string): Slug {
  return s.toLowerCase().replace(/\s+/g, "-") as Slug; // cái `as` duy nhất, nằm trong hàm tạo
}

const sl: Slug = toSlug("A B");
const asStr: string = sl; // OK
// @ts-expect-error: chuỗi thường không phải Slug
const bad: Slug = "x";
```

`declare const brand: unique symbol` chỉ khai báo kiểu, không tạo giá trị runtime, nên không có property thật trên chuỗi. Ví dụ ngắn hơn hay gặp là `T & { readonly __brand: B }`, nhưng khoá chuỗi `__brand` có thể bị trùng khi hai thư viện cùng dùng; `unique symbol` tránh được.

**Nguyên tắc `as` duy nhất.** Ở brand thủ công, `as Slug` là chỗ bạn *hứa* giá trị hợp lệ. Hãy giữ nó ở đúng một hàm (hàm tạo) có kiểm tra thật; ở mọi nơi khác không dùng `as Slug`. Với Zod, `.brand()` đã gói sẵn việc đó: chỉ `parse` mới tạo ra được kiểu brand mà không cần `as`.

**Brand chỉ hiệu lực lúc biên dịch.** `ArticleId.safeParse("").success` là `false` vì có `.min(1)`; nhưng nếu bạn dùng `as ArticleId` ở đâu đó, runtime không biết. Brand không thay thế validate, nó *ghi lại* rằng validate đã diễn ra.

**Khi nào đáng dùng.**

| Đáng | Không đáng |
|---|---|
| Các loại id (`UserId`, `ArticleId`) dễ nhầm thứ tự tham số | Mọi `string` trong dự án |
| Giá trị đã chuẩn hoá (`Email` đã lowercase, `Slug`) | Dữ liệu chỉ dùng cục bộ một hàm |
| Đơn vị (`Cents` so với `Dollars` cùng là `number`) | Khi đội chưa quen và chi phí giải thích cao hơn lỗi mà nó chặn |
| Dữ liệu "đã qua ranh giới" (`ValidatedBody`) | |

## Tricks & tips thực tế

- **Gắn brand ngay trong schema của ranh giới.** Lý do: `parse` vừa kiểm chứng vừa gắn brand, nên đi vào trong code là đã mang kiểu đúng, không cần bước thứ hai.
- **Chỉ có một nơi tạo giá trị brand.** Lý do: mỗi `as Brand` rải rác là một lỗ hổng, brand mất ý nghĩa "đã kiểm chứng".
- **Brand cho id; cẩn thận brand cho mọi thứ.** Lý do: id là nơi lỗi hoán vị tham số hay gặp nhất, còn brand tràn lan làm test và mock phải ép kiểu khắp nơi.
- **Test và fixture**: tạo qua `ArticleId.parse("a1")` thay vì `"a1" as ArticleId`. Lý do: giữ nguyên bất biến và phát hiện fixture sai ngay.
- **Brand và JSON**: sau `JSON.stringify` / `JSON.parse`, brand biến mất (vì không tồn tại runtime). Dữ liệu đọc lại phải qua schema một lần nữa để lấy lại brand.
- **Thông báo lỗi của compiler với brand dài và khó đọc** (`Type 'string' is not assignable to type 'string & BRAND<"ArticleId">'`). Gặp lỗi này nghĩa là một giá trị chưa qua hàm parse. Lần ngược tới nơi giá trị xuất hiện và thêm parse ở ranh giới, đừng thêm `as`.
- **Brand cho kiểu số (`Cents`)**: `z.number().int().brand<"Cents">()`. Lý do: phép cộng `Cents + Cents` vẫn ra `number` thường nên cần hàm `addCents` trả về brand; hãy tính xem lợi ích có đáng không.
- **Brand không thay thế mô hình hoá trạng thái bằng union (Bài 2).** Dùng union cho "dữ liệu thuộc dạng nào", brand cho "giá trị đã được kiểm chứng/mang ý nghĩa gì".
- **So sánh PHP**: PHP thường dùng class bọc (`final class UserId { public function __construct(public readonly string $value) {} }`). Class bọc tốn runtime object nhưng có thể gắn logic; brand không tốn gì nhưng chỉ là kiểu. Chọn theo nhu cầu.

## Liên hệ bài tập

Trong Order input, giá trị nào dễ bị nhầm với giá trị khác cùng kiểu nguyên thuỷ (id khách hàng, id sản phẩm, số lượng, đơn giá)? Chọn một hai chỗ thật sự đáng và thử: viết hàm nhận hai id, cố tình đảo thứ tự, xem compiler báo gì. Cân nhắc brand nên được gắn ở schema hay ở một hàm riêng, và vì sao.

## Đọc thêm

- [Zod: Branded types](https://zod.dev/api)
- [TypeScript: `unique symbol`](https://www.typescriptlang.org/docs/handbook/symbols.html)
- [TypeScript: Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)

## Ghi chú của bạn

