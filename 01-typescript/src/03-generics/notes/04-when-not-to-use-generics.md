# 4. Khi nào nên và không nên dùng generic

Generic chỉ đáng dùng khi nó **nối** ít nhất hai vị trí trong chữ ký; nếu `T` chỉ xuất hiện một lần thì thường bạn không cần nó.

```ts
// Thừa: T chỉ dùng một lần
function logAll<T>(x: T): void { String(x); }
// Đủ rồi
function logAll2(x: unknown): void { String(x); }

// Đáng: T nối đầu vào với đầu ra
function firstOf<T>(xs: readonly T[]): T | undefined { return xs[0]; }
```

## Ý chính

- **Quy tắc "hai lần"**: mỗi type parameter nên xuất hiện ít nhất hai lần trong chữ ký (tham số và trả về, hai tham số, hoặc tham số và callback). Một lần là dấu hiệu thừa hoặc nói dối.
- Generic có chi phí: chữ ký khó đọc hơn, thông báo lỗi dài hơn, thân hàm khó kiểm tra hơn.
- Ưu tiên kiểu cụ thể hoặc `unknown` trước; thêm generic khi thấy mình mất thông tin (hoặc phải ép kiểu) ở chỗ gọi.
- Với dữ liệu từ ngoài (HTTP, DB), generic không thay thế validation.
- Generic nhiều tầng, nhiều tham số, nhiều constraint lồng nhau thường là over-engineering trong code backend nghiệp vụ.

## Lý thuyết chi tiết

**T chỉ xuất hiện một lần ở tham số.** `firstName<T extends { name: string }>(x: T): string` tương đương `firstName(x: { name: string }): string`. Không có thông tin nào của `T` quay lại cho người gọi, nên generic không mang lợi ích gì, chỉ thêm ký hiệu.

**T chỉ xuất hiện ở kiểu trả về.** Đã nói ở file 3: người gọi tự chọn kiểu và không có gì kiểm chứng. Dùng `unknown`, hoặc truyền thứ gì đó (schema, class, guard) để `T` được suy ra từ dữ liệu thật.

**Khi nào generic đáng giá.**

- Container và cấu trúc dữ liệu (`Stack<T>`, `Cache<K, V>`, `Page<T>`): hành vi giống nhau cho mọi kiểu phần tử.
- Hàm biến đổi giữ kiểu (`firstOf`, `pluck`, `groupBy`).
- Hàm bọc (wrapper) cần giữ nguyên chữ ký của hàm bên trong.
- Hàm làm việc theo khoá (`getProp<T, K extends keyof T>`).

Ví dụ một cache nhỏ, miền khác với bài lab:

```ts
class Cache<K, V> {
  private readonly store = new Map<K, V>();

  get(key: K): V | undefined { return this.store.get(key); }

  set(key: K, value: V): this {
    this.store.set(key, value);
    return this;
  }

  getOrCompute(key: K, compute: () => V): V {
    const hit = this.store.get(key);
    if (hit !== undefined) return hit;
    const v = compute();
    this.store.set(key, v);
    return v;
  }
}

const cache = new Cache<string, number>();
cache.set("a", 1).getOrCompute("b", () => 2);   // number
```

Chú ý `hit !== undefined` thay vì `if (hit)`: nếu `V` có thể là `0` hoặc chuỗi rỗng, kiểm tra truthy sẽ bỏ qua giá trị hợp lệ. Nhưng với `V` bản thân có thể chứa `undefined`, cách này cũng mất chính xác; khi đó dùng `this.store.has(key)`. Đây là loại cạm bẫy mà generic đưa vào: bạn không biết `V` là gì nên không được giả định gì về nó.

**Thay thế cho generic.**

- **Union**: `string | number` rõ hơn `<T extends string | number>` khi chỉ có hai khả năng và không cần nối đầu vào với đầu ra.
- **Overload** (Bài 7): khi mỗi kiểu đầu vào có kiểu đầu ra khác nhau theo cách không biểu diễn gọn bằng một `T`.
- **`unknown` + narrowing**: khi bạn thực sự không biết kiểu (dữ liệu ngoài).
- **Interface cụ thể**: khi chỉ có một vài kiểu thật sự dùng, kiểu cụ thể dễ đọc hơn.

**Class generic: static không dùng được `T`.**

```ts
class Bad<T> {
  value?: T;
  static create(x: T): T { return x; }   // Lỗi: Static members cannot reference class type parameters
}
```

**Instantiation expressions (TS 4.7+).** Khi cần cố định type argument mà không gọi hàm, viết `typeof fn<string>`; ví dụ ở bài 4 sẽ gặp với `ReturnType<typeof fn<string>>`.

**So sánh với PHP/Laravel.** Trong Laravel, `Collection` không có kiểu phần tử thật, bạn hay quen "mọi thứ là array/mixed". Sang TypeScript dễ quá tay theo hướng ngược lại: gắn `<T>` cho mọi hàm. Câu hỏi kiểm tra: "nếu bỏ `T` và dùng `unknown` hoặc kiểu cụ thể, người gọi có mất thông tin nào không?" Nếu không, đừng dùng generic.

## Tricks & tips thực tế

- **Bắt đầu bằng hàm không generic, thêm khi cần.** Lý do: bạn thấy rõ thông tin nào bị mất ở chỗ gọi, nên generic bạn thêm có mục đích. Viết generic trước thường dẫn tới chữ ký phức tạp mà không ai gọi theo cách đó.
- **Giới hạn số type parameter ở 1–3.** Hơn thế thường là dấu hiệu nên gom thành một object type (`TConfig`) hoặc tách hàm. Lý do: người đọc phải giữ cả danh sách trong đầu và thông báo lỗi quá dài.
- **Đừng thêm constraint "cho đẹp".** Constraint chỉ nên có nếu thân hàm dùng nó. Constraint thừa làm hàm khó tái sử dụng hơn.
- **Wrapper giữ chữ ký bằng generic hàm + `Parameters`/`ReturnType`** (Bài 4) tốt hơn việc gõ lại tham số; gõ lại sẽ lệch khi hàm gốc đổi.
- **Generic trên class/service ở tầng ứng dụng: cẩn thận với DI.** Ở NestJS (Phase 03), kiểu generic bị xoá lúc runtime nên container không phân biệt được `Repo<User>` với `Repo<Order>`; sẽ cần token riêng. Đây là hệ quả của type erasure, không phải lỗi của framework.
- **Test kiểu generic bằng ví dụ dùng thử.** Viết vài lời gọi trong file test hoặc file nháp, dùng `// @ts-expect-error` cho các lời gọi phải bị từ chối; nếu dòng đó không còn lỗi, `tsc` sẽ báo "unused @ts-expect-error", tức chữ ký của bạn đã lỏng đi. (Bài 11 sẽ dùng `expectTypeOf`.)
- **Tránh `any` trong chữ ký công khai.** Nếu bắt buộc (như `Constructor<T>` với `any[]`), cô lập ở một type alias dùng chung, nhờ vậy `any` không lan ra khắp codebase.

## Liên hệ bài tập

Với mỗi type bạn dựng trong lab, kiểm tra quy tắc "hai lần": mỗi type parameter nối những vị trí nào? Nếu có tham số nào không nối gì, hãy thử thay bằng kiểu cụ thể và xem chỗ gọi có mất gì không. Trong `EXERCISE.md`, trả lời phần "vì sao chọn generic ở đây" dựa trên câu hỏi đó.

## Đọc thêm

- [Generics (Handbook)](https://www.typescriptlang.org/docs/handbook/2/generics.html)
- [More on Functions: Guidelines for Writing Good Generic Functions](https://www.typescriptlang.org/docs/handbook/2/functions.html#guidelines-for-writing-good-generic-functions)
- [Generic Classes](https://www.typescriptlang.org/docs/handbook/2/generics.html#generic-classes)

## Ghi chú của bạn

