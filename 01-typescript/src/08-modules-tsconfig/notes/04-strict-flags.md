# 4. Các cờ kiểm tra nghiêm ngặt: `strict` và hơn thế

`strict` là một cờ tổng bật cả nhóm kiểm tra; các cờ như `noUncheckedIndexedAccess` hay `exactOptionalPropertyTypes` nằm **ngoài** nhóm đó và phải bật riêng. Mỗi cờ biến một loại bug runtime thành lỗi compile.

```ts
const ports = [3000, 3001];
const first = ports[0];                 // number | undefined (nhờ noUncheckedIndexedAccess)

// @ts-expect-error  'first' is possibly 'undefined'
export const next = first + 1;
```

## Ý chính

- `strict: true` bật nhóm: `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`, `useUnknownInCatchVariables`, `alwaysStrict`. Bật `strict` rồi liệt kê lại từng cờ trong đó là thừa (tuy vô hại, dùng làm tài liệu).
- Ở TS 7.0.2, `strict` **mặc định là bật** ngay cả khi không ghi (đã thử: không có `strict` mà `(x) => x` vẫn báo `TS7006`). Nên cấu hình mới ngắn hơn trước.
- Các cờ **ngoài `strict`** đáng cân nhắc cho backend: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`.
- Cờ nghiêm ngặt càng bật sớm càng rẻ: bật trễ trên dự án lớn tạo ra hàng trăm lỗi cùng lúc.
- Compiler chỉ chứng minh tính đúng ở **trong** kiểu bạn khai báo. Dữ liệu từ ngoài vẫn cần validate lúc chạy (Bài 9).

## Lý thuyết chi tiết

**Nhóm trong `strict`.**

| Cờ | Bắt lỗi gì |
|---|---|
| `strictNullChecks` | `null`/`undefined` không còn gán được cho mọi kiểu. Tương đương "nullable type hint" của PHP nhưng được ép mọi nơi |
| `noImplicitAny` | Tham số/biến không suy ra được kiểu thì lỗi, thay vì âm thầm là `any` |
| `strictFunctionTypes` | Kiểm tra tham số hàm theo chiều phản biến (xem dưới) |
| `strictBindCallApply` | `bind`/`call`/`apply` được kiểm tra đúng kiểu đối số |
| `strictPropertyInitialization` | Thuộc tính class phải được gán trong constructor (hoặc khai báo `!`/`?`) |
| `noImplicitThis` | `this` phải biết kiểu (xem Bài 7) |
| `useUnknownInCatchVariables` | `catch (e)` có `e: unknown` thay vì `any` |
| `alwaysStrict` | Phát `"use strict"` và phân tích theo strict mode của JS |

Ví dụ `strictFunctionTypes`: một hàm nhận kiểu *hẹp* không gán được vào chỗ cần hàm nhận kiểu *rộng* (vì người gọi có thể truyền kiểu rộng vào):

```ts
type Animal = { name: string };
type Dog = { name: string; bark(): void };

type OnAnimal = (a: Animal) => void;

const onDog = (d: Dog): void => d.bark();

// @ts-expect-error  Type '(d: Dog) => void' is not assignable to type 'OnAnimal'
export const handler: OnAnimal = onDog;
```

Cú pháp **method** (`onEvent(a: Animal): void` trong interface) vẫn được kiểm tra lỏng hơn (bivariant) vì lý do tương thích lịch sử; cú pháp **thuộc tính hàm** (`onEvent: (a: Animal) => void`) được kiểm tra chặt. Khi khai báo callback trong interface, ưu tiên dạng thuộc tính.

**`noUncheckedIndexedAccess`.** Truy cập bằng chỉ số hoặc khoá chuỗi trả `T | undefined`, không phải `T`:

```ts
const env: Record<string, string> = { PORT: "3000" };
const port = env["PORT"];               // string | undefined

export const portNumber = Number(port ?? "3000");

const items: string[] = ["a", "b"];
export const second = items[1] ?? "none";            // phải xử lý undefined

for (const item of items) {
  // vòng lặp for...of: item vẫn là string (không bị | undefined)
  void item.length;
}
```

Hai cách giữ code gọn: dùng `for...of`, `.map`, `.at()` (trả `T | undefined` sẵn), destructuring có mặc định, hoặc kiểm tra `if (x !== undefined)` rồi dùng. Đây là cờ đáng bật nhất cho backend vì nó bắt đúng loại bug "phần tử không tồn tại" mà PHP hay âm thầm trả `null` (kèm warning "Undefined array key").

**`exactOptionalPropertyTypes`.** Phân biệt "thuộc tính vắng" với "thuộc tính có giá trị `undefined`":

```ts +exactOptionalPropertyTypes
type Patch = { nickname?: string };

export const ok: Patch = {};                         // vắng: OK

// @ts-expect-error  Type 'undefined' is not assignable to type 'string' with 'exactOptionalPropertyTypes'
export const bad: Patch = { nickname: undefined };   // có, nhưng giá trị là undefined: lỗi

export type Maybe = { nickname?: string | undefined }; // muốn cho phép thì khai báo tường minh
```

Quan trọng cho PATCH API: `{ nickname: undefined }` và `{}` thường có nghĩa khác nhau ("xoá" hay "không đổi"), và `JSON.stringify` bỏ qua thuộc tính `undefined`. Không bật cờ này (mặc định), compiler coi hai cái như nhau.

**`noImplicitReturns`.** Mọi đường đi của hàm có kiểu trả về giá trị phải `return` tường minh:

```ts
function sign(n: number): string {
  if (n > 0) return "+";
  if (n < 0) return "-";
  return "0";                                        // bỏ dòng này thì lỗi
}

// @ts-expect-error  TS7030: Not all code paths return a value
export function bad(n: number): string | undefined {
  if (n > 0) return "+";
}

export { sign };
```

Không `return` ở cuối hàm kiểu `T | undefined` khiến lỗi sót, buộc bạn viết `return undefined;` tường minh.

**`noUnusedLocals` và `noUnusedParameters`.** Biến/tham số khai báo mà không đọc là lỗi. Tham số **bắt đầu bằng `_`** được miễn:

```ts
export function handle(_req: unknown, res: { send(s: string): void }): void {
  res.send("ok");                                    // _req không dùng nhưng được miễn vì có `_`
}
```

Các lỗi này hơi gây khó chịu khi đang thử nghiệm; đó cũng là lý do một số dự án chỉ bật chúng ở bước CI.

**`noFallthroughCasesInSwitch`.** `case` có code mà không `break`/`return` rồi rơi xuống `case` sau là lỗi:

```ts
export function label(n: number): string {
  let s = "";
  switch (n) {
    // @ts-expect-error  TS7029: Fallthrough case in switch (lỗi báo ở dòng `case 1:`)
    case 1:
      s += "one";
    case 2:
      s += "two";
      break;
    default:
      s = "many";
  }
  return s;
}
```

`case` rỗng xếp liền nhau (`case 1: case 2:`) vẫn được phép.

**`noImplicitOverride`.** Khi class con ghi đè method của cha, phải viết `override`. Lý do: nếu sau này cha đổi tên method, `override` của con báo lỗi thay vì âm thầm thành method mới không ai gọi:

```ts +noImplicitOverride
class Base {
  run(): string { return "base"; }
}

export class Child extends Base {
  // @ts-expect-error  TS4114: This member must have an 'override' modifier
  run(): string { return "child"; }
}
```

**`noPropertyAccessFromIndexSignature`.** Với kiểu có index signature, buộc dùng `obj["key"]` thay vì `obj.key`, để phân biệt "thuộc tính đã biết" với "khoá động":

```ts +noPropertyAccessFromIndexSignature
type Env = { NODE_ENV: string; [key: string]: string | undefined };
declare const env: Env;

export const mode = env.NODE_ENV;                   // khoá đã biết: dùng chấm
// @ts-expect-error  Property 'PORT' comes from an index signature, so it must be accessed with ['PORT']
export const port = env.PORT;
export const port2 = env["PORT"];                   // đúng cách
```

**Cạm bẫy nhận biết: cờ bật nhưng code dùng `!` hoặc `as` để tắt nó.** `items[0]!` và `x as string` bỏ qua kiểm tra. Dùng khi bạn *thật sự* biết hơn compiler và nên kèm comment lý do.

## Tricks & tips thực tế

- **Bật `strict` và `noUncheckedIndexedAccess` ngay từ đầu dự án.** Lý do: sửa dần từng chỗ ở dự án nhỏ rẻ hơn nhiều so với gỡ hàng trăm lỗi ở dự án lớn.
- **Bật `exactOptionalPropertyTypes` khi bạn có API PATCH hoặc DTO với "vắng" ≠ `undefined`.** Lý do: cờ này ngăn một nhóm bug mà `JSON.stringify` và ORM xử lý khác nhau. Chú ý: một số thư viện bên thứ ba có thể chưa tương thích; trường hợp đó cân nhắc lại lợi ích (chưa thử trong ghi chú này).
- **Dùng `?? ` và `if (x !== undefined)` thay vì `!` để xử lý `T | undefined`.** Lý do: `!` chỉ đóng miệng compiler và lỗi vẫn xảy ra ở runtime, chỉ chuyển từ lúc compile sang lúc chạy.
- **Đặt tên tham số không dùng bằng `_name`**, đặc biệt ở handler/callback có chữ ký cố định. Lý do: giữ chữ ký đúng mà không phải tắt `noUnusedParameters`.
- **Bật `noImplicitOverride` nếu dùng kế thừa class** (NestJS, class-based services). Lý do: bảo vệ trước đổi tên ở lớp cha.
- **Chuyển cờ từng bước khi làm dự án cũ.** Bật một cờ, sửa hết lỗi, commit, rồi cờ tiếp theo. Lý do: lỗi của mỗi cờ có bản chất khác nhau, trộn lẫn rất khó theo dõi. Dùng `npx tsc --noEmit --exactOptionalPropertyTypes` để thử một cờ mà không sửa `tsconfig`.
- **Đếm lỗi nhanh**: `npx tsc --noEmit | grep -c "error TS"`. Lý do: biết quy mô công việc trước khi bắt đầu.
- **Đừng tắt cờ chỉ để "cho xanh"**. Lý do: mỗi lỗi do cờ nghiêm ngặt thường là một bug tiềm tàng hoặc một giả định chưa kiểm chứng.
- **Tránh `any`**; nếu bắt buộc, ghi lý do. `unknown` + narrowing/Zod thay `any` (xem notes Bài 1 và Bài 9). Lý do: `any` lây lan và vô hiệu hoá hầu hết các cờ ở trên.
- **So với PHP**: `declare(strict_types=1)` chỉ siết kiểu tại ranh giới gọi hàm lúc chạy; PHPStan/Psalm mới tương đương compiler TS (phân tích tĩnh, theo "level"). Bật cờ TS giống nâng level PHPStan, nhưng ở TS việc này nằm sẵn trong compiler.

## Liên hệ bài tập

Khi giải thích "từng flag" trong bài lab, mỗi cờ nên có bộ ba: *nó bắt loại lỗi nào*, *một đoạn code nhỏ vi phạm*, *đoạn code đã sửa*. Hãy kiểm chứng bằng cách thực sự tắt cờ, thấy code vi phạm lọt qua, rồi bật lại. Cờ nào đang có trong `tsconfig.json` của repo, cờ nào đang thừa vì đã nằm trong `strict`, cờ nào nên cân nhắc thêm? Hãy tự quyết định và nêu lý do thay vì chép bản dựng sẵn.

## Đọc thêm

- [TSConfig: `strict`](https://www.typescriptlang.org/tsconfig/#strict)
- [`noUncheckedIndexedAccess`](https://www.typescriptlang.org/tsconfig/#noUncheckedIndexedAccess)
- [`exactOptionalPropertyTypes`](https://www.typescriptlang.org/tsconfig/#exactOptionalPropertyTypes)
- [`noImplicitOverride`](https://www.typescriptlang.org/tsconfig/#noImplicitOverride)
- [`noPropertyAccessFromIndexSignature`](https://www.typescriptlang.org/tsconfig/#noPropertyAccessFromIndexSignature)

## Ghi chú của bạn
