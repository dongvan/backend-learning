# 3. `import type`, `verbatimModuleSyntax` và `isolatedModules`

Kiểu chỉ tồn tại lúc biên dịch, còn `import`/`export` tồn tại lúc chạy. Các cờ trong bài này buộc bạn **nói rõ** import nào là kiểu (sẽ bị xoá) và import nào là giá trị (được giữ lại), để mọi công cụ chỉ đọc từng file riêng lẻ cũng làm đúng.

```ts +esm +fixtures +verbatimModuleSyntax
import { add } from "./math.js";                  // giá trị: được giữ trong JS
import type { Point } from "./math.js";           // kiểu: bị xoá hoàn toàn
import { type Id, add as plus } from "./math.js"; // trộn: chỉ `Id` bị xoá

export const p: Point = { x: add(1, 2) };
export const id: Id = plus(1, 2);
```

## Ý chính

- `import type { X }` (và `export type`) đảm bảo import đó **bị xoá** khỏi JS. `import { type X, y }` xoá riêng `X`, giữ `y`.
- **`verbatimModuleSyntax`** (TS 5.0+): những gì bạn viết là những gì được giữ. Import không có `type` luôn còn trong JS; import có `type` luôn bị xoá. Nếu bạn import một kiểu mà quên `type`, compiler báo lỗi `TS1484`.
- **`isolatedModules`**: bắt lỗi ở các cấu trúc mà công cụ chỉ nhìn **một file** (esbuild, `tsx`, Vitest, Babel) không thể biết đúng. Ví dụ re-export một kiểu không ghi `type` (`TS1205`).
- Hai cờ này cùng giải quyết một vấn đề gốc: tool xoá kiểu theo từng file không có thông tin của file khác để biết `User` là kiểu hay giá trị.
- `verbatimModuleSyntax` cũng báo `TS1205` ở re-export kiểu (đã thử), nên nó bao trùm phần lớn việc mà `isolatedModules` kiểm tra. Với dự án Node + công cụ như `tsx`/Vitest, bật `verbatimModuleSyntax` là lựa chọn hiện đại.
- `verbatimModuleSyntax` đòi file phải **thực sự là ESM** hoặc dùng cú pháp CJS của TS; dùng cú pháp `import`/`export` trong file đang là CJS bị cấm (đã thử, xem dưới).

## Lý thuyết chi tiết

**Vấn đề: "import elision".** Trước đây TS tự động xoá import mà nó thấy chỉ dùng làm kiểu. Compiler đầy đủ làm được việc này vì nó thấy toàn dự án. Công cụ chỉ xử lý từng file (esbuild, Babel, `tsx`, Vitest) thì không biết `User` ở file khác là `interface` hay `class`, nên không dám xoá, hoặc xoá nhầm. Kết quả: lúc chạy báo `The requested module does not provide an export named 'User'`.

**Hành vi quan sát được trên TS 7.0.2** (module ESM, `module: NodeNext`):

```text
Không bật cờ nào:
  import { User } from "./types.js";   // User chỉ dùng làm kiểu
  -> JS đầu ra: dòng import biến mất hoàn toàn
     (kể cả hiệu ứng phụ của ./types.js nếu file đó chỉ được nạp vì import này)

verbatimModuleSyntax: true:
  import { User } from "./types.js";   -> lỗi TS1484 'User' is a type and must be imported using a type-only import
  import type { User } from ...        -> bị xoá hoàn toàn
  import { type User } from ...        -> JS còn `import {} from "./types.js"` (giữ hiệu ứng phụ)
```

Hai điểm tinh tế: (1) `import type { X }` xoá cả dòng, nhưng `import { type X }` để lại một import rỗng để bảo toàn việc nạp module (hiệu ứng phụ); (2) khi `verbatimModuleSyntax` báo lỗi mà bạn vẫn emit, dòng `import { User }` vẫn nằm trong JS, và Node sẽ sập ở runtime. Vì vậy hãy xem lỗi này là nghiêm trọng.

**Cú pháp.**

```ts +esm +fixtures +verbatimModuleSyntax
import type { Point } from "./math.js";
import { type Id, add } from "./math.js";
export type { Point, Id };                       // re-export kiểu: bắt buộc có `type`

export const origin: Point = { x: add(0, 0) };
```

Re-export kiểu mà thiếu `type` là lỗi `TS1205` dưới cả `verbatimModuleSyntax` lẫn `isolatedModules`:

```ts +esm +fixtures +isolatedModules
// @ts-expect-error  TS1205: Re-exporting a type when 'isolatedModules' is enabled requires using 'export type'
export { Point } from "./math.js";
```

Lý do: một tool đọc từng file nhìn dòng đó không biết `Point` là kiểu (nên phải xoá) hay giá trị (nên phải giữ).

**`verbatimModuleSyntax` với file CJS.** Repo này hiện có `"type": "commonjs"`, nghĩa là các file `.ts` là CJS. Thử bật `verbatimModuleSyntax` trong cấu hình như vậy cho kết quả:

```text
TS1295: ECMAScript imports and exports cannot be written in a CommonJS file under
        'verbatimModuleSyntax'. Adjust the 'type' field in the nearest 'package.json'
        to make this file an ECMAScript module, or adjust your 'verbatimModuleSyntax',
        'module', and 'moduleResolution' settings in TypeScript.
TS1287: A top-level 'export' modifier cannot be used on value declarations in a
        CommonJS module when 'verbatimModuleSyntax' is enabled.
```

Hiểu thông điệp: cờ này muốn đầu ra giống hệt đầu vào. Với CJS, `import` sẽ phải bị dịch thành `require` (tức "không verbatim"), nên nó cấm. Vì thế `verbatimModuleSyntax` và việc chuyển sang ESM đi cùng nhau: hai thay đổi này phụ thuộc lẫn nhau, bạn nên nghĩ về thứ tự khi làm bài lab.

**`isolatedModules`** kiểm tra các cấu trúc "không an toàn khi xử lý từng file". Cấu trúc đã thử trong ghi chú này là re-export kiểu không có `type` (ví dụ trên). Tài liệu chính thức còn liệt kê thêm vài trường hợp khác (ví dụ `const enum`), xem link ở cuối; những mục đó chưa được thử ở đây.

**`erasableSyntaxOnly` (TS 5.8+)** cấm cú pháp TS không thể "xoá kiểu" mà vẫn ra JS đúng: `enum`, `namespace` có code, parameter property của class (`constructor(private x: number)`). Đã thử, mỗi mục báo `TS1294`. Nó liên quan vì Node 24 chạy trực tiếp file `.ts` bằng cách *chỉ xoá kiểu* (type stripping) và không hỗ trợ các cú pháp trên (thử: `enum` làm Node 24.21 báo lỗi). Cờ này giúp code của bạn chạy được ở mọi công cụ kiểu "chỉ xoá kiểu". Thứ có thể ảnh hưởng bài tập: `enum` đã học ở các bài trước nên tránh nếu bật cờ này, dùng object `as const` (xem Bài 7).

**`import type` và class dùng cho DI.** Cạm bẫy hệ NestJS (Phase 03): `emitDecoratorMetadata` cần class ở dạng giá trị, nên `import type { UserService }` làm DI hỏng (Nest không thấy class). Ở phase đó, import class dùng cho injection phải là import thường. Chỉ ghi nhận ở đây, chưa thử trong repo này.

**Lỗi ngược chiều: dùng `import type` rồi dùng như giá trị.** Đã thử:

```text
import type { Svc } from "./svc.js";     // Svc là class
export const s = new Svc();
-> TS1361: 'Svc' cannot be used as a value because it was imported using 'import type'.
```

Class vừa là kiểu vừa là giá trị, nên `import { Svc }` thường (không `type`) hợp lệ dưới `verbatimModuleSyntax` (đã thử: không lỗi khi chỉ dùng `Svc` làm kiểu tham số). `TS1484` chỉ xuất hiện với thứ **thuần kiểu** (`interface`, `type`). Quy tắc: `interface`/`type` thì `import type`; class dùng lúc chạy (`new`, `instanceof`, decorator) thì import thường.

**Node chạy `.ts` trực tiếp cho thấy rõ vấn đề "xoá kiểu từng file"** (Node 24.21, đã thử):

```text
// types.ts: export interface User {...}; export const make = ...
import { make, User } from "./types.ts";       -> SyntaxError: The requested module './types.ts' does not provide an export named 'User'
import { make, type User } from "./types.ts";  -> chạy được
class P { constructor(private x: number) {} }  -> ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript parameter property is not supported in strip-only mode
import { make } from "./types";                -> ERR_MODULE_NOT_FOUND (thiếu đuôi)
import { make } from "@/types.ts";             -> ERR_MODULE_NOT_FOUND: Cannot find package '@/types.ts' (không đọc `paths`)
```

Dòng đầu chính xác là lỗi mà `verbatimModuleSyntax` chặn từ lúc type-check. Lưu ý Node import đuôi `.ts` (khác quy ước `.js` của `tsc`): chạy trực tiếp bằng Node và build bằng `tsc` đòi hai quy ước khác nhau, một lý do để chọn một con đường và bám theo (xem `05-toolchain-tsx-tsc-vitest.md`).

## Tricks & tips thực tế

- **Bật `verbatimModuleSyntax` cho dự án ESM mới.** Lý do: rõ ràng nhất, một dòng `import` nói thẳng nó sống lúc runtime hay không, và không còn bất ngờ giữa `tsc`, `tsx`, Vitest.
- **Dùng `import { type A, b }` thay vì hai dòng import khi cùng một module.** Lý do: gọn, giữ một nơi nhìn. Chú ý nó để lại `import {}` khi mọi mục đều là `type`; nếu muốn xoá hẳn thì dùng `import type { A }`.
- **Khi cần giữ hiệu ứng phụ** (đăng ký, polyfill), viết `import "./setup.js"` tường minh. Lý do: import có tên mà chỉ dùng làm kiểu bị xoá khi không bật cờ (đã thử), kéo theo mất luôn việc nạp module; import không tên thì luôn được giữ.
- **Gặp `TS1484`**: thêm `type` vào import. Gặp `TS1205`: đổi `export { X }` thành `export type { X }`. Lý do: đó là đúng điều cờ muốn, không cần tắt cờ.
- **Gặp `The requested module '...' does not provide an export named 'X'` lúc chạy** (trong khi `tsc` sạch): gần như chắc chắn một import kiểu bị giữ lại. Bật `verbatimModuleSyntax` để compiler chỉ ra từng chỗ. Lý do: lỗi này do tool xoá kiểu từng-file không biết `X` là kiểu.
- **Cân nhắc lint quy tắc `consistent-type-imports`** (typescript-eslint). Lý do: tự động sửa hàng loạt import thành `import type`.
- **Dùng `export type { ... }` trong file "barrel" `index.ts`.** Lý do: tool từng-file không biết thứ bạn re-export là kiểu hay giá trị. Nếu không thì lỗi `TS1205` hoặc runtime sập.
- **So với PHP**: `use App\Models\User;` không phân biệt "chỉ dùng làm type hint" và "dùng làm class thật". Autoloader chỉ nạp file khi class thực sự được dùng. Trong TS, ranh giới "kiểu/giá trị" là thật và nằm ở ngay dòng `import`.

## Liên hệ bài tập

Khi giải thích `verbatimModuleSyntax` và `isolatedModules` trong bài lab, hãy tự tạo hai file nhỏ (một export `interface`, một import nó) và quan sát hai điều: lỗi nào hiện ra khi bật/tắt cờ, và JS trong `dist/` khác nhau ra sao. Hãy dự đoán trước, chạy thử, rồi đối chiếu. Hãy thử xem điều gì xảy ra nếu bật `verbatimModuleSyntax` trước khi đổi `"type"` trong `package.json`, và lý do.

## Đọc thêm

- [`verbatimModuleSyntax`](https://www.typescriptlang.org/tsconfig/#verbatimModuleSyntax)
- [`isolatedModules`](https://www.typescriptlang.org/tsconfig/#isolatedModules)
- [`erasableSyntaxOnly`](https://www.typescriptlang.org/tsconfig/#erasableSyntaxOnly)
- [Type-only imports and exports](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-8.html#type-only-imports-and-exports)

## Ghi chú của bạn
