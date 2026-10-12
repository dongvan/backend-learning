# 2. Edge cases, giá trị biên, tiền, hàm ném lỗi và `it.each`

Phần lớn bug nghiệp vụ nằm ở rìa: rỗng, bằng đúng ngưỡng, số lẻ, lỗi. Test phải chủ động đứng ở rìa.

```ts
it.each([
  { name: "đúng giờ hạn",          returned: "2026-01-10T00:00:00Z", expected: 0 },
  { name: "trễ 1 giây tính 1 ngày", returned: "2026-01-10T00:00:01Z", expected: 500 },
  { name: "trễ đúng 1 ngày",        returned: "2026-01-11T00:00:00Z", expected: 500 },
  { name: "trễ 1 ngày + 1 giây",    returned: "2026-01-11T00:00:01Z", expected: 1000 },
])("giá trị biên: $name", ({ returned, expected }) => {
  const loan: Loan = { dueDate: new Date("2026-01-10T00:00:00Z"), returnedAt: new Date(returned) };
  expect(calculateFine(loan, new Date())).toBe(expected);
});
```

## Ý chính

- **Phân tích giá trị biên**: test ngay tại ngưỡng, một bước dưới và một bước trên (`n-1`, `n`, `n+1`).
- **Rỗng, một phần tử, nhiều phần tử** là bộ ba cho mọi thứ nhận danh sách.
- **Không dùng số thực cho tiền**. Dùng số nguyên đơn vị nhỏ nhất; nếu buộc so số thực thì `toBeCloseTo`.
- Hàm ném lỗi: bọc trong arrow function rồi dùng `toThrow`. Kiểm tra cả **loại lỗi** lẫn thông tin quan trọng.
- `it.each` biến bảng dữ liệu thành nhiều test độc lập, báo cáo từng dòng riêng.

## Lý thuyết chi tiết

**Danh sách edge case để tự hỏi** với mỗi hàm:

| Nhóm | Ví dụ |
|---|---|
| Số | `0`, âm, số lẻ, `NaN`, `Infinity`, rất lớn (vượt `Number.MAX_SAFE_INTEGER`) |
| Chuỗi | rỗng, chỉ khoảng trắng, Unicode (tiếng Việt có dấu), rất dài |
| Danh sách | rỗng, 1 phần tử, trùng lặp, đã sắp xếp/ngược |
| Thời gian | đúng ngưỡng, múi giờ, cuối tháng/năm, năm nhuận, `Date` không hợp lệ |
| Trạng thái | mọi cặp (trạng thái, hành động) kể cả cặp không hợp lệ |
| Dữ liệu ngoài | thiếu trường, thừa trường, sai kiểu (Zod ở Bài 9 chặn trước khi vào domain) |

Với kiểu TypeScript chặt, một số edge case đã bị compiler loại (ví dụ `null` khi kiểu không cho). Nhưng kiểu không bảo vệ **giá trị**: `qty: number` vẫn nhận `-5` hay `1.5`. Test (và validation) phải lo phần đó.

**Sai số thập phân.** Số `number` là IEEE 754 nhị phân; nhiều số thập phân không biểu diễn chính xác.

```ts
it("0.1 + 0.2 không bằng 0.3", () => {
  expect(0.1 + 0.2).not.toBe(0.3);
  expect(0.1 + 0.2).toBeCloseTo(0.3);        // mặc định so tới 5 chữ số thập phân
});

it("làm tròn trên số thực dễ sai", () => {
  expect(Math.round(1.005 * 100)).toBe(100);  // người ta kỳ vọng 101; 1.005 * 100 = 100.49999...
});

it("số nguyên minor units thì chính xác", () => {
  expect(10 + 20).toBe(30);                   // 0.10 + 0.20 tính bằng xu
});
```

`toBeCloseTo(x, digits)` kiểm tra `|actual - x| < 10^-digits / 2`. Hữu ích cho phép tính khoa học, nhưng **không phải cách đúng cho tiền**: tiền cần kết quả đúng tuyệt đối. Giải pháp là thiết kế: lưu tiền bằng số nguyên minor units (đồng, cent), chỉ chuyển sang dạng hiển thị ở ranh giới. Test khi đó dùng `toBe` trên số nguyên. Phần thiết kế nằm ở Bài 12.

Quy tắc làm tròn (làm tròn chia hoá đơn, thuế, chiết khấu %) là **nghiệp vụ**; hãy test rõ ràng: tổng các phần chia phải bằng tổng gốc, nửa xu làm tròn theo hướng nào, v.v.

**Test hàm ném lỗi.**

```ts
class InsufficientFundsError extends Error {
  constructor(readonly balance: number, readonly requested: number) {
    super(`Số dư ${balance} không đủ để rút ${requested}`);
    this.name = "InsufficientFundsError";
  }
}

it("ném InsufficientFundsError khi vượt số dư", () => {
  expect(() => withdraw(100, 150)).toThrow(InsufficientFundsError);   // theo class
  expect(() => withdraw(100, 150)).toThrow("không đủ");               // chuỗi con của message
});

it("kiểm tra thuộc tính của lỗi", () => {
  try {
    withdraw(100, 150);
    expect.unreachable("phải ném lỗi");        // nếu không ném thì test fail ngay đây
  } catch (e) {
    expect(e).toBeInstanceOf(InsufficientFundsError);
    expect(e).toMatchObject({ balance: 100, requested: 150 });
  }
});
```

Cạm bẫy: `expect(withdraw(100, 150)).toThrow()` (quên bọc arrow) làm hàm ném **trước khi** `expect` nhận được, test fail với lỗi gốc thay vì kết quả bạn muốn. Bọc `() => withdraw(...)` để Vitest tự bắt. Với async, dùng `rejects` (ghi chú 3).

Nếu domain dùng `Result<T, E>` (Bài 10) thay vì ném lỗi, test đơn giản hơn: lỗi là giá trị, so sánh bằng `toEqual({ ok: false, error: { type: "..." } })`, không cần `try/catch`.

**`it.each`.**

```ts
it.each([
  [0, "Không có sách"],
  [1, "1 cuốn"],
  [5, "5 cuốn"],
])("hiển thị %i -> %s", (count, label) => { /* ... */ });          // dạng mảng, %i %s là printf-style

it.each([{ a: 1, b: 2, sum: 3 }])("cộng $a + $b", ({ a, b, sum }) => { /* ... */ });   // dạng object, $tên
```

Dạng object-array rõ nghĩa hơn khi có từ 3 cột trở lên vì có tên cột (đã chạy thật trên Vitest 5.0.3). Tương đương `@dataProvider` của PHPUnit hay `->with()` của Pest.

## Tricks & tips thực tế

- **Dùng bảng `it.each` cho quy tắc theo ngưỡng** (phí theo bậc, giảm giá theo số lượng): mỗi dòng là một đặc tả, thêm ca mới chỉ thêm một dòng. Lý do: bảng đọc như tài liệu nghiệp vụ, và khi một dòng đỏ, tên dòng cho biết đúng ca nào.
- **Đưa tên vào mỗi dòng (`name`)** và dùng `$name` trong tiêu đề: nếu chỉ có số, khi fail bạn phải đếm dòng.
- **Chuyển lỗi `Date` sang UTC trong test**: dùng chuỗi ISO có `Z` (`"2026-01-10T00:00:00Z"`). Lý do: `new Date("2026-01-10")` và các dạng không có múi giờ phụ thuộc máy chạy, test xanh trên laptop nhưng đỏ trên CI.
- **Với tiền, kiểm tra tính bảo toàn**: ví dụ chia 100 đồng cho 3 người thì tổng các phần vẫn 100. Test tính chất như vậy bắt lỗi làm tròn mà test từng giá trị đơn lẻ bỏ sót.
- **Không dùng `toBeCloseTo` để "cho test xanh"** khi giá trị lệch: nếu tiền lệch 1 đồng là lỗi, đừng nới sai số, hãy sửa thiết kế sang số nguyên.
- **Kiểm tra cả đầu vào bị cấm**: số âm, số lẻ, chuỗi rỗng, để chắc luật chặn hoạt động. Test "đường vui" một mình cho cảm giác an toàn giả.
- **Một lỗi thường gặp với `noUncheckedIndexedAccess`**: `list[0]` có kiểu `T | undefined`, nên trong test phải `expect(list[0]).toEqual(...)` hoặc dùng `list.at(0)`; tránh `list[0]!.x` che mất trường hợp mảng rỗng. Khi cần narrowing một `Result`, viết `expect(r.ok).toBe(true); if (!r.ok) return;`: `expect` cho thông báo lỗi rõ, còn `if` giúp compiler thu hẹp kiểu.
- **Test sinh ngẫu nhiên** (property-based, thư viện fast-check) mạnh cho tính chất như "tổng các phần = tổng gốc", nhưng là phụ thuộc thêm; chưa cần ở Phase 01.

## Liên hệ bài tập

Với mỗi bài 1-10, lập bảng edge case theo các nhóm ở trên rồi chọn những nhóm thực sự áp dụng. Hãy dành riêng một test cho: rỗng, đúng ngưỡng, giá trị bị cấm, và (nếu bài có tiền) tính chính xác của số học. Bài 1 (`calculateOrderTotal`) và Bài 10 (lỗi có kiểu) là hai bài có nhiều ca biên nhất. Tự quyết định ca nào có giá trị; đừng viết cho đủ số lượng.

## Đọc thêm

- [Vitest: `test.each`](https://vitest.dev/api/test.html#test-each)
- [Vitest: `toBeCloseTo`, `toThrow` trong expect API](https://vitest.dev/api/expect.html)

## Ghi chú của bạn
