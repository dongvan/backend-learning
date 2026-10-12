# 4. Repository, domain service, quy trình tự review và checklist

Repository là cổng để domain "lấy và cất" aggregate mà không biết DB; domain service giữ luật liên quan nhiều aggregate; review là bước biến code chạy được thành code bạn bảo vệ được.

```ts
interface LoanRepository {
  findById(id: LoanId): Promise<Loan | undefined>;
  findActiveByMember(memberId: MemberId): Promise<readonly Loan[]>;
  save(loan: Loan): Promise<void>;
}

// domain service: luật cần nhìn nhiều aggregate nên không thuộc riêng entity nào
const MAX_ACTIVE_LOANS = 3;
async function canBorrow(repo: LoanRepository, memberId: MemberId): Promise<boolean> {
  return (await repo.findActiveByMember(memberId)).length < MAX_ACTIVE_LOANS;
}
```

## Ý chính

- **Repository interface thuộc về domain**; cài đặt (SQL, Prisma, in-memory) thuộc hạ tầng. Phase 01 chỉ cần bản **in-memory** để test.
- Repository làm việc với **aggregate root**, trả và nhận kiểu domain, không trả row DB.
- **Domain service** là hàm/class phi trạng thái cho luật không thuộc riêng một entity. Đừng dùng nó làm chỗ chứa mọi thứ.
- Phần **điều phối** (nạp từ repo, gọi luật, lưu lại) là use case/application service; ở Phase 01 có thể viết mỏng hoặc để cho test đóng vai đó.
- Quy trình: viết, chạy, **review theo checklist**, refactor, rồi giải thích lại bằng lời.

## Lý thuyết chi tiết

**Repository.** Interface khai báo theo **ngôn ngữ nghiệp vụ** (`findActiveByMember`), không theo SQL (`selectWhere`). Hai quyết định thiết kế:

- **Trả `T | undefined` hay ném khi không tìm thấy?** `undefined` buộc người gọi xử lý (compiler buộc kiểm tra trước khi dùng, giống `noUncheckedIndexedAccess`); ném lỗi phù hợp khi "không có" thật sự là bất thường. Chọn một cách nhất quán.
- **Trả mảng `readonly`** để người gọi không sửa kho nội bộ.

Bản in-memory (đã chạy thật):

```ts
class InMemoryLoanRepository implements LoanRepository {
  private readonly store = new Map<LoanId, Loan>();

  async findById(id: LoanId) { return this.store.get(id); }
  async findActiveByMember(memberId: MemberId) {
    return [...this.store.values()].filter((l) => l.memberId === memberId && l.status === "active");
  }
  async save(loan: Loan) { this.store.set(loan.id, loan); }
}
```

Các phương thức `async` dù không có I/O thật, để chữ ký giống bản DB sau này: đổi cài đặt không buộc sửa domain.

**Cạm bẫy repo in-memory.** Nếu lưu và trả **cùng tham chiếu** object mutable, test có thể "xanh" nhờ sửa gián tiếp mà bản DB thật không làm được. Giữ aggregate bất biến (như các ghi chú trước) thì hết vấn đề; nếu mutable, sao chép khi lưu và khi đọc.

**Domain service.** Dấu hiệu một luật thuộc domain service: cần dữ liệu từ nhiều aggregate hoặc từ repository (như "một thành viên không mượn quá 3 cuốn": cần đếm các phiếu, không thuộc một Loan hay Member riêng). Luật chỉ dùng dữ liệu của một aggregate thì đặt trong chính aggregate (hàm `renew`). Domain service nhận phụ thuộc (repo) qua tham số/constructor, dễ truyền fake.

**Test domain với fake.**

```ts
it("chặn khi đủ 3 phiếu đang mượn", async () => {
  const repo = new InMemoryLoanRepository();
  for (const i of ["1", "2", "3"]) await repo.save(makeLoan({ id: `l${i}` as LoanId }));
  expect(await canBorrow(repo, "m1" as MemberId)).toBe(false);
  expect(await canBorrow(repo, "m2" as MemberId)).toBe(true);
});
```

**Quy trình review và refactor.** Một vòng cho mỗi lát cắt:

1. **Chạy** `npm run type-check` và `npm test`: cả hai xanh.
2. **Đọc lại như người lạ**: tên có theo ngôn ngữ nghiệp vụ? Có hàm nào làm hai việc?
3. **Săn invariant hở**: có đường nào tạo ra đối tượng sai? (constructor public, `as`, trường mutable, kiểu `string` thay cho ID.)
4. **Săn trùng lặp và abstraction thừa**: cái gì chỉ dùng một lần mà bọc ba lớp?
5. **Phá thử**: thêm một trạng thái giả vào union, sửa luật, đổi chữ ký; xem compiler và test có kêu đúng chỗ.
6. **Refactor nhỏ**, chạy lại test sau mỗi bước. Test xanh trước, xanh sau; không đổi hành vi trong lúc refactor.
7. **Giải thích lại bằng lời** cho chính mình hoặc người hướng dẫn: vì sao chọn mô hình này, đánh đổi gì, khi nào cách này không phù hợp.

Dùng AI agent theo ROADMAP §7: nhờ review và chất vấn, nhưng phần viết lời giải do bạn làm, và bạn phải hiểu từng dòng mình nộp.

## Tricks & tips thực tế

- **Viết repo interface sau khi có use case cần nó**, không phải trước. Lý do: bạn chỉ thêm phương thức khi có nhu cầu thật, tránh interface phình (`findAll`, `findByX`... không ai dùng).
- **Không để repo chứa luật nghiệp vụ**: nó chỉ nạp/lưu. Nếu thấy `if` nghiệp vụ trong repo, chuyển nó vào domain. Lý do: logic nằm trong hạ tầng thì phải dựng hạ tầng mới test được.
- **Fake và test hợp đồng**: khi sau này có bản DB thật, chạy cùng một bộ test hợp đồng cho cả in-memory và bản thật để chắc chúng hành xử giống nhau.
- **Tên test là bảng đặc tả**: đọc danh sách tên test của aggregate phải thấy được mọi luật. Nếu không thấy, luật chưa được test.
- **Đừng tối ưu sớm**: `filter` trên `Map` là O(n), đủ cho test. Tối ưu truy vấn là việc của bản DB.
- **Đếm `as` và `!`** trong domain bằng `grep -nE " as |!\." -r domain/`: mỗi cái là nơi bỏ qua compiler, hãy chắc chúng chỉ ở hàm tạo ID/giá trị.
- **Debug "test xanh nhưng sai"**: cố ý bẻ code (đảo điều kiện, đổi `>=` thành `>`) xem test nào đỏ. Không test nào đỏ nghĩa là thiếu test ở chỗ đó.
- **Ghi lại quyết định** ngắn gọn (vì sao chọn số nguyên cho tiền, vì sao Order chứa OrderItem): vào "Ghi chú của bạn" hoặc PROGRESS khi bạn nộp. Lý do: bài kiểm tra cuối phase hỏi chính các quyết định này.

### Checklist trước khi nộp (thuộc phần Tricks & tips)

Không phải đáp án, mà là cách tự soát (lấy từ PLAN.md, ROADMAP §8 và các ghi chú trước):

- [ ] `npm run type-check` sạch; `npm test` xanh; không còn `.only`, `console.log` thừa.
- [ ] Không `any`. Mỗi `as`/`!` có lý do và nằm ở hàm tạo/ranh giới.
- [ ] Domain không import hạ tầng hay framework.
- [ ] Mọi trạng thái là discriminated union; mọi `switch` trên union có exhaustive check; thử thêm trạng thái giả để chắc.
- [ ] Danh sách invariant có đủ; mỗi cái được bảo vệ ở một tầng và có test từ chối, test ở biên.
- [ ] Tiền không dùng số thập phân; có test chính xác số học và (nếu có) làm tròn/chia.
- [ ] Hàm không mutate đầu vào; có test chứng minh.
- [ ] Lỗi nghiệp vụ trả `Result` với lỗi có tag; lỗi lập trình thì ném.
- [ ] ID có brand; chỉ hàm tạo được dùng `as`.
- [ ] Test không phụ thuộc DB, mạng, đồng hồ thật; thời gian truyền vào như tham số.
- [ ] Có type test hoặc `@ts-expect-error` cho các luật được bảo vệ bằng kiểu.
- [ ] Đã review theo quy trình trên và refactor ít nhất một vòng.
- [ ] Giải thích lại được: aggregate boundary, vì sao Result, vì sao tiền như vậy, khi nào cách này không phù hợp.
- [ ] `PROGRESS.md` được cập nhật kèm bằng chứng (kết quả chạy lệnh, không chỉ tick).

## Liên hệ bài tập

Dùng checklist này như bước cuối của lab Bài 12, sau khi tự hoàn thành domain layer cho Customer, Product, Order, OrderItem, Payment. Bạn sẽ cần một repository interface (ít nhất cho aggregate chính) kèm bản in-memory để test, và có thể một domain service nếu có luật liên aggregate (hãy tự tìm xem luật nào thật sự cần). Ghi lại những chỗ checklist khiến bạn sửa code; đó là nội dung tốt cho phần "kiến thức còn yếu" trong PROGRESS.

## Đọc thêm

- [TypeScript: `implements` và interface trong class](https://www.typescriptlang.org/docs/handbook/2/classes.html#implements-clauses)
- [Vitest: Mocking (fake vs mock)](https://vitest.dev/guide/mocking.html)

## Ghi chú của bạn
