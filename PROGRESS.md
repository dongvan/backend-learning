# Progress

Roadmap: [`ROADMAP.md`](ROADMAP.md)

**Phase hiện tại:** 01 — Advanced TypeScript (bắt đầu 2026-10-09)
**Bài hiện tại:** 2 — Union & discriminated union (đang làm)

Quy ước trạng thái: ⬜ chưa học · 🟡 đang làm · ✅ hoàn thành (phải có bằng chứng ở cột Kết quả).

## Phase 01 — Advanced TypeScript

Kế hoạch: [`01-typescript/PLAN.md`](./01-typescript/PLAN.md)

| # | Bài | Trạng thái | Kết quả kiểm tra | Ngày |
|---|---|---|---|---|
| 1 | Type system cơ bản | ✅ | `tsc --noEmit` sạch; vitest 8/8 pass; không `any`, không mutate; trả lời được 4 câu hỏi nộp + 4 câu kiểm tra (còn vài điểm cần củng cố, xem dưới) | 2026-10-13 |
| 2 | Union & discriminated union | 🟡 | | |
| 3 | Generics & constraints | ⬜ | | |
| 4 | Utility types | ⬜ | | |
| 5 | keyof / typeof / mapped types | ⬜ | | |
| 6 | Conditional types & infer | ⬜ | | |
| 7 | Function types, overloads, async | ⬜ | | |
| 8 | Module system & tsconfig | ⬜ | | |
| 9 | Runtime validation với Zod | ⬜ | | |
| 10 | Error handling & API contracts | ⬜ | | |
| 11 | Testing | ⬜ | | |
| 12 | Project: Order domain layer | ⬜ | | |

Definition of Done Phase 01: xem `01-typescript/PLAN.md`. Trạng thái: chưa đạt.

## Kiến thức còn yếu

_Ghi lại sau mỗi lần review: khái niệm, biểu hiện, bài liên quan, đã khắc phục chưa._

- **Bài 1 — `readonly` chỉ là compile-time và nông (shallow):** ví dụ sai `items[0].status = 'new'` (đó là lỗi vì thuộc tính không tồn tại, không minh hoạ readonly); đúng là `items[0].qty = 5` vẫn hợp lệ. Chưa nêu được `readonly` không có tác dụng runtime (cần `Object.freeze`). Chưa khắc phục.
- **Bài 1 — làm tròn tiền bằng `Math.round(x*100)/100`:** chưa nêu được kết quả cụ thể của `price: 1.005` (ra `1.00`, không phải `1.01`). Hướng đúng đã nắm: lưu số nguyên đơn vị nhỏ nhất. Chưa khắc phục trong code.
- **Bài 1 — suy luận kiểu trả về:** chưa nêu được kiểu suy luận là `number`, và rủi ro chính khi bỏ annotation (đổi thân hàm làm kiểu trả về đổi âm thầm). Chưa khắc phục.
- **Bài 1 — declaration merging:** nắm đúng cơ chế; cần nhớ file là module thì không merge giữa các file (trong repo này `NodeNext` ép mọi file thành module); merge chỉ trong cùng scope hoặc qua `declare global`/`declare module`.

## Các phase tiếp theo

02–10: ⬜ chưa bắt đầu (chỉ mở sau khi Phase trước đạt DoD).
