# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Nature of this repo

Đây là repo **học tập**, không phải sản phẩm: lộ trình Backend Engineering (TypeScript → Node.js → NestJS → …) của một người học có nền Laravel/PHP. Tài liệu viết bằng tiếng Việt; trả lời bằng tiếng Việt.

- `ROADMAP.md` (root): nguồn định hướng chính, gồm các phase, Definition of Done (§8) và quy tắc dùng AI agent (§7). Đọc trước khi làm việc.
- `PROGRESS.md` (root): trạng thái từng bài, kết quả kiểm tra, kiến thức còn yếu. Chỉ tick ✅ khi có bằng chứng (test pass, `tsc` sạch, người học giải thích lại được).
- `01-typescript/` … `11-ai-backend/`: mỗi thư mục một phase. Chỉ `01-typescript` có nội dung; các thư mục còn lại rỗng. Tên `09-observability` và `10-system-design` không khớp ROADMAP (Phase 09 là Production Readiness, Phase 10 là AI Backend); chưa quyết định xử lý.
- Mỗi phase có `README.md` (mục tiêu, phạm vi) và `PLAN.md` (bài học, tiêu chí, DoD). Mỗi bài nằm ở `src/NN-<tên-bài>/` với `EXERCISE.md` (đề) và `notes/*.md` (bài giảng ngắn kèm mục "Ghi chú của bạn" để người học tự bổ sung).

## Quy tắc làm việc với người học

- Quy trình mỗi bài: giải thích → giao `EXERCISE.md` → **người học tự làm** → review → người học giải thích lại → cập nhật `PROGRESS.md`.
- **Không viết lời giải cho bài tập** trước khi người học thử; chỉ gợi ý hướng khi họ bí.
- Không chuyển phase (ví dụ sang Node.js/NestJS) khi Phase hiện tại chưa đạt Definition of Done trong `PLAN.md`.
- Không thêm dependency hay abstraction ngoài nhu cầu bài học.
- Không lặp nội dung giữa các file (mục tiêu ở README, bài học ở PLAN, trạng thái ở PROGRESS, đề ở EXERCISE). Quy tắc này chỉ về việc không trùng lặp giữa các file, không giới hạn độ dài.
- Chỉ tạo `EXERCISE.md` và `notes/` khi bắt đầu bài đó.

## Chuẩn viết `notes/*.md`

Notes phải đủ thông tin để người học hiểu sâu vấn đề, không cần giữ ngắn. Mỗi file gồm các mục theo thứ tự:

1. Tiêu đề và đoạn mở đầu một–hai câu nêu ý chính, kèm ví dụ code ngắn.
2. `## Ý chính`: các điểm cần nhớ.
3. `## Lý thuyết chi tiết`: cơ chế bên trong, vì sao ngôn ngữ/compiler hoạt động như vậy, các trường hợp biên, so sánh với PHP/Laravel khi giúp ích.
4. `## Tricks & tips thực tế`: mẹo dùng trong backend thật, cạm bẫy thường gặp, lỗi phổ biến và cách sửa, quy ước nên theo, cách debug kiểu.
5. `## Liên hệ bài tập`: trỏ tới câu hỏi trong `EXERCISE.md`, chỉ nêu hướng, không đưa lời giải.
6. `## Đọc thêm`: link tài liệu chính thức.
7. `## Ghi chú của bạn`: để trống cho người học, không được xoá hay ghi đè.

Yêu cầu nội dung:
- Ví dụ code phải đúng và nhất quán với `tsconfig.json` của repo (strict, `noUncheckedIndexedAccess`, …). Ghi rõ phiên bản TypeScript tối thiểu khi dùng tính năng mới (ví dụ `satisfies` cần TS 4.9+).
- Mỗi tip nêu rõ cả lý do, không chỉ lệnh "nên làm".
- Ví dụ minh hoạ không được là lời giải của `EXERCISE.md`.
- Khi sửa notes đã có, giữ nguyên "Ghi chú của bạn" và chỉ bổ sung.

## Commands (chạy trong `01-typescript/`)

```bash
npm run type-check        # tsc --noEmit
npm test                  # vitest run
npm run test:watch        # vitest (watch)
npx vitest run src/01-type-system/order.test.ts          # một file test
npx vitest run -t "tên test"                             # một test theo tên
npm run dev               # tsx watch src/01-type-system/index.ts
```

Không có lint/build script. Mọi thư mục phase khác chưa có `package.json`.

## Cấu hình TypeScript (`01-typescript/`)

- `tsconfig.json`: `module`/`moduleResolution` là `NodeNext`, `strict` cộng `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`, `noImplicitReturns`; alias `@/*` → `src/*`. `rootDir` là `src`, nên test và code đều phải nằm dưới `src/`.
- `package.json` đang `"type": "commonjs"` trong khi dùng `NodeNext`; việc chuyển sang ESM là nội dung của Bài 8, đừng sửa trước.
- `experimentalDecorators`/`emitDecoratorMetadata` và `reflect-metadata` chỉ cần cho NestJS (Phase 03).
- Test dùng Vitest; validation runtime dùng Zod (học ở Bài 9).
