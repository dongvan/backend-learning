# 5. Cạm bẫy và tình huống thực tế khi mô hình hoá domain

Các lỗi hay gặp khi dựng entity, value object, Result và trạng thái, kèm thông báo compiler cụ thể. Ví dụ dùng miền khác (Voucher, Invoice, Booking, Wallet) để bạn tự áp dụng vào miền của mình. Mọi đoạn code và mã lỗi dưới đây đã được `tsc` (TypeScript 7, `tsconfig.json` của repo) kiểm chứng; một số hành vi runtime đã chạy bằng `tsx`.

```ts
// Hàm tạo Result "tiện tay" làm hỏng toàn bộ narrowing ở chỗ gọi
const ok = <T>(value: T) => ({ ok: true, value });   // ok: boolean, không phải true
```

## Ý chính

- Phần lớn lỗi mô hình hoá là lỗi **thông tin bị mất**: tag thành `boolean`/`string`, brand mất sau khi qua JSON, class bị so sánh bằng tham chiếu.
- Constructor `private` và `readonly` chỉ bảo vệ ở compile-time; ranh giới runtime (JSON, DB, `as`) vẫn phải kiểm tra.
- Mọi quyết định thiết kế nên trả lời được: "luật nào phải đúng **cùng lúc**?" và "ai là cửa vào duy nhất để đổi nó?".
- Tính đúng của tiền nằm ở **thiết kế** (số nguyên, quy tắc làm tròn một chỗ, bảo toàn tổng), không nằm ở việc làm tròn cuối cùng.

## Lý thuyết chi tiết

**1. Hàm tạo `ok()`/`err()` làm mất literal `true`/`false`.**

```ts
const ok = <T>(value: T) => ({ ok: true, value });          // kiểu: { ok: boolean; value: T }
function widened(n: number) {
  return n > 0 ? ok(n) : { ok: false, error: "neg" };
}
const w = widened(1);
w.value;
// TS2339: Property 'value' does not exist on type
//   '{ ok: boolean; value: number; } | { ok: boolean; error: string; }'
```

Nguyên nhân: object literal không có kiểu đích thì `true` bị mở rộng thành `boolean` (Bài 1). `ok` thành `boolean` ở cả hai nhánh nên union không phân biệt được. Sửa: khai báo kiểu trả về tường minh của hàm tạo (`const ok = <T>(value: T): Ok<T> => ({ ok: true, value })`), như ghi chú 3 đã nhắc. Thông báo lỗi ở chỗ **dùng**, không ở chỗ tạo, nên khó truy ngược; khi gặp "Property 'value' does not exist", kiểm tra hàm tạo trước.

**2. Class có constructor private / thành viên private: hai mã lỗi khác nhau.**

```ts
class Voucher {
  private constructor(readonly code: string, private readonly cents: number) {}
  static of(code: string, cents: number) { return new Voucher(code, cents); }
  get value() { return this.cents; }
}

new Voucher("A", 1);
// TS2673: Constructor of class 'Voucher' is private and only accessible within the class declaration.

const fake: Voucher = { code: "A", value: 1 };
// TS2741: Property 'cents' is missing in type '{ code: string; value: number; }' but required in type 'Voucher'.
```

Điểm thú vị: lớp có thành viên `private` (hoặc `#private`) trở nên **gần như nominal**: object literal có cùng "hình dạng" công khai vẫn không gán được, vì thiếu thành viên private (đã thử với cả `#c`: TS2741 "Property '#c' is missing"). Đây là cách duy nhất trong TypeScript để chặn người khác tự dựng một giá trị giả mạo bằng literal mà không cần brand. Nhưng chỉ ở compile-time: `JSON.parse(...) as Voucher` hay `Object.create(Voucher.prototype)` vẫn lọt qua. Với `private` (từ khoá TS) giá trị vẫn đọc được lúc chạy bằng `v["cents"]`; `#private` (ES2022) thì thật sự riêng tư lúc chạy.

**3. Brand: các ngả mất thông tin (đã kiểm chứng).**

```ts
type Brand<T, B extends string> = T & { readonly __brand: B };
type BookingId = Brand<string, "BookingId">;
type GuestId = Brand<string, "GuestId">;
declare const b: BookingId;

const g: GuestId = b;
// TS2322: Type 'BookingId' is not assignable to type 'GuestId'.
//   Types of property '__brand' are incompatible.
//     Type '"BookingId"' is not assignable to type '"GuestId"'.

const up = b.toUpperCase();      // up: string, brand đã mất
const back: BookingId = up;      // TS2322: Type 'string' is not assignable to type 'BookingId'.
```

Ba chỗ brand rơi mất: (a) mọi phương thức chuỗi (`toUpperCase`, `slice`, template literal) trả `string` thường; (b) `JSON.parse(...) as { id: BookingId }` chỉ là lời hứa, không có kiểm tra gì lúc chạy; (c) `42 as unknown as BookingId` qua mặt hoàn toàn. Quy tắc: brand được **tạo** ở hàm tạo có kiểm tra (hoặc `z.string().brand<"BookingId">()` của Zod, đã thử: `parse` trả kiểu có brand), được **truyền** nguyên vẹn, và **không** biến đổi bằng phép toán chuỗi (nếu cần, tạo lại qua hàm tạo). Khi serialise ra JSON brand biến mất, nên khi đọc vào lại phải qua hàm tạo/schema, không `as`.

**4. Value object trong `Map`/`Set`: khoá là tham chiếu.**

```ts
const m = new Map<{ readonly minor: number }, string>();
m.set({ minor: 1 }, "a");
m.get({ minor: 1 });          // undefined: hai object literal khác tham chiếu
```

`Map` và `Set` so khoá bằng `SameValueZero` (tham chiếu với object). Hệ quả: `Set<Money>` không loại trùng, `Map<Money, ...>` không tra cứu được. Dùng khoá nguyên thuỷ (`${currency}:${minor}`, hoặc `id` đã brand cho entity), hoặc cung cấp `equals`. Entity thì tự nhiên có khoá là `id`, nên `Map<InvoiceId, Invoice>` chạy tốt (như repo in-memory ở ghi chú 4).

**5. Bảng chuyển trạng thái bằng dữ liệu, kiểm tra đầy đủ bằng `satisfies` (TS 4.9+).**

```ts
type Status = "draft" | "issued" | "paid" | "void";

const transitions = {
  draft: ["issued", "void"],
  issued: ["paid", "void"],
  paid: [],
  void: [],
} as const satisfies Record<Status, readonly Status[]>;

type Next<S extends Status> = (typeof transitions)[S][number];
const a: Next<"issued"> = "paid";     // OK
const b: Next<"issued"> = "draft";    // TS2322: Type '"draft"' is not assignable to type '"paid" | "void"'.
```

Thiếu một khoá (ví dụ bỏ `void`) làm `satisfies Record<Status, ...>` báo **TS2741**: "Property 'void' is missing in type ... but required in type 'Record<Status, readonly Status[]>'" (đã chạy). Không có chỗ nào bạn phải nhớ thêm: thêm trạng thái vào `Status` là `tsc` chỉ ra bảng nào thiếu dòng. Ưu điểm so với `switch`: luật chuyển trạng thái nằm ở **một bảng** đọc như đặc tả, thêm trạng thái mới buộc bổ sung dòng, và kiểu `Next<S>` được suy ra từ chính dữ liệu. Nhược điểm: bảng chỉ cho biết **được phép hay không**; điều kiện phụ thuộc dữ liệu (đủ tiền, còn hạn) vẫn phải là hàm. Dùng bảng cho phần "đồ thị trạng thái", hàm cho phần điều kiện.

**6. Ánh xạ lỗi domain sang mã HTTP bằng `Record` thay vì `switch`.**

```ts
type InvoiceError = { type: "NOT_FOUND" } | { type: "ALREADY_PAID" };
const httpStatus: Record<InvoiceError["type"], number> = { NOT_FOUND: 404, ALREADY_PAID: 409 };
```

Thêm một lỗi mới vào union mà quên thêm dòng thì `tsc` báo thiếu khoá. Bảng này thuộc tầng ngoài (controller), không đặt vào domain (ghi chú 3).

**7. `Date` trong value object (đã chạy).**

```ts
class DateRange {
  private constructor(readonly start: Date, readonly end: Date) {}
  static of(start: Date, end: Date): Result<DateRange, { type: "INVALID_RANGE" }> {
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end)
      return err({ type: "INVALID_RANGE" });
    return ok(new DateRange(new Date(start), new Date(end)));   // sao chép phòng bên ngoài sửa Date gốc
  }
  overlaps(o: DateRange): boolean { return this.start < o.end && o.start < this.end; }
}
```

Điểm cần nhớ: khoảng **nửa mở** `[start, end)` làm hai khoảng liền kề (`01-05` và `05-08`) **không** chồng nhau (đã chạy: `false`), đúng với nghiệp vụ đặt phòng (khách này trả phòng đúng lúc khách kia nhận). Nếu bạn dùng `<=` thì chúng chồng nhau và hệ thống từ chối đặt liền kề. `Date` không hợp lệ (`NaN`) khiến mọi so sánh trả `false`, nên `start >= end` **không** bắt được; phải kiểm `getTime()` riêng. `readonly start: Date` chỉ chặn gán lại thuộc tính, không chặn `start.setDate(...)` sửa chính đối tượng `Date`, nên hàm tạo sao chép bằng `new Date(...)`.

**8. Tiền: bảo toàn tổng theo trọng số, và làm tròn số âm (đã chạy).**

```ts
function allocate(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((w) => Math.floor((total * w) / sum));
  let rest = total - shares.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0; i = (i + 1) % shares.length, rest--) shares[i] = (shares[i] ?? 0) + 1;
  return shares;
}
// allocate(100, [1, 1, 1]) -> [34, 33, 33];  allocate(5, [70, 30]) -> [4, 1];  tổng luôn bằng total
```

Đây là minh hoạ nguyên tắc "phần dư phải được phân phát đâu đó"; nó giả định `total >= 0` và `weights` không rỗng, tổng trọng số khác 0. Một triển khai thật phải trả lời: ai nhận phần dư (người đầu, người có trọng số lớn nhất, hay quy tắc riêng)? Số âm (hoàn tiền) làm tròn thế nào? Chú ý `Math.round(-2.5)` là `-2` còn `Math.round(2.5)` là `3`, nên hoàn tiền một nửa đồng sẽ lệch nếu bạn dùng `Math.round` mà không có quy tắc. Đây là quyết định nghiệp vụ, hãy ghi lại và có test.

**9. Mất chính xác ở số lớn.** `Number.MAX_SAFE_INTEGER * 2` là một số hợp lệ về kiểu nhưng `Number.isSafeInteger(...)` là `false`, và ở vùng đó `x + 1 === x + 2` có thể đúng (đã chạy). Với hệ thống tiền thật: kiểm tra sau **mỗi** phép nhân (đơn giá nhân số lượng nhân thuế), hoặc dùng `bigint` cho tiền (lưu ý `bigint` không đi cùng `number` trong phép toán, không `JSON.stringify` trực tiếp, và Zod/DB driver cần xử lý riêng).

## Tricks & tips thực tế

- **Tìm "lỗ" trong aggregate bằng cách hỏi "có cách nào tạo/đổi mà bỏ qua luật không?"**: liệt kê mọi nơi gọi `as`, constructor public, trường không `readonly`, hàm trả về mảng nội bộ (người gọi `push` được). Lý do: một lỗ là đủ để invariant không còn đáng tin.
- **Trả mảng nội bộ dưới dạng `readonly T[]`** hoặc sao chép: `readonly` chỉ ngăn ở compile-time; khi giá trị này đi qua `any`/JSON, ai đó vẫn có thể sửa. Với dữ liệu rủi ro cao, `Object.freeze` ở biên là lớp bảo vệ runtime (chi phí nhỏ).
- **Không chia sẻ aggregate giữa các request/test qua biến module**: nếu một singleton giữ bản mutable, hai luồng xử lý có thể nhìn thấy nhau.
- **Ưu tiên tham chiếu bằng ID giữa aggregate** và nạp từng aggregate qua repo: đặt `Guest` bên trong `Booking` buộc mọi lần tải đặt phòng kéo theo cả khách, và hai aggregate dễ vướng nhau khi lưu.
- **Đặt tên lỗi theo luật nghiệp vụ, không theo trường**: `OVERLAPPING_BOOKING` thay vì `INVALID_DATE_RANGE`. Lý do: tầng ngoài ánh xạ lỗi sang thông điệp/HTTP code theo nghĩa nghiệp vụ.
- **Mỗi lần thêm trạng thái mới, chạy `npm run type-check` trước khi sửa gì**: số lỗi là danh sách các chỗ phải suy nghĩ (xem ghi chú 5 Bài 2).
- **So với Laravel**: Eloquent `$casts` và Castable object gần với value object; Observer/Event là nơi tác dụng phụ thường nằm. Khác biệt: ở TypeScript thuần, ràng buộc `private constructor` + `readonly` là thật (compile-time), còn cast Eloquent chỉ chạy lúc đọc/ghi thuộc tính.

## Tình huống mở để tự suy nghĩ

1. Một `Wallet` có `balance` và danh sách giao dịch. "Số dư không âm" là invariant của `Wallet` hay của hàm `withdraw`? Nếu hai người cùng rút lúc `balance = 100`, mỗi người rút 80, kiểu có giúp gì không? (Gợi ý: đọc ghi chú 6 về khoá lạc quan.)
2. `Booking` tham chiếu `GuestId` hay chứa `Guest`? Bạn cần thông tin nào của khách để tính luật "tối đa 4 người một phòng"? Dữ liệu đó có cần nhất quán **cùng lúc** với booking không?
3. Hai `Money` cùng nội dung nằm trong một `Set`. Bạn cần "loại trùng" thật sự. Có ít nhất ba cách làm; nêu ưu và nhược mỗi cách.
4. Bạn thêm trạng thái `refunded` cho `Invoice`. Liệt kê (bằng cách chạy `tsc`) mọi chỗ phải sửa, rồi phân loại: chỗ nào là luật nghiệp vụ, chỗ nào chỉ là ánh xạ hiển thị.
5. Hàm `refund(invoice, amount)` nhận `Invoice` (union) hay `PaidInvoice`? Người gọi lấy dữ liệu từ DB thì chuyện gì xảy ra ở ranh giới? Quyết định này dẫn đến chữ ký nào cho tầng ứng dụng?

## Liên hệ bài tập

Khi tự dựng Customer, Product, Order, OrderItem, Payment: lần lượt dùng danh sách trên soát mô hình của bạn: hàm tạo Result có bị widen không; ID nào cần brand và hàm tạo ở đâu; value object nào bị đưa vào `Map`/`Set`; bảng chuyển trạng thái hay hàm; mọi chỗ làm tròn tiền được phân định rõ chưa. Các câu hỏi "tình huống mở" là để bạn tự trả lời cho miền Order của mình, không có đáp án sẵn trong notes.

## Đọc thêm

- [TypeScript: `satisfies` operator (release notes 4.9)](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html)
- [TypeScript Handbook: Classes (member visibility, `#private`)](https://www.typescriptlang.org/docs/handbook/2/classes.html)
- [MDN: `Map` (key equality)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map)
- [Zod: `.brand()`](https://zod.dev/api)

## Ghi chú của bạn

