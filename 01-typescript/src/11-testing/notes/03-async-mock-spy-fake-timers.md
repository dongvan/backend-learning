# 3. Test async, mock, spy và fake timers

Test code bất đồng bộ phải **đợi** kết quả, và test code có phụ thuộc ngoài phải thay phụ thuộc đó bằng đồ giả có kiểm soát.

```ts
it("resolve / reject", async () => {
  await expect(fetchRate("USD")).resolves.toBe(24000);
  await expect(fetchRate("")).rejects.toThrow("rỗng");
});
```

## Ý chính

- Hàm test `async` + `await` (hoặc `return` promise). Quên `await` thì test kết thúc trước khi assertion chạy, **xanh giả**.
- `resolves` / `rejects` biến một promise thành giá trị để dùng matcher; nhớ `await` cả biểu thức.
- Ưu tiên **fake viết tay** (object in-memory thoả interface) khi được; dùng `vi.fn()` khi cần đếm lời gọi hoặc ép lỗi.
- Mock ở **ranh giới** (gửi mail, gọi API, đồng hồ), không mock chính domain đang test.
- Fake timers (`vi.useFakeTimers`) để test `setTimeout`, debounce, retry, và "bây giờ" mà không chờ thật.

## Lý thuyết chi tiết

**Async test.**

```ts
it("await trực tiếp", async () => {
  const rate = await fetchRate("USD");
  expect(rate).toBeGreaterThan(0);
});
```

Cạm bẫy số một:

```ts
it("xanh giả", () => {
  expect(fetchRate("")).rejects.toThrow("rỗng");   // thiếu await và hàm test không async/return
});
```

Test kết thúc ngay, promise bị bỏ rơi. Vitest 5.0.3 (đã thử) có phát hiện assertion `resolves`/`rejects` không được `await` và làm test fail, nhưng đừng dựa vào: bản cũ hơn và các phiên bản khác có thể để lọt, và việc gọi hàm async rồi không `await` kết quả (không phải assertion) thì không được bắt. Luôn `await expect(...).rejects...`. Bật quy tắc lint `@typescript-eslint/no-floating-promises` (khi có lint) cũng bắt được lỗi này ở mọi nơi.

**Test double: dummy, stub, fake, spy, mock.** Dùng chính xác từ giúp trao đổi rõ:

| Loại | Là gì | Ví dụ |
|---|---|---|
| Stub | Trả giá trị định sẵn | `vi.fn().mockResolvedValue(1)` |
| Fake | Cài đặt đơn giản nhưng chạy thật | Repository in-memory dựa trên `Map` |
| Spy | Bọc hàm thật, ghi lại lời gọi | `vi.spyOn(console, "warn")` |
| Mock | Có kỳ vọng về cách bị gọi | `expect(send).toHaveBeenCalledWith(...)` |

**`vi.fn`: dựng hàm giả có kiểu.**

```ts
import { vi } from "vitest";

type Mailer = { send(to: string, body: string): Promise<void> };

const send = vi.fn<Mailer["send"]>().mockResolvedValue(undefined);
await notifyOverdue({ send }, ["a@x.vn", "b@x.vn"]);

expect(send).toHaveBeenCalledTimes(2);
expect(send).toHaveBeenNthCalledWith(1, "a@x.vn", "Sách đã quá hạn");

// ép lỗi để test đường lỗi
const failing = vi.fn<Mailer["send"]>().mockRejectedValue(new Error("SMTP down"));
await expect(notifyOverdue({ send: failing }, ["a@x.vn"])).rejects.toThrow("SMTP down");
```

Truyền kiểu hàm vào generic (`vi.fn<Mailer["send"]>()`) để `mockResolvedValue` và tham số được kiểm kiểu: đổi chữ ký `send` thì test báo lỗi compile thay vì lệch âm thầm (đã chạy trên Vitest 5.0.3 và TS 7).

**Fake viết tay.**

```ts
const sent: string[] = [];
const fake: Mailer = { send: async (to) => { sent.push(to); } };
await notifyOverdue(fake, ["a@x.vn"]);
expect(sent).toEqual(["a@x.vn"]);
```

Test khẳng định **kết quả** (ai đã nhận mail) thay vì **cách gọi** (bao nhiêu lần, thứ tự nào). Bền hơn khi refactor. Đây là lý do domain layer nên phụ thuộc vào interface (`Mailer`, `Repository`) chứ không vào lớp cụ thể: thay fake vào rất dễ.

**`vi.spyOn`.**

```ts
afterEach(() => vi.restoreAllMocks());

it("ghi log cảnh báo", () => {
  const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
  console.warn("x");
  expect(spy).toHaveBeenCalledWith("x");
});
```

Spy sửa object thật; nếu không khôi phục, nó rò rỉ sang test khác. Dùng `afterEach(() => vi.restoreAllMocks())`. Lưu ý với Vitest hiện đại: `restoreAllMocks` khôi phục các spy tạo bởi `vi.spyOn`; hành vi chính xác với `vi.fn()` thay đổi giữa các phiên bản, nên đừng dựa vào nó để reset `vi.fn()` mà hãy tạo mới mock trong từng test.

**Fake timers và thời gian.**

```ts
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("debounce chỉ gọi một lần sau khoảng chờ", () => {
  const fn = vi.fn();
  const d = debounce(fn, 100);
  d(); d(); d();
  expect(fn).not.toHaveBeenCalled();
  vi.advanceTimersByTime(100);
  expect(fn).toHaveBeenCalledTimes(1);
});

it("cố định 'bây giờ'", () => {
  vi.setSystemTime(new Date("2026-03-01T00:00:00Z"));
  expect(new Date().toISOString()).toBe("2026-03-01T00:00:00.000Z");
});
```

Khi bật fake timers, `setTimeout`, `setInterval` và `Date` bị thay bằng bản điều khiển được; thời gian chỉ trôi khi bạn gọi `advanceTimersByTime`, `runAllTimers`… Phiên bản async (`advanceTimersByTimeAsync`) cần khi callback chứa promise.

**Thiết kế để khỏi phải fake timers.** Cách tốt nhất cho domain: **truyền thời gian vào như tham số** (`calculateFine(loan, now)`) thay vì gọi `new Date()` bên trong. Hàm thuần theo `now` không cần fake timers, test chỉ là truyền một ngày cố định. Fake timers dành cho code thật sự dùng timer (debounce, retry có backoff, timeout).

## Tricks & tips thực tế

- **Không bao giờ để test chờ thật** (`await sleep(1000)`): chậm, và vẫn flaky vì phụ thuộc tải máy. Dùng fake timers hoặc đưa `now` vào hàm.
- **Luôn `useRealTimers()` trong `afterEach`**: nếu fake timers rò sang test khác, test đó treo hoặc có thời gian sai, rất khó dò vì lỗi nằm ở test khác chỗ.
- **Mock ít, mock đúng chỗ**: mỗi mock là một giả định về phụ thuộc, có thể lệch thực tế. Mock cả domain nội bộ khiến test chỉ kiểm tra mock. Chỉ mock ranh giới I/O.
- **Đừng mock thứ bạn không sở hữu theo cách chi tiết** (ví dụ mô phỏng từng lời gọi của driver DB). Bọc nó sau interface của bạn (Repository) rồi fake interface đó.
- **Test đường lỗi của phụ thuộc**: mail thất bại, repo ném lỗi. Hầu hết bug production nằm ở đây, nhưng thường không có test. `mockRejectedValue` làm việc này rẻ.
- **Debug test treo**: thường do fake timers chưa tiến, promise không bao giờ resolve, hoặc quên `await`. Thêm `timeout` ngắn cho riêng test đó (`it("...", { timeout: 500 }, async () => {...})`, đã thử trên 5.0.3) và log để xem dừng ở đâu. Mặc định Vitest ngắt test sau 5 giây.
- **Kiểm tra bằng `toHaveBeenCalledWith` dùng `expect.objectContaining`** khi đối số là object lớn: chỉ ràng buộc phần quan trọng, test ít vỡ khi thêm trường mới.
- **Với PHPUnit**: `createMock()` / Mockery tương ứng `vi.fn()`; Laravel `Mail::fake()` / `Queue::fake()` tương ứng với fake viết tay. Trong Laravel fake được tích hợp framework; ở TypeScript thuần bạn tự thiết kế interface để có thể fake, và đó là một lợi ích thiết kế chứ không chỉ để test.

- **Phân biệt ba hàm dọn dẹp mock** (`mockClear`, `mockReset`, `mockRestore`) và thứ `vi.restoreAllMocks()` thực sự làm: bảng đối chiếu đã chạy thật ở ghi chú 5, mục 5. Lý do cần nhớ: dọn dẹp sai là nguồn rò rỉ giữa test phổ biến nhất, và hành vi thay đổi giữa các phiên bản Vitest.
- **Đặt assertion trước khi tiến thời gian với promise sẽ reject**: gọi `const a = expect(p).rejects.toThrow(...)` rồi `await vi.advanceTimersByTimeAsync(...)`, sau cùng `await a` (ví dụ ở ghi chú 5, mục 6). Lý do: promise reject mà chưa ai gắn handler gây Unhandled Rejection làm cả lần chạy báo lỗi.
- **Test hàm async "ném" bằng `rejects`, không bằng `toThrow`**: `expect(async () => ...).toThrow()` không bắt được vì hàm async không ném đồng bộ (ghi chú 5, mục 7).
- **Fake nên "bắt chước" hợp đồng thật**: fake repository in-memory phải trả `undefined` khi không thấy và không rò tham chiếu, giống bản DB. Nếu không, test xanh trên fake mà code đỏ trên DB thật (xem mục "test hợp đồng" ở Bài 12).

## Liên hệ bài tập

Bài 7 (overload, async) và Bài 10 (lỗi có kiểu) là nơi hợp để thực hành `resolves`/`rejects`. Hãy test cả nhánh thành công lẫn thất bại của hàm async, và chứng minh bằng cách cố ý làm hỏng code rằng test của bạn **thật sự đỏ** khi quên `await`. Với hàm có phụ thuộc, thử viết một fake in-memory thay cho mock và so sánh độ dễ đọc.

## Đọc thêm

- [Vitest: Mocking](https://vitest.dev/guide/mocking.html)
- [Vitest: `vi` API (`vi.fn`, `vi.spyOn`, `vi.useFakeTimers`)](https://vitest.dev/api/vi.html)

## Ghi chú của bạn
