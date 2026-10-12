# 4. Dẫn xuất DTO từ entity: create, update, response

Entity là nguồn sự thật về dữ liệu; mỗi DTO là một **góc nhìn** có chủ đích lên entity đó: client được gửi gì, được sửa gì, và được thấy gì.

```ts
interface Article {
  readonly id: number;
  title: string;
  slug: string;
  body: string;
  authorId: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

type CreateArticleInput = Pick<Article, "title" | "body"> & { tags?: string[] };
type UpdateArticleInput = Partial<Pick<Article, "title" | "body">>;
type ArticleResponse = Omit<Article, "deletedAt" | "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};
```

Ví dụ này dùng miền Article/Comment. Bài lab dùng entity khác của bạn, và bạn tự quyết từng trường.

## Ý chính

- Mỗi DTO trả lời một câu hỏi: **ai được ghi trường nào** (create/update) và **ai được thấy trường nào** (response). Kiểu thể hiện câu trả lời đó.
- Create: `Pick` các trường client được gửi. Update: `Pick` các trường được sửa rồi `Partial`. Response: `Pick`/`Omit` các trường được lộ, thay kiểu không serialize được (Date) bằng kiểu JSON.
- Khai báo whitelist (`Pick`) cho dữ liệu vào và dữ liệu ra nhạy cảm; blacklist (`Omit`) chỉ cho các trường chắc chắn vô hại.
- Kiểu dẫn xuất giúp đồng bộ tên và kiểu trường với entity, nhưng **không thay thế validation runtime** (Bài 9: Zod).
- Entity (domain) và DTO (hợp đồng API) là hai thứ khác nhau. Dẫn xuất DTO từ entity là tiện lợi, nhưng hợp đồng công khai vẫn cần được xem như một thứ ổn định riêng (Bài 10).

## Lý thuyết chi tiết

**Create.** Client không được gửi trường do server sinh (`id`, `slug`, thời gian) hay do ngữ cảnh xác định (`authorId` lấy từ người dùng đăng nhập, không từ body):

```ts
type CreateArticleInput = Pick<Article, "title" | "body"> & { tags?: string[] };
```

Trường không thuộc entity (như `tags` đi vào bảng khác) được thêm bằng intersection `&`. Nếu một trường trùng tên nhưng khác kiểu, intersection tạo ra `never` ở trường đó, nên khi cần đổi kiểu hãy `Omit` trước.

**Update (PATCH).** Hai bước: whitelist, rồi cho phép thiếu:

```ts
type UpdateArticleInput = Partial<Pick<Article, "title" | "body">>;

const upd: UpdateArticleInput = { title: "x" };
const upd2: UpdateArticleInput = { authorId: 2 };   // Lỗi: authorId không có trong whitelist
```

Nếu bạn viết `Partial<Article>`, client "được phép" gửi `id`, `authorId`, `deletedAt`: một lỗ hổng mass-assignment ở cấp kiểu (giống `$guarded = []` trong Laravel). Thứ tự `Partial<Pick<...>>` quan trọng: whitelist trước, tuỳ chọn sau.

**Áp dụng patch bất biến.**

```ts
function applyPatch(a: Article, patch: UpdateArticleInput): Article {
  return { ...a, ...patch, updatedAt: new Date() };
}
```

Compile được, nhưng có một cạm bẫy: `Partial` cho phép `{ title: undefined }` (khi `exactOptionalPropertyTypes` tắt, như repo này), và spread `...patch` sẽ ghi đè `title` bằng `undefined` lúc runtime trong khi kiểu vẫn nói `title: string`:

```ts
const base = { title: "a", body: "b" };
const patch: Partial<typeof base> = { title: undefined };
const merged = { ...base, ...patch };
const mt: string = merged.title;   // compile OK, nhưng runtime là undefined
```

Đã kiểm chứng: đoạn trên compile không lỗi. Hai cách xử lý: lọc khoá có giá trị `undefined` trước khi spread, hoặc validate ở ranh giới (Zod loại `undefined` hoặc báo lỗi). JSON từ client không có `undefined` (chỉ có thiếu khoá hoặc `null`), nên chuyện này chủ yếu xảy ra khi code nội bộ truyền `patch` được dựng thủ công.

**Response.** Hai nhiệm vụ: ẩn trường, và đổi kiểu cho khớp JSON (`Date` thành chuỗi ISO):

```ts
interface Author { id: number; email: string; passwordHash: string; displayName: string }

type PublicAuthor = Omit<Author, "passwordHash">;               // blacklist: thêm cột nhạy cảm là rò
type PublicAuthor2 = Pick<Author, "id" | "displayName">;        // whitelist: an toàn mặc định
```

Đổi kiểu hàng loạt bằng mapped type nhỏ (giới thiệu; Bài 5 học sâu):

```ts
type Serialized<T> = {
  [K in keyof T]: T[K] extends Date ? string
    : T[K] extends Date | null ? string | null
    : T[K];
};
type ArticleJson = Serialized<Article>;
```

Hàm map với kiểu trả về tường minh để compiler kiểm tra từng trường:

```ts
function toResponse(a: Article): Pick<ArticleJson, "id" | "title" | "createdAt"> {
  return { id: a.id, title: a.title, createdAt: a.createdAt.toISOString() };
}
```

Quên gọi `toISOString()` (trả `Date` cho `string`) là lỗi biên dịch, vì kiểu trả về nói `createdAt: string`. Nhờ đó "Date thành chuỗi" không còn phụ thuộc trí nhớ.

**Quan hệ lồng nhau.**

```ts
interface Comment { id: number; articleId: number; authorId: number; text: string; createdAt: Date }
type ArticleWithComments = ArticleResponse & { comments: Pick<Comment, "id" | "text">[] };
```

Mỗi mức lồng có DTO riêng; đừng nhúng nguyên entity `Comment` vào response.

**Thêm một số hình dạng hữu ích.**

```ts
// Bắt buộc thêm vài trường vào một kiểu có trường tuỳ chọn
type RequireFields<T, K extends keyof T> = T & Required<Pick<T, K>>;
type Draft = { title?: string; body?: string; slug?: string };
const rf: RequireFields<Draft, "title"> = { title: "x" };

// Dẫn xuất tập giá trị từ một mảng hằng, dùng chung cho kiểu và cho runtime
const ARTICLE_STATUSES = ["draft", "published"] as const;
type ArticleStatus = (typeof ARTICLE_STATUSES)[number];   // "draft" | "published"
```

Mảng hằng `as const` là nguồn duy nhất cho cả kiểu lẫn kiểm tra runtime (`ARTICLE_STATUSES.includes(...)`), tránh enum/union lệch với danh sách thật.

**Chiều ngược: kiểu từ schema.** Ở Bài 9, bạn sẽ đi theo hướng khác: viết schema Zod rồi `z.infer` ra kiểu. Khi đó DTO là kiểu dẫn xuất từ schema, và các utility type này vẫn dùng được trên kiểu đó (ví dụ `schema.partial()` của Zod tương ứng `Partial`).

**So với PHP/Laravel.**

| Laravel | TypeScript |
|---|---|
| `$fillable` / `$guarded` | whitelist bằng `Pick` |
| `$hidden` | `Omit` (blacklist) hoặc `Pick` (whitelist) |
| `API Resource` (`toArray`) | hàm map + kiểu response |
| `FormRequest::validated()` | validation runtime + kiểu input đã validate |

Điểm khác: Laravel chặn ở runtime; utility types chỉ cho kiểu đúng, nên bạn vẫn phải validate dữ liệu thật.

## Tricks & tips thực tế

- **Đặt tên DTO theo vai trò, không theo hình dạng:** `CreateArticleInput`, `UpdateArticleInput`, `ArticleResponse`. Lý do: tên nói rõ ai dùng và để làm gì; khi hai DTO tình cờ giống nhau thì chúng vẫn thay đổi vì lý do khác nhau.
- **Không tái sử dụng một DTO cho input và output.** Lý do: input và output có tập trường, kiểu (`Date` vs chuỗi), và mức tin cậy khác nhau; gộp lại buộc cả hai phải nhượng bộ.
- **Whitelist cho mọi thứ đi ra, kể cả khi hiện tại `Omit` ngắn hơn.** Lý do: entity sẽ lớn lên (thêm cột nội bộ, token, ghi chú quản trị). `Pick` biến "lộ thêm trường" thành quyết định có chủ ý trong code review.
- **Dùng kiểu trả về tường minh cho hàm map entity thành response.** Nếu để suy luận, thêm trường vào entity có thể lặng lẽ lọt ra response thông qua `{ ...entity }`. Spread cả entity vào response là anti-pattern.
- **Thử "đổi tên trường" để kiểm tra dây an toàn.** Đổi `title` thành `heading` trong entity: mọi `Pick<Article, "title">` phải lỗi. Cái nào im lặng (thường là `Omit<..., "tenCu">`) là chỗ có thể rò dữ liệu; chuyển sang `Pick` hoặc `StrictOmit` (file 1).
- **Kiểu `Readonly`/`readonly` trên `id`** của entity ngăn code ứng dụng gán lại id; dẫn xuất bằng `Pick` giữ `readonly` (đã kiểm chứng ở file 1), nên DTO nhận `id` sẽ cũng chỉ đọc. Để ý điều này khi DTO input thật sự cần gán.
- **Đừng dẫn xuất DTO từ chính entity ORM** khi entity có quan hệ lazy, hàm hoặc decorator (TypeORM/Prisma/MikroORM). Lý do: `keyof` bao gồm cả method và thuộc tính quan hệ. Hãy khai báo một kiểu dữ liệu thuần cho DTO làm nền, hoặc dùng kiểu mà ORM sinh ra (Prisma Client sinh sẵn kiểu thuần).
- **Giữ dẫn xuất nông và đọc được.** Nếu một kiểu dẫn xuất cần ba utility lồng nhau để hiểu, hãy đặt tên bước trung gian, hoặc viết tay kiểu đó. Lý do: DTO là hợp đồng, nên cần đọc nhanh hơn cần "thông minh".
- **Debug kiểu dẫn xuất:** `type Show<T> = { [K in keyof T]: T[K] } & {}` rồi hover `Show<CreateArticleInput>`; hoặc `const _x: CreateArticleInput = {}` để compiler liệt kê trường thiếu.

## Liên hệ bài tập

Với entity của lab, lập bảng ba cột (create / update / response) cho từng trường: có hoặc không, bắt buộc hay tuỳ chọn, kiểu gì. Dựng DTO từ bảng đó, rồi kiểm tra ba tình huống: (1) client gửi trường không được phép, (2) thêm một trường mới vào entity, (3) đổi tên một trường. Ghi lại DTO nào bắt được, DTO nào im lặng, và vì sao.

## Đọc thêm

- [Utility Types (Handbook)](https://www.typescriptlang.org/docs/handbook/utility-types.html)
- [Mapped Types](https://www.typescriptlang.org/docs/handbook/2/mapped-types.html)
- [Indexed Access Types](https://www.typescriptlang.org/docs/handbook/2/indexed-access-types.html)

## Ghi chú của bạn

