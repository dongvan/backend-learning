# 3. Invariants, tiền, trạng thái và Result cho lỗi nghiệp vụ

Invariant là điều luôn đúng với một đối tượng hợp lệ. Thiết kế tốt làm cho vi phạm invariant **không thể xảy ra** (bằng kiểu) hoặc **bị từ chối rõ ràng** (bằng Result).

```ts
type LoanError =
  | { readonly type: "MAX_RENEWALS_REACHED"; readonly max: number }
  | { readonly type: "ALREADY_RETURNED" };

function renew(loan: Loan): Result<ActiveLoan, LoanError> {
  if (loan.status === "returned") return err({ type: "ALREADY_RETURNED" });
  if (loan.renewals >= MAX_RENEWALS) return err({ type: "MAX_RENEWALS_REACHED", max: MAX_RENEWALS });
  return ok({ ...loan, dueDate: addDays(loan.dueDate, 7), renewals: loan.renewals + 1 });
}
```

## Ý chính

- Chia invariant thành ba tầng, rẻ đến đắt: **kiểu** (không thể biểu diễn), **hàm tạo/ranh giới** (kiểm tra một lần), **hàm nghiệp vụ** (kiểm tra khi chuyển trạng thái, trả `Result`).
- **Lỗi nghiệp vụ là giá trị** (`Result<T, E>` với `E` là union có tag); **lỗi lập trình / dữ liệu hỏng** mới ném exception.
- **Tiền = số nguyên minor units** (đồng, cent) kèm loại tiền; không dùng `number` thập phân. Luật làm tròn là nghiệp vụ, đặt ở một chỗ.
- **Trạng thái = discriminated union**; chuyển trạng thái là hàm nhận nhánh nguồn trả nhánh đích; exhaustive check ở mọi `switch`.
- **Immutability**: hàm không sửa đầu vào, trả bản mới.

## Lý thuyết chi tiết

**Ba tầng invariant.**

| Tầng | Ví dụ | Chi phí / lợi ích |
|---|---|---|
| Kiểu | `ReturnedLoan` không có `dueDate`; `giveBack` chỉ nhận `ActiveLoan` | Compiler bắt, không tốn runtime |
| Hàm tạo | `Money.of` từ chối số lẻ; `toMemberId` kiểm định dạng | Kiểm một lần ở biên |
| Hàm nghiệp vụ | `renew` từ chối khi hết lượt | Cần vì phụ thuộc trạng thái hiện tại |

Quy tắc: đẩy invariant lên tầng cao nhất có thể. Cái gì bắt được bằng kiểu thì đừng kiểm bằng `if`.

**Tiền.** `0.1 * 3` cho `0.30000000000000004` (số thực nhị phân không biểu diễn chính xác nhiều số thập phân; đã chạy thử). Với tiền:

- Lưu **số nguyên đơn vị nhỏ nhất**: `19_990` đồng, hoặc `1999` cent cho 19,99 USD. Phép cộng/nhân với số nguyên (trong phạm vi `Number.isSafeInteger`) chính xác.
- Kèm **loại tiền**; cộng khác loại là lỗi (ném hoặc Result tuỳ bạn, chọn và nhất quán).
- Chuyển sang chuỗi hiển thị chỉ ở **ranh giới** (hiển thị/API), không trong domain.
- Số tiền rất lớn hoặc cần phần thập phân cao (tiền mã hoá, tỷ giá) thì cân nhắc `bigint` hoặc thư viện (dinero.js, decimal.js...). Với Phase 01, số nguyên + `Number.isSafeInteger` là đủ và không cần thêm dependency; hãy ghi lý do nếu bạn chọn khác.
- **Phép chia/phần trăm** sinh số lẻ: chọn quy tắc làm tròn rõ ràng và **bảo toàn tổng** khi chia (chia 100 cho 3 thành 34 + 33 + 33).

```ts
function split(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}
// split(100, 3) -> [34, 33, 33], tổng luôn bằng 100
```

(Đây là ví dụ minh hoạ nguyên tắc bảo toàn tổng; nó không phải một phần mô hình Order.)

**Trạng thái bằng union.** Đã học ở Bài 2: mỗi nhánh mang đúng dữ liệu. Hàm chuyển trạng thái có chữ ký chính xác (`giveBack(loan: ActiveLoan, at: Date): ReturnedLoan`) nên luật "chỉ phiếu đang mượn mới trả được" nằm ở **kiểu**. Hàm nhận cả `Loan` (như `renew`) thì phải xử lý nhánh không hợp lệ bằng `Result`. Chọn theo câu hỏi: người gọi đã biết trạng thái chưa? Nếu có thì nhận nhánh hẹp; nếu đến từ DB/ngoài thì nhận union và trả Result.

**Result cho lỗi nghiệp vụ (Bài 10).**

```ts
type Ok<T> = { readonly ok: true; readonly value: T };
type Err<E> = { readonly ok: false; readonly error: E };
type Result<T, E> = Ok<T> | Err<E>;
```

Chỗ gọi buộc phải xử lý cả hai nhánh (compiler không cho đọc `.value` khi chưa kiểm `ok`). `E` là union tag nên có thể exhaustive check khi ánh xạ lỗi sang mã HTTP ở tầng ngoài. Phân định:

| Tình huống | Cách xử lý |
|---|---|
| Người dùng làm điều nghiệp vụ không cho phép (hết lượt gia hạn, hết hàng) | `Result` lỗi có tag |
| Dữ liệu đầu vào sai định dạng | Validate ở ranh giới (Zod), trả lỗi validation |
| Vi phạm giả định nội bộ, dữ liệu DB hỏng, bug | `throw` (đừng bắt để nuốt) |

Lý do tách: lỗi nghiệp vụ **dự kiến được** và nên có kiểu để người gọi xử lý; lỗi lập trình nên làm sập to để sửa sớm.

**Immutability trong thực tế.** `readonly` trên trường, `readonly T[]` cho mảng, hàm trả object mới. Sao chép nông là đủ khi các phần con cũng bất biến. Cẩn thận `Date` (mutable) và mảng/object lồng nhau đang `readonly` nông. Test "không mutate đầu vào" bằng `structuredClone` (notes Bài 11).

## Tricks & tips thực tế

- **Liệt kê invariant thành danh sách có số thứ tự** trước khi code, rồi với mỗi cái ghi nó được bảo vệ ở tầng nào. Lý do: thấy ngay cái nào chưa được bảo vệ, và mỗi dòng trở thành một test.
- **Mỗi invariant một test "phải bị từ chối"** cộng một test "đúng ngưỡng thì cho qua". Hai bên của ngưỡng là chỗ bug ẩn.
- **Đặt hằng số luật ở một nơi có tên** (`MAX_RENEWALS`) thay vì số ma thuật (`2`) trong `if`: đổi luật sửa một chỗ, test dùng chính hằng số hoặc giá trị cứng có chủ đích.
- **Đừng đặt thông điệp hiển thị trong domain error**: lỗi mang `type` và dữ liệu (`max: 2`), việc đổi thành câu tiếng Việt/mã HTTP thuộc tầng ngoài. Lý do: cùng một lỗi domain được dùng bởi API, CLI, và test mà không bị ràng buộc ngôn ngữ.
- **Không `catch` rồi nuốt**: nếu bắt exception thì chuyển thành lỗi có kiểu hoặc ném tiếp; `catch (e) {}` biến bug thành dữ liệu sai âm thầm.
- **Đừng dùng `Result` cho mọi thứ**: hàm thuần không thể thất bại (cộng hai `Money` cùng loại) trả thẳng giá trị. Result ở nơi có nhánh lỗi nghiệp vụ thật.
- **Tránh `boolean` cờ cho trạng thái** (`isPaid`, `isCancelled` cùng lúc): tổ hợp vô nghĩa (`isPaid && isCancelled`) lại hợp lệ về kiểu. Dùng union.
- **Tiền: kiểm tra `Number.isSafeInteger` sau mỗi phép nhân** nếu giá trị có thể lớn; vượt `2^53` là mất chính xác mà không báo lỗi. Lý do: JavaScript không tràn số nguyên theo kiểu ném lỗi, nó âm thầm làm tròn.
- **Debug kiểu khi `Result` không narrow**: nếu `r.value` báo lỗi, kiểm `ok` trước (`if (!r.ok) return ...`); nếu vẫn lỗi, kiểm tra `ok` có phải kiểu literal `true`/`false` (đừng để suy luận mở rộng thành `boolean`: khai báo kiểu trả về tường minh `Result<...>` hoặc dùng `as const`).

- **Hàm tạo Result phải có kiểu trả về tường minh**: `const ok = <T>(value: T) => ({ ok: true, value })` cho `ok: boolean`, và chỗ gọi báo `TS2339: Property 'value' does not exist on type '{ ok: boolean; ... } | ...'` (đã chạy; ghi chú 5, mục 1). Lý do: lỗi hiện ra ở chỗ dùng, cách xa chỗ gây ra.
- **Chia tiền theo trọng số phải phân phát phần dư** (ví dụ ở ghi chú 5, mục 8) và quyết định ai nhận phần dư là quy tắc nghiệp vụ. Số âm (hoàn tiền) làm tròn khác số dương với `Math.round` (`-2.5` thành `-2`, `2.5` thành `3`; đã chạy).
- **Nên lưu cả "số lượng" lẫn "đơn giá tại thời điểm" thay vì tham chiếu giá hiện tại của sản phẩm**: giá sản phẩm đổi sau này không được làm đổi tổng của một giao dịch đã chốt. Đây là kiểu bug chỉ lộ khi có dữ liệu cũ, và test nên có ca "giá sản phẩm đổi sau khi đã đặt".
- **Dùng bảng chuyển trạng thái (`as const satisfies Record<Status, readonly Status[]>`, TS 4.9+) cho phần "đồ thị trạng thái"** và hàm cho điều kiện phụ thuộc dữ liệu; chi tiết ở ghi chú 5, mục 5. Lý do: luật nằm ở một chỗ đọc như đặc tả và `tsc` báo thiếu khi thêm trạng thái.
- **Phân biệt "không thể xảy ra" và "chưa nghĩ tới"** trong nhánh `default`/`assertNever`: nếu dữ liệu từ DB có thể mang giá trị lạ (dữ liệu cũ), nhánh đó không phải "không thể", cần xử lý rõ (xem ghi chú 6, mục hydration).

## Liên hệ bài tập

Lab Bài 12: lập danh sách invariant cho Order và Payment (ví dụ về trạng thái hợp lệ, số lượng, tổng tiền, thanh toán khớp đơn), quyết định tầng bảo vệ cho từng cái. Mô hình tiền theo một trong hai hướng (số nguyên minor units hoặc thư viện) và giải thích lựa chọn. Dùng discriminated union cho trạng thái Order và Payment (đã làm ở Bài 2) và Result cho lỗi nghiệp vụ (Bài 10). Mỗi invariant cần ít nhất một test từ chối và một test ở biên.

## Đọc thêm

- [TypeScript: Discriminated unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)
- [MDN: `Number.isSafeInteger`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/isSafeInteger)

## Ghi chú của bạn
