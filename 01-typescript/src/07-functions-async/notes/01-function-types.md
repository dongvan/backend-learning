# 1. Function types, tham số và `this`

Hàm trong TypeScript là giá trị có kiểu: bạn mô tả được "nhận gì, trả gì" bằng một function type, rồi dùng lại cho callback, handler, dependency.

```ts
type Formatter = (value: number, locale?: string) => string;

const money: Formatter = (value, locale = "vi-VN") =>
  new Intl.NumberFormat(locale).format(value);   // value, locale được suy ra từ Formatter

money(1500000);                                 // "1.500.000"
```

## Ý chính

- Function type có dạng `(tham số) => kiểu trả về`. Tên tham số trong kiểu chỉ để đọc, không ảnh hưởng việc gán.
- Tham số: bắt buộc, optional (`x?: T`), có giá trị mặc định (`x: T = ...`), rest (`...xs: T[]`). Optional và default đều làm tham số có thể bỏ qua khi gọi.
- Khi gán hàm cho một biến đã có kiểu, tham số được **contextual typing** suy ra, không cần chú thích lại.
- **Call signature** (`{ (x: A): B }`) cho phép kiểu hàm mang thêm thuộc tính, ví dụ hàm có `.cache` hay `.name` tuỳ biến.
- `void` khác `undefined`: kiểu trả về `void` của *callback* nghĩa là "giá trị trả về bị bỏ qua", nên hàm trả giá trị khác vẫn gán được.
- Tham số giả `this` ở vị trí đầu tiên khai báo kiểu của `this`, bị xoá khi compile.

## Lý thuyết chi tiết

**Hai cách viết function type.** Dạng mũi tên `type F = (a: string) => number` gọn và dùng cho 95% trường hợp. Dạng call signature dùng khi hàm có thuộc tính đi kèm (TS cho phép mọi object có call signature):

```ts
type Counter = {
  (step?: number): number;   // call signature
  reset(): void;             // thuộc tính của hàm
};

function makeCounter(): Counter {
  let n = 0;
  const fn = ((step = 1) => (n += step)) as Counter;
  fn.reset = () => { n = 0; };
  return fn;
}

const c = makeCounter();
c();         // 1
c(5);        // 6
c.reset();
```

Từ `as Counter` ở đây là một lời hứa mà compiler không kiểm tra (ta gán `reset` ngay sau đó). Cách an toàn hơn là dùng `Object.assign(fn, { reset })`, kiểu kết quả là giao của hàm và object được gán.

**Contextual typing.** Compiler lấy kiểu của vị trí mà hàm được đặt vào để suy ra tham số. Vì thế `arr.map(x => ...)` không cần kiểu cho `x`. Nhưng nếu hàm được khai báo riêng, không có ngữ cảnh, tham số sẽ thành `any` ngầm và `strict` báo lỗi:

```ts
const nums = [1, 2, 3];
nums.map((n) => n * 2);               // n: number, suy ra từ mảng

// @ts-expect-error  Parameter 'n' implicitly has an 'any' type
const double = (n) => n * 2;          // không có ngữ cảnh, phải tự chú thích
```

**Optional, default, rest.**

```ts
function slugify(text: string, sep = "-", ...extra: string[]): string {
  const base = text.toLowerCase().trim().split(/\s+/).join(sep);
  return [base, ...extra].join(sep);
}

slugify("Hello World");                // "hello-world"
slugify("Hello World", "_", "v2");     // "hello_world_v2"
```

- `sep = "-"` suy ra kiểu `string` và tự động optional ở chỗ gọi. Ở bên trong hàm, `sep` luôn là `string`, không phải `string | undefined`.
- `x?: T` thì bên trong hàm `x` là `T | undefined`.
- Tham số optional phải đứng sau tham số bắt buộc. Tham số default thì được phép đứng trước, nhưng khi đó người gọi phải truyền `undefined` tường minh để "nhảy qua" nó. Vì vậy hãy xếp default ở cuối.
- Rest phải ở cuối và có kiểu mảng (hoặc tuple). Với `noUncheckedIndexedAccess`, `extra[0]` có kiểu `string | undefined`.

**Rest với tuple.** Muốn tham số có số lượng và kiểu vị trí cố định, dùng tuple:

```ts
function logEvent(...args: [name: string, payload?: object]): string {
  const [name, payload] = args;
  return `${name} ${JSON.stringify(payload ?? {})}`;
}

logEvent("user.created");
logEvent("user.created", { id: 1 });
```

**`void` vs `undefined`.** Đây là chỗ hay gây nhầm.

```ts
function run(cb: () => void): void {
  cb();
}

run(() => 42);                        // OK: giá trị trả về bị bỏ qua

export const result: void = undefined;   // void chỉ gán được undefined (khi nằm ở biến)
// @ts-expect-error  Type 'number' is not assignable to type 'void'
export const bad: void = 1;
```

Quy tắc: *khi một hàm **khai báo** kiểu trả về là `void`* (hàm literal ở vị trí có annotation `void`), thân hàm không được `return` giá trị. Nhưng *khi một hàm bất kỳ được **gán vào** một kiểu có `() => void`*, nó có thể trả gì cũng được. Đó là lý do `arr.forEach(x => results.push(x))` hợp lệ dù `push` trả `number`.

```ts
export function bad2(): void {
  // @ts-expect-error  Type 'number' is not assignable to type 'void'
  return 1;
}

export function fine(): undefined {
  return undefined;                   // return undefined tường minh, ý đồ rõ ràng
}
```

Dùng `undefined` làm kiểu trả về khi bạn muốn **cam kết** giá trị cụ thể là `undefined` (ví dụ một interface mà người dùng phải return `undefined` tường minh). Mặc định, hàm "không trả gì" cứ để `void`.

**Tham số `this`.** Trong JS, `this` phụ thuộc vào cách gọi, nên một method tách khỏi object sẽ mất `this`. TS cho khai báo `this` như một tham số giả ở đầu danh sách. Nó không tồn tại ở runtime:

```ts
interface Clock {
  label: string;
}

function describe(this: Clock, prefix: string): string {
  return `${prefix} ${this.label}`;
}

const clock: Clock = { label: "UTC" };
describe.call(clock, "Now:");          // OK

// @ts-expect-error  The 'this' context of type 'void' is not assignable to method's 'this' of type 'Clock'
describe("Now:");
```

Với `strict` (cụ thể `noImplicitThis`), dùng `this` trong hàm thường mà không biết kiểu của nó sẽ báo lỗi. Arrow function không có `this` riêng (lấy `this` từ phạm vi bao ngoài) nên không cho khai báo tham số `this`.

**Hàm generic** đã học ở Bài 3. Ở đây chỉ cần nhớ: kiểu hàm có thể chứa tham số kiểu, ví dụ `type Mapper = <T, U>(xs: T[], f: (x: T) => U) => U[]`. Vị trí đặt `<T>` quyết định khi nào `T` được cố định: trước tên hàm (cố định ở lúc gọi hàm), hay trên type alias (cố định ở lúc dùng alias).

## Tricks & tips thực tế

- **Đặt tên cho kiểu callback** (`type Handler = (req: Req) => Promise<void>`) thay vì viết inline lặp lại. Lý do: một chỗ để sửa, và thông báo lỗi hiển thị tên kiểu dễ đọc hơn là cả chữ ký dài.
- **Ưu tiên default parameter hơn `x?: T` rồi `x ?? default` trong thân hàm.** Lý do: `?? ` coi `null` cũng là "thiếu", còn default chỉ thay khi giá trị là `undefined`; hơn nữa kiểu bên trong hàm gọn hơn (không còn `| undefined`).
- **Đừng dùng nhiều tham số optional/boolean liên tiếp** (`createUser(name, true, false)`). Lý do: người đọc không biết `true` là gì, thứ tự dễ sai mà compiler không bắt được vì cùng kiểu. Chuyển sang một object tham số `createUser({ name, notify: true })`. Quy ước backend: từ 3 tham số trở lên thì dùng object.
- **Tham số object kèm default**: `function connect({ host = "localhost", port = 5432 }: { host?: string; port?: number } = {}) {}`. Lý do: gọi `connect()` không tham số vẫn hợp lệ, và mỗi trường có default riêng.
- **Callback trả `void` nhưng bạn `await` nó**: nếu type là `() => void` mà người dùng truyền async function (trả `Promise`), compiler vẫn chấp nhận nhưng Promise bị bỏ rơi, lỗi bên trong thành unhandled rejection. Nếu callback có thể async, khai báo `() => void | Promise<void>` hoặc `() => Promise<void>` và `await` nó. Xem `03-async-promise.md`.
- **Đừng truyền method thẳng làm callback** (`items.forEach(repo.save)`) vì mất `this`. Dùng arrow `items.forEach((i) => repo.save(i))`. Lý do: giống JS gốc, `this` được quyết định lúc gọi. Bật `noImplicitThis` giúp bắt một số trường hợp, nhưng không phải tất cả khi method khai báo kiểu `this` ngầm.
- **Debug "tại sao kiểu hàm không khớp"**: đọc thông báo từ dưới lên (dòng cuối thường nêu nguyên nhân gốc), và rê chuột vào biến để xem kiểu suy ra. Lỗi hay gặp: số tham số *nhiều hơn* kiểu đích. Hàm ít tham số hơn thì gán được (`(a) => ...` vào `(a, b) => ...`), ngược lại thì không.
- **So với PHP**: PHP có type hint `callable`/`Closure` nhưng không mô tả được chữ ký. TS tương đương với việc có PHPDoc `@param callable(int, string): bool $cb` mà compiler **thực sự kiểm tra**. Tham số mặc định và variadic `...$args` của PHP tương ứng với default và rest ở đây. Named arguments của PHP 8 được thay bằng object tham số trong TS.

## Liên hệ bài tập

Hàm trong bài lab cần có chữ ký rõ ràng. Hãy tự hỏi: tham số nào thực sự optional, tham số nào nên gom vào một object, và kiểu trả về nên là gì khi hàm không tìm thấy kết quả (`undefined`, `null` hay ném lỗi). Xem `02-overloads.md` để quyết định khi nào một hàm cần nhiều chữ ký.

## Đọc thêm

- [More on Functions](https://www.typescriptlang.org/docs/handbook/2/functions.html)
- [Functions và `this` trong TS](https://www.typescriptlang.org/docs/handbook/2/functions.html#declaring-this-in-a-function)

## Ghi chú của bạn
