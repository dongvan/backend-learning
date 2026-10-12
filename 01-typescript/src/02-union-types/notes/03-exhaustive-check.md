# 3. Exhaustive check bằng `never`

Làm cho compiler báo lỗi khi bạn thêm một nhánh mới vào union mà quên xử lý ở đâu đó.

```ts
function assertNever(x: never): never {
  throw new Error(`Unhandled: ${JSON.stringify(x)}`);
}

function perimeter(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return 2 * Math.PI * s.radius;
    case "rect":
      return 2 * (s.width + s.height);
    default:
      return assertNever(s);   // s: never nếu đã xử lý hết; thêm nhánh mới thì dòng này lỗi
  }
}
```

## Ý chính

- Sau khi mọi nhánh đã được loại bằng narrowing, biến còn lại có kiểu `never`. Truyền `never` vào hàm nhận `never` thì hợp lệ; còn một nhánh sót thì kiểu không phải `never` và compiler báo lỗi.
- Lợi ích lớn nhất: đây là lưới an toàn khi refactor. Thêm một trạng thái, compiler chỉ ra mọi `switch` cần cập nhật.
- Hai lớp bảo vệ khác nhau: **compile-time** (kiểu của bạn) và **runtime** (`throw` trong `assertNever` cho dữ liệu ngoài kiểu).
- Không viết `default` xử lý "những trường hợp còn lại" cho logic nghiệp vụ, vì nó che mất lỗi.

## Lý thuyết chi tiết

**Vì sao `s` là `never` ở `default`?** Mỗi `case` loại một thành viên khỏi union. Hết thành viên thì phần còn lại là tập rỗng, tức `never`. Nếu ai đó thêm `{ kind: "triangle" }`, `default` còn lại triangle, không gán được cho `never`, nên lỗi hiện ngay tại `assertNever(s)`.

**Hàm `assertNever` phải khai báo `: never`** (kiểu trả về tường minh). Compiler chỉ coi lời gọi là "không bao giờ quay lại" khi hàm có chú thích kiểu rõ ràng. Hàm khai báo bằng `function` hoặc `const` kèm kiểu đều được.

**Switch đầy đủ không cần `default`** nếu hàm có kiểu trả về tường minh. Compiler hiểu cuối `switch` là mã không chạy tới:

```ts
function area(s: Shape): number {
  switch (s.kind) {
    case "circle": return 1;
    case "rect": return 2;
  }                       // OK. Thêm nhánh mới vào Shape thì lỗi "Function lacks ending return statement"
}
```

Đây cũng là một kiểu exhaustive check, bắt được bằng `noImplicitReturns` và kiểu trả về tường minh. Tuy nhiên chỉ hoạt động khi hàm *trả về giá trị*. Với hàm `void` hoặc `switch` chỉ có tác dụng phụ, bạn cần `assertNever`.

**Hai bảo vệ khác nhau.** Bản `switch` không `default` chỉ có bảo vệ compile-time. Khi dữ liệu runtime mang tag lạ (từ DB, API đối tác, phiên bản cũ), hàm sẽ âm thầm trả `undefined` dù kiểu nói là `number`. Nên với dữ liệu có thể đến từ ngoài, `default: return assertNever(x)` an toàn hơn vì nó ném lỗi to rõ.

**Dạng bảng tra.** `Record` cũng ép đủ khoá:

```ts
type Status = "draft" | "sent";
const label: Record<Status, string> = { draft: "Nháp", sent: "Đã gửi" };   // thiếu khoá thì lỗi

// satisfies giữ kiểu hẹp của object mà vẫn kiểm tra đủ khoá (TS 4.9+)
const label2 = { draft: "Nháp", sent: "Đã gửi" } satisfies Record<Status, string>;
```

**Chuỗi `if / else if`** cũng làm được, nhớ nhánh `else` cuối:

```ts
if (s.kind === "circle") return 1;
else if (s.kind === "rect") return 2;
else return assertNever(s);
```

## Tricks & tips thực tế

- **Chính sách cho tag lạ**. Chọn có chủ ý:
  - Dữ liệu nội bộ (bạn kiểm soát cả hai đầu): `assertNever` ném lỗi, lỗi to để sửa sớm.
  - Dữ liệu từ ngoài (webhook, message queue): hệ thống đối tác có thể thêm loại sự kiện mới. Ghi log rồi bỏ qua thường tốt hơn là làm sập tiến trình. Khi đó vẫn giữ nhánh `default` nhưng xử lý nhẹ nhàng thay vì ném lỗi.
- **Bật lint `@typescript-eslint/switch-exhaustiveness-check`**: bắt `switch` thiếu nhánh kể cả khi hàm trả `void`. Rất đáng bật khi có lint.
- **Thông điệp lỗi hữu ích cho `assertNever`**: ở runtime `x` có thể là bất kỳ thứ gì. `JSON.stringify` đủ cho đa số trường hợp, nhưng với object vòng sẽ ném lỗi khác. Nếu cần chắc chắn, in `String(x)` hoặc chỉ in thuộc tính tag.
- **Mọi `default` đều nên nghi ngờ**. `default: return 0` "cho yên tâm" làm nhánh mới thêm vào bị xử lý như `0` mà không ai biết. Chỉ dùng `default` làm cầu chì (`assertNever`).
- **Một lỗi compile ở nhiều chỗ là tính năng, không phải phiền toái**. Mỗi chỗ báo lỗi là một nơi phải cân nhắc nghiệp vụ cho trạng thái mới.
- **So với PHP 8 `match`**: `match` ném `UnhandledMatchError` khi không khớp, nhưng chỉ ở runtime, trên đúng đường đi bị chạy. TypeScript bắt từ lúc compile, cho mọi nhánh.
- **Đừng dùng `as never`** để "tắt lỗi" exhaustive check. Lỗi ở đó là thông tin đúng, hãy xử lý nhánh còn thiếu.
- **Kiểm tra bằng thí nghiệm**: tạm thêm một nhánh vào union, chạy `npm run type-check`, xem những chỗ nào báo lỗi, rồi hoàn tác. Cách rẻ nhất để chắc chắn lưới an toàn đang hoạt động.

## Liên hệ bài tập

Mọi hàm xử lý trạng thái Order và Payment trong bài lab Bài 2 nên có exhaustive check. Thử thêm một trạng thái giả vào union và xem compiler chỉ ra những đâu.

## Đọc thêm

- [Exhaustiveness checking](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking)
- [The `never` type](https://www.typescriptlang.org/docs/handbook/2/functions.html#never)

## Ghi chú của bạn

