# Phase 01 — Kế hoạch bài học

Thứ tự theo phụ thuộc kiến thức. Thời lượng dự kiến 4–6 tuần, có thể điều chỉnh theo tiến độ thực tế.
Thư mục bài: `src/NN-<tên-bài>/` (Bài 1 dùng `src/01-type-system/` có sẵn).

## Bài học

| # | Bài | Nội dung | Bài tập (tóm tắt) | Phụ thuộc |
|---|---|---|---|---|
| 1 | Type system cơ bản | Inference, structural typing, `type` vs `interface`, `unknown`/`never`, narrowing | `calculateOrderTotal(order)` | — |
| 2 | Union & discriminated union | Union, intersection, exhaustive check bằng `never` | Mô hình trạng thái Order và Payment | 1 |
| 3 | Generics & constraints | Generic function/type/class, `extends`, default type param | `Result<T>`, `Repository<T>` in-memory (type only) | 1–2 |
| 4 | Utility types | `Pick`, `Omit`, `Partial`, `Required`, `Readonly`, `Record`, `ReturnType`, `Awaited` | Dẫn xuất DTO từ entity | 3 |
| 5 | `keyof`, `typeof`, indexed access, mapped types | Key remapping, dựng lại utility types | Tự viết `MyPick`, `MyReadonly`, `Getters<T>` | 3–4 |
| 6 | Conditional types & `infer` | Distributive conditional, `infer`, template literal types | `UnwrapPromise`, `EventName<T>` | 5 |
| 7 | Function types, overloads, async | Overloads, `Promise<T>`, `satisfies`, `as const` | Hàm có overload và config `as const` | 3, 6 |
| 8 | Module system & `tsconfig` | ESM/CJS, `moduleResolution`, `verbatimModuleSyntax`, strict flags | Chuyển project sang ESM, giải thích từng flag | 1–7 |
| 9 | Runtime validation với Zod | `z.infer`, `parse` vs `safeParse`, branded types | Schema cho input tạo Order | 2, 4, 8 |
| 10 | Error handling & API contracts | `Result<T, E>`, typed errors, tách DTO và domain | Contract tạo Order, lỗi có kiểu | 3, 9 |
| 11 | Testing | Vitest cho business logic, type tests (`expectTypeOf`), edge cases | Bổ sung test cho Bài 1–10 | 1–10 |
| 12 | Project: Order domain layer | Customer, Product, Order, OrderItem, Payment | Domain layer đầy đủ + test | 1–11 |

Đề chi tiết của từng bài nằm trong `EXERCISE.md`, chỉ tạo khi bắt đầu bài đó.

## Tiêu chí đánh giá mỗi bài

- [ ] `npm run type-check` sạch, không dùng `any` (nếu có thì ghi lý do).
- [ ] Test pass, gồm trường hợp thường, rỗng và giá trị biên.
- [ ] Không mutate dữ liệu đầu vào.
- [ ] Giải thích lại được bằng lời: vì sao chọn type này, TypeScript suy luận ra gì.
- [ ] Đã review và refactor.
- [ ] `PROGRESS.md` được cập nhật kèm bằng chứng.

## Definition of Done (Phase 01)

Theo ROADMAP §8, kèm tiêu chí riêng của Phase 01:

- [ ] Nắm các concept cốt lõi của 10 nhóm nội dung.
- [ ] Tự triển khai bài tập, không phụ thuộc hoàn toàn vào AI.
- [ ] Có test cho các hành vi quan trọng; xử lý edge cases chính.
- [ ] Không dùng `any` khi chưa có lý do rõ ràng.
- [ ] Giải thích được type inference và các quyết định thiết kế type.
- [ ] Dùng discriminated union để mô hình hóa trạng thái.
- [ ] Phân biệt dữ liệu đã validate với dữ liệu đầu vào chưa đáng tin cậy.
- [ ] Project Order domain layer hoàn thành, đã review và refactor.
- [ ] Có ghi chú kiến thức; `PROGRESS.md` đã cập nhật.
- [ ] Qua bài kiểm tra cuối phase (câu hỏi đánh giá do agent đặt, bạn trả lời).

Chưa đạt đủ thì luyện tiếp; không bắt đầu Node.js hoặc NestJS.
