# 5. Cạm bẫy và tình huống thực tế với union

Các lỗi gặp thường xuyên khi dùng union và discriminated union trong backend, kèm cách nhận ra và cách sửa. Mọi ví dụ trong ghi chú này đã được `tsc` kiểm chứng với `tsconfig.json` của repo.

```ts
type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "rect"; width: number; height: number };
```

## Ý chính

- Hầu hết lỗi với union đến từ việc **tag bị mở rộng (widen) thành `string`**, hoặc từ việc **làm mất thông tin narrowing** (biến `let`, `Omit` trên union, spread).
- Compiler báo lỗi là thông tin đúng. Cách sửa thường là chỉnh *kiểu* hoặc *cách viết*, hiếm khi cần `as`.
- Luôn thử phá bằng một dòng sai (`// @ts-expect-error`) để chắc chắn kiểu đang bảo vệ bạn.

## Lý thuyết chi tiết

**1. Tag bị widen khi khai báo qua biến**

```ts
const widened = { kind: "circle", radius: 1 };   // kind: string
const bad: Shape = widened;                      // Lỗi: string không gán được cho "circle" | "rect"

const ok1: Shape = { kind: "circle", radius: 1 };                 // OK: ngữ cảnh kiểu giữ literal
const ok2 = { kind: "circle", radius: 1 } as const;                // OK: as const giữ literal (readonly)
const ok3 = { kind: "circle", radius: 1 } satisfies Shape;         // OK: giữ literal và vẫn kiểm tra
```

Lý do: object literal không có kiểu đích thì thuộc tính `string` bị mở rộng (xem Bài 1, ghi chú 1). Cách tự nhiên nhất là ghi kiểu cho biến hoặc dùng hàm tạo trả đúng kiểu.

**2. Hàm tạo (constructor function) giữ tag đúng**

```ts
const circle = (radius: number): Extract<Shape, { kind: "circle" }> => ({ kind: "circle", radius });
```

Hàm tạo là nơi duy nhất viết literal `"circle"`; nơi khác gọi hàm. Tag sai chính tả bị bắt tại đó, không rải rác khắp code.

**3. `filter` và narrowing**

```ts
const shapes: Shape[] = [];
const circles = shapes.filter((s) => s.kind === "circle");
```

Từ TS 5.5, compiler **tự suy ra type predicate** cho callback đơn giản kiểu này, nên `circles` có kiểu mảng `circle`. Trước TS 5.5 vẫn là `Shape[]` và phải viết predicate tay:

```ts
const circles = shapes.filter(
  (s): s is Extract<Shape, { kind: "circle" }> => s.kind === "circle",
);
```

Compiler (ở đây là TS 7.0 trong repo) chỉ suy ra predicate khi điều kiện thật sự là "khi và chỉ khi". Biểu thức phức tạp (nhiều điều kiện, gọi hàm khác) thì vẫn cần viết tay. Nếu không chắc, hover kết quả của `filter` để xem.

**4. `Omit`/`Pick` trên union làm mất cấu trúc union**

```ts
type Bad = Omit<Shape, "kind">;   // {}  (chỉ còn những khoá chung của mọi nhánh)
const b: Bad = {};                // hợp lệ, mất sạch thông tin
```

`keyof` của một union là các khoá **chung**, nên `Omit` làm phẳng. Muốn bỏ một khoá khỏi từng nhánh, phải "phân phối" (conditional type, Bài 6):

```ts
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type NoKind = DistOmit<Shape, "kind">;   // { radius: number } | { width: number; height: number }
```

Thường gặp khi dẫn xuất DTO tạo mới (bỏ `id`, `status`) từ một union entity.

**5. Narrowing bị mất khi destructure ra `let`**

```ts
function f(s: Shape) {
  let { kind } = s;            // let, có thể gán lại
  if (kind === "circle") {
    return s.radius;           // Lỗi: s chưa được thu hẹp
  }
  return 0;
}
```

Destructure ra `const` (TS 4.6+) thì giữ được narrowing. Dùng `const`, hoặc kiểm tra trực tiếp `s.kind`.

**6. Spread khi đổi nhánh mang theo trường không thuộc nhánh đích**

```ts
type Open = { status: "open"; note: string };
type Closed = { status: "closed"; closedAt: number };

function close(o: Open): Closed {
  return { ...o, status: "closed", closedAt: 1 };   // KHÔNG lỗi, nhưng kết quả có thêm `note` lúc chạy
}
```

Kiểm tra thuộc tính thừa không áp dụng cho spread. Kết quả có runtime shape `{ status: "closed", note, closedAt }`, và `note` rò vào JSON/DB. Liệt kê tường minh các trường của nhánh đích khi chuyển nhánh (xem ghi chú 4).

**7. `in` mong manh hơn discriminant**

```ts
type A = { a: string } | { b: number };
function g(x: A) { return "a" in x ? x.a : x.b; }
```

Hợp lệ, nhưng nếu sau này một nhánh khác cũng có `a` thì logic hỏng mà compiler không phàn nàn. Thêm tag `kind`.

**8. Discriminant optional hay `undefined` làm hỏng narrowing**

Tag phải là literal **bắt buộc** ở mọi nhánh. `kind?: "circle"` hoặc một nhánh để `kind: string` khiến compiler không lọc được.

**9. Hai union độc lập vs union của tổ hợp**

```ts
type Pair = { order: "paid" | "open"; payment: "ok" | "failed" };   // 4 tổ hợp
```

Nếu chỉ vài tổ hợp hợp lệ (ví dụ `paid` kéo theo `ok`), thì mô hình bằng union của từng tổ hợp thay vì hai trường độc lập:

```ts
type Valid =
  | { order: "open"; payment: "failed" | "pending" }
  | { order: "paid"; payment: "ok" };
```

Chỉ làm vậy khi tổ hợp thật sự ràng buộc; nếu độc lập thì giữ hai trường riêng.

## Tricks & tips thực tế

- **Webhook/queue có thể gửi tag mới**: Stripe, GitHub, v.v. thêm sự kiện mới theo thời gian. Parse bằng schema (Bài 9), nhánh không nhận ra thì ghi log và bỏ qua, đừng để `assertNever` làm sập worker. Lý do: lỗi ở hệ thống đối tác không nên làm hỏng việc xử lý các sự kiện khác.
- **Idempotency của chuyển trạng thái**: webhook thường gửi lặp. Hàm chuyển `paid → paid` nên xử lý rõ ràng (bỏ qua hay báo lỗi) và được ghi lại trong test; để compiler bắt `markPaid(order: PlacedOrder)` thì lần gọi thứ hai bị từ chối ở kiểu, nhưng dữ liệu đọc lại từ DB là `unknown`/`Row`, nên vẫn cần kiểm tra ở runtime.
- **Concurrency**: kiểu không bảo vệ khỏi hai request đồng thời cùng chuyển trạng thái. Cần khoá/optimistic locking ở database (ví dụ `UPDATE … WHERE status = 'placed'` và kiểm tra số dòng ảnh hưởng). Kiểu chỉ đảm bảo hình dạng, không đảm bảo thứ tự thời gian.
- **Lưu lịch sử**: nếu cần biết "đã từng ở trạng thái nào", đừng nhét vào một trường `previousStatus` mơ hồ; lưu bảng sự kiện/lịch sử (event log) và suy ra trạng thái hiện tại. Kiểu union vẫn mô tả trạng thái hiện tại.
- **Trạng thái "cuối" (terminal)**: `delivered`, `cancelled` thường không có chuyển tiếp ra ngoài; thể hiện bằng việc không có hàm chuyển nào nhận chúng làm tham số.
- **Đặt tên theo ngôn ngữ nghiệp vụ** (ubiquitous language): `PlacedOrder`, `ShippedOrder`, thay vì `OrderState2`. Hỏi chuyên gia nghiệp vụ (hoặc chính bạn) tên gọi thật của từng trạng thái.
- **Kiểm tra độ bao phủ bằng thí nghiệm "thêm một trạng thái"**: tạm thêm một nhánh và chạy `npm run type-check`; số lỗi bạn thấy là số chỗ code phụ thuộc vào tập trạng thái. Nhiều quá thì xem có chỗ nào đang `if/else` theo chuỗi thay vì dùng bảng tra hoặc hàm đa hình.
- **Hiệu năng/kích thước**: union rất lớn (hàng trăm thành viên) làm compiler chậm; hiếm gặp trong domain backend.
- **So với Laravel**: enum PHP 8.1 backed enum + cột nullable + method `canTransitionTo()` là cách quen thuộc. Ở TypeScript, "được phép chuyển hay không" nằm ngay chữ ký hàm, còn `canTransitionTo` runtime chỉ cần cho dữ liệu đến từ ngoài.

## Liên hệ bài tập

`EXERCISE.md` của Bài 2: các câu hỏi về spread, tag lạ từ DB/webhook, và quan hệ Order–Payment đều có liên quan trực tiếp đến mục 1, 4, 6 và phần tips ở trên.

## Đọc thêm

- [Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
- [TypeScript 5.5: Inferred type predicates](https://devblogs.microsoft.com/typescript/announcing-typescript-5-5/)
- [Distributive conditional types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types)

## Ghi chú của bạn

