# 4. Object (strip/strict/loose), discriminatedUnion, và tách schema input khỏi entity

Cách Zod đối xử với khoá thừa quyết định bạn có bị **mass assignment** hay không; còn `discriminatedUnion` mang bài union Bài 2 vào dữ liệu runtime.

```ts
import { z } from "zod";

const RegisterBody = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(8),
  displayName: z.string().trim().min(1).max(50),
});

const clean = RegisterBody.parse({
  email: "A@B.CO", password: "12345678", displayName: " Bob ", role: "admin",
});
// { email: "a@b.co", password: "12345678", displayName: "Bob" }  <- "role" bị loại bỏ
```

## Ý chính

- `z.object` mặc định **strip**: khoá không khai báo bị **bỏ** khỏi kết quả, không báo lỗi. Đây là hành vi an toàn nhất cho mass assignment, và bạn nhận về object *chỉ chứa* khoá đã khai báo.
- `z.strictObject` (hoặc `.strict()`): khoá thừa là **lỗi** (`unrecognized_keys`). Hợp khi muốn báo client biết họ gửi nhầm.
- `z.looseObject` (hoặc `.loose()`): giữ nguyên khoá thừa. Zod 4 đánh dấu `.passthrough()` là deprecated.
- `z.discriminatedUnion("type", [...])` chọn nhánh theo giá trị của khoá phân biệt (nhanh hơn và lỗi gọn hơn `z.union`).
- **Tách schema input với entity**: input là thứ client được phép gửi; entity là thứ hệ thống lưu. Chúng khác nhau (id, role, createdAt, passwordHash). Dùng `omit`/`pick`/`extend` để dẫn xuất từ một nguồn thay vì copy.
- Schema có `refine` thì không `pick`/`omit`/`partial` được; dẫn xuất xong rồi mới thêm refine.

## Lý thuyết chi tiết

**Ba chế độ khoá thừa** (đã chạy):

```ts
const Base = z.object({ title: z.string() });

Base.parse({ title: "a", hack: 1 });                    // { title: "a" }          (strip)
z.strictObject({ title: z.string() }).safeParse({ title: "a", hack: 1 });
// success: false, issue: { code: "unrecognized_keys", keys: ["hack"], path: [], message: 'Unrecognized key: "hack"' }
z.looseObject({ title: z.string() }).parse({ title: "a", hack: 1 }); // { title: "a", hack: 1 }
```

`strict` lỗi ở `path: []` (cấp object), nên `flattenError` đặt nó vào `formErrors`, không vào `fieldErrors`.

Nên chọn thế nào: **input từ client** dùng strip (mặc định), hoặc strict nếu bạn muốn API nghiêm ngặt và coi trường lạ là lỗi của client (ví dụ client gõ sai `pagee`, strip sẽ im lặng bỏ qua và dùng mặc định). **Dữ liệu đọc từ nguồn khác** thường dùng strip để chỉ giữ phần mình dùng. Loose chỉ dùng khi bạn thật sự cần chuyển tiếp phần thừa (proxy, lưu metadata).

**Mass assignment: vì sao strip quan trọng.** Trong Laravel, `$request->all()` + `fill()` mà quên `$fillable` thì client có thể ghi `is_admin`. Phiên bản TS tương đương là `Object.assign(user, req.body)` hoặc `{ ...req.body }` đưa vào ORM. Với schema strip, kết quả của `parse` đã *chỉ* chứa khoá bạn khai báo; chỉ cần luôn truyền `r.data` chứ không truyền `req.body` đi tiếp. Lỗi kinh điển: validate xong nhưng vẫn dùng `req.body` gốc.

**Dẫn xuất schema** (giống utility types Bài 4 nhưng ở runtime):

```ts
const UserEntity = RegisterBody.omit({ password: true }).extend({
  id: z.uuid().brand<"UserId">(),
  role: z.enum(["admin", "member"]),
  createdAt: z.date(),
});
type UserEntity = z.infer<typeof UserEntity>;
// { email: string; displayName: string; id: string & z.$brand<"UserId">; role: "admin" | "member"; createdAt: Date }

const PatchUser = RegisterBody.omit({ password: true }).partial();
type PatchUser = z.infer<typeof PatchUser>; // mọi trường tuỳ chọn
```

Sơ đồ nên có cho một tài nguyên:

```text
RegisterBody  (client -> server)        : email, password, displayName
UserEntity    (lưu trữ / domain)         : id, email, displayName, role, passwordHash, createdAt
UserResponse  (server -> client)         : id, email, displayName, createdAt   (không có role nội bộ, không có hash)
```

Ba hình dạng khác nhau, không dùng một schema cho cả ba. Hệ quả của việc dùng chung: client gửi `role: "admin"`, hoặc response lộ `passwordHash`. Bài 10 nói tiếp về DTO.

Lưu ý: `omit`, `pick`, `partial` ném lỗi nếu schema đã có `refine` (`.omit() cannot be used on object schemas containing refinements`, đã chạy). `extend` và `safeExtend` thì được. `safeExtend` từ chối ghi đè trường bằng kiểu không tương thích (an toàn hơn `extend` khi bạn chỉ muốn thắt chặt luật).

**`discriminatedUnion`.**

```ts
const Notification = z.discriminatedUnion("type", [
  z.object({ type: z.literal("email"), address: z.email() }),
  z.object({ type: z.literal("sms"), phone: z.string().min(9) }),
]);
type Notification = z.infer<typeof Notification>;
// | { type: "email"; address: string } | { type: "sms"; phone: string }

function send(n: Notification): string {
  switch (n.type) {
    case "email": return n.address;
    case "sms": return n.phone;
  }
}
```

Kiểu suy ra chính là discriminated union Bài 2, nên `switch` và exhaustive check dùng được nguyên vẹn. Lỗi (đã chạy):

```ts
Notification.safeParse({ type: "push" }).error?.issues;
// [{ code: "invalid_union", errors: [], note: "No matching discriminator", discriminator: "type",
//    options: ["email", "sms"], path: ["type"], message: "Invalid discriminator value. Expected 'email' | 'sms'" }]

Notification.safeParse({ type: "email", address: "x" }).error?.issues;
// [{ code: "invalid_format", format: "email", path: ["address"], message: "Invalid email address", ... }]  <- chỉ lỗi của nhánh đã chọn
```

Với `z.union` thường, bạn nhận một issue gom lỗi của mọi nhánh, rất khó đọc. Khoá phân biệt phải là literal (hoặc enum/giá trị hằng) ở **mọi** nhánh.

**Dữ liệu đến từ ngoài vào union cần cả hai lớp.** Union trạng thái trong DB (cột `status` + các cột nullable) được dựng lại thành discriminated union ở ranh giới repository: parse hàng DB bằng `discriminatedUnion` để chắc chắn dữ liệu cũ vẫn khớp kiểu.

**Query string và env là trường hợp quen thuộc của object schema:**

```ts
const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  published: z.stringbool().optional(),
});
ListQuery.parse({});                              // { page: 1, perPage: 20 }
ListQuery.parse({ page: "3", published: "true" }); // { page: 3, perPage: 20, published: true }
ListQuery.safeParse({ page: "abc" });              // lỗi: expected number, received NaN
```

**Những điều `z.object` thực sự chấp nhận** (đã chạy với Zod 4.6.5):

- Nó từ chối `null` (`expected object, received null`) và mảng (`z.object({}).safeParse([]).success === false`), nhưng **chấp nhận `Date`, `Map` và instance của class** (`z.object({}).safeParse(new Date()).success === true`). Với JSON từ HTTP thì không sao (JSON không có `Date`), nhưng khi nhận object từ code nội bộ/queue deserialize, đừng coi `z.object` là "chỉ object thuần".
- Khoá `undefined` tường minh *còn nguyên* trong kết quả: `z.object({ a: z.string().optional() }).parse({ a: undefined })` có `Object.keys` là `["a"]`, còn `parse({})` cho `[]`. Khi truyền kết quả vào ORM `update`, khoá có giá trị `undefined` có thể được hiểu là "không đổi" hoặc "đặt NULL" tuỳ thư viện; hãy tự kiểm tra thư viện bạn dùng (cần tự kiểm chứng).
- Khoá `__proto__` trong JSON không gây prototype pollution qua Zod: với `JSON.parse('{"__proto__":{"admin":true},"a":1}')` (`Object.keys` của nó có `"__proto__"` như khoá thường), cả `z.object` lẫn `z.looseObject` đều trả object chỉ có `a`, và `({}).admin` vẫn `undefined`. Cẩn thận hơn nếu bạn tự `Object.assign`/merge sâu input thô.

**Khoá thừa có kiểu: `catchall`.** Khi muốn nhận khoá động nhưng vẫn kiểm giá trị: `z.object({ a: z.string() }).catchall(z.number())` báo lỗi ở `path: ["b"]` cho `{ a: "x", b: "y" }` (đã chạy). Hợp với "metadata tự do giá trị số/chuỗi", ít dùng hơn `z.record`.

**`z.record` và khoá enum.** `z.record(z.string(), z.number())` cho khoá bất kỳ. Khi khoá là enum, Zod 4 yêu cầu **đủ** mọi khoá: `z.record(z.enum(["a", "b"]), z.number()).safeParse({ a: 1 }).success` là `false`; muốn khoá tuỳ chọn thì dùng `z.partialRecord(...)` (đã chạy, kiểu suy ra `Partial<Record<"a" | "b", number>>`).

**PATCH: dẫn xuất từ schema không có `default`.** Vì `.partial()` vẫn áp `default` (xem file 3), cấu trúc an toàn là:

```ts
const SettingsFields = z.object({ theme: z.enum(["light", "dark"]), name: z.string().min(1) });
const CreateSettings = SettingsFields.extend({ theme: SettingsFields.shape.theme.default("light") });
const PatchSettings = SettingsFields.partial();           // vắng mặt nghĩa là "không đổi"
```

**Union và độ chính xác của lỗi.** `z.union` thử lần lượt và gom lỗi; `discriminatedUnion` chỉ tra khoá phân biệt rồi validate đúng nhánh. Nếu khoá phân biệt vắng hay sai giá trị, kết quả là một `invalid_union` với `note: "No matching discriminator"`, `discriminator: "type"` và `options` (đã chạy), nên client có thể sửa ngay.

## Tricks & tips thực tế

- **Luôn dùng `result.data` (đã parse), không dùng input gốc nữa.** Lý do: input gốc còn khoá thừa và giá trị chưa chuẩn hoá; dùng nhầm là mất toàn bộ lợi ích của strip.
- **Mặc định strip cho body; bật `strictObject` cho endpoint nhạy cảm hoặc khi muốn phản hồi sớm cho client gõ sai khoá.** Lý do: strip an toàn nhưng im lặng, client dễ không biết `pagee` bị bỏ.
- **Đừng đặt `role`, `id`, `createdAt`, `passwordHash` vào schema input.** Lý do: không có trong schema nghĩa là client không thể ghi chúng, kể cả khi quên chặn ở nơi khác.
- **Dẫn xuất (`omit`/`extend`) từ một schema gốc thay vì sao chép.** Lý do: thêm trường mới chỉ sửa một chỗ; sao chép sẽ lệch dần.
- **Refine đặt sau cùng chuỗi dẫn xuất.** Lý do: `omit/pick/partial` sau refine ném lỗi (Zod 4.6.5), nên bạn sẽ gặp lỗi lúc khởi động module chứ không lúc runtime, nhưng vẫn khó hiểu nếu không biết.
- **Union của object: ưu tiên `discriminatedUnion`.** Lý do: thông điệp lỗi chỉ nói về nhánh liên quan, kiểu suy ra là union thu hẹp được.
- **Khoá phân biệt tên nhất quán (`type`, `kind`, `status`) trong toàn dự án.** Lý do: dễ đọc, dễ viết helper dùng lại.
- **Input mảng: đặt giới hạn `max` cho độ dài.** Lý do: không giới hạn nghĩa là client gửi mảng 10 triệu phần tử, tốn bộ nhớ và CPU trước cả khi vào nghiệp vụ. Giới hạn kích thước body cũng nên cấu hình ở framework.
- **Debug "sao khoá của tôi biến mất"**: nhớ strip là mặc định. Nếu một trường client gửi không thấy trong `data`, trường đó chưa được khai báo trong schema.
- **Dùng Zod 3 `z.object().strict()`/`.passthrough()` theo blog cũ**: trong Zod 4.6.5 `.strict()` vẫn tồn tại, `.passthrough()` bị deprecated; hướng dẫn mới là `z.strictObject()` / `z.looseObject()`.

## Liên hệ bài tập

Với Order input: client được phép gửi những trường nào và trường nào chỉ hệ thống mới được đặt (id, tổng tiền, trạng thái)? Hãy thử đưa thêm `status: "paid"` hoặc `total: 0` vào input và xem kết quả `parse`. Hãy cân nhắc line items là mảng phần tử object: giới hạn độ dài, và lỗi ở phần tử thứ n nằm ở `path` nào. Trạng thái của Order nếu dùng discriminated union (Bài 2) thì schema cho nó nên là gì khi đọc từ DB?

## Đọc thêm

- [Zod: Objects](https://zod.dev/api)
- [Zod: Discriminated unions](https://zod.dev/api)
- [Zod: Migration guide v4](https://zod.dev/v4/changelog)
- [TypeScript: Discriminated unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)

## Ghi chú của bạn

