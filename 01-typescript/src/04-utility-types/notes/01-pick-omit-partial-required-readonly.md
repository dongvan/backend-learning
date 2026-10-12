# 1. `Pick`, `Omit`, `Partial`, `Required`, `Readonly`

Các utility type này tạo kiểu mới từ một kiểu object có sẵn, nên bạn không phải khai báo lại và không bị lệch khi kiểu gốc đổi.

```ts
interface Article {
  id: number;
  title: string;
  body: string;
  authorId: number;
  publishedAt: Date | null;
  tags?: string[];
}

type Preview = Pick<Article, "id" | "title">;                  // chỉ giữ id, title
type NewArticle = Omit<Article, "id" | "publishedAt">;         // bỏ id, publishedAt
type ArticlePatch = Partial<NewArticle>;                       // mọi trường thành tuỳ chọn
type Strict = Required<Article>;                               // mọi trường bắt buộc (kể cả tags)
type Frozen = Readonly<Article>;                               // mọi trường chỉ đọc
```

## Ý chính

- `Pick<T, K>` giữ lại các khoá `K`; `Omit<T, K>` loại các khoá `K`. Hai cái này là "whitelist" và "blacklist".
- `Partial<T>` thêm `?` cho mọi trường; `Required<T>` gỡ `?`; `Readonly<T>` thêm `readonly`.
- Tất cả đều **nông** (shallow): chỉ tác động tầng thuộc tính đầu tiên, không đi vào object lồng bên trong.
- Chúng chỉ tồn tại ở compile time. Không có gì thay đổi lúc runtime: `Readonly` không đóng băng object, `Required` không điền giá trị thiếu.
- `Pick` kiểm tra khoá có tồn tại; `Omit` thì **không** kiểm tra, nên typo tên khoá bị bỏ qua im lặng.
- Có thể kết hợp (compose): `Partial<Pick<T, "a" | "b">>`, `Omit<T, K> & Partial<Pick<T, K>>`.

## Lý thuyết chi tiết

**Hành vi của từng cái.**

```ts
const p: Preview = { id: 1, title: "t" };
const p2: Preview = { id: 1, title: "t", body: "x" };   // Lỗi: object literal có thuộc tính thừa (excess property check)

type Bad = Pick<Article, "slug">;   // Lỗi: "slug" không thuộc keyof Article
```

`Pick` bắt typo vì khoá bị ràng buộc `K extends keyof T`. `Omit` thì khai báo `K extends keyof any`, tức chấp nhận mọi chuỗi:

```ts
type Typo = Omit<Article, "idd">;   // Không lỗi. Kết quả vẫn còn id, vì "idd" không tồn tại để bỏ
```

Đây là cạm bẫy thực sự khi đổi tên field: `Omit<Article, "oldName">` vẫn hợp lệ sau khi đổi tên và field mới lọt vào kiểu mà bạn tưởng đã bỏ. Xem tip bên dưới về `StrictOmit`.

**Giữ nguyên modifier.** `Pick` và `Omit` giữ nguyên `readonly` và `?` của từng trường:

```ts
type RO = Pick<{ readonly a: 1; b?: 2 }, "a" | "b">;
declare const ro: RO;
ro.a = 1;   // Lỗi: a vẫn là readonly
```

**`Partial` và `Required` chỉ đảo dấu `?`.** `Required` loại `undefined` đi cùng dấu `?` nhưng **không** loại `undefined` bạn tự viết trong kiểu:

```ts
type RU = Required<{ a?: number; b: number | undefined }>;
const ru: RU = { a: 1, b: undefined };            // OK: b vẫn cho phép undefined
const ru2: RU = { a: undefined, b: 1 };           // Lỗi: a bắt buộc và không còn undefined
```

Ngược lại, `Partial<{ a: number }>` cho phép `{ a: undefined }` (vì `exactOptionalPropertyTypes` không bật trong repo). Điều này quan trọng với patch/update: xem file 4.

**Nông, không đệ quy.**

```ts
interface Settings { theme: { dark: boolean; font: string } }
type PS = Partial<Settings>;
const ps: PS = { theme: { dark: true } };   // Lỗi: theme có mặt thì phải đủ dark và font
```

Muốn `DeepPartial`, bạn tự viết bằng mapped type đệ quy (Bài 5). Ở backend, cân nhắc kỹ trước khi cho phép patch sâu: ngữ nghĩa "thiếu = giữ nguyên" với mảng và object lồng thường mơ hồ.

`Readonly` cũng nông: `Readonly<Article>` chặn gán `a.title = ...` nhưng `a.tags?.push("x")` vẫn hợp lệ. Muốn bất biến thật sự cần `readonly string[]` ở kiểu gốc hoặc `Object.freeze` ở runtime.

**Bên trong chúng là mapped type** (giới thiệu; học sâu ở Bài 5):

```ts
type MyPick<T, K extends keyof T> = { [P in K]: T[P] };
type MyPartial<T> = { [P in keyof T]?: T[P] };
type MyRequired<T> = { [P in keyof T]-?: T[P] };     // -? nghĩa là gỡ dấu ?
type MyReadonly<T> = { readonly [P in keyof T]: T[P] };
type MyExclude<T, U> = T extends U ? never : T;
type MyOmit<T, K extends keyof any> = MyPick<T, MyExclude<keyof T, K>>;
```

`[P in keyof T]` duyệt từng khoá của `T`; vì dạng này là *homomorphic* (duyệt trực tiếp `keyof T`), TypeScript giữ nguyên modifier của khoá gốc. `Omit` là `Pick` trên tập khoá đã loại bớt bằng `Exclude`, nên cũng giữ modifier; điều khác biệt của nó là khoá không bị kiểm tra (xem trên) và hành vi với union (xem dưới).

**`Omit` làm sập union.**

```ts
type Shape = { kind: "c"; r: number } | { kind: "s"; side: number };
type OmitKind = Omit<Shape, "r">;
declare const ok: OmitKind;
ok.kind;   // OK
ok.side;   // Lỗi: union bị gộp, chỉ còn các khoá chung
```

`keyof` của một union là các khoá chung, nên `Omit` và `Pick` trên union cho ra một object duy nhất thay vì map qua từng nhánh. Với discriminated union, hãy dùng `Extract` để chọn nhánh rồi mới `Omit`, hoặc viết bản phân phối:

```ts
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
```

(Bài 6 giải thích vì sao `T extends unknown ? ... : ...` phân phối qua union. Bản này đã kiểm chứng: `d.kind === "s"` thu hẹp được và `d.side` truy cập hợp lệ.)

**Index signature.** `Omit` trên kiểu có index signature (`{ [k: string]: unknown; id: number }`) làm mất khoá cụ thể, chỉ còn index signature, vì `keyof` trả về `string | number`.

## Tricks & tips thực tế

- **Với DTO, ưu tiên `Pick` (whitelist) hơn `Omit` (blacklist).** Lý do: thêm cột nhạy cảm vào entity (ví dụ `passwordHash`) thì `Omit<User, "x">` tự động đưa nó ra response, còn `Pick` thì phải chủ động thêm. An toàn mặc định quan trọng hơn gõ ngắn.
- **Dùng `StrictOmit` để bắt typo:** `type StrictOmit<T, K extends keyof T> = Omit<T, K>;`. Lý do: ràng buộc `K extends keyof T` làm đổi tên field là lỗi biên dịch thay vì lặng lẽ rò rỉ.
- **Dạng "đặt vài trường thành tuỳ chọn":** `type SetOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>`. Kết quả là intersection nên hover khó đọc; bọc `type Prettify<T> = { [K in keyof T]: T[K] } & {}` để editor hiển thị object phẳng. Chỉ dùng cho mục đích đọc kiểu; không thay đổi ngữ nghĩa.
- **Đừng dùng `Partial<Entity>` làm kiểu cho update** nếu entity có trường mà client không được phép sửa (`id`, `authorId`, `createdAt`). Lý do: `Partial` cho phép tất cả. Hãy `Pick` các trường được phép trước rồi mới `Partial` (file 4).
- **`Readonly<T>` cho dữ liệu trả từ cache/config dùng chung.** Lý do: một handler vô tình sửa object chung sẽ gây lỗi lan sang request khác; kiểu `Readonly` biến chuyện đó thành lỗi biên dịch. Nhớ rằng nó nông.
- **Mở rộng kiểu bằng intersection `&` thay vì sửa kiểu gốc** khi cần thêm trường (ví dụ thêm `comments`), nhưng với thuộc tính trùng tên khác kiểu, intersection cho ra `never` ở thuộc tính đó. Nếu đổi kiểu của một trường, `Omit` nó trước rồi mới thêm lại.
- **So với PHP/Laravel:** `Pick`/`Omit` giống `$model->only([...])` / `except([...])`, `$fillable`/`$hidden`, nhưng ở cấp kiểu: sai tên khoá bị bắt lúc compile. `Partial` giống mảng dữ liệu của `PATCH` (`validated()` với `sometimes`). Khác biệt: Laravel kiểm tra lúc runtime, còn utility types không kiểm tra gì lúc chạy; bạn vẫn cần validation.
- **Debug:** khi một kiểu dẫn xuất khó hiểu, viết `type Show = Prettify<KieuNay>` rồi hover; hoặc gán `{}` vào biến có kiểu đó để compiler liệt kê trường còn thiếu trong thông báo lỗi.

## Liên hệ bài tập

Lab yêu cầu dẫn xuất DTO từ entity. Trước khi viết, liệt kê cho từng DTO: trường nào client được gửi, trường nào server sinh ra, trường nào không bao giờ được trả ra. Từ đó chọn `Pick` hay `Omit`, có cần `Partial` không, và tự giải thích vì sao. Thử đổi tên một trường trong entity và xem DTO nào báo lỗi, DTO nào im lặng.

## Đọc thêm

- [Utility Types (Handbook)](https://www.typescriptlang.org/docs/handbook/utility-types.html)
- [Mapped Types](https://www.typescriptlang.org/docs/handbook/2/mapped-types.html)

## Ghi chú của bạn

