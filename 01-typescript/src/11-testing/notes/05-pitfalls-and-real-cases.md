# 5. Cạm bẫy và tình huống thực tế khi viết test

Những cái bẫy khiến test "xanh giả", "đỏ ngẫu nhiên" hoặc khó bảo trì, kèm cách nhận ra và cách sửa. Các hành vi nêu "đã kiểm chứng" được chạy thật trên Vitest 5.0.3, TypeScript 7 với `tsconfig.json` của repo.

```ts
// Test này xanh nhưng không chứng minh được gì: ai đảm bảo nó từng đỏ?
it("tính phí", () => {
  const fee = calculateFee(100);
  expect(fee).toBe(calculateFee(100));
});
```

## Ý chính

- Một test chỉ có giá trị nếu **có cách làm nó đỏ**. Mọi cạm bẫy dưới đây đều quy về: test không thể đỏ (xanh giả), hoặc đỏ vì lý do không liên quan hành vi (flaky, gắn cài đặt).
- Chọn matcher đủ chặt cho điều bạn muốn khẳng định: `toEqual` bỏ qua vài khác biệt mà `toStrictEqual` bắt.
- Mọi trạng thái dùng chung giữa các test (object mặc định, mock, timer, biến môi trường) phải được dựng mới hoặc khôi phục.
- Thời gian, thứ tự và ngẫu nhiên là ba nguồn flaky chính; cả ba nên được đưa vào như tham số.

## Lý thuyết chi tiết

**1. `toEqual` tha thứ nhiều hơn bạn nghĩ (đã kiểm chứng).**

```ts
class Money { constructor(readonly minor: number) {} }

expect({ a: 1, b: undefined }).toEqual({ a: 1 });          // PASS: bỏ qua thuộc tính undefined
expect(new Money(1)).toEqual({ minor: 1 });                 // PASS: không phân biệt class
expect(0).not.toBe(-0);                                     // toBe dùng Object.is nên phân biệt +0 và -0
expect(0).not.toEqual(-0);                                  // toEqual cũng phân biệt
expect(NaN).toBe(NaN);                                      // PASS: Object.is(NaN, NaN) là true
```

`toStrictEqual({ a: 1 })` thì **fail** với `{ a: 1, b: undefined }` và với instance của `Money` so với object literal. Khi nào cần chặt: test của hàm trả DTO để gửi ra JSON (thuộc tính `undefined` có thể biến mất hay không đều quan trọng), hoặc test khẳng định "đây là value object chứ không phải object trần". Khi nào `toEqual` là đủ: so sánh dữ liệu thuần, nơi bạn không quan tâm lớp.

Cạm bẫy riêng với `Error`: trong Vitest 5.0.3, `expect(new A("x")).toEqual(new B("x"))` với `A`, `B` là hai lớp lỗi khác nhau nhưng cùng message **vẫn pass** (đã chạy), còn khác message thì fail. Nghĩa là `toEqual` trên lỗi chủ yếu so message. Muốn kiểm tra loại lỗi, dùng `toBeInstanceOf(A)` hoặc `toThrow(A)`.

**2. Thứ tự và kiểu tập hợp.**

- `[10, 9, 1].sort()` ra `[1, 10, 9]` vì `sort()` mặc định so sánh **chuỗi**. Test `expect(sorted).toEqual([1, 9, 10])` sẽ bắt được nếu code chính quên comparator `(a, b) => a - b`; nhưng nếu *test* tự sort để so sánh thì sai theo cùng cách và xanh giả.
- `toEqual` trên mảng nhạy thứ tự. Nếu thứ tự không phải nghiệp vụ (kết quả từ DB không có `ORDER BY`), đừng khẳng định thứ tự: dùng `expect.arrayContaining([...])` kèm kiểm `toHaveLength`, hoặc sắp xếp cả hai phía theo khoá có chủ đích.
- `Set` và `Map` được so sánh theo nội dung và **không** theo thứ tự chèn (`new Set([1, 2])` bằng `new Set([2, 1])`, đã thử). Nhưng `set.has(new Money(1))` là `false` vì `Set` so sánh phần tử bằng tham chiếu; ví dụ trực tiếp cho lý do value object cần phương thức `equals` hoặc khoá chuỗi.

**3. Asymmetric matchers cho phần không xác định.** Khi kết quả chứa id sinh ngẫu nhiên hoặc thời điểm hiện tại:

```ts
expect(created).toEqual({
  id: expect.any(String),
  createdAt: expect.any(Date),
  tags: expect.arrayContaining(["vip"]),
  total: 1500,
});
```

Đã chạy được. Lý do dùng: ghi nhận phần *ổn định* của hợp đồng mà không buộc phải cố định giá trị ngẫu nhiên. Nhưng nếu bạn có thể truyền id và thời gian vào như tham số (khuyên dùng cho domain), hãy làm vậy thay vì `expect.any`, vì giá trị cứng chặt hơn.

**4. Trạng thái dùng chung rò giữa các test (đã kiểm chứng).**

```ts
const base = { qty: 1, tags: [] as string[] };                 // dùng chung
const make = (o: Partial<typeof base> = {}) => ({ ...base, ...o });

it("a", () => { make().tags.push("x"); });
it("b", () => { expect(make().tags).toEqual(["x"]); });        // PASS: tags rò từ test a
```

Spread chỉ sao chép **nông**: mảng `tags` vẫn là cùng tham chiếu. Test b xanh vì bị nhiễm test a; khi chạy riêng (`-t "b"`) nó đỏ, và bạn mất cả buổi để hiểu. Cách sửa: hàm dựng tạo mảng/object lồng nhau mới mỗi lần gọi (`tags: []` nằm *trong* hàm), hoặc `structuredClone(base)`.

**5. `mockClear`, `mockReset`, `mockRestore` (đã kiểm chứng trên 5.0.3).**

| Gọi | Xoá lịch sử gọi | Xoá implementation đã gán | Trả về implementation gốc |
|---|---|---|---|
| `mockClear()` | có | không | không |
| `mockReset()` | có | có | `vi.fn(impl)` quay về `impl` ban đầu (thử: `vi.fn(() => 5)` sau `mockReset()` vẫn trả `5`) |
| `mockRestore()` trên spy | có | có | khôi phục hàm gốc của object (thử: `o.m()` trở lại `1`) |

Ngoài ra, `vi.restoreAllMocks()` chỉ khôi phục các spy từ `vi.spyOn`; `vi.fn(() => 5)` vẫn trả `5` sau lời gọi đó (đã thử). Bản Vitest cũ hơn hành xử khác, nên nếu tài liệu/StackOverflow cũ nói ngược lại, hãy tin vào phiên bản đã cài. Muốn tự động hoá, cấu hình `mockReset`/`restoreMocks`/`clearMocks` ở `vitest.config`: nhưng repo hiện chưa có file cấu hình, nên cứ gọi tường minh trong `afterEach`.

**6. Fake timers và async: bẫy treo (đã kiểm chứng).**

```ts
it("treo", { timeout: 300 }, async () => {
  vi.useFakeTimers();
  await new Promise((r) => setTimeout(r, 1000));   // không ai tiến thời gian
});
// Error: Test timed out in 300ms.
```

Khi bật fake timers mà `await` một timer, phải có ai đó `advanceTimersByTime` trước khi `await`, hoặc dùng bản async:

```ts
const p = doWithRetry();                           // chưa await, đã đặt timer
await vi.advanceTimersByTimeAsync(5_000);          // cho cả microtask chạy xen kẽ
await expect(p).resolves.toBe("ok");
```

Với promise bị từ chối: tạo assertion (`const a = expect(p).rejects.toThrow("late")`) **trước** khi tiến thời gian, rồi `await a` sau. Nếu để promise reject mà chưa ai gắn handler, Node báo unhandled rejection (đã thử: kết quả là lỗi "Unhandled Rejection" làm cả lần chạy báo lỗi). `vi.setSystemTime` + `advanceTimersByTime(1000)` làm `Date.now()` tăng đúng 1000 (đã thử).

**7. Hàm async dùng với `toThrow` (đã kiểm chứng).**

`expect(async () => { throw new Error("x"); }).not.toThrow()` **không** fail ở dòng đó: hàm async không ném đồng bộ, nó trả promise reject. Vitest 5.0.3 kết thúc bằng "Unhandled Rejection" cho cả lần chạy. Đúng là `await expect(async () => {...}).rejects.toThrow("x")` (đã thử: pass). Tóm lại: đồng bộ thì `expect(() => f()).toThrow()`, bất đồng bộ thì `await expect(f()).rejects...`.

**8. `expect.assertions` và `expect.hasAssertions` cho `catch`/callback.**

```ts
it("ném lỗi có thuộc tính", () => {
  expect.assertions(1);
  try { withdraw(100, 150); } catch (e) { expect(e).toMatchObject({ requested: 150 }); }
});
```

Nếu `withdraw` ngừng ném lỗi, khối `catch` không chạy và test **xanh vì không có assertion nào sai**. `expect.assertions(1)` biến điều đó thành lỗi (thông báo thật: `expected number of assertions to be 2, but got 1`); `expect.hasAssertions()` báo `expected any number of assertion, but got none` khi không có `expect` nào chạy (cả hai đã thử). Ở ghi chú 2 đã có cách `expect.unreachable`; chọn một trong hai cho nhất quán, nhưng với callback/subscriber (nơi `try/catch` không áp dụng) thì `expect.assertions` là công cụ chính.

**9. `skip`, `todo`, `fails`, `only`.**

- `it.todo("hạn mức tháng")` ghi danh một hành vi chưa có test: hiện trong báo cáo, không fail. Hữu ích để liệt kê edge case trước khi viết.
- `it.skip` ẩn một test hỏng: chỉ nên là tạm thời, kèm lý do và ngày/việc cần làm, vì CI vẫn xanh.
- `it.fails("...", fn)` đảo kết quả: test **phải** fail. Dùng để ghi một bug đã biết (đỏ khi bug được sửa, nhắc bạn bỏ `.fails`). Đã thử: `it.fails` với `expect(1).toBe(2)` được tính là pass.
- `it.only` và `it.skip` đều làm test khác không chạy mà vẫn xanh. Thêm bước `grep -rnE "\.(only|skip)\(" src` vào checklist nộp bài.

**10. Type test cũng có cạm bẫy (đã kiểm chứng với `expectTypeOf`).**

- `toEqualTypeOf` **chặt hơn bạn nghĩ**: `{ a: 1 } & { b: 2 }` **không** "giống hệt" `{ a: 1; b: 2 }` (tsc báo "Expected 1 arguments, but got 0" ở lời gọi), dù hai bên `toExtend` nhau. Nếu kiểu bạn đang kiểm tra là kết quả của intersection, dùng cặp `toExtend` hai chiều hoặc `Simplify`/mapped type để làm phẳng trước.
- `{ a: 1 }` và `{ readonly a: 1 }` **không** `toEqualTypeOf` nhau, nhưng `toExtend` thì pass. Muốn chứng minh "trường là readonly" thì phải dùng `toEqualTypeOf` hoặc `@ts-expect-error` trên phép gán.
- Quên rằng type test chỉ đỏ ở `tsc` (ghi chú 4): sau khi sửa kiểu, `npm test` vẫn xanh. Đừng báo "đã kiểm chứng" khi chưa chạy `npm run type-check`.

**11. Múi giờ và thời gian thật (đã kiểm chứng với `TZ=America/New_York`).** `new Date("2026-03-01")` (chỉ ngày) được hiểu là UTC, ra `...T00:00:00.000Z`; còn `new Date("2026-03-01T00:00:00")` (có giờ, không `Z`) được hiểu theo giờ địa phương, ra `05:00:00.000Z` ở New York. Hai dạng gần như giống hệt nhau nhưng khác nghĩa theo máy chạy. Quy ước: trong test luôn viết ISO có `Z`.

## Tricks & tips thực tế

- **Làm hỏng có chủ đích rồi mới tin test**: đảo `>=` thành `>`, đổi hằng số, xoá một nhánh; test phải đỏ. Lý do: một test chưa từng đỏ có thể không kiểm tra gì (ví dụ so kết quả hàm với chính nó như ví dụ mở đầu).
- **Mỗi bug thật = một test hồi quy** đặt tên theo triệu chứng ("không tính phí khi trả sách đúng ngày hạn cuối") và để cạnh test nghiệp vụ. Lý do: bug đã xảy ra một lần thì có xác suất cao xảy ra lại khi refactor.
- **Tránh kỳ vọng tính bằng chính công thức của code**: `expect(total).toBe(price * qty * 1.1)` lặp lại luật. Hãy ghi số cụ thể (`1100`) và đủ ca để công thức khác nhau cho kết quả khác nhau.
- **Đừng khẳng định quá nhiều trong một test**: `toEqual` cả object 20 trường khiến mỗi lần thêm trường là sửa hàng chục test. Dùng `toMatchObject` hoặc `expect.objectContaining` cho phần liên quan tới hành vi đang test.
- **Snapshot (`toMatchSnapshot`) không thay cho assertion có ý nghĩa**: nó ghi lại "đang là gì", không phải "phải là gì", và người ta thường chỉ bấm cập nhật khi đỏ. Với domain logic, ưu tiên giá trị kỳ vọng cứng. (Vitest hỗ trợ snapshot; repo chưa dùng, chưa kiểm chứng trong repo này.)
- **Đặt tên theo hành vi, nhóm theo tình huống**: `describe("khi phiếu đã trả", () => { it("không cho gia hạn") })`. Lý do: báo cáo CI đọc như đặc tả và dễ thấy tình huống nào thiếu.
- **Khi test đỏ trên CI mà xanh trên máy bạn**, kiểm tra theo thứ tự: múi giờ/locale, thứ tự chạy (chạy `-t` một test riêng), trạng thái dùng chung, phiên bản Node, dữ liệu phụ thuộc ngày hiện tại. Lý do: đây là các nguồn khác biệt giữa hai môi trường hay gặp nhất (đừng coi là thống kê chính xác).
- **Không sleep thật, không phụ thuộc đồng hồ thật, không phụ thuộc thứ tự**: ba điều làm test không tái lập được.
- **So với PHPUnit/Pest**: `@depends` (test phụ thuộc kết quả test trước) không có tương đương tự nhiên trong Vitest và cũng không nên có; mỗi test tự dựng dữ liệu. `markTestSkipped`/`markTestIncomplete` tương ứng `it.skip`/`it.todo`.

## Tình huống mở để tự suy nghĩ

1. Hàm `applyDiscount(total, percent)` nhận `percent` từ người dùng. Liệt kê ít nhất 6 đầu vào bạn sẽ test (gợi ý nhóm: biên 0 và 100, âm, vượt 100, số lẻ, `NaN`). Với mỗi đầu vào, hàm nên trả gì hay ném gì, và quyết định đó ở tầng nào?
2. Bạn có hàm gửi thông báo, thử lại 3 lần cách nhau 1s, 2s, 4s. Bạn sẽ test "thành công ở lần thứ 3" thế nào mà không chờ 3 giây thật? Phần nào dùng fake timers, phần nào nên đưa vào như tham số?
3. Một test đang xanh nhưng bạn nghi ngờ nó không kiểm tra gì. Liệt kê 3 cách khác nhau để xác nhận.
4. Khi nào `toEqual` là đủ, khi nào cần `toStrictEqual`? Tìm một ví dụ trong code Bài 1-10 của chính bạn mà hai matcher cho kết quả khác nhau (nếu không có, giải thích vì sao).
5. Test kiểm tra một lỗi nghiệp vụ trả bằng `Result`: bạn so sánh cả object lỗi hay chỉ `type`? Điều gì xảy ra với test khi sau này thêm một trường vào lỗi?

## Liên hệ bài tập

Lab Bài 11 (bổ sung test cho Bài 1-10): dùng các mục trên như danh sách soát. Với mỗi file test của bạn, tự hỏi: có test nào dùng `toEqual` nơi cần `toStrictEqual` (hoặc ngược lại) không; có đối tượng mặc định dùng chung giữa các test không; mock nào chưa được khôi phục; có `await` bị thiếu không; có chỗ nào phụ thuộc đồng hồ hay múi giờ không. Làm hỏng code có chủ đích ít nhất một lần cho mỗi bài và ghi lại test nào đỏ vào "Ghi chú của bạn".

## Đọc thêm

- [Vitest: `expect` API (toEqual, toStrictEqual, assertions)](https://vitest.dev/api/expect.html)
- [Vitest: `vi` API (mockReset, restoreAllMocks, fake timers)](https://vitest.dev/api/vi.html)
- [Vitest: Mock functions](https://vitest.dev/api/mock.html)
- [MDN: `Date` (date-time string format)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date#date_time_string_format)

## Ghi chú của bạn

