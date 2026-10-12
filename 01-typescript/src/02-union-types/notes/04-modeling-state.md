# 4. Mô hình hoá trạng thái: làm cho trạng thái sai không thể biểu diễn

Nguyên tắc: thiết kế kiểu sao cho mọi giá trị hợp lệ về kiểu đều là trạng thái hợp lệ về nghiệp vụ.

```ts
type Idle = { status: "idle" };
type Uploading = { status: "uploading"; startedAt: number; progress: number };
type Done = { status: "done"; startedAt: number; url: string };
type Failed = { status: "failed"; startedAt: number; error: string };

type Upload = Idle | Uploading | Done | Failed;
```

Không thể có `Idle` kèm `url`, hay `Done` thiếu `url`. Ví dụ này (upload file) chỉ để minh hoạ cách nghĩ; bài lab dùng miền Order và Payment, bạn tự mô hình.

## Ý chính

- Mỗi trạng thái là một kiểu riêng, mang đúng dữ liệu của nó. Dữ liệu chỉ có nghĩa ở một số trạng thái thì chỉ nằm ở những nhánh đó.
- Chuyển trạng thái là **hàm nhận nhánh nguồn và trả nhánh đích**. Kiểu của hàm chính là luật chuyển.
- Không mutate. Mỗi lần chuyển trả một object mới.
- Tầng persistence có thể vẫn là một bảng với cột nullable. Chuyển đổi giữa bảng và union nằm ở ranh giới (repository).

## Lý thuyết chi tiết

**Từ cờ boolean sang union.** Mô hình hay gặp:

```ts
type Bad = { loading: boolean; data?: string; error?: string };
// Cho phép: loading = true kèm error, data và error cùng có mặt, loading = false mà không có gì.
```

Mỗi tổ hợp vô nghĩa là một lỗi tiềm ẩn mà bạn phải nhớ kiểm tra bằng code. Union loại bỏ chúng ngay ở kiểu.

**Hàm chuyển trạng thái có kiểu chính xác.**

```ts
function start(_s: Idle, now: number): Uploading {
  return { status: "uploading", startedAt: now, progress: 0 };
}

function finish(s: Uploading, url: string): Done {
  return { status: "done", startedAt: s.startedAt, url };
}

start({ status: "done", startedAt: 1, url: "u" }, 1);   // Lỗi: Done không phải Idle
```

Luật nghiệp vụ "chỉ `Idle` mới start được" trở thành lỗi biên dịch thay vì `if` ở runtime.

**Reducer: kết hợp union trạng thái và union sự kiện.**

```ts
type UploadEvent =
  | { type: "START"; now: number }
  | { type: "PROGRESS"; value: number }
  | { type: "SUCCESS"; url: string }
  | { type: "FAIL"; error: string };

function reduce(state: Upload, event: UploadEvent): Upload {
  switch (state.status) {
    case "idle":
      return event.type === "START" ? start(state, event.now) : state;
    case "uploading":
      switch (event.type) {
        case "PROGRESS":
          return { ...state, progress: event.value };
        case "SUCCESS":
          return finish(state, event.url);
        case "FAIL":
          return { status: "failed", startedAt: state.startedAt, error: event.error };
        case "START":
          return state;     // sự kiện không áp dụng: quyết định rõ ràng (bỏ qua), không phải lỡ quên
        default:
          return assertNever(event);
      }
    case "done":
    case "failed":
      return state;
    default:
      return assertNever(state);
  }
}
```

Hai tầng `switch` đều có exhaustive check (ghi chú 3). Thêm một sự kiện hay một trạng thái thì compiler chỉ ra chỗ cần quyết định.

**Cạm bẫy của spread.** `{ ...state, status: "done" }` sao chép *mọi* thuộc tính của `state`, kể cả những thuộc tính không thuộc nhánh đích (ví dụ `error`). TypeScript có thể không báo lỗi vì kiểm tra thuộc tính thừa không áp dụng cho spread. Khi chuyển sang nhánh khác, hãy liệt kê tường minh các trường của nhánh đích như ở `finish` và `FAIL` phía trên. Dùng spread chỉ khi cập nhật trong cùng một nhánh (`PROGRESS`).

**Ranh giới với database.** Bảng thường có `status` kèm cột nullable. Hàm chuyển từ row sang union nên kiểm tra tính nhất quán và ném lỗi nếu dữ liệu hỏng:

```ts
type Row = { status: string; url: string | null; started_at: number | null };

function fromRow(r: Row): Upload {
  switch (r.status) {
    case "idle":
      return { status: "idle" };
    case "done":
      if (r.url === null || r.started_at === null) throw new Error("row 'done' thiếu dữ liệu");
      return { status: "done", startedAt: r.started_at, url: r.url };
    default:
      throw new Error(`status không hợp lệ: ${r.status}`);
  }
}
```

Nguyên tắc "parse, don't validate": biến dữ liệu thô thành kiểu chặt một lần ở ranh giới, phần còn lại của code dùng kiểu chặt đó và không cần kiểm tra lại.

## Tricks & tips thực tế

- **Bắt đầu thiết kế từ câu hỏi "trạng thái nào tồn tại?"**, rồi mới hỏi "mỗi trạng thái cần dữ liệu gì?". Kể ra bằng lời trước khi viết kiểu.
- **Đặt tên từng nhánh bằng `type` riêng và export** (như `Idle`, `Uploading`). Hàm chuyển trạng thái và test sẽ nhận đúng kiểu hẹp, dễ đọc và dễ test hơn nhiều so với `Extract<...>` rải rác.
- **Để compiler kiểm tra luật chuyển**: viết một vài dòng sai trong file test và gắn `// @ts-expect-error` phía trên. `npm run type-check` bao phủ cả file test (nằm dưới `src/`). Vitest tự nó không kiểm tra kiểu, nên đừng chỉ dựa vào `npm test`. (Bài 11 sẽ học thêm `expectTypeOf`.)
- **Dữ liệu chỉ tồn tại ở một số trạng thái thì đặt ở nhánh đó**: ví dụ trường chỉ có nghĩa khi đã hoàn tất, đừng để `undefined` ở các nhánh khác.
- **Đừng quên hợp lệ về giá trị**: kiểu không ngăn được `progress = -5` hay `url = ""`. Ràng buộc giá trị là việc của validation (Bài 9) và branded type, kiểu union chỉ lo hình dạng.
- **Giữ immutability**: `readonly` cho các trường, và mọi chuyển trạng thái trả object mới. Dễ suy luận, dễ test, không có tác dụng phụ ngoài ý muốn.
- **Với máy trạng thái phức tạp** hơn (nhiều trạng thái, nhiều điều kiện), thư viện như XState có ích, nhưng phần lớn domain backend chỉ cần union cộng hàm chuyển như trên. Không thêm dependency khi chưa cần.
- **Tương quan với Laravel**: tương đương với Eloquent model có thuộc tính `status` kèm các accessor cho trường nullable. Nhưng ở đó, mọi phương thức đều phải nhớ "trường này có thể null ở trạng thái nào". Ở TypeScript, kiểu nhớ giúp bạn.
- **Đừng quá tay**: nếu chỉ có hai trạng thái và không có dữ liệu riêng, một union literal đơn giản (`"open" | "closed"`) là đủ; không cần object cho từng nhánh.

## Liên hệ bài tập

Bài lab Bài 2 (xem `PLAN.md`): mô hình trạng thái Order và Payment. Gợi ý quy trình: liệt kê trạng thái, quyết định dữ liệu của từng trạng thái, viết hàm chuyển trạng thái có kiểu chính xác, thêm exhaustive check, rồi thử phá (gán sai, quên một nhánh) để xem compiler phản ứng.

## Đọc thêm

- [Narrowing: discriminated unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)
- Bài viết gốc về ý tưởng "Make illegal states unrepresentable" (Yaron Minsky) và "Parse, don't validate" (Alexis King), tìm theo tên.

## Ghi chú của bạn

