# 5. Cạm bẫy và tình huống thực tế với utility types

Những chỗ utility types cho kết quả khác điều bạn đoán khi làm DTO, config và lớp service trong backend. Mọi ví dụ trong ghi chú này đã được `tsc` 7.0.2 kiểm chứng với `tsconfig.json` của repo; các dòng ghi "lỗi" đã được chứng minh bằng `// @ts-expect-error`; hành vi runtime đã chạy bằng Node 24.

```ts
interface Row { id: number; name: string; secret: string }
type A = { id: number; v: string };
```

## Ý chính

- Utility types chỉ thao tác trên **kiểu**, mà dữ liệu thật đi qua `JSON.stringify`, `Object.entries`, spread, DB driver. Các chỗ "kiểu đúng nhưng runtime sai" tập trung ở ranh giới này.
- Hầu hết utility là **homomorphic mapped type** hoặc **conditional type phân phối**; hiểu hai cơ chế này đủ để đoán đa số kết quả lạ.
- Kết quả "lạ" (`never`, `{}`, union bị gộp) thường là tín hiệu thiết kế DTO cần xem lại, không phải lỗi của compiler.

## Lý thuyết chi tiết

**1. `Partial`/`Readonly` trên mảng và tuple**

```ts
type PA = Partial<string[]>;
const pa: PA = ["a", undefined];     // OK: phần tử trở thành string | undefined
type RA = Readonly<string[]>;        // readonly string[]
const ra: RA = ["a"];
ra.push("b");                        // Lỗi: Property 'push' does not exist on type 'readonly string[]'
type PT = Partial<[number, string]>;
const pt: PT = [1];                  // OK: tuple có phần tử tuỳ chọn
```

Mapped type đồng cấu (homomorphic) khi áp dụng lên mảng/tuple sẽ cho ra mảng/tuple chứ không phải object. Nên `Readonly<T[]>` là cách ngắn để gõ tham số mảng chỉ đọc, nhưng `readonly T[]` đọc rõ ý hơn.

**2. Utility trong hàm generic: `Partial<T>` rộng hơn bạn nghĩ**

```ts
function patch<T extends object>(base: T, p: Partial<T>): T { return { ...base, ...p }; }
function mk<T>(): Partial<T> { return {}; }       // OK: {} luôn là Partial<T> hợp lệ
function mk2<T>(): Readonly<T> { return {}; }     // Lỗi: {} không chứng minh được là T
```

`{}` gán được cho `Partial<T>` với mọi `T` nhưng không gán được cho `Readonly<T>`/`T`. Hệ quả: hàm "tạo bản nháp rỗng" trả `Partial<T>` hợp lệ; đừng "sửa" lỗi kiểu bằng `as T` để trả về bản nháp như thể là bản đầy đủ.

Cảnh báo về `patch` ở trên: spread `{ ...base, ...p }` với `p` có khoá `undefined` ghi đè giá trị gốc bằng `undefined` (đã chạy: `{ title: undefined }`), trong khi kiểu trả về vẫn là `T`. Xem tip về lọc `undefined` ở file 4.

**3. `Exclude`/`Extract` trên `boolean`, `never`, hàm**

```ts
type EB = Exclude<boolean, true>;     // false (boolean thực chất là true | false)
type EN = Exclude<"a", "a">;          // never
type XS = Extract<string | number | (() => void), Function>;   // () => void
type EX1 = Exclude<string | number | null, string>;            // number | null
```

Vì `boolean` là union `true | false`, `Exclude`/`Extract` tách được nó. `never` là kết quả hợp lệ khi lọc hết, và `never` khi dùng làm kiểu trường sẽ biến trường thành "không thể gán" (xem mục 6).

**4. `NonNullable` trên `unknown` và generic**

```ts
type NN2 = NonNullable<unknown>;      // {}
const nn2: NN2 = 1;                   // OK
const nn3: NN2 = null;                // Lỗi

function must<T>(x: T): NonNullable<T> {
  if (x == null) throw new Error("x");
  return x;
}
```

`{}` nghĩa là "mọi giá trị trừ `null` và `undefined`" (kể cả số, chuỗi), không phải "object rỗng". Cạm bẫy đọc nhầm này gặp rất nhiều khi đọc lỗi.

**5. `Record<string, V>` và prototype**

```ts
const dyn: Record<string, number> = {};
"toString" in dyn;           // true (đã chạy): khoá thừa kế từ Object.prototype
Object.hasOwn(dyn, "toString");   // false (Object.hasOwn là ES2022, repo dùng được)
```

Với khoá đến từ input người dùng, `dyn[k]` có thể trả về hàm kế thừa chứ không phải số. Kiểu `number | undefined` (do `noUncheckedIndexedAccess`) không bắt được điều này. Dùng `Map<string, number>`, `Object.hasOwn` trước khi đọc, hoặc `Object.create(null)`.

**6. `Record<Stat, V>`: thừa khoá chỉ bị bắt ở object literal tươi**

```ts
type Stat = "a" | "b";
const r2: Record<Stat, number> = { a: 1, b: 2, c: 3 };   // Lỗi: excess property
const r3 = { a: 1, b: 2, c: 3 };
const r4: Record<Stat, number> = r3;                      // OK (không còn là literal "tươi")
```

Excess property check chỉ áp dụng cho object literal viết trực tiếp. Dữ liệu đi qua biến trung gian lọt qua, nên đừng dựa vào nó để lọc dữ liệu ngoài.

**7. `Object.entries`/`Object.keys` làm mất khoá hẹp**

```ts
const r1: Record<Stat, number> = { a: 1, b: 2 };
const ent = Object.entries(r1);       // [string, number][]  (khoá thành string)
const ks = Object.keys(r1) as Stat[]; // cần ép kiểu có chủ ý
```

Lý do đã nêu ở Bài 3 (file 2 và 3): object có thể mang thêm khoá. Nếu hay cần duyệt theo khoá hẹp, giữ danh sách khoá ở một mảng `as const` và duyệt mảng đó.

**8. `ReturnType`/`Parameters`/`Awaited` trong tình huống thật**

```ts
class Svc {
  async create(name: string) { return { id: 1, name }; }
}
type Created = Awaited<ReturnType<Svc["create"]>>;   // { id: number; name: string }
type Args = Parameters<Svc["create"]>;               // [name: string]

function rest(a: string, ...more: number[]) {}
type PR = Parameters<typeof rest>;                   // [a: string, ...more: number[]]

type Thenable = { then(cb: (v: number) => void): void };
type AT = Awaited<Thenable>;                         // number (Awaited xử lý cả thenable, không chỉ Promise)
type AN = Awaited<string>;                           // string (không phải Promise thì giữ nguyên)

async function load(flag: boolean) {
  if (flag) return { ok: true as const, v: 1 };
  return { ok: false as const, err: "x" };
}
type LR = Awaited<ReturnType<typeof load>>;          // union có tag, thu hẹp được bằng if (lr.ok)
```

Hàm async nhiều nhánh `return` cho ra union; thêm `as const` vào tag nếu bạn muốn kiểu suy luận dùng được như discriminated union mà không phải khai báo kiểu tay.

**9. Intersection với kiểu trùng khoá khác nhau cho `never`**

```ts
type B = A & { id: string };
declare const bb: B;
bb.id;   // number & string = never
```

Hay gặp khi "mở rộng DTO bằng `&`" mà đổi kiểu một trường. Sửa: `Omit<A, "id"> & { id: string }` (và nhớ `Omit` không kiểm tra khoá, xem file 1).

**10. `Omit`/`keyof` với class có `private`**

```ts
class Ent { private secret = 1; constructor(public id: number, public name: string) {} touch() {} }
type OE = Omit<Ent, "touch">;
const oe: OE = { id: 1, name: "a" };   // OK: private bị bỏ khỏi kiểu dẫn xuất
type KE = keyof Ent;                   // "id" | "name" | "touch" ("secret" không có)
```

`keyof` không thấy member `private`/`protected`, nên `Pick`/`Omit` trên class tạo ra kiểu object thường, gán được từ object literal. Đó là lợi ích khi lấy "hình dạng dữ liệu" từ class, nhưng `keyof` cũng gồm method (`touch`), nên DTO dẫn xuất từ class cần `Omit` method hoặc `Pick` tường minh các trường dữ liệu.

**11. `Serialized<T>` tự viết: các lỗ hổng**

```ts
type Serialized<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] };
interface WithNested { at: Date; inner: { when: Date }; maybe?: Date }
type SN = Serialized<WithNested>;
const sn: SN = { at: "x", inner: { when: new Date() } };   // OK: inner KHÔNG được chuyển đổi (nông)
const sn3: SN = { at: "x", inner: { when: new Date() }, maybe: "s" };   // Lỗi: maybe?: Date | undefined không extends Date
```

Hai lỗ hổng: (1) chỉ xử lý một tầng; (2) `Date | undefined` (trường tuỳ chọn) không thoả `extends Date` nên không được chuyển thành chuỗi. Muốn đúng, cần phân phối trên union (`T[K] extends Date | undefined`) và đệ quy (Bài 5-6). Cách bền hơn: viết hàm map với kiểu trả về tường minh (file 4), không phụ thuộc vào kiểu "thông minh".

**12. Runtime của `JSON.stringify`: kiểu không phản ánh**

```ts
JSON.stringify({ a: undefined, d: new Date(0), n: null, m: new Map([[1, 2]]), s: new Set([1]) });
// {"d":"1970-01-01T00:00:00.000Z","n":null,"m":{},"s":{}}  (đã chạy)
JSON.stringify({ b: 1n });   // TypeError: Do not know how to serialize a BigInt
```

`undefined` biến mất, `Date` thành chuỗi ISO, `Map`/`Set` thành `{}`, `bigint` ném lỗi. Một DTO response có trường `Map`, `Set`, `bigint` là lỗi thiết kế: kiểu response phải chỉ chứa những gì JSON biểu diễn được (string, number, boolean, null, mảng, object thuần).

**13. `satisfies` để kiểm tra hàm map mà vẫn giữ kiểu hẹp (TS 4.9+)**

```ts
const pub = (r: Row) => ({ id: r.id, name: r.name }) satisfies Partial<Row>;
type PubRes = ReturnType<typeof pub>;   // { id: number; name: string }
```

`satisfies` kiểm tra object trả về hợp lệ với `Partial<Row>` (bắt typo/kiểu sai) mà không làm kiểu kết quả rộng ra thành `Partial<Row>`. Chú ý: với `satisfies Partial<Row>`, trường thừa tên lạ bị báo lỗi nhưng thiếu trường thì không; muốn ép đủ trường, dùng `satisfies Pick<Row, "id" | "name">`.

## Tricks & tips thực tế

- **Khi một kiểu dẫn xuất ra `never`, `{}` hay union bị gộp, hỏi "utility này tác động lên union hay lên object?"** Lý do: `Exclude`/`Extract` làm việc trên union, `Pick`/`Omit` trên object (và làm phẳng union), nhầm hai nhóm là nguồn lỗi hàng đầu.
- **Thêm test kiểu cho DTO bằng file nháp với `// @ts-expect-error`.** Lý do: một dòng "client gửi `role: "admin"` vào `UpdateProfileInput`" phải bị từ chối; nếu `tsc` báo "Unused '@ts-expect-error' directive" (TS2578), DTO của bạn đã lỏng ra. Bài 11 sẽ dùng `expectTypeOf` cho việc này.
- **Hàm map entity sang response nên có kiểu trả về khai báo tường minh, và response chỉ chứa kiểu JSON-an-toàn.** Lý do: `ReturnType` của hàm không khai báo kiểu thừa kế mọi thay đổi vô tình trong hàm (xem file 3), còn `JSON.stringify` âm thầm làm biến mất hoặc biến đổi giá trị (mục 12).
- **Với class entity (ORM), lấy `Pick` tường minh các trường dữ liệu, đừng `Omit` method.** Lý do: thêm method mới vào class là chuyện thường, và `Omit` danh sách đen sẽ để nó lọt vào DTO.
- **Đừng bọc mọi thứ bằng `Prettify`/`Simplify` trừ khi để đọc hover.** Lý do: nó chỉ làm phẳng hiển thị; nó không thay đổi ngữ nghĩa, nhưng tạo thêm một mức gián tiếp mà người đọc phải hiểu.
- **So với PHP/Laravel:** `Resource`/`toArray()` của Laravel biến `Carbon` thành chuỗi ở runtime và ép kiểu lúc serialize; ở TypeScript, kiểu response chỉ là lời hứa và việc biến đổi thật (`toISOString()`) vẫn do hàm map làm. Kiểu giúp nhắc bạn đừng quên, không làm hộ.
- **Lưu ý môi trường:** repo hiện chưa nạp kiểu của Node vào `tsconfig.json` (thử dùng `console` hay `setTimeout` trong file mẫu báo `TS2584`/`TS2304`), nên các ví dụ như `ReturnType<typeof setTimeout>` cần cấu hình `types` riêng; chưa kiểm chứng trong repo này.

## Tình huống mở để tự suy nghĩ

1. Entity `Cart` có `items: CartItem[]` và `coupon?: string`. DTO `UpdateCartInput` nên cho client gửi cả `items` (thay thế toàn bộ) hay từng thao tác (thêm/xoá)? `Partial` mô tả được ngữ nghĩa nào, và không mô tả được ngữ nghĩa nào (gợi ý: "thiếu" khác `null` khác mảng rỗng)?
2. Một `Invoice` có `total: number` tính từ các dòng. `Pick<Invoice, "total">` trong create DTO có hợp lý không? Nếu không, kiểu dẫn xuất nên thể hiện "server tính" như thế nào (đừng đưa vào input)?
3. Bạn có `type Status = "draft" | "sent" | "paid"` và `Record<Status, string>` làm nhãn hiển thị. Thêm `"void"` vào `Status`: những chỗ nào trong codebase báo lỗi, chỗ nào im lặng (hãy tìm `Exclude<Status, ...>`, `Partial<Record<...>>`, `switch` thiếu `default`)?
4. Với `Omit<Invoice, "internalNote">` làm response, giả sử đồng nghiệp đổi tên `internalNote` thành `staffNote`. Compiler nói gì? Cần đổi cách khai báo thế nào để nó nói?

## Liên hệ bài tập

Với DTO của lab, hãy chạy lần lượt các mục 9, 11, 12 như danh sách kiểm tra: có intersection trùng khoá không, có trường `Date` tuỳ chọn/lồng nào bị bỏ sót khi chuyển sang kiểu JSON không, response có chứa kiểu mà JSON không biểu diễn được không. Viết ít nhất một dòng `// @ts-expect-error` cho mỗi DTO để chứng minh nó từ chối đầu vào sai. Chỉ ghi hướng đi, tự viết lời giải.

## Đọc thêm

- [Utility Types (Handbook)](https://www.typescriptlang.org/docs/handbook/utility-types.html)
- [Mapped Types (Handbook)](https://www.typescriptlang.org/docs/handbook/2/mapped-types.html)
- [The satisfies operator (TS 4.9 release notes)](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html)
- [JSON.stringify (MDN)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify)
- [Object.hasOwn (MDN)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/hasOwn)

## Ghi chú của bạn
