# 5. Cạm bẫy và tình huống thực tế với generic

Những lỗi generic hay gặp khi viết code backend (cache, groupBy, retry, wrapper), kèm thông báo lỗi thật của compiler và cách sửa. Mọi ví dụ và mã lỗi trong ghi chú này đã được `tsc` 7.0.2 kiểm chứng với `tsconfig.json` của repo (strict, `noUncheckedIndexedAccess`).

```ts
class Animal { name = "a"; }
class Dog extends Animal { bark() {} }
interface Item { sku: string; qty: number }
```

## Ý chính

- Phần lớn lỗi generic là một trong ba loại: **suy luận ra kiểu không như ý** (`never[]`, `unknown`), **generic "nói dối"** (kiểu hứa nhiều hơn dữ liệu thật), và **variance** (khi nào `Box<Dog>` gán được cho `Box<Animal>`).
- Thông báo lỗi có mã `TSxxxx` ổn định: học vài mã hay gặp giúp bạn đoán nguyên nhân mà không cần đọc hết thông báo dài.
- `T` không biết gì về nó ngoài constraint. Mọi giả định (truthy, khoá là chuỗi, so sánh `===` theo giá trị) đều là cạm bẫy tiềm tàng.

## Lý thuyết chi tiết

**1. Bảng mã lỗi thường gặp (đã kiểm chứng)**

| Tình huống | Mã và thông báo |
|---|---|
| `const b: Box = ...` khi `Box<T>` | `TS2314: Generic type 'Box' requires 1 type argument(s).` |
| `two<string>("a", 1)` với `two<A, B>` | `TS2558: Expected 2 type arguments, but got 1.` |
| `len<number>(1)` với `T extends { length: number }` | `TS2344: Type 'number' does not satisfy the constraint '{ length: number; }'.` |
| `len(1)` (suy luận, không truyền tay) | `TS2345: Argument of type 'number' is not assignable to parameter of type '{ length: number; }'.` |
| `reduce(..., [])` suy ra `never[]` | `TS2769: No overload matches this call.` kèm "Type 'string' is not assignable to type 'never'." |

Lưu ý khác biệt `TS2344` và `TS2345`: khi bạn **truyền tay** type argument sai, lỗi nằm ở type argument (2344); khi để suy luận, lỗi nằm ở đối số (2345).

**2. Excess property check không áp dụng khi tham số là `T`**

```ts
interface Upload { name: string }
function saveLoose<T extends Upload>(x: T): T { return x; }
function saveStrict(x: Upload): Upload { return x; }

saveLoose({ name: "a", extra: 1 });    // OK: T suy ra thành { name: string; extra: number }
saveStrict({ name: "a", extra: 1 });   // TS2353: Object literal may only specify known properties
```

Với generic, `T` được suy ra *bao gồm* thuộc tính thừa nên không còn "thừa" nữa. Đây là lý do `saveLoose` giữ được kiểu cụ thể (ưu điểm, xem file 2), nhưng bạn mất lưới an toàn bắt typo tên trường. Nếu hàm là cổng nhận dữ liệu từ nhiều nơi và bạn muốn bắt trường lạ, dùng tham số kiểu cụ thể (như `saveStrict`) hoặc validate ở runtime.

**3. `reduce` với giá trị khởi tạo rỗng**

```ts
const items: Item[] = [];

const bySku = items.reduce((acc, it) => { acc[it.sku] = it; return acc; }, {});
// TS7053: Element implicitly has an 'any' type because expression of type 'string' can't be used to index type '{}'.

const skus = items.reduce((acc, it) => [...acc, it.sku], []);
// TS2769: No overload matches this call. (acc là never[], string không gán được cho never)

// Sửa: nói rõ kiểu của accumulator
const skus2 = items.reduce<string[]>((acc, it) => [...acc, it.sku], []);
const bySku2 = items.reduce<Record<string, Item>>((acc, it) => { acc[it.sku] = it; return acc; }, {});
```

Lý do: `reduce<U>` suy ra `U` từ giá trị khởi tạo, mà `[]` và `{}` không mang thông tin. Truyền `<U>` tay ở đúng chỗ này là hợp lý (khác với lời khuyên "đừng truyền thừa" ở file 1), vì không còn nguồn suy luận nào khác.

**4. `groupBy` tự viết: kiểu trả về `Record<K, T[]>` nói dối**

```ts
function groupBy<T, K extends PropertyKey>(xs: readonly T[], key: (x: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;     // as ở đây là lời hứa: "sẽ đủ mọi khoá"
  for (const x of xs) {
    const k = key(x);
    (out[k] ??= []).push(x);
  }
  return out;
}
const g = groupBy(items, (i) => (i.qty > 1 ? "many" : "one"));
g.many;   // kiểu là Item[], nhưng nếu không có item nào qty > 1 thì runtime là undefined
```

`K` suy ra là `"many" | "one"`, nên `Record<"many" | "one", Item[]>` hứa cả hai khoá luôn tồn tại. Trung thực hơn là `Partial<Record<K, T[]>>`:

```ts
function groupBy2<T, K extends PropertyKey>(xs: readonly T[], key: (x: T) => K): Partial<Record<K, T[]>> {
  const out: Partial<Record<K, T[]>> = {};
  for (const x of xs) {
    const k = key(x);
    const bucket = out[k] ?? [];
    bucket.push(x);
    out[k] = bucket;
  }
  return out;
}
const g2 = groupBy2(items, (i) => (i.qty > 1 ? "many" : "one"));
g2.many;   // Item[] | undefined
```

Bản có `as Record<K, T[]>` ở đầu là ví dụ điển hình của "một `as` che một lời hứa": đáng ghi comment nếu bạn chọn giữ nó. (`Object.groupBy` là ES2024, nằm ngoài `lib: ES2022` của repo nên không dùng được ở đây.)

**5. Variance: `Box<Dog>` có gán được cho `Box<Animal>` không?**

```ts
const dogs: Dog[] = [new Dog()];
const animals: Animal[] = dogs;      // OK (mảng là covariant, và hơi không an toàn)
animals.push(new Animal());          // compile OK, nhưng `dogs` giờ chứa một Animal không có bark()

interface Sink<T> { write: (x: T) => void }       // thuộc tính kiểu hàm
declare const sinkAnimal: Sink<Animal>;
declare const sinkDog: Sink<Dog>;
const s1: Sink<Dog> = sinkAnimal;    // OK: nơi ghi được mọi Animal thì ghi được Dog
const s2: Sink<Animal> = sinkDog;    // TS2322: Property 'bark' is missing in type 'Animal' but required in type 'Dog'

interface SinkM<T> { write(x: T): void }          // method shorthand
declare const smDog: SinkM<Dog>;
const s3: SinkM<Animal> = smDog;     // OK! method bị kiểm tra "bivariant" nên lọt
```

- Vị trí **đầu ra** (kiểu trả về, thuộc tính đọc) là **covariant**: `Dog` thay được `Animal`.
- Vị trí **đầu vào** (tham số hàm) là **contravariant** khi bật `strictFunctionTypes` (nằm trong `strict`): chiều ngược lại.
- **Method shorthand** (`write(x: T): void`) được miễn kiểm tra chặt này, còn thuộc tính kiểu hàm (`write: (x: T) => void`) thì không. Đây là cố ý của TypeScript để các kiểu như `Array<T>` còn dùng được, nhưng nghĩa là method cho kết quả lỏng hơn.
- Từ TS 4.7 bạn có thể ghi chú variance tường minh: `interface Source<out T>`, `interface Sink<in T>`, `interface Both<in out T>`. Đã kiểm chứng: `Both<Dog>` không gán được cho `Both<Animal>` (TS2322). Với kiểu chỉ dùng method shorthand, annotation `out T` sai vẫn không báo lỗi (do bivariance), nên đừng coi nó là bằng chứng.

Hệ quả thực tế: nếu bạn thiết kế `EventHandler<T>`, `Validator<T>` (chỉ *nhận* `T`), hãy dùng thuộc tính kiểu hàm nếu muốn compiler từ chối gán chiều sai.

**6. `Map` với khoá là object trong cache generic**

```ts
class Cache<K, V> {
  private readonly store = new Map<K, V>();
  get(k: K) { return this.store.get(k); }
  set(k: K, v: V) { this.store.set(k, v); }
}
const c = new Cache<{ id: number }, string>();
c.set({ id: 1 }, "x");
c.get({ id: 1 });   // undefined lúc runtime (đã chạy): hai object literal khác tham chiếu
```

`Map` so khoá bằng tham chiếu (SameValueZero), generic không đổi được điều đó. Kiểu `K` quá rộng mời gọi lỗi này. Thiết kế lại để khoá là kiểu nguyên thuỷ:

```ts
class Cache2<TItem, K extends string | number> {
  private readonly store = new Map<K, TItem>();
  constructor(private readonly keyOf: (i: TItem) => K) {}
  put(i: TItem) { this.store.set(this.keyOf(i), i); }
  find(k: K) { return this.store.get(k); }
}
const c2 = new Cache2((i: { id: number; n: string }) => i.id);   // K suy ra number
c2.put({ id: 1, n: "a" });
c2.find(1)?.n;   // "a" (đã chạy)
```

**7. Thu hẹp (narrowing) giá trị kiểu `T` không làm `T` hẹp lại**

```ts
function ret<T extends string | number>(x: T): T {
  if (typeof x === "string") {
    return x.toUpperCase();   // Lỗi: string không gán được cho T
  }
  return x;
}
```

Sau `typeof x === "string"`, bạn dùng được `x.toUpperCase()`, nhưng kết quả là `string` chứ không phải `T` (`T` có thể là `"abc"`, và `"ABC"` không phải `"abc"`). Khi đầu ra phụ thuộc vào nhánh đầu vào, dùng overload (Bài 7):

```ts
function ret2(x: string): string;
function ret2(x: number): number;
function ret2(x: string | number): string | number { return typeof x === "string" ? x.toUpperCase() : x; }
```

**8. `T & U` cho thuộc tính trùng tên cho ra `never`**

```ts
function merge<T extends object, U extends object>(a: T, b: U): T & U { return { ...a, ...b }; }
const mg = merge({ a: 1 }, { a: "x" });
mg.a;   // number & string = never
```

Kiểu trả về `T & U` mô tả "vừa là T vừa là U", không phải "U ghi đè T" như spread lúc runtime. Nếu muốn ghi đè đúng, trả về `Omit<T, keyof U> & U`, hoặc tránh generic và gõ rõ hai object.

**9. `T extends object` nhận mảng và hàm, từ chối primitive**

```ts
function onlyObj<T extends object>(x: T) { return x; }
onlyObj([1]); onlyObj(() => 1);   // OK
onlyObj("s");                     // Lỗi (đã kiểm chứng)
```

Nếu bạn cần "object thường" (không phải mảng/hàm), `object` không đủ; kiểm tra thêm ở runtime.

**10. Type guard generic có thể nói dối**

```ts
function isDefined<T>(x: T | null | undefined): x is T { return x != null; }
const defined = [1, null].filter(isDefined);   // number[]   (cho mảng (number | null)[])

const lie = <T>(x: T | undefined): x is T => true;   // compile được, hoàn toàn sai
```

Compiler không kiểm tra thân hàm có thật sự khớp predicate. `isDefined` ở trên là một tiện ích tái sử dụng hợp lý; mọi predicate tự viết khác nên có unit test.

**11. `parseInt` làm callback: lỗi runtime mà generic không bắt được**

```ts
["1", "2", "3"].map(parseInt);   // [1, NaN, NaN] (đã chạy)
```

`map` truyền `(value, index, array)`, nên `parseInt("2", 1)` dùng cơ số 1. Kiểu vẫn hợp lệ vì `parseInt(string, radix?: number)` tương thích với callback `(value: string, index: number)`. Viết `(s) => parseInt(s, 10)`. Bài học: assignability của generic callback kiểm tra *hình dạng*, không kiểm tra ý nghĩa.

## Tricks & tips thực tế

- **Khi nghi một generic "nói dối", tìm `as` trong thân hàm.** Lý do: nếu chữ ký hứa nhiều hơn những gì thân hàm tạo ra, khoảng cách luôn được che bằng `as` hoặc `any`. Tìm được chỗ đó là tìm được lời hứa.
- **Kiểu trả về của hàm tra cứu theo khoá động nên chứa `| undefined`.** Lý do: dữ liệu không đảm bảo đủ mọi khoá, và `noUncheckedIndexedAccess` của repo cũng nghĩ theo hướng này (xem `Partial<Record<K, V>>` ở trên).
- **Khoá của cache/registry generic nên là `string | number` do hàm `keyOf` sinh ra**, không nhận object làm khoá. Lý do: so sánh tham chiếu là nguồn lỗi im lặng (miss cache mãi mà không có lỗi).
- **Khi cần hạn chế chiều gán, đặt ghi chú variance (TS 4.7+) cho interface generic của bạn** nếu nó dùng ở nhiều nơi. Lý do: compiler xác thực annotation theo cấu trúc (với thuộc tính kiểu hàm), và nó là tài liệu sống về ý định "chỉ đọc" hay "chỉ ghi".
- **Đừng dùng `T & U` làm kiểu trả về của hàm merge/extend** nếu hai bên có thể trùng khoá. Lý do: kết quả `never` ở thuộc tính trùng tên khó phát hiện, vì chỉ lộ ra khi bạn đọc nó.
- **Với generic dùng `reduce`, luôn truyền `<U>` hoặc gõ biến accumulator.** Lý do: suy luận từ `[]`/`{}` sai thường gặp nhất trong code backend.
- **So với PHP/Laravel:** `Collection::groupBy` của Laravel là hàm runtime không có kiểu phần tử; ở TypeScript bạn phải tự biểu diễn "khoá có thể thiếu" bằng kiểu. Và `Map` có khoá là object so theo tham chiếu, khác với mảng PHP (so khoá theo giá trị).

## Tình huống mở để tự suy nghĩ

Không có đáp án ở đây; hãy thử trong file nháp và ghi kết luận vào "Ghi chú của bạn".

1. Bạn viết `class Queue<T>` với `peek(): T`. Cho một queue rỗng, `peek()` nên trả gì? Đổi chữ ký thế nào để compiler buộc người gọi xử lý trường hợp rỗng, và với `noUncheckedIndexedAccess` thân hàm sẽ báo gì?
2. `function toMap<T, K extends string>(xs: T[], key: (x: T) => K): Record<K, T>`: hãy tìm hai input làm kiểu trả về nói dối (gợi ý: khoá trùng, mảng rỗng), rồi đề xuất kiểu trung thực.
3. Một `EventBus<TEvents>` có `on(name, handler)` và `emit(name, payload)`. Làm sao để `payload` của `emit` phụ thuộc `name` mà vẫn chỉ cần **một** type parameter `K extends keyof TEvents`? Handler nên khai báo bằng method hay thuộc tính kiểu hàm, và vì sao?
4. `async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T>`: nếu người gọi truyền `Promise<void>`, `T` là gì và `await` kết quả có ý nghĩa không? Có chỗ nào `T` bị suy ra là `unknown` mà bạn không ngờ?

## Liên hệ bài tập

Khi tự kiểm tra lab, hãy thử từng cạm bẫy ở trên với `Result<T>` và `Repository<T>` của bạn: có chỗ nào dùng `as` để "làm xong" không, kiểu trả về nào có thể chứa `undefined` mà chưa khai báo, và nếu hai entity có id kiểu khác nhau thì chữ ký còn đúng không. Chỉ ghi hướng suy nghĩ, tự viết lời giải.

## Đọc thêm

- [Generics (Handbook)](https://www.typescriptlang.org/docs/handbook/2/generics.html)
- [Type Compatibility (Handbook)](https://www.typescriptlang.org/docs/handbook/type-compatibility.html)
- [TypeScript 4.7 release notes (variance annotations)](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-7.html)
- [Array.prototype.reduce (MDN)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/reduce)

## Ghi chú của bạn
