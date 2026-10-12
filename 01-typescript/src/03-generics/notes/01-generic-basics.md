# 1. Generic cơ bản: function, type, class

Generic là "tham số của kiểu": bạn viết logic một lần, và giữ được mối liên hệ giữa kiểu đầu vào và kiểu đầu ra thay vì làm mất nó bằng `any`.

```ts
function first<T>(items: readonly T[]): T | undefined {
  return items[0];
}

const a = first([1, 2, 3]);   // number | undefined (T suy ra là number)
const b = first(["x"]);       // string | undefined
const c = first<string>(["x"]); // truyền tường minh
first<string>([1]);           // Lỗi: number không gán được cho string
```

## Ý chính

- `<T>` khai báo một **type parameter**, nằm trước danh sách tham số. Khi gọi, `T` được thay bằng **type argument** (suy luận hoặc truyền tay).
- Có ba nơi dùng generic: **function**, **type alias / interface**, **class**. Cú pháp giống nhau, chỉ khác chỗ khai báo.
- Generic không tồn tại lúc runtime. Sau khi biên dịch, `T` biến mất hoàn toàn (type erasure).
- Giá trị của generic là **liên kết** giữa các vị trí dùng cùng một `T`: "đầu vào là `T[]` thì đầu ra là `T`".
- Phần lớn thời gian bạn không cần viết `<number>` khi gọi; compiler tự suy luận từ đối số.

## Lý thuyết chi tiết

**Generic function.** Type parameter có thể xuất hiện ở tham số, kiểu trả về, hoặc cả hai. Nhiều type parameter được phân cách bằng dấu phẩy, và mỗi cái được suy luận độc lập:

```ts
function pairUp<A, B>(a: A, b: B): [A, B] {
  return [a, b];
}
const p = pairUp("a", 1);   // [string, number]

function mapArr<T, U>(xs: readonly T[], fn: (x: T) => U): U[] {
  return xs.map(fn);
}
const m = mapArr([1, 2], (x) => String(x));   // string[]; x được suy ra là number
```

Ở `mapArr`, compiler suy `T = number` từ `xs` trước, rồi dùng `T` đó để gõ kiểu cho tham số `x` của callback (contextual typing), sau cùng suy `U = string` từ kiểu trả về của callback. Thứ tự "đối số không phải callback trước, callback sau" là lý do callback luôn được gõ kiểu đúng.

**Generic type alias và interface.** Khác với function, type alias không suy luận type argument: bạn phải truyền đủ (trừ khi có giá trị mặc định, xem file 2).

```ts
type Box<T> = { value: T };
type Pair<A, B> = readonly [A, B];
interface Page<T> { items: T[]; total: number }

const box: Box<number> = { value: 1 };
const pair: Pair<string, number> = ["a", 1];
const page: Page<{ id: number }> = { items: [{ id: 1 }], total: 1 };

const bad: Box = { value: 1 };   // Lỗi: Generic type 'Box<T>' requires 1 type argument(s)
```

Lưu ý: không có "suy luận" ở cấp type. Nếu muốn có giá trị `Box` suy ra từ dữ liệu, bạn cần một hàm generic (`function box<T>(value: T): Box<T>`).

**Generic class.** Type parameter của class dùng được trong thuộc tính và method của instance:

```ts
class Stack<T> {
  private readonly items: T[] = [];
  push(item: T): void { this.items.push(item); }
  pop(): T | undefined { return this.items.pop(); }
  peek(): T | undefined { return this.items[this.items.length - 1]; }
  get size(): number { return this.items.length; }
}

const s = new Stack<number>();
s.push(1);
s.push("x");                  // Lỗi
const top = s.pop();          // number | undefined
```

Hai điểm hay nhầm:

- `pop()` trả `T | undefined`, vì stack có thể rỗng. Với `noUncheckedIndexedAccess`, `this.items[i]` cũng cho `T | undefined`, nên kiểu trả về trung thực.
- Nếu bạn viết `new Stack()` không kèm type argument và không có chỗ nào để suy luận, `T` rơi về `unknown`. Kiểu của `s2` lúc đó là `Stack<unknown>`: nhận mọi thứ vào, nhưng lấy ra là `unknown`.

```ts
const s2 = new Stack();         // Stack<unknown>
const n: number = s2.pop();     // Lỗi: unknown (và undefined) không gán được cho number
```

**Cú pháp arrow function.** Trong file `.ts`, `const id = <T>(x: T): T => x` chạy bình thường. Trong file `.tsx` (JSX), `<T>` bị hiểu là thẻ nên phải viết `<T,>`. Dự án backend của bạn dùng `.ts`, nhưng thói quen viết `<T,>` vô hại.

**So sánh với PHP.** PHP không có generic ở runtime; bạn chỉ có docblock `@template T` / `@param array<T>` cho PHPStan hoặc Psalm, và Laravel dùng `Collection<TKey, TValue>` theo kiểu đó. Điểm khác: docblock chỉ là chú thích cho công cụ phân tích, còn generic của TypeScript là một phần của compiler, nên sai là không build được.

## Tricks & tips thực tế

- **Đặt tên type parameter có nghĩa khi có từ hai cái trở lên.** `T` đủ cho một tham số đơn giản; còn `TInput`/`TOutput`, `TEntity`/`TKey` dễ đọc hơn `A`/`B`/`C`, nhất là trong thông báo lỗi dài. Lý do: lỗi generic thường in tên tham số, tên mô tả giúp bạn đoán đúng chỗ.
- **Để compiler suy luận, đừng truyền `<number>` thừa.** Khi gọi `first<number>([1])`, bạn thêm nhiễu mà không thêm an toàn. Chỉ truyền tay khi suy luận ra kết quả quá rộng (ví dụ `new Stack()` ở trên) hoặc khi muốn ép kiểu hẹp hơn dữ liệu.
- **Không thể truyền một phần type argument.** `two<string>("a", 1)` với `two<A, B>` báo lỗi "Expected 2 type arguments". Lý do: TypeScript không có suy luận từng phần. Cách tránh: tách thành hai hàm lồng (currying) hoặc cho tham số sau một giá trị mặc định (file 2).
- **Dùng `readonly T[]` cho tham số mảng chỉ đọc.** Hàm nhận `readonly T[]` nhận được cả `T[]` lẫn `readonly T[]`, còn hàm nhận `T[]` thì từ chối mảng `readonly`. Lý do: bạn hứa không mutate, nên chấp nhận kiểu rộng hơn là đúng.
- **Static member của class không dùng được `T` của class.** `static create(x: T)` là lỗi vì `T` thuộc về từng instance. Nếu cần factory generic, khai báo type parameter riêng trên chính static method: `static create<U>(x: U)`.
- **Debug kiểu suy luận:** rê chuột (hover) lên lời gọi hàm trong editor để thấy `T` được suy ra là gì. Muốn kiểm tra trong code, gán kết quả cho một biến có kiểu mong đợi và xem có lỗi không; hoặc viết `type X = typeof ketQua` rồi hover `X`.
- **Generic không thay thế kiểm tra runtime.** `Stack<number>` không ngăn một `string` lọt vào nếu dữ liệu đến từ `JSON.parse` được ép kiểu. Ranh giới với dữ liệu ngoài vẫn cần validate (Bài 9).

## Liên hệ bài tập

Bài lab dựng `Result<T>` và `Repository<T>` chỉ ở mức type. Hãy tự hỏi: type nào cần tham số, tham số đó nối những vị trí nào với nhau, và chỗ nào bạn phải truyền type argument tay so với chỗ compiler tự suy ra. Ở lab, thử viết lời gọi mà không truyền `<...>` nào và xem hover ra gì.

## Đọc thêm

- [Generics (Handbook)](https://www.typescriptlang.org/docs/handbook/2/generics.html)
- [Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html)

## Ghi chú của bạn

