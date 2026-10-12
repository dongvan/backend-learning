# 2. Entity, value object và aggregate

Entity có danh tính (ID) và vòng đời; value object chỉ là giá trị, so sánh theo nội dung; aggregate là cụm đối tượng được đổi thông qua **một cửa vào** để luôn nhất quán.

```ts
type Brand<T, B extends string> = T & { readonly __brand: B };
type LoanId = Brand<string, "LoanId">;     // entity: định danh bằng id
type MemberId = Brand<string, "MemberId">;

class Money {                              // value object: bằng nhau khi cùng nội dung
  private constructor(readonly minor: number, readonly currency: "VND" | "USD") {}
  static of(minor: number, currency: "VND" | "USD"): Money {
    if (!Number.isSafeInteger(minor)) throw new RangeError("minor phải là số nguyên an toàn");
    return new Money(minor, currency);
  }
}
```

## Ý chính

- **Entity**: hai entity là cùng một khi `id` bằng nhau, dù các trường khác đã đổi (phiếu mượn gia hạn vẫn là phiếu đó).
- **Value object**: không có id, bất biến, hai giá trị cùng nội dung là như nhau (`Money 1000 VND`). Đóng gói luật của chính nó (cộng tiền chỉ khi cùng loại).
- **Aggregate**: một **root** cộng các phần tử con. Bên ngoài chỉ giữ tham chiếu tới root, mọi thay đổi đi qua root, root giữ invariant cho cả cụm.
- **Branded ID** ngăn nhầm `MemberId` với `BookId` ngay ở compile-time dù cùng là chuỗi.
- Tham chiếu giữa các aggregate bằng **ID**, không bằng object lồng nhau.

## Lý thuyết chi tiết

**Branded ID.** `string` thuần khiến hàm `find(memberId, bookId)` nhận sai thứ tự mà compiler im lặng. Brand thêm một thuộc tính "ảo" chỉ tồn tại ở kiểu:

```ts
type BookId = Brand<string, "BookId">;
declare function findLoan(member: MemberId, book: BookId): void;
findLoan("b1" as BookId, "m1" as MemberId);   // Lỗi kiểu: BookId không phải MemberId
```

Brand không tồn tại lúc chạy (`"m1" as MemberId` vẫn chỉ là chuỗi). Chỗ duy nhất được ép kiểu `as` nên là **hàm tạo ID** (có validate), để toàn bộ phần còn lại của code nhận ID đã hợp lệ:

```ts
function toMemberId(raw: string): MemberId {
  if (!/^m-\d+$/.test(raw)) throw new Error("MemberId không hợp lệ");
  return raw as MemberId;
}
```

Với Zod (Bài 9), cùng ý tưởng được viết bằng `.brand<"MemberId">()` trong schema; hãy dùng cách bạn đã học ở đó cho nhất quán.

**Value object bằng class có constructor private.**

```ts
class Money {
  private constructor(readonly minor: number, readonly currency: "VND" | "USD") {}
  static of(minor: number, currency: "VND" | "USD"): Money { /* validate */ }
  add(other: Money): Money { /* cùng loại tiền, trả Money mới */ }
}
new Money(1, "VND");   // Lỗi kiểu: constructor là private (đã thử bằng @ts-expect-error)
```

Hàm `of` là cửa duy nhất, nên không thể tồn tại một `Money` vô nghĩa. Mọi phép toán trả `Money` **mới**, không sửa tại chỗ. Về so sánh: hai `Money` cùng nội dung `toEqual` nhau nhưng `===` là `false` (khác tham chiếu), nên cung cấp phương thức `equals` và dùng nó trong domain; trong test, `toEqual` chấp nhận được vì so sánh theo cấu trúc (đã thử).

Value object cũng có thể là **object literal `readonly` cộng hàm** thay vì class, tuỳ bạn; điều quan trọng là bất biến và có điểm vào duy nhất có kiểm tra.

**Entity và danh tính.**

```ts
type Common = { readonly id: LoanId; readonly bookId: BookId; readonly memberId: MemberId };
type ActiveLoan = Common & { readonly status: "active"; readonly dueDate: Date; readonly renewals: number };
type ReturnedLoan = Common & { readonly status: "returned"; readonly returnedAt: Date };
type Loan = ActiveLoan | ReturnedLoan;
```

Dùng union theo trạng thái (Bài 2), phần chung gom vào một kiểu cơ sở bằng intersection. Trường `readonly` giúp compiler chặn gán trực tiếp:

```ts
loan.renewals = 5;        // Lỗi: renewals là readonly
readonlyArray.push(2);    // Lỗi: mảng readonly không có push
```

`readonly` chỉ có hiệu lực ở compile-time (và **nông**: `readonly items: Item[]` vẫn cho `items.push(...)`; dùng `readonly Item[]`). Nếu cần bảo vệ lúc chạy, có `Object.freeze`, thường không cần ở domain nội bộ.

**Aggregate: root và con.** Ví dụ trừu tượng: một "Giỏ hàng" có nhiều "Dòng". Luật "tổng số dòng không quá 20" và "không trùng sản phẩm" liên quan tới **cả cụm**, nên chỉ root được phép thêm dòng, và root kiểm tra luật:

```ts
type CartLine = { readonly productId: ProductId; readonly qty: number };
type Cart = { readonly id: CartId; readonly lines: readonly CartLine[] };

function addLine(cart: Cart, line: CartLine): Result<Cart, CartError> {
  if (cart.lines.length >= 20) return err({ type: "TOO_MANY_LINES" });
  if (cart.lines.some((l) => l.productId === line.productId)) return err({ type: "DUPLICATE_PRODUCT" });
  return ok({ ...cart, lines: [...cart.lines, line] });
}
```

Không có hàm nào cho phép thêm dòng mà bỏ qua `addLine`. Nếu code ngoài tự sửa `cart.lines`, luật bị phá. Vì vậy: **cửa vào duy nhất**, và các con không có hàm đổi trạng thái tự do ở public.

**Ranh giới aggregate.** Hỏi: "những dữ liệu nào phải **cùng lúc nhất quán** để một luật đúng?" Chúng thuộc cùng aggregate. Luật chỉ cần đúng "sau một lúc" (eventual) thì để aggregate riêng và tham chiếu bằng ID. Aggregate nhỏ thường tốt hơn: ít xung đột khi hai người cùng sửa, dễ nạp/lưu.

Một sai lầm hay gặp là nhồi mọi thứ vào một aggregate to (Customer chứa mọi Order chứa mọi Payment). Hãy tự trả lời cho mô hình của bạn: nếu tải một Order, có thật sự cần cả danh sách mọi đơn của khách?

**So sánh với Eloquent.** `Order hasMany OrderItem`, và code ở đâu cũng có thể `$order->items()->create(...)` bỏ qua mọi luật. Aggregate là cách nói "con chỉ được đổi qua root". Trong Laravel bạn có thể mô phỏng bằng cách chỉ cho phép đổi qua phương thức của model và dùng `$guarded`, nhưng ngôn ngữ không bắt buộc; còn ở đây constructor private và `readonly` bắt buộc.

## Tricks & tips thực tế

- **Entity bằng nhau theo `id`, value object theo nội dung**: viết đúng hàm so sánh cho từng loại. Lý do: so sánh nhầm (so `===` hai `Money`) cho `false` sai và bug khó thấy.
- **Hàm đổi trạng thái trả bản mới** (`{ ...loan, renewals: loan.renewals + 1 }`) và tránh `push`/gán trực tiếp. Lý do: dữ liệu đầu vào không bị sửa ngầm, test dễ ("trước và sau"), và là tiêu chí chấm trong PLAN.
- **Cẩn thận spread khi đổi nhánh union**: `{ ...active, status: "returned" }` mang theo `dueDate`, `renewals` vào bản ghi "returned". Khi chuyển nhánh hãy liệt kê tường minh trường của nhánh đích như hàm `giveBack` trong ví dụ. Spread chỉ dùng khi ở lại trong cùng nhánh.
- **Hàm tạo ID và giá trị là nơi duy nhất dùng `as`**. Mỗi `as` rải rác là một chỗ bỏ qua compiler. Tìm nhanh bằng `grep " as "`.
- **ID sinh ở đâu?** Domain không nên tự gọi `Date.now()`/`randomUUID()` rải rác. Truyền vào (tham số) hoặc dùng một hàm/dịch vụ sinh ID để test cố định được giá trị.
- **Đừng dùng `Date` mutable làm giá trị tin cậy**: `Date` có phương thức `setX` sửa tại chỗ. Khi lưu/giữ, đừng để bên ngoài giữ cùng tham chiếu; sao chép (`new Date(d)`) ở ranh giới nếu cần.
- **Kiểm tra bằng thí nghiệm**: thử `new Money(...)`, thử gán `readonly`, thử truyền `BookId` vào chỗ `MemberId` và xác nhận compiler từ chối; ghi lại thành test dùng `@ts-expect-error` (Bài 11).
- **Đừng lạm dụng brand**: ID thường nên brand; còn mỗi chuỗi đều brand thì code đầy `as` và khó đọc. Brand khi nhầm lẫn có hậu quả thật.

## Liên hệ bài tập

Trong lab, tự phân loại Customer, Product, Order, OrderItem, Payment: cái nào là entity (có id), cái nào là value object (ví dụ tiền, địa chỉ nếu có), cái nào là root của aggregate và con nằm trong đó. Với mỗi lựa chọn viết một câu lý do dựa trên "luật nào phải nhất quán cùng lúc". Chú ý quan hệ Order - OrderItem và Order - Payment: tham chiếu bằng ID hay chứa trực tiếp? Cả hai có thể đúng; bạn cần chọn và bảo vệ được.

## Đọc thêm

- [TypeScript: `readonly` và `ReadonlyArray`](https://www.typescriptlang.org/docs/handbook/2/objects.html#readonly-properties)
- [TypeScript: Classes (constructor private)](https://www.typescriptlang.org/docs/handbook/2/classes.html)

## Ghi chú của bạn
