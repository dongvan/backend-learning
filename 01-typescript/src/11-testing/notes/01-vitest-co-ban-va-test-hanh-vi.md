# 1. Vitest cơ bản và nguyên tắc test hành vi

Test tốt trả lời câu hỏi "với đầu vào này, hệ thống phải cho kết quả gì?", không phải "hàm bên trong gọi những gì?".

```ts
import { describe, it, expect } from "vitest";
import { calculateFine, type Loan } from "./fine";   // ví dụ miền thư viện

describe("calculateFine", () => {
  it("trả 0 khi trả sách đúng hạn", () => {
    // Arrange
    const loan: Loan = {
      dueDate: new Date("2026-01-10T00:00:00Z"),
      returnedAt: new Date("2026-01-09T10:00:00Z"),
    };
    // Act
    const fine = calculateFine(loan, new Date("2026-02-01T00:00:00Z"));
    // Assert
    expect(fine).toBe(0);
  });
});
```

## Ý chính

- `describe` gom nhóm theo đơn vị đang test, `it` (hoặc `test`, là bí danh) mô tả **một hành vi**, `expect(...)` + matcher là phép khẳng định.
- Cấu trúc **AAA**: Arrange (dựng dữ liệu), Act (gọi đúng một lần), Assert (khẳng định). Một test chỉ nên có một Act.
- Test **hành vi quan sát được** (đầu vào, đầu ra, lỗi ném ra, tác dụng phụ qua ranh giới), không test chi tiết cài đặt (hàm private, thứ tự gọi nội bộ).
- Tên test là một câu mô tả nghiệp vụ. Khi test đỏ, đọc tên là hiểu hỏng cái gì.
- Test business logic thuần không cần DB, mạng, đồng hồ thật. Đó là lợi ích trực tiếp của việc tách domain khỏi hạ tầng.

## Lý thuyết chi tiết

**Vitest chạy thế nào.** `vitest run` tìm file `*.test.ts` / `*.spec.ts`, biên dịch từng file bằng bộ transform của Vite (chỉ gỡ kiểu, không phân tích kiểu), rồi chạy trong worker riêng. Quan trọng: bước này **xoá kiểu, không kiểm tra kiểu**. Test pass trong Vitest không có nghĩa `tsc` sạch. Vì vậy repo có cả `npm test` và `npm run type-check`, và cả hai đều phải xanh (xem ghi chú 4). Phiên bản đã cài trong repo: Vitest 5.x.

**Phạm vi cô lập (đã kiểm chứng trên 5.0.3).**

- Vitest mặc định **không** bật global: `it`/`expect` không import thì lỗi `ReferenceError: it is not defined` và cả suite fail. Luôn `import { describe, it, expect } from "vitest"`.
- Module-level state **được chia sẻ giữa các test trong cùng một file** (test 1 tăng `state.n` thì test 2 thấy), nhưng **mỗi file test chạy trong môi trường module riêng**, nên hai file không thấy state của nhau. Hệ quả: biến toàn cục/singleton trong code chính (bộ đếm id, cache) làm các test cùng file ảnh hưởng nhau; domain thuần không có state toàn cục thì không gặp vấn đề này. Trong Laravel, mỗi request/test khởi động lại app container nên ít gặp; ở Node, module cache sống suốt cả file test.

**Matcher hay dùng.**

| Matcher | Dùng khi |
|---|---|
| `toBe(x)` | So sánh `Object.is`: số, chuỗi, boolean, cùng tham chiếu |
| `toEqual(x)` | So sánh sâu theo giá trị (object, mảng). Bỏ qua thuộc tính `undefined` |
| `toStrictEqual(x)` | Như `toEqual` nhưng phân biệt `undefined`, kiểu class, mảng thưa |
| `toMatchObject({...})` | Chỉ kiểm tra tập con thuộc tính |
| `toBeCloseTo(x, digits?)` | Số thực, có sai số |
| `toThrow(...)` | Hàm ném lỗi (ghi chú 2) |
| `toContain`, `toHaveLength` | Mảng, chuỗi |
| `toBeNull`, `toBeUndefined`, `toBeDefined` | Kiểm tra rỗng |

Cạm bẫy kinh điển: `expect(a).toBe(b)` với hai object giống nội dung nhưng khác tham chiếu sẽ **fail**; dùng `toEqual`. Ngược lại, dùng `toEqual` để kiểm tra "không mutate" là đúng chủ đích (so với bản chụp), còn dùng `toBe` để khẳng định "trả về chính object đó".

**Hành vi hay cài đặt?** So sánh hai test cho cùng một hàm:

```ts
// Gắn với cài đặt: hỏng khi refactor dù kết quả vẫn đúng
expect(spyOnHelper).toHaveBeenCalledTimes(3);

// Gắn với hành vi: chỉ hỏng khi nghiệp vụ sai
expect(calculateFine(loan, now)).toBe(1500);
```

Test gắn cài đặt làm refactor đắt: bạn đổi cách làm mà đầu ra giữ nguyên, test vẫn đỏ. Dấu hiệu nhận biết: test import hàm private, phải mock gần hết các phụ thuộc, hoặc chứa gần như bản sao của code chính.

**Chọn cái gì để test.** Ưu tiên theo rủi ro nghiệp vụ: tính tiền, quy tắc chuyển trạng thái, phân quyền, ràng buộc (invariant). Getter đơn giản, code chỉ chuyển tiếp lời gọi thì ít giá trị.

**So sánh với PHPUnit / Pest.**

| PHPUnit/Pest | Vitest |
|---|---|
| `class FooTest extends TestCase`, `public function test_x()` | `describe` / `it` là hàm, không cần class |
| `$this->assertSame($a, $b)` | `expect(b).toBe(a)` (chú ý thứ tự: giá trị thực nằm trong `expect`) |
| `assertEquals` (so lỏng) | `toEqual` (sâu) / `toStrictEqual` (chặt) |
| `setUp()` / `tearDown()` | `beforeEach` / `afterEach` |
| `@dataProvider` / Pest `->with([...])` | `it.each([...])` (ghi chú 2) |
| `expectException(Foo::class)` | `expect(() => f()).toThrow(Foo)` |
| `RefreshDatabase`, factory | Với domain thuần: tự dựng object bằng hàm `make...()`, không cần DB |

Khác biệt tư duy: Laravel hay có "feature test" chạm DB vì Eloquent gắn logic với persistence. Ở domain layer thuần TypeScript, logic là hàm/class thuần nên test nhanh (mili-giây) và không cần dựng môi trường.

## Tricks & tips thực tế

- **Đặt tên theo mẫu "khi ... thì ..."** (`"từ chối phiếu đã trả"`): báo cáo lỗi trong CI chỉ hiện tên test, tên tốt tiết kiệm thời gian đoán.
- **Dùng hàm dựng dữ liệu `makeLoan(overrides)`** thay vì lặp object literal dài: mỗi test chỉ nêu phần *khác biệt* liên quan tới hành vi đang test, người đọc thấy ngay điều gì quan trọng. Kiểu `Partial<T>` cho overrides giữ type-safe.
- **Không dùng logic (if, vòng lặp, tính toán lại) trong test**. Nếu phải tính kỳ vọng bằng công thức giống code chính, bạn đang test code bằng chính nó; hãy ghi giá trị kỳ vọng cứng (`1500`).
- **Một test, một lý do thất bại**. Nhiều `expect` về cùng một kết quả thì ổn; nhiều Act không liên quan thì tách test, để khi đỏ biết chính xác nhánh nào hỏng.
- **Đừng chia sẻ state giữa các test** (biến `let` ở cấp `describe` bị test này sửa rồi test kia đọc). Dựng mới trong `beforeEach` hoặc trong từng test, vì thứ tự chạy không nên ảnh hưởng kết quả.
- **Chạy một test để debug**: `npx vitest run -t "tên test"` hoặc `it.only` tạm thời (nhớ xoá trước khi nộp, vì `.only` âm thầm bỏ qua mọi test khác và CI vẫn xanh).
- **Đọc thông báo lỗi `toEqual`**: Vitest in diff giữa expected và received. Dòng có `-` là kỳ vọng, `+` là thực tế. Lỗi hay gặp là lệch `undefined` vs thiếu thuộc tính, hoặc `Date` khác múi giờ.
- **Test phải fail trước khi pass**: khi sửa bug, viết test tái hiện lỗi, thấy nó đỏ, rồi mới sửa. Test chưa từng đỏ có thể không kiểm tra gì cả.
- **Kiểm tra "không mutate đầu vào"** bằng cách chụp trước (`structuredClone`) rồi so `toEqual` sau Act. Đây là tiêu chí chấm trong `PLAN.md`.

```ts
it("không mutate dữ liệu đầu vào", () => {
  const loan: Loan = { dueDate: new Date("2026-01-10T00:00:00Z"), returnedAt: null };
  const snapshot = structuredClone(loan);
  calculateFine(loan, new Date("2026-02-01T00:00:00Z"));
  expect(loan).toEqual(snapshot);
});
```

- **Chọn matcher đủ chặt**: `toEqual` bỏ qua thuộc tính `undefined` và không phân biệt class; `toStrictEqual` thì có. Chi tiết, kèm cạm bẫy `Error` và `Set`/`Map`, ở ghi chú 5. Lý do cần biết: test "xanh" với `toEqual` có thể che một DTO lộ thêm trường `undefined` hay trả nhầm kiểu.
- **Đọc báo lỗi từ dưới lên**: dòng đầu là tên test, tiếp theo là matcher, sau cùng là diff. Nếu diff trông giống hệt, nghi ngờ khác tham chiếu (`toBe` thay vì `toEqual`), khác kiểu class, hoặc khác `undefined`/thiếu trường.

## Liên hệ bài tập

Lab Bài 11 là bổ sung test cho Bài 1-10. Gợi ý quy trình: với mỗi bài, liệt kê hành vi quan trọng bằng lời trước, viết test cho từng hành vi theo AAA, rồi tự hỏi "nếu tôi đổi cách cài đặt nhưng giữ hành vi, test nào đỏ?". Test nào đỏ là test gắn cài đặt, cần viết lại. Đừng sửa code của bài cũ chỉ để dễ test trừ khi bạn ghi lại lý do.

## Đọc thêm

- [Vitest: Getting Started](https://vitest.dev/guide/)
- [Vitest: expect API](https://vitest.dev/api/expect.html)
- [Vitest: test API (`it`, `describe`, `each`)](https://vitest.dev/api/test.html)

## Ghi chú của bạn
