# 4. `any`, `unknown`, `never`

| Kiểu | Ý nghĩa | Dùng khi |
|---|---|---|
| `any` | Tắt kiểm tra kiểu | Tránh. Nếu dùng thì ghi lý do |
| `unknown` | "Chưa biết", phải narrow trước khi dùng | Dữ liệu chưa tin cậy: JSON, request body, `catch` |
| `never` | "Không thể xảy ra" | Hàm luôn throw, exhaustive check (Bài 2) |

```ts
function parse(input: unknown) {
  input.toUpperCase();            // Lỗi: chưa biết input là gì
  if (typeof input === "string") {
    return input.toUpperCase();   // OK sau khi narrow
  }
}
```

## Ý chính

- `unknown` an toàn hơn `any` vì bắt buộc kiểm tra trước khi dùng.
- Compile-time type không bảo đảm dữ liệu runtime. Dữ liệu từ ngoài vào là `unknown` cho đến khi được validate (Zod ở Bài 9).
- `never` là kiểu rỗng, không có giá trị nào thuộc kiểu này.

## Lý thuyết chi tiết

**Vị trí trong hệ kiểu**: `unknown` là kiểu "top" (mọi giá trị gán được vào), `never` là kiểu "bottom" (gán được vào mọi kiểu, nhưng không có giá trị nào). `any` vừa là top vừa là bottom, nên phá vỡ mọi kiểm tra.

```ts
const u: unknown = 123;           // OK, gán gì cũng được
function fail(): never { throw new Error("x"); }
const s: string = fail();         // OK về kiểu: never gán được cho mọi kiểu (vì không bao giờ trả về)
```

**`any` lây lan**: kết quả của mọi thao tác trên `any` lại là `any`, nên một chỗ `any` có thể làm mất kiểu cả chuỗi phía sau.

```ts
const data = JSON.parse(text);    // any
const id = data.user.id;          // any, không lỗi dù data không có user
```

**`unknown` với các phép toán**: không truy cập thuộc tính, không gọi, không cộng được. Chỉ được so sánh (`===`), `typeof`, hoặc narrow.

**`never` xuất hiện ở đâu**
- Hàm không bao giờ trả về (luôn `throw`, vòng lặp vô hạn).
- Nhánh còn lại sau khi đã narrow hết các khả năng.
- Giao của các kiểu không tương thích (`string & number`).
- Phần tử rỗng trong union: `string | never` chính là `string`.

**Exhaustive check** (dùng ở Bài 2):

```ts
function assertNever(x: never): never {
  throw new Error(`Unhandled: ${JSON.stringify(x)}`);
}
```

Thêm một thành viên mới vào union mà quên xử lý thì `assertNever(x)` báo lỗi compile ngay.

**Khác biệt cần phân biệt**: `void` (hàm không trả giá trị hữu ích) khác `never` (hàm không bao giờ kết thúc bình thường), khác `undefined` (một giá trị cụ thể), khác `null`.

## Tricks & tips thực tế

- **`catch (e)` là `unknown`** khi bật `strict` (`useUnknownInCatchVariables`). Mẫu chuẩn:
  ```ts
  try { ... } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
  }
  ```
  Đừng `throw "string"`; luôn throw `Error` (hoặc subclass) để có stack trace.
- **`JSON.parse`, `req.body`, `res.json()`, `process.env`** đều trả `any` hoặc kiểu không đáng tin. Gán ngay vào `unknown` rồi validate (Zod), không cast bằng `as User`:
  ```ts
  const raw: unknown = JSON.parse(text);
  ```
- **`as` không phải kiểm tra**, nó là lời hứa. `x as User` không chạy gì lúc runtime. Dùng `as` là dấu hiệu cần cân nhắc lại; khi bắt buộc dùng, ghi comment lý do.
- **Khi thật sự cần `any`**: ưu tiên `// @ts-expect-error: lý do` (báo lỗi nếu sau này không còn lỗi) hơn `@ts-ignore`. Giới hạn `any` ở phạm vi nhỏ nhất, và bọc lại bằng kiểu rõ ràng ở ranh giới.
- **Bật lint**: `@typescript-eslint/no-explicit-any`, `no-unsafe-*` để bắt `any` lọt vào.
- **Kiểu "bất kỳ object"**: dùng `Record<string, unknown>` thay cho `object`/`{}`/`any`. Lưu ý `{}` nghĩa là "mọi thứ trừ null/undefined", không phải "object rỗng".
- **Non-null assertion `!`** (`user!.name`) cũng là lời hứa như `as`. Ưu tiên kiểm tra thật (`if (!user) throw ...`).
- **Hàm luôn throw** nên khai báo `: never` để compiler hiểu code phía sau không chạy tới (giúp narrowing).

## Liên hệ bài tập

Yêu cầu "không dùng `any`". Nếu bạn muốn dùng thì ghi lý do và thử `unknown` thay thế trước.

## Đọc thêm

- [The `unknown` type](https://www.typescriptlang.org/docs/handbook/2/functions.html#unknown)
- [The `never` type](https://www.typescriptlang.org/docs/handbook/2/functions.html#never)

## Ghi chú của bạn

