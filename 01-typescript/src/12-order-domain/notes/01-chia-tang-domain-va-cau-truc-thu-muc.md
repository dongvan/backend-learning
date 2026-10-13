# 1. Chia tầng domain thuần TypeScript và cấu trúc thư mục

Domain layer là phần code biểu diễn **luật nghiệp vụ**, không biết gì về HTTP, DB, framework. Nó chỉ là kiểu, hàm và class thuần TypeScript.

```ts
// domain: không import express, nest, prisma, zod request schema...
export function renew(loan: Loan): Result<ActiveLoan, LoanError> { /* luật gia hạn */ }

// hạ tầng (làm sau, ở phase khác): hiện thực interface mà domain khai báo
export class SqlLoanRepository implements LoanRepository { /* ... */ }
```

Ví dụ trong ghi chú dùng miền **thư viện** (Book, Member, Loan). Bài lab của bạn dùng miền Order; bạn tự quyết định mô hình, ghi chú chỉ nêu nguyên tắc và quy trình.

## Ý chính

- Bài 12 là bài **tổng hợp**: dùng lại mọi thứ từ Bài 1-11 (union, generics, utility types, Result, branded type, validation, test) vào một project nhỏ.
- Hướng phụ thuộc: hạ tầng và ứng dụng **phụ thuộc vào domain**, domain không phụ thuộc ai. Domain khai báo interface (Repository), hạ tầng cài đặt.
- Domain layer = entity, value object, aggregate, domain service, repository interface, lỗi nghiệp vụ.
- Ở Phase 01 **không có DB, không HTTP, không framework**. Persistence dùng bản in-memory để chạy được test.
- Lợi ích có thể kiểm chứng: toàn bộ test domain chạy mili-giây, không cần dựng môi trường.

## Lý thuyết chi tiết

**Vì sao tách domain.** Trong Laravel, một Eloquent model vừa là bản ghi DB, vừa chứa logic, vừa có thể gọi `save()` ở bất kỳ đâu (kiểu "fat model" / Active Record). Tiện cho CRUD, nhưng:

| Eloquent "fat model" | Domain model thuần |
|---|---|
| Dữ liệu và persistence dính nhau (`$order->save()`) | Entity chỉ giữ dữ liệu và luật; lưu qua Repository |
| Mọi thuộc tính mutable, ai cũng `$order->status = 'x'` | Đổi trạng thái qua hàm/phương thức có kiểm tra luật |
| Test thường cần DB | Test không cần DB |
| Trạng thái nghiệp vụ là cột chuỗi + nullable | Union kiểu chặt, trạng thái sai không biểu diễn được |
| Hợp với CRUD đơn giản | Hợp khi luật nghiệp vụ phức tạp, đáng bảo vệ |

Không có cái nào "đúng tuyệt đối". Với CRUD mỏng, domain model là thừa. Bài 12 chọn cách thuần để bạn học tư duy mô hình hoá; hãy tự trả lời được "khi nào mình sẽ **không** dùng cách này?".

**Các tầng ở mức nhẹ (liên hệ DDD).**

```
domain/          luật nghiệp vụ thuần (bài này)
application/     use case: điều phối domain + repository (Phase sau)
infrastructure/  DB, HTTP client, email (Phase sau)
interface/       controller, DTO, validation request (Phase sau; Bài 9 chạm tới)
```

DDD (Domain-Driven Design) là cả một hệ phương pháp; ở đây chỉ mượn vài từ vựng: **entity** (có danh tính), **value object** (so sánh theo giá trị), **aggregate** (cụm đối tượng đổi cùng nhau qua một cửa vào), **repository**, **domain service**. Không cần theo đúng giáo điều.

**Cấu trúc thư mục gợi ý theo nguyên tắc** (không phải đáp án, bạn tự điều chỉnh):

```
src/12-<tên>/
  domain/
    shared/        # kiểu dùng chung: Result, Money, branded id
    <aggregate>/   # mỗi aggregate một thư mục: kiểu, hàm chuyển trạng thái, lỗi, repository interface
  <aggregate>.test.ts hoặc đặt test cạnh file
```

Hai cách chia: **theo loại** (`entities/`, `value-objects/`, `repositories/`) hoặc **theo tính năng / aggregate** (`loan/`, `member/`). Theo aggregate thường dễ sửa hơn: khi đổi luật gia hạn, mọi file liên quan nằm một chỗ. Theo loại phù hợp project rất nhỏ. Chọn một, ghi lý do.

**Ranh giới import.** Quy ước đơn giản, tự kiểm tra bằng mắt hoặc grep: file trong `domain/` không được `import` từ thư mục hạ tầng, không import thư viện web/DB. Ngoại lệ có chủ đích duy nhất ở Phase 01 là Zod, và Zod nên ở **ranh giới** (parse input thô thành dữ liệu domain), không nằm bên trong luật domain.

**Hai loại "kiểu" cần phân biệt (từ Bài 9, 10).**

- **DTO / input thô**: dữ liệu từ ngoài, chưa tin cậy, được Zod validate.
- **Domain type**: dữ liệu đã hợp lệ, đã mang ràng buộc (ID có brand, số lượng nguyên dương).

Hàm "tạo" ở ranh giới biến loại thứ nhất thành loại thứ hai (parse, don't validate). Bên trong domain, không kiểm tra lại những gì kiểu đã bảo đảm.

## Tricks & tips thực tế

- **Bắt đầu từ ngôn ngữ nghiệp vụ, không từ kiểu.** Viết ra câu bằng tiếng Việt: "một phiếu mượn đang hoạt động có thể gia hạn tối đa 2 lần". Từ danh từ rút ra entity/value object, từ động từ rút ra hàm. Lý do: mô hình lệch ngôn ngữ nghiệp vụ thì sau này người đọc phải dịch hai lần.
- **Đặt tên theo từ nghiệp vụ** (`renew`, `giveBack`) thay vì thuật ngữ kỹ thuật (`update`, `setStatus`). `setStatus` cho phép mọi thứ; `renew` chứa luật.
- **Chưa cần class**: hàm thuần trên kiểu union thường đủ và dễ test. Dùng class khi muốn giấu constructor để ép tạo qua hàm kiểm tra (Money, ví dụ ở ghi chú 2) hoặc khi nhóm hành vi quanh dữ liệu giúp dễ đọc. Chọn có chủ đích và giải thích được.
- **Đừng thêm abstraction thừa**: CLAUDE.md và ROADMAP đều nhấn mạnh. Không `BaseEntity<T>` chung chung, không `UnitOfWork` khi chưa có nhu cầu. Mỗi tầng trừu tượng phải trả lời được "nó giải quyết vấn đề thật nào ngay bây giờ?".
- **Đừng vội làm đủ mọi thứ**: dựng lát cắt mỏng chạy được xuyên suốt trước (một aggregate, một luật, một test), rồi mở rộng. Lý do: sai hướng thiết kế sớm thì sửa ít tốn kém hơn.
- **Debug kiến trúc bằng "mùi" import**: nếu file domain cần import thứ gì ngoài kiểu và hàm thuần, hãy dừng lại hỏi vì sao; thường đó là dấu hiệu logic hạ tầng rò vào domain.
- **Giữ file nhỏ và một ý**: một file nên đọc hết trong một màn hình hoặc hai. Khi file ôm cả kiểu, luật, lỗi, repo thì tách ra, nhưng tách theo ý, không theo "mỗi kiểu một file" máy móc.
- **Với `moduleResolution: NodeNext` và `commonjs`** trong repo hiện tại, import tương đối giữa file `.ts` chạy tốt như các bài trước; việc chuyển ESM (kéo theo đuôi `.js` trong import) thuộc Bài 8, đừng tự đổi khi làm Bài 12 nếu chưa đến lượt.

- **Kiểm tra ranh giới import bằng lệnh, không bằng trí nhớ**: `grep -rnE "from \"(zod|node:|fs|http)" src/12-*/domain` (điều chỉnh theo thư mục của bạn) và đọc từng kết quả. Lý do: lệch ranh giới thường xảy ra từng bước nhỏ ("chỉ import một tiện ích"), một lệnh chạy lại được còn hơn lần xem mắt.
- **Cẩn thận vòng phụ thuộc giữa các file** (`a.ts` import `b.ts` và `b.ts` import `a.ts`): `tsc` vẫn sạch nhưng lúc chạy có thể lỗi. Thử với `tsx` trong dự án `commonjs`: hai file import vòng và dùng giá trị của nhau ngay lúc nạp module cho `ReferenceError: Cannot access 'makeB' before initialization` (đã chạy; thông điệp và việc có lỗi hay giá trị `undefined` phụ thuộc cách transform và thứ tự import). Lý do cần biết: lỗi chỉ xuất hiện ở một thứ tự import nhất định nên rất khó lần ra. Cách tránh: kiểu dùng chung đặt ở file riêng (`shared/`), tham chiếu giữa aggregate bằng ID thay vì import lẫn nhau.
- **Tránh `index.ts` "barrel" ở giai đoạn đầu**: file tái xuất mọi thứ làm dễ vô tình import ngược lên và che hướng phụ thuộc. Khi cần, thêm sau cùng. Lý do: mỗi barrel là một chỗ thêm cho vòng phụ thuộc và cho kéo cả module vào khi chỉ cần một hàm.
- **Phân biệt `domain error` và `application error`**: "hết lượt" là domain; "không tìm thấy bản ghi theo id" thường là application (use case). Đặt sai chỗ làm domain phải biết khái niệm của kho dữ liệu.
- Xem thêm ghi chú 5 (cạm bẫy mô hình hoá) và 6 (nạp dữ liệu, xung đột đồng thời, xử lý lặp).

## Liên hệ bài tập

Lab Bài 12: domain layer đầy đủ cho Customer, Product, Order, OrderItem, Payment, kèm test. Gợi ý quy trình, chưa phải đáp án: (1) viết ra ngôn ngữ nghiệp vụ và danh sách luật; (2) xác định cái nào là entity, cái nào là value object, ranh giới aggregate ở đâu và vì sao; (3) chọn cấu trúc thư mục và ghi lý do; (4) dựng lát cắt mỏng rồi mở rộng; (5) tự review theo checklist ở ghi chú 4. Bạn phải giải thích lại được mọi quyết định thiết kế.

## Đọc thêm

- [TypeScript Handbook: Modules](https://www.typescriptlang.org/docs/handbook/2/modules.html)
- Ý tưởng "Domain-Driven Design" (Eric Evans) và "Hexagonal Architecture" (Alistair Cockburn): tìm theo tên; chỉ cần nắm khái niệm ở mức nhẹ.

## Ghi chú của bạn
