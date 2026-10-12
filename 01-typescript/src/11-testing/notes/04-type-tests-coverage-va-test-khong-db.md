# 4. Type tests, `@ts-expect-error`, coverage và test không phụ thuộc DB

Kiểu cũng là hành vi cần bảo vệ: nếu bạn mô hình hoá "trạng thái sai không thể biểu diễn", hãy có test chứng minh nó thật sự không biểu diễn được.

```ts
import { it, expectTypeOf } from "vitest";

type Ok<T> = { ok: true; value: T };
type Err<E> = { ok: false; error: E };
type Result<T, E> = Ok<T> | Err<E>;

function parseQty(raw: string): Result<number, "invalid"> {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? { ok: true, value: n } : { ok: false, error: "invalid" };
}

it("kiểu trả về", () => {
  expectTypeOf(parseQty).returns.toEqualTypeOf<Result<number, "invalid">>();
  expectTypeOf(parseQty).parameters.toEqualTypeOf<[string]>();
});
```

## Ý chính

- **Type test không chạy ở runtime.** `expectTypeOf(...)` là hàm rỗng khi chạy; việc kiểm tra xảy ra khi `tsc` biên dịch file. Vì vậy phải chạy `npm run type-check` (gồm cả file test vì chúng nằm dưới `src/`), không chỉ `npm test`.
- `// @ts-expect-error` khẳng định "dòng kế tiếp **phải** có lỗi kiểu". Nếu dòng đó hết lỗi, chính directive trở thành lỗi (TS2578), nên đây là cách test "đoạn code này phải bị cấm".
- Dùng type test cho: kiểu trả về của hàm generic, narrowing của union, luật chuyển trạng thái, branded ID, utility type tự viết (Bài 5, 6).
- **Coverage** đo dòng code nào đã được chạy, không đo chất lượng assertion. Dùng để tìm vùng chưa được test, không phải làm chỉ tiêu.
- Test business logic **không cần DB**: truyền dữ liệu vào, kiểm tra dữ liệu ra; phần I/O nằm sau interface và dùng fake.

## Lý thuyết chi tiết

**Hai kiểu bảo đảm tách biệt.**

| Câu hỏi | Công cụ | Chạy bằng |
|---|---|---|
| Hàm tính đúng không? | `expect(...).toBe(...)` | `npm test` |
| Kiểu có đúng như thiết kế không? | `expectTypeOf`, `@ts-expect-error` | `npm run type-check` |

Cả hai nằm trong cùng file `*.test.ts` được, miễn là chạy cả hai lệnh.

**`expectTypeOf` (Vitest 5.0.3, đã thử cùng TypeScript 7).**

```ts
type MemberId = string & { readonly __brand: "MemberId" };
function findMember(_id: MemberId): void {}
function first<T>(xs: readonly T[]): T | undefined { return xs[0]; }

it("generic suy luận", () => {
  expectTypeOf(first([1, 2, 3])).toEqualTypeOf<number | undefined>();
  expectTypeOf(first(["a"] as const)).toEqualTypeOf<"a" | undefined>();
});

it("narrowing của union", () => {
  const r = parseQty("1");
  if (r.ok) expectTypeOf(r).toEqualTypeOf<Ok<number>>();
  else expectTypeOf(r.error).toEqualTypeOf<"invalid">();
});

it("branded id không nhận string thường", () => {
  // @ts-expect-error string thường không gán được cho MemberId
  findMember("m-1");
  expectTypeOf<string>().not.toExtend<MemberId>();   // string không phải MemberId
  expectTypeOf<MemberId>().toExtend<string>();       // MemberId vẫn là một string
});
```

Phân biệt hai họ matcher:
- `toEqualTypeOf<T>()`: hai kiểu **giống hệt** (chặt: phân biệt `readonly`, `any`, optional).
- `toExtend<T>()`: kiểu thực **gán được** cho `T` (tương đương "extends"). Bản cũ hơn tên là `toMatchTypeOf`; với bản 5.0.3 dùng `toExtend`. Nếu đổi phiên bản mà báo "không tồn tại", tra lại tên.
- Khác: `.returns`, `.parameters`, `.toHaveProperty("a")`, `.not.` để đảo.

**Test phải fail được.** Đã thử: khẳng định sai `expectTypeOf(1).toEqualTypeOf<string>()` làm `tsc` báo TS2344 ("Expected: string, Actual: number"), còn `vitest run` của chính file đó **vẫn xanh** vì không kiểm kiểu. Kết luận: với type test, tín hiệu đỏ đến từ `tsc`.

**Cạm bẫy: `declare function` trong test.** Khi viết thử type test nhanh, người ta hay `declare function parseQty(...)` cho khỏi phải cài đặt. `tsc` chấp nhận, nhưng khi Vitest chạy file, hàm không tồn tại và test ném `ReferenceError` (đã gặp khi thử). Hoặc cài đặt thật (như trên), hoặc chỉ dùng `expectTypeOf<Kiểu>()` ở mức kiểu thuần mà không gọi hàm.

**Vitest còn có chế độ typecheck riêng** (`vitest --typecheck` và file `*.test-d.ts`) chạy `tsc` ngay trong Vitest. Chưa kiểm chứng trong repo này; với repo hiện tại, `npm run type-check` đã bao phủ nên chưa cần.

**Coverage.** Vitest tính coverage qua một provider, phổ biến nhất là `@vitest/coverage-v8`, bật bằng `vitest run --coverage`. Gói này **chưa được cài trong repo** (chỉ có `vitest`, `@vitest/mocker`, `@vitest/spy`), và CLAUDE.md dặn không thêm dependency ngoài nhu cầu bài học, nên phần này **chưa chạy thử**. Nếu muốn dùng, hãy trao đổi với người hướng dẫn trước khi cài. Các chỉ số: lines, branches, functions, statements. **Branch coverage** hữu ích hơn line coverage vì `if` không có `else` vẫn "phủ dòng" dù thiếu nhánh sai.

100% coverage không có nghĩa là đúng: một test gọi hàm mà không assert gì vẫn tăng coverage. Ngược lại, coverage thấp ở một nhánh lỗi cho bạn danh sách ca cần viết.

**Test không phụ thuộc DB.** Nguyên tắc: logic quyết định (tính tiền, kiểm tra trạng thái) là hàm/phương thức thuần trên dữ liệu. DB, HTTP, queue nằm ở ranh giới. Hệ quả:

```ts
// Domain nhận interface, không biết DB thật
interface LoanRepository {
  findActiveByMember(memberId: MemberId): Promise<readonly Loan[]>;
}

// Test: fake in-memory, chạy mili-giây, không cần Docker
const repo = new InMemoryLoanRepository();
await repo.save(someLoan);
expect(await canBorrow(repo, memberId)).toBe(false);
```

So với Laravel: test với `RefreshDatabase` cho độ tin cậy về truy vấn nhưng chậm và cần môi trường. Hai lớp bổ trợ nhau: unit test domain nhanh và nhiều; integration test persistence ít và chậm (sẽ học ở các phase sau với DB thật). Ở Phase 01 chỉ cần lớp thứ nhất.

## Tricks & tips thực tế

- **Gắn `// @ts-expect-error` kèm lời giải thích** (`// @ts-expect-error Done không phải Idle`): một mình nó dễ bị người sau hiểu nhầm là "bỏ qua lỗi", còn lý do cho biết đây là test về luật kiểu.
- **Đừng dùng `@ts-ignore` trong test**: nó không báo khi lỗi biến mất, nên test về kiểu mất tác dụng âm thầm. `@ts-expect-error` thì báo.
- **Một `@ts-expect-error` chỉ che một dòng, và che mọi lỗi trên dòng đó**: viết dòng sai thật nhỏ, chỉ chứa một lỗi dự định, để không vô tình che lỗi khác (như viết sai tên hàm).
- **Debug type test**: khi `toEqualTypeOf` báo lỗi, thông điệp `Expected/Actual` thường quá ngắn. Gán kiểu ra biến và rê chuột trong editor, hoặc tạm viết `const x: never = value` để compiler in ra kiểu thực.
- **Kiểm tra `any` ngầm**: `expectTypeOf(value).not.toBeAny()` bắt trường hợp kiểu "vô tình" thành `any` làm mất an toàn (ví dụ kết quả `JSON.parse`).
- **Type test cho utility type tự viết (Bài 5, 6)** là ứng dụng đẹp nhất: `expectTypeOf<MyPick<User, "id">>().toEqualTypeOf<Pick<User, "id">>()` đối chiếu với bản chuẩn của TypeScript, vì vậy bạn có chứng cứ "tự dựng lại đúng".
- **Chạy cả hai lệnh trước khi nộp**: `npm run type-check && npm test`. Lý do: chỉ chạy `npm test` bỏ lọt lỗi kiểu, chỉ chạy `type-check` không chạy logic.
- **Đừng đuổi theo con số coverage**: nếu đặt ngưỡng cứng, người ta thêm test vô nghĩa để đạt ngưỡng. Hãy đọc báo cáo để thấy nhánh lỗi nào chưa được phủ.
- **Đặt test cạnh code** (`fine.ts` và `fine.test.ts` cùng thư mục) như repo đang làm: dễ tìm, và `rootDir: src` buộc cả hai dưới `src/`.

## Liên hệ bài tập

Với các bài nặng về kiểu (2, 3, 4, 5, 6), mỗi bài nên có ít nhất một type test: ca "phải biên dịch được, kiểu đúng như thế này" bằng `expectTypeOf`, và ca "phải bị cấm" bằng `@ts-expect-error`. Thử phá có chủ đích (đổi định nghĩa kiểu cho sai) để chắc `npm run type-check` thật sự đỏ. Về coverage, chỉ cần bạn giải thích được nó đo gì và không đo gì; việc cài gói hay không bàn lại với người hướng dẫn.

## Đọc thêm

- [Vitest: Testing Types](https://vitest.dev/guide/testing-types.html)
- [Vitest: Coverage](https://vitest.dev/guide/coverage.html)
- [TypeScript: `// @ts-expect-error` (Release notes 3.9)](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-9.html)

## Ghi chú của bạn
