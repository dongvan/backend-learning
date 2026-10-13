# 6. Ranh giới persistence: nạp dữ liệu, khoá lạc quan, idempotency và domain event

Domain thuần chỉ đúng khi dữ liệu **đi vào** và **đi ra** nó cũng được kiểm soát. Ghi chú này nói về chỗ domain gặp thế giới bên ngoài: dữ liệu từ DB, hai người cùng sửa một aggregate, thao tác bị gửi lặp, và cách báo "điều đã xảy ra" mà không kéo hạ tầng vào domain.

```ts
// Chuỗi hoá một vòng đời: nạp -> hàm nghiệp vụ -> lưu kèm version
const row = await repo.find(id);                  // dữ liệu thô từ ngoài
const invoice = toDomain(row);                    // kiểm tra + dựng kiểu domain
const result = pay(invoice, now);                 // luật nghiệp vụ (trả Result hoặc bản mới)
await repo.save(result.state, invoice.version);   // lưu, từ chối nếu version đã đổi
```

Mọi ví dụ (miền Invoice, Wallet, Note) đã được `tsc` kiểm chứng và chạy bằng `tsx`. Chúng minh hoạ mẫu thiết kế, không phải lời giải của Order domain.

## Ý chính

- **Hydration** (dựng lại đối tượng domain từ dữ liệu lưu) là một ranh giới như request đầu vào: phải kiểm tra, không `as` bừa.
- Aggregate bất biến + repo sao chép khi lưu/đọc thì repo in-memory hành xử như DB thật.
- **Khoá lạc quan** (optimistic locking) dùng một trường `version`: chỉ ghi nếu version khi ghi bằng version khi đọc. Kiểu không thay thế được việc này.
- Thao tác từ webhook/queue **có thể bị gửi lặp** (at-least-once): hàm nghiệp vụ và use case cần quyết định rõ hành vi khi lặp.
- **Domain event** (kết quả trả về, không phải phát ngay) giữ tác dụng phụ ra ngoài domain nhưng vẫn cho test thấy "điều gì đã xảy ra".

## Lý thuyết chi tiết

**1. Hydration: dữ liệu từ DB cũng là `unknown`.**

DB row là dữ liệu ngoài: schema có thể đã đổi, cột có thể `NULL`, kiểu có thể lệch (số lớn trả về dạng chuỗi tuỳ driver). Dựng lại domain bằng cùng cách như validate request: schema + hàm ánh xạ.

```ts
import { z } from "zod";

type InvoiceId = string & { readonly __brand: "InvoiceId" };
type Invoice =
  | { readonly status: "issued"; readonly id: InvoiceId; readonly totalMinor: number }
  | { readonly status: "paid"; readonly id: InvoiceId; readonly totalMinor: number; readonly paidAt: Date };

const RowSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("issued"), id: z.string().min(1), total_minor: z.number().int().nonnegative() }),
  z.object({
    status: z.literal("paid"),
    id: z.string().min(1),
    total_minor: z.number().int().nonnegative(),
    paid_at: z.coerce.date(),
  }),
]);

function toDomain(raw: unknown): Invoice {
  const row = RowSchema.parse(raw);        // ném ZodError nếu dữ liệu hỏng
  const id = row.id as InvoiceId;          // nơi duy nhất ép brand, sau khi đã kiểm tra
  switch (row.status) {
    case "issued": return { status: "issued", id, totalMinor: row.total_minor };
    case "paid":   return { status: "paid", id, totalMinor: row.total_minor, paidAt: row.paid_at };
  }
}
```

Đã chạy: dòng `paid` có `paid_at` hợp lệ cho `Invoice` đúng nhánh; thiếu `paid_at` hoặc `total_minor` là chuỗi `"100"` đều bị `ZodError` từ chối. Lưu ý các điểm:

- Hàm ánh xạ **liệt kê tường minh** từng trường của từng nhánh (không spread từ `row`), để cột thừa trong DB không rò vào domain (cạm bẫy ghi chú 5 của Bài 2).
- `noImplicitReturns` + `switch` vét cạn: nếu thêm nhánh vào schema mà quên ở `switch`, compiler báo `TS2366: Function lacks ending return statement and return type does not include 'undefined'` (đã chạy), nên không cần dòng `default` với `assertNever` để được bảo vệ.
- **Bẫy của `z.coerce.date()`** (đã chạy): `safeParse(null).success` là `true` (nó gọi `new Date(null)` ra ngày epoch 1970), trong khi `""` và `"abc"` bị từ chối. Với trường bắt buộc, `null` âm thầm thành `1970-01-01` là lỗi dữ liệu rất khó thấy. Ở ranh giới, ưu tiên ghi tường minh (ví dụ `z.string().datetime()` rồi tự đổi sang `Date`, hay `z.date()` nếu driver đã trả `Date`), và thêm test cho `null`.
- Lỗi ở bước này là **lỗi dữ liệu hỏng**, thuộc nhóm "ném exception" của ghi chú 3, không phải lỗi nghiệp vụ trả Result.

So với Laravel: `$casts`, accessor/mutator và `Model::hydrate` làm việc này một cách ngầm và lỏng (cast sai thì thường ra `null` hoặc giá trị lạ). Ở đây việc kiểm tra là tường minh và có kiểu.

**2. Repo in-memory rò tham chiếu (đã chạy).**

```ts
type Wallet = { id: string; balance: number };         // mutable, cố tình
class BadRepo {
  private store = new Map<string, Wallet>();
  async save(w: Wallet) { this.store.set(w.id, w); }   // giữ nguyên tham chiếu
  async find(id: string) { return this.store.get(id); }
}
// save(w); w.balance = 999 (chưa gọi save lại); find("w1")?.balance  ->  999
```

Test thấy `999` mà DB thật sẽ giữ `100`: test xanh nhờ một hành vi không có thật. Sửa theo hai hướng: giữ aggregate bất biến (`readonly`, hàm trả bản mới), hoặc repo `structuredClone` khi lưu và khi đọc. Ghi chú 4 đã nêu nguyên tắc; điểm bổ sung ở đây là cách phát hiện: thêm một test hợp đồng "sửa object sau khi `save` không đổi dữ liệu đã lưu" cho mọi cài đặt repo (mẫu `describe.each` ở ghi chú 4 của Bài 11, mục tips). `structuredClone` giữ `Date` nhưng làm mất prototype của class (instance `Money` thành object trần), nên với value object dạng class thì lưu dạng dữ liệu thuần rồi dựng lại qua hàm tạo.

**3. Khoá lạc quan (đã chạy).**

Kiểu bảo đảm hình dạng, **không** bảo đảm thứ tự thời gian. Hai request cùng đọc `Invoice` version 1, cùng đổi, cùng ghi: không có lỗi kiểu nào, nhưng bản ghi sau đè bản ghi trước. Cách phổ biến: trường `version` tăng mỗi lần lưu, và `save` nhận version mong đợi.

```ts
type SaveError = { readonly type: "VERSION_CONFLICT"; readonly expected: number; readonly actual: number };

class InMemInvoiceRepo {
  private readonly store = new Map<string, { readonly id: string; readonly version: number; readonly status: "issued" | "paid" }>();
  // ...
  async save(next: { readonly id: string; readonly version: number; readonly status: "issued" | "paid" },
             expectedVersion: number): Promise<Result<void, SaveError>> {
    const actual = this.store.get(next.id)?.version ?? 0;
    if (actual !== expectedVersion) return err({ type: "VERSION_CONFLICT", expected: expectedVersion, actual });
    this.store.set(next.id, { ...next, version: expectedVersion + 1 });
    return ok(undefined);
  }
}
```

Chạy thử: hai lần `save` cùng `expectedVersion = 1`, lần đầu `{ ok: true }`, lần hai `{ ok: false, error: { type: "VERSION_CONFLICT", expected: 1, actual: 2 } }`. Bản SQL tương ứng là một câu lệnh duy nhất `UPDATE ... SET ..., version = version + 1 WHERE id = ? AND version = ?` rồi kiểm tra **số dòng bị ảnh hưởng** (0 dòng nghĩa là xung đột). Lý do phải là **một** câu lệnh: "đọc version rồi mới ghi" ở hai bước tách rời lại tạo cửa sổ race. Lỗi `VERSION_CONFLICT` là lỗi nghiệp vụ/đồng thời có thể dự đoán, nên đúng chỗ cho `Result`; người gọi chọn: thử lại (nạp lại, áp dụng lại luật) hay báo 409.

So với Laravel: tương đương là cột `version`/`updated_at` kiểm ở `where`, hoặc khoá bi quan `lockForUpdate()` trong `DB::transaction`. Khoá bi quan chặn người sau đến khi người trước xong (đơn giản, nhưng giữ khoá trong cả giao dịch); khoá lạc quan không chặn mà báo xung đột (hợp khi xung đột hiếm). Chọn theo tần suất xung đột và chi phí thử lại.

**4. Idempotency (xử lý lặp).**

Webhook, queue (at-least-once) và client thử lại đều có thể gửi cùng một lệnh nhiều lần. Có ba mức đối phó, từ trong ra ngoài:

| Mức | Cách | Điểm cần cân nhắc |
|---|---|---|
| Hàm domain | `pay` trên hoá đơn đã `paid` trả lỗi `ALREADY_PAID` hoặc trả lại chính hoá đơn (hai chiến lược khác nhau, chọn một) | Trả lỗi dễ gây retry vô hạn nếu hệ gọi coi lỗi là "thử lại"; trả lại bản cũ an toàn hơn cho retry nhưng che mất lệnh trùng |
| Use case | Lưu **khoá idempotency** (id sự kiện/lệnh) và bỏ qua nếu đã xử lý | Cần chỗ lưu, và lưu cùng giao dịch với thay đổi |
| Ranh giới DB | Ràng buộc `UNIQUE` trên khoá idempotency | Chắc chắn nhất; là chốt chặn cuối khi hai tiến trình đua nhau |

Kiểu (`pay(i: IssuedInvoice)`) chỉ chặn lần gọi thứ hai **nếu code giữ bản `IssuedInvoice` cũ**; dữ liệu nạp lại từ DB là `unknown` nên vẫn phải kiểm ở runtime (hydration trả đúng nhánh `paid`, và `pay` nhận union rồi trả Result). Hãy viết test cho "gọi hai lần" như một ca biên bắt buộc.

**5. Domain event bằng giá trị trả về (đã chạy).**

Khi một thay đổi cần kích hoạt việc ngoài (gửi mail, ghi sổ), đừng gọi dịch vụ ngoài từ domain. Trả kèm danh sách sự kiện, tầng ứng dụng phát chúng sau khi lưu thành công:

```ts
type InvoiceEvent = { readonly type: "InvoicePaid"; readonly invoiceId: string; readonly at: string };
type Paid = { readonly id: string; readonly status: "paid"; readonly paidAt: string };

function pay(i: { readonly id: string; readonly status: "issued" }, at: string)
  : { readonly state: Paid; readonly events: readonly InvoiceEvent[] } {
  return {
    state: { id: i.id, status: "paid", paidAt: at },
    events: [{ type: "InvoicePaid", invoiceId: i.id, at }],
  };
}
```

Lợi ích: hàm vẫn thuần, test khẳng định `events` bằng `toEqual` mà không cần mock mailer; thời điểm `at` do người gọi truyền vào. Điểm tinh tế: nếu bạn **phát sự kiện trước khi lưu** và lưu thất bại, người nhận đã được báo về điều không xảy ra; nếu **lưu rồi mới phát** mà tiến trình sập giữa chừng, sự kiện bị mất. Giải pháp bền (transactional outbox: ghi sự kiện vào cùng giao dịch rồi có tiến trình riêng phát đi) thuộc các phase sau; ở Phase 01 chỉ cần biết vấn đề tồn tại và không để domain gọi I/O. Đây là cách làm tuỳ chọn, chỉ đáng dùng khi bài của bạn có tác dụng phụ thật sự.

**6. Ai tạo ID và "bây giờ"?**

Domain nhận id và thời gian qua tham số (`create(input, id, now)`), hoặc qua một đối tượng nhỏ `{ newId(): Id; now(): Date }` được truyền vào use case. Lý do: test cố định được giá trị, không cần fake timers hay mock `crypto.randomUUID`. Với id sinh ở DB (auto-increment), entity chưa lưu **chưa có id**: mô hình bằng hai kiểu (`NewInvoice` không có id, `Invoice` có id) tốt hơn trường `id?: string` rồi phải kiểm ở khắp nơi (cùng ý với "trạng thái là union").

## Tricks & tips thực tế

- **Lưu `version` trong aggregate nạp lên và truyền vào `save`**: bên gọi không tự đoán version, nên không thể "lách" khoá. Lý do: nếu version nằm ngoài aggregate thì dễ bị lấy sai thời điểm (đọc lại ngay trước khi lưu thì xung đột bị che).
- **Đừng thử lại vô điều kiện khi gặp `VERSION_CONFLICT`**: nạp lại aggregate, áp dụng lại luật rồi mới lưu; áp dụng lại bản đã tính trên dữ liệu cũ là mất cập nhật của người kia.
- **Giữ aggregate nhỏ**: aggregate to nghĩa là xung đột version thường xuyên hơn (nhiều người sửa cùng một bản ghi to). Một lý do thực tế để chia aggregate theo "luật phải nhất quán cùng lúc".
- **Chuẩn hoá thời gian về UTC ở ranh giới** và lưu dạng ISO có `Z` hoặc kiểu timestamp của DB; domain làm việc với `Date`. Lý do: cùng một chuỗi không có múi giờ có thể thành hai thời điểm khác nhau trên hai máy (xem ghi chú 5 của Bài 11).
- **Test ba tình huống ranh giới**: dữ liệu hỏng khi nạp (ném lỗi rõ ràng), xung đột phiên bản (trả `VERSION_CONFLICT`), lệnh lặp (không nhân đôi tác dụng). Lý do: đây là ba nguồn lỗi production mà test "đường vui" không chạm tới.
- **Đừng bắt `ZodError` rồi biến thành lỗi nghiệp vụ** ở tầng hydration: dữ liệu DB hỏng là sự cố cần cảnh báo, không phải điều người dùng sửa được.
- **Ghi lại quyết định "khoá lạc quan hay bi quan"** cùng lý do (tần suất xung đột, chi phí giữ khoá). Lý do: câu hỏi này lặp lại ở Phase DB và bài kiểm tra cuối phase.

## Tình huống mở để tự suy nghĩ

1. `Wallet.withdraw` kiểm "đủ số dư" rồi trừ. Hai request chạy song song trên Node (một tiến trình, bất đồng bộ) có thể đua nhau không? Còn với hai tiến trình/hai máy thì sao? Cái nào được `version` giải quyết, cái nào cần ràng buộc ở DB?
2. Webhook thanh toán đến hai lần cách nhau 50ms. Trình bày bằng lời hai cách làm cho kết quả đúng (khoá idempotency; hàm domain idempotent). Cách nào cần thêm chỗ lưu, cách nào cần thay đổi hợp đồng của hàm?
3. Dữ liệu cũ trong DB có một số dòng `status` mà code hiện tại không còn nhánh nào. Hydration nên ném, bỏ qua, hay ánh xạ sang nhánh "legacy"? Mỗi lựa chọn kéo theo hệ quả gì với báo cáo và với các hàm `switch` vét cạn?
4. Domain event trả về dạng mảng so với EventEmitter gọi ngay trong hàm: so sánh về khả năng test, thứ tự, và hành vi khi `save` thất bại.
5. Bạn có nên đưa `version` vào kiểu domain (`Invoice.version`) hay giữ nó ở tầng repository (trả `{ aggregate, version }`)? Đánh đổi là gì?

## Liên hệ bài tập

Domain layer Order của bạn chưa cần DB thật, nhưng bản repo in-memory nên đã thể hiện hai điều: không rò tham chiếu và (tuỳ chọn, nếu thấy đáng) kiểm tra `version`. Hãy tự quyết định có cần `version` ở phạm vi Phase 01 hay không và ghi lý do; kể cả khi không làm, bạn phải giải thích được vì sao kiểu không thay thế được nó. Với dữ liệu "đọc từ kho", thử viết một hàm hydration cho aggregate của bạn và test với dữ liệu hỏng. Những mục "Tình huống mở" ở trên là câu hỏi để bạn tự trả lời, không có đáp án trong notes.

## Đọc thêm

- [Zod: `discriminatedUnion` và coercion](https://zod.dev/api)
- [MDN: `structuredClone`](https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone)
- [TypeScript: Discriminated unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)
- Ý tưởng "optimistic locking", "idempotency key" và "transactional outbox": tìm theo tên; sẽ dùng thật ở các phase DB/queue.

## Ghi chú của bạn

