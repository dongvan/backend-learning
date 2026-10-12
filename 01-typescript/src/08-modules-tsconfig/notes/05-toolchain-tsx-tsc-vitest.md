# 5. `tsc`, `tsx`, Vitest và Node: mỗi công cụ một vai

Chỉ có `tsc` kiểm tra kiểu. `tsx`, Vitest và cả Node 24 chạy `.ts` đều **chỉ xoá kiểu rồi chạy**, nên một file có lỗi kiểu vẫn chạy bình thường.

```ts
// @ts-expect-error  tsc báo TS2322; tsx, vitest, node vẫn chạy file này
export const n: number = "oops";
```

## Ý chính

- **`tsc`**: type-checker và compiler chính thức. `tsc --noEmit` chỉ kiểm tra; `tsc` (có `outDir`) sinh JS vào `dist/`.
- **`tsx`**: chạy file TS trực tiếp (dùng esbuild để chuyển mã), không kiểm tra kiểu, tiện cho dev (`tsx watch`). Đọc `paths` của tsconfig.
- **Vitest**: test runner dựa trên Vite; cũng chỉ chuyển mã, không kiểm tra kiểu khi chạy test thường.
- **Node 24 `node file.ts`**: tự xoá kiểu (type stripping), không kiểm tra, không hỗ trợ cú pháp TS cần sinh code (`enum`...), và đòi import có đuôi đầy đủ.
- Hệ quả: **"chạy được" ≠ "đúng kiểu"**. Cần một bước `tsc --noEmit` (trong CI hoặc trước commit) để có lưới an toàn thật sự.
- Các công cụ khác nhau còn xử lý `import` hơi khác nhau, nên một dự án nên có ít nhất một lần chạy kết quả theo cách production thật.

## Lý thuyết chi tiết

**Hai việc khác nhau: kiểm tra kiểu và chuyển mã.** TS làm hai việc: (1) *type-check*: chứng minh kiểu đúng; (2) *transpile*: xoá kiểu, đổi cú pháp mới sang cú pháp chạy được. `tsc` làm cả hai. Các công cụ nhanh (esbuild, trong `tsx`/Vite) chỉ làm việc (2), mỗi file một lượt, không cần hiểu kiểu. Đó là lý do chúng nhanh, và cũng là lý do `isolatedModules`/`verbatimModuleSyntax` tồn tại (xem `03-import-type-isolated-modules.md`).

**Thí nghiệm đã chạy** (Node 24.21, TS 7.0.2, tsx 4.x, Vitest 5.0.3):

| Hành vi | `tsc` | `tsx` | `vitest run` | `node file.ts` |
|---|---|---|---|---|
| File có `const n: number = "oops"` | Lỗi `TS2322` | Chạy | Test pass | Chạy |
| Import tương đối không đuôi (`./t`) trong package ESM | Lỗi `TS2835` | Chạy được | (không thử riêng) | `ERR_MODULE_NOT_FOUND` |
| Import `.js` trỏ tới `.ts` (`./t.js`) | OK | OK | OK | Không (không có `t.js`; dùng `./t.ts`) |
| Alias `paths` (`@/...`) | OK | Chạy | Lỗi, thiếu cấu hình alias | Lỗi |
| `enum` | OK | OK | (không thử riêng) | Lỗi: không hỗ trợ |

Bảng này đủ để rút ra quy tắc: **dùng `tsc` làm trọng tài về tính đúng, dùng các công cụ khác làm trọng tài về "có chạy không".**

**Vai trò trong script npm.** Hãy nhìn lại các lệnh của repo này (`npm run type-check`, `npm run dev`, `npm test`): ba lệnh dùng ba công cụ với ba mục đích khác nhau.

```text
type-check   tsc --noEmit            -> kiểm tra kiểu, không sinh file
dev          tsx watch <file>        -> chạy và nạp lại khi sửa, KHÔNG kiểm tra kiểu
test         vitest run              -> chạy test, KHÔNG kiểm tra kiểu
(build)      tsc                     -> sinh dist/, chạy bằng node dist/...
```

`npm run type-check` mới là lệnh bắt lỗi kiểu. Nếu chỉ chạy `npm test` thấy xanh, bạn chưa biết code có đúng kiểu hay không.

**Kiểm tra kiểu cho test.** Vitest có chế độ kiểm tra kiểu riêng và `expectTypeOf` để kiểm tra kiểu như một phần của test (nội dung Bài 11, chưa thử ở đây). Trong lúc chưa dùng, `tsc --noEmit` bao luôn cả file test vì `include` có `src/**/*`.

**`tsx` vs Node 24 type stripping.** Node 24 (đã thử; các bản 22 gần đây cũng có nhưng chưa thử) chạy được `node file.ts` không cần công cụ, nhưng chỉ với tập con "erasable" của TS. `tsx` linh hoạt hơn (hỗ trợ `paths`, dò đuôi lỏng, `enum`) nên dễ che lỗi. Nếu mục tiêu là code chạy được bằng Node thuần, bật `erasableSyntaxOnly` (xem `03-import-type-isolated-modules.md`) để `tsc` cảnh báo trước. Với backend triển khai, `tsc` build rồi chạy `node dist/main.js` vẫn là con đường phổ biến, an toàn nhất.

**Sinh `dist/` và chạy.** Luồng điển hình: `tsc` đọc `rootDir: src`, ghi vào `outDir: dist`. Hệ module của kết quả theo `module` và `"type"` (xem `01-esm-vs-cjs.md`). Chạy `node dist/main.js` là cách duy nhất chắc chắn bạn đang kiểm tra thứ production sẽ chạy. File test dưới `src/` cũng bị biên dịch vào `dist/` nếu không bị loại khỏi build; cách xử lý để bạn tự cân nhắc.

**Debug stack trace trỏ vào `dist`.** Bật `sourceMap` trong tsconfig và chạy Node với `--enable-source-maps` để stack trace trỏ về file `.ts`. Hai cờ này đúng theo tài liệu nhưng chưa thử trong ghi chú này.

**So với PHP/Laravel.** PHP không có bước build: code chạy thẳng, kiểu kiểm tra lúc chạy (hoặc bởi PHPStan ngoài). TS giống việc có cả PHPStan (`tsc`) và runtime (`node`) là hai chương trình riêng. `tsx` như `php artisan serve` cho dev nhanh; `tsc` như `phpstan analyse`; Vitest như `phpunit`/Pest. Đừng nhầm "test xanh" với "phpstan sạch".

**Phân biệt ba vị trí của kiểu.**
- *Kiểu của chính dự án*: bạn viết, `tsc` kiểm tra.
- *Kiểu từ thư viện*: đi kèm (`types` trong `package.json`) hoặc ở `@types/*` (xem `02-module-resolution.md`).
- *Kiểu toàn cục* (`console`, `process`): từ `@types/node` qua cờ `types`.

## Tricks & tips thực tế

- **Chạy `npm run type-check` trước khi báo "xong" một bài**, kể cả khi test xanh. Lý do: test xanh không chứng minh kiểu đúng (đã thử: Vitest vẫn pass với lỗi kiểu).
- **Giữ ít nhất một lần chạy "đúng như production" trong CI**: `tsc` build rồi `node dist/...` (hoặc smoke test). Lý do: `tsx` và Vitest dò import lỏng hơn Node.
- **Thêm `type-check` vào hook/CI**, không chỉ trông vào IDE. Lý do: IDE có thể dùng phiên bản TS khác hoặc chưa nạp lại tsconfig; trong VS Code kiểm tra phiên bản bằng "TypeScript: Select TypeScript Version".
- **Khi IDE báo lỗi mà `tsc` sạch (hoặc ngược lại)**: khởi động lại TS server và kiểm tra IDE đang dùng đúng `typescript` của dự án. Lý do: hai bên đang chạy hai phiên bản/cấu hình khác nhau. Lưu ý TS 7 là bản native mới, công cụ cũ có thể chưa hỗ trợ đầy đủ; kiểm tra khi có hành vi lạ.
- **`tsx watch` không phải bằng chứng đúng kiểu.** Lý do: nó cố ý bỏ qua kiểu để nhanh. Chạy `npm run type-check:watch` ở terminal thứ hai nếu muốn phản hồi kiểu liên tục (script này có trong `package.json` của repo).
- **Khi lỗi chỉ xuất hiện ở một công cụ**, hỏi: công cụ đó có đọc `tsconfig.json` không, và đọc những cờ nào? `tsx` đọc `paths`; Vitest không đọc `paths` mặc định; Node thì không đọc `tsconfig` luôn. Lý do: gần như mọi lỗi kiểu "chạy ở A mà vỡ ở B" đến từ chỗ này.
- **Đừng trộn nhiều trình chạy trong cùng một dự án mà không ghi rõ** trong `README`/`package.json` công cụ nào dùng cho việc gì. Lý do: người mới (hoặc chính bạn sau 3 tháng) sẽ không biết lỗi này nên trông vào công cụ nào.
- **Kiểm tra nhanh thứ gì được biên dịch**: `npx tsc --listFiles | grep -v node_modules`. Lý do: biết ngay test hay file thừa có lọt vào build không.

## Liên hệ bài tập

Khi bạn kiểm tra kết quả chuyển ESM, hãy chạy lần lượt: `tsc --noEmit` (kiểu), `tsx` (chạy dev), `vitest` (test), và code đã build bằng `node`. Ghi lại công cụ nào báo lỗi nào và lý do khác biệt giữa chúng. Đó là cách nhanh nhất để thật sự hiểu mỗi công cụ làm gì, và là nội dung bạn nên tự giải thích lại bằng lời của mình.

## Đọc thêm

- [Node.js: Running TypeScript natively](https://nodejs.org/api/typescript.html)
- [TypeScript: `noEmit`](https://www.typescriptlang.org/tsconfig/#noEmit)
- [TypeScript: `sourceMap`](https://www.typescriptlang.org/tsconfig/#sourceMap)
- [TypeScript: Modules reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html)

## Ghi chú của bạn
