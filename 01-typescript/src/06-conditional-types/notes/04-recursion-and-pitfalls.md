# 4. Đệ quy kiểu, giới hạn, khi nào nên dùng và cách debug

Conditional + `infer` + template literal cho phép đệ quy ở cấp kiểu, nhưng compiler có giới hạn độ sâu và bạn là người trả giá bằng độ phức tạp.

```ts
type Reverse<T extends readonly unknown[]> =
  T extends readonly [infer H, ...infer R] ? [...Reverse<R>, H] : [];
// Reverse<[1, 2, 3]> là [3, 2, 1]

type Paths<T, D extends unknown[] = []> = D["length"] extends 5
  ? never
  : T extends object
    ? { [K in keyof T & string]: K | `${K}.${Paths<T[K], [...D, unknown]>}` }[keyof T & string]
    : never;
```

## Ý chính

- Đệ quy kiểu: một alias tự tham chiếu tới chính nó, có **điều kiện dừng** qua conditional.
- Giới hạn: lỗi **TS2589 "Type instantiation is excessively deep and possibly infinite"**.
- Dạng *tail recursion* (kết quả tích lũy truyền qua tham số) cho độ sâu lớn hơn (TS 4.5+); đo ở TS 7.0.2: `Repeat<"x", 999>` chạy, `Repeat<"x", 1000>` lỗi.
- Kiểu phức tạp là code phải bảo trì: dùng khi **lợi ích rõ**, không dùng để khoe.
- Debug bằng cách **chia nhỏ, hover, `Equal`, `Expand`**.

## Lý thuyết chi tiết

**Đệ quy trên tuple và chuỗi.** Hai cấu trúc đệ quy "tự nhiên" của TS là tuple (đầu/đuôi bằng `infer`) và chuỗi (ký tự đầu/phần còn lại, hoặc tách theo dấu).

**Tail recursion với accumulator.** Dạng "kết quả là lời gọi đệ quy ở vị trí cuối" cho phép compiler tối ưu:

```ts
type Repeat<S extends string, N extends number, Acc extends string = "", C extends unknown[] = []> =
  C["length"] extends N ? Acc : Repeat<S, N, `${Acc}${S}`, [...C, unknown]>;
// Repeat<"ab", 3> là "ababab"
// Repeat<"x", 999> chạy; Repeat<"x", 1000> lỗi TS2589
```

Bộ đếm được dựng bằng độ dài tuple (`C["length"]`) vì TS không có phép cộng ở cấp kiểu. Trái lại với `Reverse` ở đầu file (không tail: `[...Reverse<R>, H]` còn việc phải làm sau lời gọi), giới hạn thấp hơn nhiều; con số cụ thể phụ thuộc vào phiên bản và dạng kiểu nên chưa kiểm chứng được một ngưỡng ổn định, chỉ cần nhớ rằng nó nhỏ hơn.

**Tự giới hạn độ sâu.** Với `Paths` ở trên, một tuple `D` đếm độ sâu và dừng ở 5. Lý do: kiểu có tham chiếu vòng (cây, đồ thị) sẽ lặp vô hạn; cho độ sâu trần là cách an toàn.

```ts
interface Cfg { db: { host: string; pool: { max: number } }; port: number }
// Paths<Cfg> là "db" | "port" | "db.host" | "db.pool" | "db.pool.max"

type PathValue<T, P extends string> = P extends `${infer H}.${infer R}`
  ? H extends keyof T ? PathValue<T[H], R> : never
  : P extends keyof T ? T[P] : never;
// PathValue<Cfg, "db.pool.max"> là number

function getPath<T, P extends Paths<T>>(obj: T, path: P): PathValue<T, P> {
  return path.split(".").reduce<unknown>(
    (acc, k) => (acc as Record<string, unknown>)[k],
    obj,
  ) as PathValue<T, P>;
}
const cfg: Cfg = { db: { host: "h", pool: { max: 5 } }, port: 1 };
const max = getPath(cfg, "db.pool.max");   // number
// getPath(cfg, "db.pool.min");            // lỗi: đường dẫn không tồn tại
```

Chú ý: bên trong thân hàm vẫn phải `as` vì runtime là dữ liệu động; **ranh giới `as` nằm trong một hàm nhỏ có kiểu công khai chính xác**. Đây là thoả hiệp chấp nhận được của thư viện.

**Chi phí.** Mỗi kiểu phức tạp tăng thời gian `tsc`, thời gian editor phản hồi, và độ dài thông báo lỗi. Với union lớn × đệ quy, thời gian có thể bùng nổ; nếu `npm run type-check` hoặc IDE chậm bất thường sau khi thêm một kiểu, kiểu đó là nghi can số một.

## Khi nào nên / không nên

Nên:
- Kiểu **thư viện/tiện ích nội bộ dùng ở nhiều nơi** và có test kiểu (ví dụ `getPath`, route params, typed event map).
- Khi nó **loại bỏ cả một lớp lỗi** (thiếu tham số route, key sai) mà kiểu đơn giản không bắt nổi.
- Khi kiểu đầu ra giúp **autocomplete** thật sự.

Không nên:
- Cho domain model nghiệp vụ: dùng discriminated union (Bài 2).
- Khi một `interface` viết tay 10 dòng là đủ; tiết kiệm không đáng.
- Khi chỉ có một chỗ dùng, hoặc khi người trong team không đọc được. Lý do: kiểu khó đọc là nợ kỹ thuật không có test runtime.
- Để **parse** dữ liệu (JSON, SQL, ngôn ngữ). Dùng thư viện runtime.
- Khi có thể suy ra kiểu từ nguồn khác: Zod `z.infer`, ORM schema, OpenAPI codegen (sẽ học ở Bài 9 và các phase sau). Lý do: nguồn sự thật nên là schema runtime, không phải kiểu tự chế.

## Tricks & tips thực tế

- **Viết test kiểu trước, kiểu sau.** `const _: Equal<Kết_quả, Mong_đợi> = true;` cho từng trường hợp, gồm biên (`never`, `any`, union, rỗng, `readonly`), và `// @ts-expect-error` cho trường hợp phải lỗi. Lý do: kiểu là code, test là cách duy nhất biết nó đúng. Mẫu helper:

  ```ts
  type Equal<A, B> =
    (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
  type Expect<T extends true> = T;
  type _t = Expect<Equal<Reverse<[]>, []>>;   // lỗi biên dịch nếu sai
  ```

  Bài 11 sẽ dùng `expectTypeOf` của Vitest cho cùng mục đích.
- **Chia nhỏ thành alias trung gian có tên rồi hover từng cái.** Lý do: kiểu lồng nhau sâu cho thông báo lỗi dài vài chục dòng; alias nhỏ cho biết bước nào ra kết quả sai.
- **`Expand`/`Simplify` để xem kiểu thực.** `type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never` (hoặc dạng `& {}`) ép compiler in ra hình dạng đầy đủ thay vì chuỗi `A & B & Omit<...>`. Lý do: giao kiểu không tự được làm phẳng khi hiển thị. Dùng tạm để debug.
- **Đọc thông báo lỗi từ dưới lên.** Dòng cuối thường là chỗ khác biệt thực sự (kiểu A không gán được cho kiểu B), các dòng trên chỉ là đường đi. Lý do: compiler in chuỗi nguyên nhân từ ngoài vào trong.
- **Gặp TS2589**: (1) thêm tham số đếm độ sâu và dừng sớm; (2) chuyển sang dạng tail recursion với accumulator; (3) giảm kích thước union đầu vào; (4) cân nhắc bỏ kiểu đó. Lý do: đây là bốn hướng duy nhất thực sự tác động tới nguyên nhân.
- **Đừng "sửa" lỗi kiểu bằng `any`/`as unknown as T` khi chưa hiểu.** Lý do: bạn chuyển lỗi biên dịch thành lỗi runtime. Nếu bắt buộc, đóng gói trong một hàm nhỏ có chữ ký đúng và ghi chú vì sao.
- **Ghi chú phiên bản TS** ở kiểu dùng tính năng mới (4.5 tail recursion, 4.7 `infer extends`, 4.8 suy ra số, 4.1 template literal và `as`). Lý do: người đọc/đồng nghiệp dùng bản cũ sẽ gặp lỗi khó hiểu.
- **`type-challenges`** (kho bài tập kiểu trên GitHub) là cách luyện tốt, nhưng đừng đem các kiểu "thi đấu" vào code sản phẩm.

## Liên hệ bài tập

Hai bài lab của Bài 6 không cần đệ quy sâu. Phần cần để ý: `UnwrapPromise` có thể đệ quy một cấp (lồng Promise) nên hãy xác định điều kiện dừng và thử với `Promise<Promise<number>>`. Sau khi làm xong, viết test kiểu đủ biên cho cả hai, rồi thử cố ý làm một kiểu sai và nhìn thông báo lỗi để học cách đọc nó. Đó là một phần của bài "giải thích lại được".

## Đọc thêm

- [Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html)
- [TypeScript 4.5: Tail-Recursion Elimination on Conditional Types](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-5.html)

## Ghi chú của bạn

