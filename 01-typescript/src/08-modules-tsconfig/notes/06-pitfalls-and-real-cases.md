# 6. Cạm bẫy và tình huống thực tế với module và tsconfig

Phần lớn lỗi ở bài này có cùng một gốc: **ba bên không đồng ý với nhau**: `tsc` (kiểm tra kiểu theo `tsconfig.json`), công cụ chạy (Node, `tsx`, Vitest) và `package.json` (`"type"`, `exports`, `imports`). Ghi chú này gom các triệu chứng thường gặp, kèm cách xác định bên nào "sai". Mọi kết quả đã chạy trong các project thử riêng với TS 7.0.2, Node 24.21, `module: NodeNext` (không đụng `tsconfig.json` của repo).

```text
Câu hỏi đầu tiên khi gặp lỗi module:
  1. Lỗi do tsc (mã TSxxxx) hay do Node lúc chạy (mã ERR_xxx, SyntaxError, ReferenceError)?
  2. Nếu do Node: file đang chạy là CJS hay ESM? (xem dist/*.js dùng require hay import)
  3. Nếu do tsc: file đó được tsc coi là CJS hay ESM? (npx tsc --explainFiles)
```

## Ý chính

- Lỗi `TSxxxx` là của compiler (type-check); lỗi `ERR_...`, `SyntaxError`, `ReferenceError` là của runtime. `tsc` sạch không bảo đảm runtime sạch, và ngược lại (xem `05-toolchain-tsx-tsc-vitest.md`).
- Mặc định `tsc` **vẫn ghi file ra `dist/` dù có lỗi kiểu** (đã thử: có `TS2307` mà `dist/main.js` vẫn được sinh). Nếu một script build bỏ qua mã thoát của `tsc`, bạn có thể triển khai code đã biết là lỗi.
- Câu trả lời cho "vì sao chạy ở máy tôi mà không ở production" thường là một trong: import thiếu đuôi, alias `paths`, import tên từ CJS, `types` thiếu, hoặc `"type"` khác nhau giữa các thư mục.
- Mỗi cờ trong `tsconfig` ảnh hưởng một trong ba việc: *sinh code*, *tìm file*, *kiểu toàn cục*. Xác định nhóm trước, đỡ đoán mò.
- Cấu hình bạn copy từ tutorial là giả thuyết, không phải sự thật: kiểm tra bằng `tsc --showConfig`.

## Lý thuyết chi tiết

**1. Bảng triệu chứng và nguyên nhân (đã gặp khi thử).**

| Triệu chứng | Công cụ | Nguyên nhân thường gặp | Hướng xử lý |
|---|---|---|---|
| `TS2307: Cannot find module 'x/y.js' or its corresponding type declarations` | tsc | Đường dẫn con không nằm trong `exports` của package, hoặc đường dẫn sai | Xem `exports` trong `package.json` của thư viện; dùng API công khai |
| `TS2834: Relative import paths need explicit file extensions...` | tsc | Import tương đối thiếu đuôi (cả khi trỏ vào thư mục) trong ESM | Thêm `.js` (hoặc `/index.js`) |
| `TS2882: Cannot find module or type declarations for side-effect import of '...'` | tsc | `import "./x.js"` không tên mà file không tồn tại, hoặc `.css` chưa khai báo | Sửa đường dẫn hoặc thêm `declare module "*.css";` |
| `TS2593: Cannot find name 'describe'. Do you need to install type definitions for a test runner?` | tsc | `types` không nạp global của test runner | `import { describe, it } from "vitest"` tường minh (không cần `types`) |
| `TS2591` (`process`, `Buffer`...) | tsc | Chưa có `"types": ["node"]` | Thêm vào `types` |
| `TS1361: 'X' cannot be used as a value because it was imported using 'import type'` | tsc | Class import bằng `import type` rồi `new X()` | Dùng import thường cho class dùng lúc chạy |
| `TS2564: Property 'x' has no initializer...` | tsc | `strictPropertyInitialization` | Khởi tạo, `?`, hoặc `!` có lý do |
| `ERR_MODULE_NOT_FOUND` | node | Thiếu đuôi ở ESM, hoặc alias `paths` | Sửa import; xem `02-module-resolution.md` |
| `ERR_UNSUPPORTED_DIR_IMPORT` | node | `import "./dir"` trong ESM | `./dir/index.js` |
| `ERR_PACKAGE_PATH_NOT_EXPORTED` | node | Import đường dẫn con không được package xuất | Dùng đường dẫn công khai |
| `ERR_REQUIRE_ASYNC_MODULE` | node | CJS nạp tĩnh module ESM có top-level `await` | `await import()` hoặc chuyển sang ESM |
| `SyntaxError: Named export 'foo' not found. The requested module ... is a CommonJS module` | node | Import tên từ CJS mà Node không phân tích tĩnh ra được | `import pkg from ...; const { foo } = pkg;` |
| `SyntaxError: The requested module ... does not provide an export named 'User'` | node/tsx | Import kiểu mà không có `type` | `import type` / bật `verbatimModuleSyntax` |
| `ReferenceError: __dirname is not defined in ES module scope` | node | Dùng biến CJS trong ESM | `import.meta.dirname` (Node 20.11+) |
| `ReferenceError: Cannot access 'a' before initialization` | node | Import vòng trong ESM | Tách file chung, hoặc đọc giá trị trong hàm |

**2. `tsc` vẫn emit khi có lỗi (đã thử).** Với `src/main.ts` có một lỗi `TS2307`, `tsc -p .` trả mã thoát khác 0 nhưng vẫn tạo `dist/main.js`. Vì thế đừng viết script triển khai dạng `tsc; node dist/main.js` (dấu `;` bỏ qua lỗi); dùng `&&`. Có cờ `noEmitOnError` để không ghi file khi có lỗi; tự quyết định có bật hay không, và kiểm tra bằng thí nghiệm nhỏ (chưa thử trong ghi chú này).

**3. Phiên bản Node và `import.meta.dirname`.** Đã thử trên Node 24.21: `import.meta.dirname` trả đúng thư mục của file đang chạy, và `tsc` chấp nhận nó trong file ESM khi có `@types/node`. Trong CJS, ngược lại, `import.meta` bị báo `TS1470`. Khi viết code dùng được cả hai bản Node cũ và mới, dùng `fileURLToPath(new URL(".", import.meta.url))`.

**4. `types: []` và cách test "nhìn thấy" `describe`.** Mặc định TS 7 không nạp `@types/*` toàn cục. Với Vitest không bật `globals`, test luôn `import { describe, it, expect } from "vitest"`, kiểu đi theo package nên không cần `types`. Chỉ khi bạn bật `globals: true` trong cấu hình Vitest và muốn dùng `describe` trần thì cần khai báo kiểu toàn cục tương ứng (ghi nhận theo tài liệu Vitest, chưa thử trong ghi chú này).

**5. `strict` đã có sẵn: đừng gỡ nhầm.** Mặc định TS 7 bật `strict`, nên một tsconfig tối giản vẫn nghiêm ngặt. Khi đọc repo người khác, chạy `npx tsc --showConfig` để biết cờ nào đang thật sự bật thay vì đoán từ file. Với repo này, hãy so danh sách cờ đã ghi trong `tsconfig.json` với nhóm `strict` (xem `04-strict-flags.md`) và phân loại: thừa, cần thiết, hay nên thêm.

**6. Vì sao nhiều dự án Node vẫn để CJS.** Hệ sinh thái cũ (framework, decorator, ORM) quen CJS; `emitDecoratorMetadata` và DI của NestJS (Phase 03) có ràng buộc riêng với `import type` (xem `03-import-type-isolated-modules.md`). Chọn hệ module là quyết định kiến trúc, không phải sở thích: đọc tài liệu framework trước khi chuyển.

**7. Phân biệt "TS không tìm thấy" và "Node không tìm thấy".** Cùng một import `"@/lib/greet.js"` có thể qua `tsc`, qua `tsx`, nhưng sập ở `node`/Vitest (bảng ở `02-module-resolution.md`). Muốn biết ai đang dùng cấu hình nào, tự đặt câu hỏi: công cụ này có đọc `tsconfig.json` không? Có đọc `package.json#imports` không? Dùng `node` thuần như "trọng tài" cuối cùng.

**8. Phân biệt lỗi do kiểu và lỗi do cấu hình.** Lỗi cấu hình thường có mã `TS5xxx` (ví dụ `TS5108` cờ đã bị gỡ ở TS 7, `TS5102`, `TS5109`, `TS5011`), xuất hiện ngay khi `tsc` đọc `tsconfig.json`, trước khi nhìn vào code. Lỗi code có mã `TS1xxx`/`TS2xxx`/`TS7xxx`. Đọc nhóm số đầu tiên giúp biết nên sửa file nào.

**9. Phân biệt thư mục `src` và `dist` khi debug.** Stack trace của Node trỏ vào `dist/*.js`. Nếu bạn sửa `src/` mà quên build lại, bạn đang debug code cũ. Dùng `tsx watch` cho dev (không cần build) hoặc `tsc --watch`, và nhìn thời điểm sửa file trong `dist/` khi nghi ngờ.

**10. Tên file và chữ hoa/thường.** Linux phân biệt hoa/thường, macOS/Windows thường không. Repo đã bật `forceConsistentCasingInFileNames`, cờ này giúp `tsc` báo khi cùng một file được import với hai kiểu viết khác nhau. Một import sai hoa/thường chạy được trên máy Mac/Windows và sập khi triển khai lên Linux; chưa thử trong ghi chú này (môi trường kiểm chứng là Linux), hãy tự kiểm tra nếu làm việc trên máy không phân biệt.

## Tricks & tips thực tế

- **Dán nguyên mã lỗi (`TS2834`, `ERR_...`) vào tìm kiếm trước khi đổi cấu hình.** Lý do: mã lỗi cho biết ngay nhóm nguyên nhân, đỡ sửa nhầm cờ khác.
- **Dùng `node dist/...` làm lần chạy cuối cùng trước khi coi là xong.** Lý do: đó là cách duy nhất chắc chắn gần với production; mọi công cụ khác dò import lỏng hơn.
- **`&&` thay vì `;` trong script build/deploy.** Lý do: `tsc` vẫn ghi file khi có lỗi, nên `;` cho phép chạy tiếp thứ đã biết là lỗi.
- **Đặt tsconfig riêng cho build (`tsconfig.build.json`) và giữ `tsconfig.json` cho IDE/type-check.** Lý do: IDE cần thấy cả test; bản build không nên đóng gói test (xem `02-module-resolution.md`).
- **Khi thêm một thư viện lạ: kiểm tra trường `exports`, `types`, `type` trong `package.json` của nó** (`npm view <tên> exports type types`). Lý do: ba trường này quyết định import có hoạt động ở ESM/NodeNext không, trước khi bạn viết code.
- **Với lỗi chỉ hiện ở một công cụ, so sánh hai công cụ trên cùng một file nhỏ** (3 dòng) thay vì debug trong project lớn. Lý do: loại bỏ nhiễu, và tái hiện được để hỏi người khác hoặc ghi vào "Ghi chú của bạn".
- **Ghi lại thí nghiệm bằng bảng "đổi gì → tsc nói gì → node nói gì".** Lý do: chính bảng đó là câu trả lời cho yêu cầu "giải thích từng flag" của bài lab, và là bằng chứng bạn hiểu.
- **So với PHP/Laravel**: `composer dump-autoload` sửa lỗi "class not found" bằng cách sinh lại bản đồ; Node không có bước tương đương, lỗi "not found" gần như luôn là đường dẫn/đuôi/`exports` sai. `php artisan config:clear` tương ứng việc khởi động lại TS server/`tsc` sau khi đổi `tsconfig` (cache cấu hình cũ).

## Liên hệ bài tập

Câu hỏi để tự suy nghĩ khi làm bài lab (không có đáp án sẵn ở đây):

- Trước khi sửa bất kỳ cờ nào, bạn có dự đoán được `tsc` sẽ báo mã lỗi gì (và `node` sẽ báo gì) không? Hãy ghi dự đoán rồi so sánh.
- Trong project của bạn, những file nào đang là CJS và file nào là ESM? Bạn kiểm tra bằng cách nào (gợi ý: `tsc --explainFiles`, xem `dist/*.js`)?
- Nếu một alias `@/...` chạy được bằng `tsx` nhưng không chạy bằng `node dist/...`, bạn sẽ có những lựa chọn nào, và đánh đổi của từng cái?
- Bật `verbatimModuleSyntax` trước hay sau khi đổi `"type"`? Quan sát được lỗi gì ở mỗi thứ tự, và vì sao?

## Đọc thêm

- [Node.js: ECMAScript modules, resolution algorithm](https://nodejs.org/api/esm.html#resolution-algorithm)
- [Node.js: Package `exports` và `imports`](https://nodejs.org/api/packages.html)
- [TypeScript: Modules theory](https://www.typescriptlang.org/docs/handbook/modules/theory.html)
- [TSConfig: `noEmitOnError`](https://www.typescriptlang.org/tsconfig/#noEmitOnError)
- [TSConfig: `forceConsistentCasingInFileNames`](https://www.typescriptlang.org/tsconfig/#forceConsistentCasingInFileNames)

## Ghi chú của bạn
