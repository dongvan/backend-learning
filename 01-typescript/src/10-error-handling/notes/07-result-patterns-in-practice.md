# 7. Các mẫu `Result` dùng được hằng ngày: `match`, `all`, `collect`, `fromPromise`, `unwrap`

Vài hàm nhỏ trên `Result<T, E>` đủ cho 90% nhu cầu, không cần thư viện: xử lý hai nhánh có ép buộc, gộp danh sách kết quả, bọc Promise ném lỗi, và thoát ra khỏi `Result` ở nơi thích hợp.

```ts
type Ok<T> = { readonly ok: true; readonly value: T };
type Err<E> = { readonly ok: false; readonly error: E };
type Result<T, E> = Ok<T> | Err<E>;
const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
const err = <E>(error: E): Err<E> => ({ ok: false, error });
```

(Giống file 1, thêm `readonly` để kết quả không bị sửa sau khi tạo; xem Bài 1 về `readonly`.)

## Ý chính

- `Result` chỉ có ích khi **nối được** với nhau mà không viết `if (!r.ok) return r` ở từng dòng; vài hàm tiện ích giải quyết việc đó.
- Danh sách kết quả có hai ngữ nghĩa gộp: **dừng ở lỗi đầu tiên** (`all`) và **gom mọi lỗi** (`collect`). Chọn theo người đọc lỗi, không theo tiện tay.
- Bọc API ném lỗi bằng một hàm (`fromPromise`) có tham số *dịch lỗi*, để `E` luôn là kiểu của bạn, không phải `unknown`.
- Có chỗ **nên thoát khỏi `Result`** (test, script, rìa framework) bằng `unwrap`, và có chỗ phải **ném** (transaction cần rollback). Quyết định tường minh.

## Lý thuyết chi tiết

**`match`: xử lý đủ hai nhánh.**

```ts
function match<T, E, R>(r: Result<T, E>, on: { ok: (v: T) => R; err: (e: E) => R }): R {
  return r.ok ? on.ok(r.value) : on.err(r.error);
}
```

Khác `if (r.ok)`: bạn *phải* đưa cả hai hàm, nên không quên nhánh lỗi; kiểu trả về `R` chung cho cả hai. Hữu ích ở rìa HTTP: `match(result, { ok: (v) => reply(201, v), err: (e) => reply(statusOf(e), toBody(e)) })`.

**`all`: dừng ở lỗi đầu tiên.**

```ts
function all<T, E>(rs: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const r of rs) {
    if (!r.ok) return r;        // r thu hẹp thành Err<E>, gán được cho Result<T[], E>
    values.push(r.value);
  }
  return ok(values);
}
```

**`collect`: gom mọi lỗi.**

```ts
function collect<T, E>(rs: readonly Result<T, E>[]): Result<T[], E[]> {
  const values: T[] = [];
  const errors: E[] = [];
  for (const r of rs) {
    if (r.ok) values.push(r.value);
    else errors.push(r.error);
  }
  return errors.length > 0 ? err(errors) : ok(values);
}
```

Đã chạy với `parseSku` (hợp lệ khi khớp `/^[A-Z]{3}-\d{3}$/`) trên `["ABC-123", "x", "DEF-456", "y"]`: `all` trả lỗi của `"x"` (chỉ một lỗi), `collect` trả mảng hai lỗi (`"x"` và `"y"`). Với import hàng loạt hay form nhiều trường, `collect` cho người dùng toàn bộ danh sách lỗi một lần.

Lưu ý: nếu bạn cần biết *dòng nào* lỗi, đưa chỉ số vào lỗi (`{ row: i, ... }`) khi tạo `Result`, vì `collect` mất quan hệ giữa vị trí và lỗi nếu bạn không lưu nó.

**`fromPromise`: bọc Promise ném lỗi, và tự dịch lỗi.**

```ts
async function fromPromise<T, E>(p: Promise<T>, toError: (cause: unknown) => E): Promise<Result<T, E>> {
  try {
    return ok(await p);
  } catch (cause) {
    return err(toError(cause));
  }
}

const r = await fromPromise(loadInvoice(id), (cause) => ({ kind: "upstream" as const, cause }));
// (trong hàm async; `loadInvoice` là hàm giả định của bạn, trả Promise)
```

Đã chạy: Promise reject bằng `TypeError` thành `{ ok: false, error: { kind: "upstream", cause } }` với `cause instanceof TypeError`. `toError` là nơi bạn phân loại lỗi (nhận `unknown`, nên thu hẹp bằng `instanceof`); đừng truyền một hàm luôn trả cùng một kiểu lỗi cho mọi `catch` nếu một số lỗi thật ra phải ném lên (ví dụ lỗi lập trình).

**`unwrap`: thoát khỏi `Result` bằng `throw`.**

```ts
function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new Error("unwrap on Err", { cause: r.error });
}
```

Dùng trong test, script một lần, hoặc khi bạn *biết* thất bại là bug. Đã chạy: `cause` giữ nguyên object lỗi (`{"kind":"bad_sku","sku":"x"}`). Đừng rải `unwrap` khắp code nghiệp vụ: đó là quay về `throw` kèm mất lợi ích của `Result`.

**Kiểu của lỗi khi nối nhiều bước (`andThen`).** Ở file 1, `andThen` trả `Result<U, E | F>`: kiểu lỗi tổng là hợp của lỗi từng bước. Khi chuỗi dài, hợp này lớn dần; hai cách giữ nó đọc được: (1) đặt tên cho hợp (`type CheckoutError = StockError | CouponError | PaymentError`), (2) mỗi tầng dịch lỗi của tầng dưới thành lỗi của chính nó ở ranh giới tầng, giống bọc lỗi hạ tầng (file 3).

**`Result` và transaction.** Hàm `transaction(callback)` của nhiều ORM rollback khi `callback` *ném*, và commit khi callback *trả về*. Nếu bên trong bạn `return err(...)` thì có thể thư viện coi đó là thành công và **commit**. Cách an toàn: trong callback chuyển `Result` lỗi thành `throw` (dùng một `Rollback` có chứa lỗi), bắt ở ngoài và biến lại thành `Result`:

```ts
class Rollback<E> extends Error {
  constructor(readonly reason: E) {
    super("rollback");
    this.name = "Rollback";
  }
}
```

Hành vi chính xác phụ thuộc thư viện bạn dùng (cần tự kiểm chứng trong tài liệu và bằng test với DB thật); nguyên tắc là biết rõ thư viện nào commit khi nào.

**So sánh PHP/Laravel.** Laravel `Validator::make(...)->errors()` gom mọi lỗi theo trường, tương ứng `collect`; `$request->validate()` ném `ValidationException` ngay ở lỗi đầu tiên *của cả form*, nhưng nội bộ vẫn gom, nên bạn nhận danh sách đầy đủ. `rescue(fn, $default)` của Laravel gần với `fromPromise` ở chỗ biến ngoại lệ thành giá trị.

## Tricks & tips thực tế

- **Đặt tên hàm theo ngữ nghĩa gộp: `all` (dừng sớm) và `collect` (gom hết).** Lý do: tên chung chung như `combine` che đi sự khác biệt quan trọng nhất về trải nghiệm người dùng.
- **Với validate nhiều trường, dùng `collect` hoặc `safeParse` của Zod (đã gom sẵn mọi issue).** Lý do: báo từng lỗi một buộc người dùng gửi lại nhiều lần.
- **Bọc ở rìa, không bọc ở mọi hàm.** Lý do: `fromPromise` ở khắp nơi biến code thành chuỗi lời gọi bọc, khó đọc; bọc một lần ở tầng tích hợp rồi nghiệp vụ dùng `Result` thuần.
- **Giữ `cause` gốc trong lỗi bọc (`{ kind: "upstream", cause }`).** Lý do: log về sau cần lỗi gốc; mất `cause` là mất stack.
- **Test các hàm gộp với danh sách rỗng.** Lý do: `all([])` nên là `ok([])`; `collect([])` cũng vậy. Hàm tự viết hay quên trường hợp này.
- **Thử nghiệm kiểu**: gọi `all([ok(1) as Result<number, "a">, ok(2) as Result<number, "b">])` và xem compiler suy `E` thế nào (đã biên dịch được trên TS 7.0.2; hover để xem kết quả cụ thể). Lý do: cho bạn trực giác về hợp kiểu lỗi.
- **Đừng thêm thư viện `Result` chỉ vì tiện.** Lý do: repo này tránh dependency ngoài nhu cầu; các hàm trên ngắn, bạn hiểu từng dòng. Nếu sau này cần (ví dụ có sẵn `neverthrow` trong dự án thật), bạn đã biết chúng đang làm gì.

## Liên hệ bài tập

Trong bài lab, nếu input có danh sách (line items), bạn muốn báo lỗi dừng ở phần tử đầu tiên hay toàn bộ lỗi? Với mỗi lựa chọn, kiểu `Result` của hàm kiểm phải thay đổi thế nào, và client nhận hình dạng lỗi nào? Hãy viết thử một hàm gộp của riêng bạn trước khi dùng gợi ý ở trên.

## Đọc thêm

- [TypeScript: Narrowing (discriminated unions)](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)
- [TypeScript: Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html)
- [MDN: Error `cause`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause)

## Ghi chú của bạn
