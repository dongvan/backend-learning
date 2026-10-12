# Phase 01 — Advanced TypeScript

Nguồn định hướng: [`../ROADMAP.md`](../ROADMAP.md) (Phase 01, §8 Definition of Done).
Kế hoạch bài học: [`PLAN.md`](./PLAN.md). Tiến độ: [`../PROGRESS.md`](../PROGRESS.md).

## Mục tiêu

- Hiểu sâu type system của TypeScript và giải thích được type inference.
- Thiết kế type an toàn cho domain, API và business logic.
- Phân biệt compile-time types với runtime validation (dữ liệu đã kiểm tra vs chưa đáng tin cậy).
- Viết code dễ đọc, dễ kiểm thử, dễ refactor.

## Phạm vi

Trong phạm vi: 10 nhóm nội dung của ROADMAP Phase 01 và project Order domain layer.

Ngoài phạm vi: Node.js runtime, HTTP, database, NestJS (decorator, DI). Không chuyển phase khi chưa đạt Definition of Done.

## Cách học

Mỗi bài theo vòng lặp: **giải thích → đề bài → bạn tự làm → review → giải thích lại → cập nhật tiến độ**.

- Agent giải thích và giao đề, không viết lời giải thay bạn.
- Đề bài nằm ở `src/NN-<tên-bài>/EXERCISE.md`; code và test do bạn viết trong cùng thư mục.
- Chỉ đánh dấu hoàn thành khi có bằng chứng: test pass, `tsc --noEmit` sạch, giải thích lại được.

## Lệnh

```bash
npm run type-check   # tsc --noEmit
npm test             # vitest run
npm run test:watch
```

## Tài liệu chính thức

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [TSConfig Reference](https://www.typescriptlang.org/tsconfig/)
- [Zod](https://zod.dev)
- [Vitest](https://vitest.dev)
