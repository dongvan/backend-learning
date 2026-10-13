# 2. `module`, `moduleResolution`, `paths`, `types` và file khai báo

`module` quyết định TS **sinh ra** loại code module nào; `moduleResolution` quyết định TS **tìm file** cho mỗi `import` như thế nào. Với Node.js, cả hai nên là `NodeNext`.

```jsonc
// Mảnh minh hoạ, không phải cấu hình hoàn chỉnh
{
  "compilerOptions": {
    "module": "NodeNext",            // sinh CJS hay ESM tuỳ package.json từng file
    "moduleResolution": "NodeNext"   // tìm file theo luật của Node (kể cả "exports" trong package.json)
  }
}
```

## Ý chính

- `module: NodeNext` bắt buộc đi với `moduleResolution: NodeNext` (hoặc để trống). Đặt khác nhau báo lỗi `TS5109` (đã thử).
- `bundler` (hoặc `module: ESNext/preserve`) dành cho code sẽ đi qua bundler (Vite, esbuild, webpack). Nó **cho phép** import không đuôi nhưng Node thật không chạy được kết quả. Backend Node thuần nên dùng `NodeNext`.
- **TS 7 đã gỡ nhiều cờ cũ**: `moduleResolution: node`/`node10`, `baseUrl`, `target: ES5`, `esModuleInterop: false`. Cấu hình cũ copy từ internet có thể lỗi `TS5108`/`TS5102`.
- **`paths` chỉ dạy compiler** cách hiểu alias. `tsc` **không** viết lại đường dẫn trong code đầu ra, nên Node chạy thẳng sẽ lỗi `ERR_MODULE_NOT_FOUND`. Runtime phải tự lo alias.
- **`rootDir`/`outDir`**: TS 7 yêu cầu `rootDir` tường minh khi cấu trúc output khác mặc định (lỗi `TS5011`, đã thử).
- **`types`** mặc định là mảng rỗng ở TS 7: `@types/node` **không** tự được nạp. `console`, `process`, `node:fs` sẽ báo không tìm thấy cho đến khi thêm `"types": ["node"]`.

## Lý thuyết chi tiết

**`module` quyết định kiểu code sinh ra.** Với `NodeNext`, mỗi file được xử lý riêng: file CJS (theo `"type"`/đuôi) biên dịch thành `require`/`exports`, file ESM giữ `import`/`export`. Chính vì thế bạn thấy cùng một mã nguồn cho ra hai kết quả (xem `01-esm-vs-cjs.md`).

**`moduleResolution` quyết định cách tìm file.** `NodeNext` mô phỏng Node thật:
- ESM yêu cầu đuôi đầy đủ ở import tương đối; CJS thì tự dò.
- Với package trong `node_modules`, tôn trọng trường `exports` (cho phép package chỉ lộ một số đường dẫn) và `main`/`types`.
- Mỗi file import theo luật hệ của **chính file đó**, không phải của dự án.

**`bundler` khác gì?** Nó giả định có công cụ khác lo phần nạp module nên nới lỏng: cho phép import không đuôi, đọc `exports` nhưng không áp quy tắc ESM nghiêm ngặt của Node. Lỗi kinh điển: dùng `bundler` rồi build bằng `tsc` ra `dist/` và chạy thẳng bằng `node` sẽ thất bại vì import không đuôi. Chọn theo cách code **thực sự được chạy**:

| Cách chạy kết quả | `module` / `moduleResolution` thường dùng |
|---|---|
| `tsc` rồi `node dist/...` (backend Node thuần) | `NodeNext` / `NodeNext` |
| Bundler (Vite, esbuild...) tạo bundle | `ESNext` hoặc `Preserve` / `bundler` |
| Chỉ type-check, chạy bằng `tsx` | Theo cách production sẽ chạy, thường vẫn `NodeNext` |

**Thử nghiệm ghi nhận ở TS 7.0.2** (quan trọng khi đọc tài liệu cũ):

```text
"moduleResolution": "node" / "node10"  -> TS5108: ...has been removed
"baseUrl": "."                         -> TS5102: Option 'baseUrl' has been removed
                                          (gợi ý: dùng "paths" với tiền tố "./")
"target": "ES5"                        -> TS5108: ...has been removed
"esModuleInterop": false               -> TS5108: ...has been removed
"allowSyntheticDefaultImports": false  -> TS5108: ...has been removed
"module": "NodeNext" + "bundler"       -> TS5109 (moduleResolution phải là NodeNext)
```

Và hai mặc định mới đáng nhớ: `strict` mặc định **bật** (một file có `(x) => x` mà không đặt `strict` vẫn báo `TS7006`), và `rootDir` mặc định là thư mục chứa `tsconfig.json` nên một dự án có mã nguồn trong `src/` mà không đặt `rootDir` sẽ nhận `TS5011` và output nằm trong `dist/src/`. Repo này đặt `rootDir: ./src` nên không dính.

**`paths` và giới hạn lúc chạy.** `paths` là bảng ánh xạ cho compiler, như hàm `class_alias` chỉ ở "thời điểm kiểm tra kiểu":

```jsonc
{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }   // tiền tố "./" là bắt buộc ở TS 7
```

Đã thử với `module: NodeNext`: `import { greet } from "@/lib/greet.js"` qua `tsc` **không có lỗi**, nhưng ba công cụ phản ứng khác nhau:

| Công cụ chạy | Kết quả với alias `@/...` |
|---|---|
| `node dist/main.js` (sau `tsc`) | `ERR_MODULE_NOT_FOUND: Cannot find package '@/lib'` |
| `node src/main.ts` (Node strip types) | Cùng lỗi |
| `tsx src/main.ts` | Chạy được (tsx đọc `paths` của tsconfig) |
| `vitest` (không cấu hình thêm) | Lỗi `Cannot find package '@/lib/greet.js'`; cần khai báo `resolve.alias` trong cấu hình Vitest hoặc plugin riêng |

Vì thế `paths` dễ tạo cảm giác "chạy được ở dev, vỡ ở production". Lựa chọn thực tế: (a) dùng đường dẫn tương đối thường, đơn giản nhất; (b) dùng `imports` trong `package.json` (alias chuẩn Node, bắt đầu bằng `#`); (c) dùng alias nhưng cấu hình **mọi** thứ chạy code (bundler, vitest, tsx, bước build) cho khớp. Cái nào cũng phải có chủ đích. Đã thử `imports` (mục (b)) trên TS 7.0.2 + Node 24.21 với `package.json` có `"imports": { "#lib/*": "./dist/lib/*" }`: `import { greet } from "#lib/greet.js"` qua `tsc` không lỗi (compiler ánh xạ về file nguồn `src/lib/greet.ts` nhờ `outDir`/`rootDir`) và `node dist/main.js` chạy đúng. Điểm khác `paths`: Node tự hiểu nên không cần cấu hình thêm ở runtime. Điều kiện: ánh xạ trỏ vào thư mục **đầu ra** (`dist`), alias phải bắt đầu bằng `#`, và vẫn phải ghi đuôi `.js` ở ESM. Vitest và `tsx` có thể cần kiểm tra riêng (chưa thử).

**Package có trường `exports`: không import tuỳ tiện vào ruột được.** Khi một package khai báo `exports`, chỉ các đường dẫn được liệt kê mới import được (đã thử với package giả `fakepkg` chỉ export `"."`):

```text
import { hi } from "fakepkg";                         -> OK
import { secret } from "fakepkg/internal/x.js";       -> tsc:  TS2307: Cannot find module 'fakepkg/internal/x.js' or its corresponding type declarations.
                                                         node: ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './internal/x.js' is not defined by "exports"
```

Nghĩa là file có thật trong `node_modules` nhưng package cố ý không cho import. Đừng "với tay" vào `dist/internal/...` của thư viện; mở issue hoặc dùng API công khai. Trong `exports`, điều kiện `"types"` nên đứng **trước** `"default"`/`"import"` vì điều kiện được duyệt theo thứ tự khai báo (đã thử với `"types"` đứng đầu; trường hợp đảo thứ tự chưa thử).

**Import thư mục và import thiếu đuôi.** Trong ESM, `import "./dir"` (thư mục có `index.ts`) không hoạt động như CJS cũ:

```text
tsc:  TS2834: Relative import paths need explicit file extensions in ECMAScript imports when
      '--moduleResolution' is 'node16' or 'nodenext'. Consider adding an extension to the import path.
node: ERR_UNSUPPORTED_DIR_IMPORT: Directory import '.../dist/dir' is not supported resolving ES modules
```

Viết `./dir/index.js`. (Với import thiếu đuôi trỏ vào thư mục, mã lỗi quan sát được là `TS2834`; `01-esm-vs-cjs.md` ghi `TS2835` cho trường hợp file đơn. Hai mã khác nhau, hãy đọc kỹ thông báo thay vì dựa vào số.) Hệ quả cho "barrel file": `import { x } from "./models"` phải thành `from "./models/index.js"`.

**Gõ kiểu cho `process.env` bằng khai báo toàn cục.** Tình huống backend rất thật: muốn `process.env.DATABASE_URL` là `string` thay vì `string | undefined`. Đặt file `src/env.d.ts` (nằm trong `include`):

```ts
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      DATABASE_URL: string;
      PORT?: string;
    }
  }
}
export {};   // biến file thành module để `declare global` có hiệu lực
```

Đã thử: `const url: string = process.env.DATABASE_URL` hợp lệ, còn `const port: number = process.env.PORT` báo `TS2322: Type 'string | undefined' is not assignable to type 'number'`; khoá không khai báo (`process.env["OTHER"]`) vẫn là `string | undefined`. Cảnh báo: đây chỉ là lời hứa với compiler, giá trị thật đến từ môi trường. Nên validate `process.env` bằng Zod một lần lúc khởi động (Bài 9) rồi dùng đối tượng đã validate, thay vì tin khai báo này.

**Tách cấu hình build khỏi cấu hình type-check.** Vì test nằm dưới `src/`, `tsc` sẽ biên dịch cả `*.test.ts` ra `dist/` (đã thử: `dist/a.test.js` xuất hiện). Một `tsconfig.build.json` kế thừa và loại test:

```jsonc
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts"]
}
```

Chạy `tsc -p tsconfig.build.json` thì `dist/` không có file test (đã thử). Theo tài liệu TSConfig, `include`/`exclude`/`files` ở file kế thừa **ghi đè** giá trị của file gốc chứ không cộng dồn (chưa thử riêng, hãy tự kiểm chứng bằng `--showConfig`). Dùng `tsc -p tsconfig.build.json --showConfig` để xem cấu hình sau khi gộp và danh sách `files` thực sự được nạp, và `--explainFiles` để biết file được kéo vào do `include` hay do import. Giữ `tsconfig.json` gốc cho IDE và `type-check` (bao cả test).

**So với PSR-4 của Composer.** `"autoload": { "psr-4": { "App\\": "app/" } }` giúp **runtime** (autoloader sinh bởi Composer) và IDE cùng hiểu `App\Models\User` nằm ở `app/Models/User.php`. `paths` chỉ làm được nửa "IDE/compiler" của chuyện đó. Nửa "runtime" không có trong Node, bạn phải tự bảo đảm.

**`rootDir`, `outDir`, `include`.** `include` chọn file để biên dịch; `rootDir` là gốc để giữ nguyên cấu trúc thư mục; `outDir` là nơi đặt kết quả. `src/a/b.ts` với `rootDir: src`, `outDir: dist` thành `dist/a/b.js`. Test đặt dưới `src/` (như repo này) sẽ bị biên dịch cùng, nên thường được loại khỏi bản build bằng `exclude` hoặc một tsconfig riêng cho build; đây là quyết định để bạn tự cân nhắc.

**`types` và `@types/*`.** Thư viện JS thuần không có kiểu thì kiểu nằm ở package riêng `@types/<tên>` (cộng đồng DefinitelyTyped). Cờ `types` quyết định **package `@types` toàn cục nào** được nạp tự động (những thứ như `console`, `process`, `describe` là biến toàn cục):

```text
Không có "types"        -> (TS 7) không nạp gì tự động
"types": ["node"]       -> nạp @types/node: console, process, Buffer, "node:fs"...
```

Đã thử: không đặt `types`, mã dùng `console`/`process`/`import fs from "node:fs"` báo `TS2591: Cannot find name 'process'. Do you need to install type definitions for node?`; thêm `"types": ["node"]` thì hết. Ghi chú: `@types/node` thường nằm sẵn trong `node_modules` (như ở repo này) nhưng không có nghĩa là nó được nạp. **Khi dự án bắt đầu dùng API của Node (Bài sau), hãy nhớ cờ này.** Còn các `import` tường minh (`import { test } from "vitest"`) thì không cần `types`, vì kiểu đi theo chính package.

**File khai báo `.d.ts`.** `.d.ts` chỉ chứa **kiểu**, không có code chạy được. Ba nguồn phổ biến: thư viện tự phát hành (trường `types` trong `package.json` của thư viện), `@types/*`, và file bạn tự viết. Khi `import` một thư viện không có kiểu, compiler báo `TS7016`. Cách xử lý tạm là một file `.d.ts` trong dự án:

```ts +dts
declare module "untyped-lib" {
  export function hi(): string;
}
```

Đã thử với một package JS thuần: trước khi có file này là `TS7016`, sau khi có thì sạch. `declare module "x";` (không thân) cho mọi import từ `x` thành `any`, chỉ dùng như lối thoát tạm. Với `declaration: true`, `tsc` cũng **sinh ra** `.d.ts` cạnh JS để người khác dùng thư viện của bạn có kiểu. Ứng dụng backend thường không cần bật cờ này, thư viện nội bộ dạng monorepo thì có.

## Tricks & tips thực tế

- **Chọn `module`/`moduleResolution` theo cách chạy thật, không theo thói quen.** `NodeNext` cho `node dist/...`. Lý do: `bundler` che mất lỗi thiếu đuôi mà Node sẽ báo lúc chạy.
- **Khi lỗi cấu hình là `TS5108`/`TS5102`**: cờ đã bị gỡ ở TS 7, xoá khỏi `tsconfig` hoặc dùng cách thay thế mà thông báo gợi ý. Lý do: hướng dẫn cũ (đặc biệt cho TS 4.x/5.x) chưa phản ánh việc này.
- **Debug "TS không tìm thấy module"**: chạy `npx tsc --traceResolution | grep tên-module` để xem compiler thử các đường dẫn nào theo thứ tự. Lý do: bạn thấy ngay là nó tìm `.js`, `.ts`, `exports` hay `types`. Cũng có `npx tsc --showConfig` để xem cấu hình sau khi gộp `extends`.
- **Debug "tsc nhận file nào"**: `npx tsc --listFiles` hoặc `--explainFiles` (cho biết *vì sao* một file được kéo vào). Lý do: biết ngay test, file build hay `.d.ts` nào đang bị nạp.
- **Thêm `types: ["node"]` ngay khi dùng API của Node**, và thêm `types` cho thư viện test chỉ khi dùng global (describe/it không cần import). Lý do: thiếu thì lỗi `TS2591` rất khó hiểu nếu không biết `types` mặc định rỗng.
- **Gặp `TS7016` với thư viện phổ biến**: thử `npm i -D @types/<tên>` trước. Lý do: đa số thư viện lâu đời có kiểu ở DefinitelyTyped. Không có mới tự viết `.d.ts`.
- **Đặt phiên bản `@types/node` khớp phiên bản Node bạn chạy** (ví dụ Node 24 thì `@types/node` 24.x). Lý do: kiểu API phản ánh phiên bản Node, lệch thì có API compiler cho phép mà runtime không có (hoặc ngược lại). Kiểm tra bằng `npm ls @types/node` và `node -v`: lúc viết ghi chú này, repo có `@types/node` 26.x còn Node cài trên máy là 24.x, tức đang lệch một chút (chưa gây lỗi, chỉ là điều nên biết).
- **Không dùng alias chỉ vì "đẹp"** khi đường dẫn tương đối đủ dùng. Lý do: alias là một thứ cấu hình thêm ở mọi công cụ.
- **`skipLibCheck: true` che lỗi trong `.d.ts` của thư viện**, không phải lỗi trong code của bạn. Giữ bật để tránh lỗi vặt từ `node_modules`; lý do: lỗi trong `.d.ts` của bên thứ ba bạn không sửa được.

## Liên hệ bài tập

Khi giải thích từng flag trong bài lab, hãy tách thành nhóm: nhóm *sinh code* (`module`, `target`), nhóm *tìm file* (`moduleResolution`, `paths`, `rootDir`), nhóm *kiểu toàn cục* (`types`, `lib`). Với mỗi cờ, tự nghĩ một thí nghiệm nhỏ (đổi cờ, xem lỗi gì hiện ra) rồi ghi lại, thay vì chỉ chép định nghĩa. Chú ý `paths` hiện có trong `tsconfig.json`: nó có tác dụng gì lúc type-check và lúc chạy bằng từng công cụ?

## Đọc thêm

- [TSConfig Reference](https://www.typescriptlang.org/tsconfig/)
- [Modules reference: `module`, `moduleResolution`](https://www.typescriptlang.org/docs/handbook/modules/reference.html)
- [Choosing compiler options](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html)
- [Declaration files](https://www.typescriptlang.org/docs/handbook/declaration-files/introduction.html)
- [Node.js: Subpath imports](https://nodejs.org/api/packages.html#subpath-imports)

## Ghi chú của bạn
