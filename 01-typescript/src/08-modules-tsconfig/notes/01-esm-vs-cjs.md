# 1. ESM vs CommonJS và `"type"` trong package.json

Node có hai hệ module: CommonJS (`require`/`module.exports`) và ES Modules (`import`/`export`). Node quyết định một file thuộc hệ nào bằng đuôi file và trường `"type"` trong `package.json` gần nhất, **không** phải bằng cú pháp bạn viết.

```ts +esm +fixtures
import { add } from "./math.js";     // ESM: bắt buộc ghi đuôi, và là ".js" dù file nguồn là .ts

export const total = add(1, 2);
```

## Ý chính

- **CommonJS (CJS)**: `require()` đồng bộ, `module.exports`, có sẵn `__dirname`, `__filename`, `require`. Là mặc định của Node nếu không khai báo gì.
- **ESM**: `import`/`export` tĩnh, hỗ trợ top-level `await`, có `import.meta.url`/`import.meta.dirname`, **không** có `__dirname` và `require`.
- Node chọn hệ theo: `.mjs`/`.mts` luôn là ESM; `.cjs`/`.cts` luôn là CJS; `.js`/`.ts` theo `"type"` trong `package.json` gần nhất (`"module"` thì ESM, `"commonjs"` hoặc vắng mặt thì CJS).
- Với `module: NodeNext`, **TypeScript bắt chước đúng quy tắc đó**: cùng một cú pháp `import` được biên dịch thành `require` ở file CJS và giữ nguyên `import` ở file ESM.
- Trong file ESM, import tương đối phải ghi **đuôi file đầy đủ**, và viết `.js` (đuôi của file sau khi build) dù trên đĩa là `.ts`.
- Cùng một lệnh `tsc` cho ra code khác nhau hoàn toàn tuỳ `package.json`. Đây là nguyên nhân của nhiều lỗi "chạy trên máy tôi".

## Lý thuyết chi tiết

**Hai hệ module khác nhau ở đâu.**

| | CommonJS | ESM |
|---|---|---|
| Cú pháp | `const x = require("x")`, `module.exports = ...` | `import x from "x"`, `export ...` |
| Nạp | Đồng bộ, lúc chạy, có thể gọi trong `if` | Phân tích tĩnh trước khi chạy, bất đồng bộ |
| `__dirname` | Có | Không (dùng `import.meta.dirname`, Node 20.11+) |
| Top-level `await` | Không | Có |
| Giá trị import | Bản sao của `module.exports` tại lúc `require` | "Live binding" tới export của module gốc |
| Đuôi file khi import tương đối | Tuỳ chọn (`./math`) | Bắt buộc (`./math.js`) |

**Quy tắc Node chọn hệ module** (đã thử trên Node 24.21 với TS 7.0.2):

```text
.mjs / .mts           -> ESM
.cjs / .cts           -> CJS
.js / .ts             -> tuỳ trường "type" trong package.json gần nhất
                         "module"            -> ESM
                         "commonjs" / vắng   -> CJS
```

Vì vậy dòng `"type": "commonjs"` trong repo này nghĩa là mọi `.ts` ở đây đang là CJS. Chuyển sang ESM nghĩa là đổi `"type"` và sửa mọi thứ phụ thuộc vào điều đó (đuôi import, `__dirname`, công cụ chạy). Chi tiết các bước tuỳ bạn tìm hiểu theo bài lab; file này chỉ giải thích cơ chế.

**TypeScript với `module: NodeNext`.** TS đọc `package.json` để biết từng file là CJS hay ESM, rồi áp dụng luật tương ứng. Cùng cú pháp, khác kết quả:

```ts +esm +fixtures
// @ts-expect-error  TS2835: Relative import paths need explicit file extensions in ECMAScript imports
import { add } from "./math";
import { add as add2 } from "./math.js";   // đúng

export { add, add2 };
```

Trong file ở package `"type": "commonjs"`, cả `"./math"` và `"./math.js"` đều hợp lệ vì Node (CJS) tự dò đuôi. Đã thử trên TS 7.0.2.

**Vì sao `.js` chứ không phải `.ts`?** Vì đường dẫn trong `import` là đường dẫn **sau khi build**: Node chạy `dist/main.js` và sẽ tìm `dist/math.js`. TS 7 chấp nhận `"./math.js"` rồi tự ánh xạ về `math.ts` khi kiểm tra kiểu. Ghi `"./math.ts"` mặc định bị từ chối:

```ts +esm +fixtures
// @ts-expect-error  TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled
import { add } from "./math.ts";

export { add };
```

Có cờ `allowImportingTsExtensions` (kèm `noEmit` hoặc `rewriteRelativeImportExtensions`) để cho phép, nhưng chỉ dùng khi bạn có chủ đích (ví dụ chạy trực tiếp bằng Node strip-types). Với luồng `tsc` → `dist/` thông thường hãy theo quy ước `.js`. (`rewriteRelativeImportExtensions` cần TS 5.7+; chưa thử trong ghi chú này.)

**Import hai chiều CJS và ESM.**
- ESM `import` được CJS: có, nhưng thường chỉ lấy được `default` (chính là `module.exports`) và đôi khi các named export nếu Node phát hiện được tĩnh. Đây là vùng hay lỗi. Khi lỗi, dùng `import pkg from "pkg"; const { thing } = pkg;`.
- CJS `require` ESM: Node mới cho phép `require()` module ESM không chứa top-level `await` (đã thử trên Node 24.21; module có top-level `await` thì lỗi `ERR_REQUIRE_ASYNC_MODULE`); Node cũ hơn (trước 22) thì lỗi `ERR_REQUIRE_ESM`. Dùng `await import("./x.js")` là cách chắc chắn nhất ở mọi phiên bản.
- Với package đích cho người khác dùng, "dual package" (xuất cả CJS và ESM qua `exports`) có nhiều bẫy. Dự án ứng dụng backend thường chỉ cần chọn một hệ (ESM là hướng hiện đại).

**`esModuleInterop` ở TS 7.** Trước đây là cờ bạn phải bật để `import fs from "fs"` hoạt động với module CJS. Ở TS 7.0.2, đặt `"esModuleInterop": false` báo `TS5108: Option 'esModuleInterop=false' has been removed`. Nghĩa là hành vi "interop" luôn bật, và để `true` trong tsconfig là thừa nhưng vô hại. (Tài liệu cũ vẫn nói đây là cờ tuỳ chọn, hãy chú ý khi đọc bài hướng dẫn cũ.) `allowSyntheticDefaultImports: false` cũng bị gỡ tương tự.

**Hai thứ TS không cứu bạn khỏi runtime.** Có `@types/node`, `__dirname` và `require` vẫn "hợp lệ" với compiler ngay cả trong file ESM, nhưng lúc chạy:

```text
ReferenceError: __dirname is not defined in ES module scope
```

Đã thử: `tsc` biên dịch không lỗi, `node dist/main.js` thì sập. Bài học: compiler không biết bạn đang ở ESM hay CJS lúc chạy một cách tuyệt đối, chỉ suy ra từ `package.json` và đuôi file, còn kiểu toàn cục của Node thì khai báo cả hai.

**Top-level `await` và `import.meta`** chỉ có trong ESM. Trong file CJS, `tsc` báo `TS1309` (await) và `TS1470` (`import.meta`). Import JSON trong ESM cần cú pháp mới `import data from "./x.json" with { type: "json" }` và `resolveJsonModule`; trong file CJS cú pháp `with` bị từ chối (`TS2856`).

**So sánh với PHP/Laravel.** Composer autoload PSR-4 ánh xạ *namespace* → *thư mục*, và PHP tự `require` file khi class được dùng lần đầu. Trong Node không có autoload: mỗi file phải `import` tường minh thứ nó cần, và đường dẫn là đường dẫn file thật (kể cả đuôi trong ESM). Không có khái niệm "namespace" toàn cục, mỗi file là một module có phạm vi riêng, thứ nó `export` mới thấy được từ ngoài. Hàm `require` của PHP tương tự `require` của CJS (đồng bộ, theo điều kiện), còn `use Namespace\Class` chỉ là bí danh tên, không nạp file, khác với `import` của ESM vốn là thứ nạp file.

**Import vòng tròn (circular) khác hẳn giữa hai hệ** (đã chạy trên Node 24.21). Hai file `a` và `b` import lẫn nhau:

```text
CJS  a.cjs: exports.a1="a1"; const b=require("./b.cjs"); exports.a2="a2"; log(b)
     b.cjs: const a=require("./a.cjs"); log(JSON.stringify(a)); exports.b="b"
-> b sees a: {"a1":"a1"}     (a mới chạy dở: chỉ có phần đã gán trước dòng require)
   Warning: Accessing non-existent property 'toJSON' of module exports inside circular dependency

ESM  a.js: import { b } from "./b.js"; export const a="a"; log("a sees", b)
     b.js: import { a } from "./a.js"; export const b="b"; log("b sees", a)
-> ReferenceError: Cannot access 'a' before initialization   (chạy a.js: b chạy trước và đọc a ở TDZ)
```

CJS cho bạn **bản dở dang** của `module.exports` (lỗi thường lặng lẽ: giá trị `undefined`), ESM ném `ReferenceError` rõ ràng nếu bạn đọc binding trước khi nó được khởi tạo. Cách sửa chung: bỏ vòng (tách phần dùng chung ra file thứ ba), hoặc chỉ đọc giá trị bên trong hàm (chạy sau khi cả hai module đã nạp xong), không đọc ở mức top-level của module.

**ESM import tên (named) từ CJS không phải lúc nào cũng được.** Node phân tích tĩnh file CJS để đoán các tên export. Đã thử với `import { foo } from "./x.cjs"`:

```text
exports.foo = 1;                                  -> chạy được
const foo = 1; module.exports = { foo };           -> chạy được (shorthand)
module.exports = { foo: 1 };                       -> SyntaxError: Named export 'foo' not found.
module.exports = (function () { return { foo: 1 }; })();   -> cùng lỗi
```

Thông báo lỗi của Node tự gợi ý cách chữa: `import pkg from "./x.cjs"; const { foo } = pkg;`. Đây là lý do một thư viện CJS "chạy được ở `tsx`/bundler" nhưng sập ở Node thật. Kiểm tra bằng `node` thuần, và nhớ `default` luôn là cả `module.exports`.

**`.mts` trong package CJS, và `import()` động.** Dùng được trong cùng một project (đã thử với `"type": "commonjs"`, `module: NodeNext`):

- `src/lib.mts` biên dịch ra `dist/lib.mjs` (ESM), và file khác import nó bằng đuôi **`.mjs`** (`import { esm } from "./lib.mjs"`).
- Trong file CJS, `await import("./lib.mjs")` được giữ nguyên là `import()` trong đầu ra (không bị đổi thành `require`), nên nạp được module ESM có top-level `await` (đã thử, chạy ra kết quả).
- Ngược lại, một `import` tĩnh từ CJS tới module ESM có top-level `await` làm `node dist/static.js` sập với `ERR_REQUIRE_ASYNC_MODULE` (`require()` cannot be used on an ESM graph with top-level await. Use import() instead).

Bài học: nếu một thư viện chỉ có ESM mà app của bạn là CJS, dùng `import()` động, hoặc chuyển cả app sang ESM.

## Tricks & tips thực tế

- **Mặc định cho dự án mới: ESM (`"type": "module"`).** Lý do: đó là chuẩn của JS, top-level `await` tiện cho script/khởi tạo, và ngày càng nhiều thư viện chỉ phát hành ESM. Ngoại lệ: một số framework (ví dụ NestJS ở thời điểm tài liệu này) quen với CJS; kiểm tra tài liệu framework trước khi chuyển.
- **Khi thấy `ERR_MODULE_NOT_FOUND ... Did you mean to import "./x.js"`**: bạn thiếu đuôi `.js` trong import ESM. Sửa import, đừng sửa `tsconfig`. Lý do: Node không thử dò đuôi ở ESM.
- **Khi thấy `ERR_REQUIRE_ESM` hoặc `Cannot use import statement outside a module`**: Node đang coi file là hệ khác với cú pháp bạn viết. Kiểm tra `"type"` trong `package.json` gần nhất, đuôi file, và đầu ra của `tsc` (`dist/*.js` là `import` hay `require`).
- **Cách nhìn nhanh Node đang coi file là gì**: mở file đã build trong `dist/` và xem nó dùng `require` hay `import`. Lý do: bạn đang debug thứ Node chạy, không phải thứ bạn viết.
- **Thay `__dirname` trong ESM bằng `import.meta.dirname`** (Node 20.11+/21.2+) hoặc `fileURLToPath(new URL(".", import.meta.url))` (mọi bản). Lý do: `__dirname` không tồn tại ở ESM nhưng TS không báo.
- **Không trộn `require` vào code ESM** trừ khi cần (`createRequire(import.meta.url)`). Lý do: làm mất lợi thế phân tích tĩnh và dễ gây lỗi khó đọc.
- **Dùng `.mts`/`.cts` khi một file lẻ cần hệ khác với phần còn lại** (ví dụ file cấu hình `.cjs` trong package ESM). Lý do: đuôi file ghi đè `"type"`.
- **Nếu dùng `tsx` chạy dev, vẫn kiểm tra bằng `tsc` + chạy thử `node dist/...`.** `tsx` dò đuôi file lỏng hơn Node thật (đã thử: `import "./t"` thiếu đuôi chạy được bằng `tsx` nhưng `node` báo `ERR_MODULE_NOT_FOUND`). Lý do: code chạy ngon ở dev rồi vỡ ở production.
- **Cẩn thận khi copy tutorial cũ.** Nhiều bài hướng dẫn dùng `"module": "commonjs"`, `esModuleInterop: false`, `baseUrl`, `moduleResolution: node`. Với TS 7 một số cờ đó đã bị gỡ (xem `02-module-resolution.md`). Lý do: lỗi `TS5108` không phải do bạn sai logic mà do cờ không còn tồn tại.

## Liên hệ bài tập

Bài lab yêu cầu chuyển project sang ESM và giải thích từng flag. Hướng làm: (1) liệt kê mọi nơi hiện đang phụ thuộc vào CJS (trường `"type"`, import tương đối thiếu đuôi, bất kỳ chỗ nào dùng `__dirname`/`require`); (2) sửa theo từng thứ một và chạy `npm run type-check` sau mỗi bước để thấy compiler báo gì; (3) kiểm tra bằng cách chạy thật (`tsx` và code đã build) để biết lỗi nào chỉ lộ lúc runtime. Tự ghi lại câu trả lời cho: "tại sao import phải có `.js` mà file là `.ts`?" bằng lời của bạn.

## Đọc thêm

- [Node.js: ECMAScript modules](https://nodejs.org/api/esm.html)
- [Node.js: Modules, packages (`"type"` field)](https://nodejs.org/api/packages.html)
- [TypeScript: Modules reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html)
- [TypeScript: `module` option](https://www.typescriptlang.org/tsconfig/#module)

## Ghi chú của bạn
