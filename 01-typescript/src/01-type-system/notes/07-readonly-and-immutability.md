# 7. `readonly` và không mutate dữ liệu đầu vào

`readonly` là lời hứa **lúc biên dịch** rằng bạn không sửa giá trị qua kiểu đó. Nó không bảo vệ dữ liệu lúc chạy và chỉ có tác dụng ở một tầng ("nông").

```ts
interface Item { qty: number }

const items: readonly Item[] = [{ qty: 1 }];
items.push({ qty: 2 });   // Lỗi: 'push' không tồn tại trên readonly Item[]
items[0].qty = 5;         // Không lỗi về readonly (xem lưu ý về noUncheckedIndexedAccess bên dưới)
```

## Ý chính

- `readonly T[]` (hay `ReadonlyArray<T>`) cấm các phương thức làm thay đổi mảng (`push`, `pop`, `splice`, `sort`, `reverse`…) và cấm gán theo chỉ số (`items[0] = x`).
- `readonly` **không đệ quy**: phần tử bên trong vẫn sửa được nếu thuộc tính của nó không `readonly`.
- `readonly` **chỉ tồn tại ở compile-time**; code JS sinh ra không có gì ngăn việc sửa. Muốn chặn lúc chạy cần `Object.freeze` (cũng nông).
- Hàm "không mutate đầu vào" thì nên khai báo tham số `readonly` để compiler giúp bạn giữ lời hứa và để người gọi tin tưởng.

## Lý thuyết chi tiết

**Ba nơi đặt `readonly`**

```ts
interface Order {
  readonly id: string;                 // thuộc tính không gán lại được
  readonly items: readonly Item[];     // mảng không đổi được
}

type Frozen = Readonly<Order>;         // utility type: thêm readonly cho MỌI thuộc tính cấp 1
```

`Readonly<Order>` chỉ khoá cấp đầu: `items` thành `readonly items: Item[]`, nghĩa là không gán lại `order.items = ...` được nhưng vẫn `order.items.push(...)`. Bạn phải thêm `readonly` vào mảng nữa.

**Không đệ quy: `readonly` chỉ đóng băng tầng khai báo nó**

```ts
const order: Readonly<{ items: Item[] }> = { items: [{ qty: 1 }] };
order.items.push({ qty: 2 });   // hợp lệ: items là Item[] thường
```

Muốn sâu thì dùng `readonly` ở từng tầng, hoặc kiểu `DeepReadonly<T>` tự viết bằng mapped type (Bài 5).

**`noUncheckedIndexedAccess` ảnh hưởng cách bạn viết** (repo này đã bật): `items[0]` có kiểu `Item | undefined`. Vì vậy `items[0].qty = 5` báo lỗi *possibly undefined*, **không phải** lỗi readonly. Muốn thấy rõ readonly không bảo vệ phần tử, viết đúng như sau:

```ts
const first = items[0];
if (first) first.qty = 5;   // hợp lệ, vì Item.qty không readonly
```

**Gán qua lại giữa `readonly` và không `readonly`**

```ts
const ro: readonly number[] = [1, 2];
const a: number[] = ro;                         // Lỗi: readonly T[] không gán được cho T[]
const b: readonly number[] = [1, 2] as number[]; // OK: T[] gán được cho readonly T[]
```

Tức là tham số `readonly T[]` nhận được cả `T[]` lẫn `readonly T[]`; tham số `T[]` chỉ nhận `T[]`. Đây là lý do nên khai báo `readonly` ở tham số: nó mở rộng khả năng sử dụng.

**Điểm không an toàn của TypeScript**: `readonly` ở **thuộc tính** không ảnh hưởng đến khả năng gán. Một object có thuộc tính `readonly` vẫn gán được cho kiểu có thuộc tính không readonly, rồi sửa qua tham chiếu đó:

```ts
interface RItem { readonly qty: number }
const ri: RItem = { qty: 1 };
const mut: { qty: number } = ri;   // không lỗi
mut.qty = 3;                       // vẫn sửa được object gốc
```

Đừng xem `readonly` là cơ chế an toàn tuyệt đối; nó là hàng rào gợi ý đủ tốt để bắt lỗi vô ý.

**`Object.freeze`** làm phần chạy thật: ném `TypeError` (ở strict mode) hoặc bỏ qua im lặng khi gán vào object đã freeze. Cũng nông:

```ts
const frozen = Object.freeze({ a: 1, nested: { b: 2 } });
frozen.a = 2;          // Lỗi biên dịch (kiểu trả về là Readonly) và lỗi runtime nếu ép qua
frozen.nested.b = 3;   // hợp lệ, nested không bị freeze
```

**`as const`** vừa giữ literal vừa thêm `readonly` đệ quy cho object/mảng literal:

```ts
const cfg = { retries: 3, tags: ["a", "b"] } as const;
// { readonly retries: 3; readonly tags: readonly ["a", "b"] }
```

## Các cách "sửa" dữ liệu mà không mutate

| Muốn | Mutate (tránh với input) | Không mutate |
|---|---|---|
| Thêm phần tử | `arr.push(x)` | `[...arr, x]` |
| Xoá phần tử | `arr.splice(i, 1)` | `arr.filter((_, j) => j !== i)` |
| Sắp xếp | `arr.sort(cmp)` | `[...arr].sort(cmp)` |
| Đảo ngược | `arr.reverse()` | `[...arr].reverse()` |
| Cập nhật phần tử | `item.qty = 5` | `arr.map(x => x === item ? { ...x, qty: 5 } : x)` |
| Cập nhật thuộc tính | `order.note = "x"` | `{ ...order, note: "x" }` |

Ghi chú: `toSorted`, `toReversed` (ES2023) cho bản sao đã sắp xếp nhưng cần `lib` có ES2023; `tsconfig.json` của repo đang là `ES2022`, nên dùng `[...arr].sort(...)`.

**Cạm bẫy: `sort` mutate.** `sort` và `reverse` sửa mảng gốc. Gặp nhiều nhất khi viết "sắp xếp rồi lấy phần tử đầu" trên mảng nhận từ tham số. Với `readonly T[]`, compiler báo lỗi ngay.

**Spread là shallow copy.** `{ ...order }` hoặc `[...items]` sao chép tầng đầu, các object bên trong vẫn dùng chung tham chiếu. Sửa object bên trong của bản sao vẫn làm ảnh hưởng bản gốc. Muốn sao chép sâu: `structuredClone(value)` (Node 17+). Không dùng được cho hàm hay class instance có phương thức.

## Tricks & tips thực tế

- **Kiểm tra "không mutate" trong test** bằng cách so sánh trước và sau:
  ```ts
  const before = structuredClone(order);
  someFunction(order);
  expect(order).toEqual(before);
  ```
  Hoặc freeze sâu dữ liệu test để lỗi ném ngay tại chỗ sửa (có tác dụng runtime, bổ sung cho `readonly`). Lý do: `readonly` không chặn code JS thuần hay ép kiểu, còn test thì bắt được.
- **Mặc định `readonly` cho kiểu domain**, bỏ đi khi có lý do rõ ràng. Lý do: mutation ngoài ý muốn là loại lỗi khó tái hiện nhất (hai chỗ khác nhau cùng giữ tham chiếu đến một mảng).
- **Hàm "thuần"** (cùng đầu vào cho cùng đầu ra, không tác dụng phụ) dễ test, dễ cache, dễ chạy song song. Nhận `readonly` và trả giá trị mới là cách diễn đạt điều đó trong kiểu.
- **Đừng lạm dụng `as` để bỏ `readonly`**: `items as Item[]` vượt qua kiểm tra nhưng làm mất bảo đảm. Nếu cần bản sao sửa được, sao chép thật (`[...items]`).
- **Chi phí hiệu năng**: sao chép mảng ở mỗi lần cập nhật là O(n). Với dữ liệu nhỏ như một đơn hàng thì không đáng kể; chỉ tối ưu khi đo được vấn đề.
- **Redux/Immer**: thư viện như Immer cho viết code "như mutate" trên bản nháp rồi sinh bản mới bất biến. Chưa cần ở giai đoạn này; hiểu spread và `map`/`filter` trước.
- **So với PHP**: mảng PHP là *value type* (sao chép khi truyền, copy-on-write) nên hàm nhận mảng không sửa được bản gốc, trừ khi truyền tham chiếu `&`. Mảng và object JS là *reference*: hàm sửa tham số là sửa chính dữ liệu của người gọi. Đây là khác biệt quan trọng khi chuyển từ PHP sang JS.
- **`const` không có nghĩa là bất biến**: `const arr = []; arr.push(1)` hợp lệ. `const` chỉ cấm gán lại biến.

## Liên hệ bài tập

Yêu cầu 3 trong `EXERCISE.md`: không mutate dữ liệu đầu vào, kể cả khi `order` được `Readonly`. Hãy tự hỏi: `readonly` bảo đảm điều gì và không bảo đảm điều gì; bài test của bạn kiểm chứng điều đó thế nào.

## Đọc thêm

- [Readonly properties và ReadonlyArray](https://www.typescriptlang.org/docs/handbook/2/objects.html#readonly-properties)
- [`Object.freeze` (MDN)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze)
- [`structuredClone` (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/structuredClone)

## Ghi chú của bạn

