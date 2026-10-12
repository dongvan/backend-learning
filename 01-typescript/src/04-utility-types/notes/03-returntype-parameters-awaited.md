# 3. `ReturnType`, `Parameters`, `Awaited` và bên trong utility types

Các utility này lấy kiểu **từ một hàm** thay vì từ một object: bạn không phải khai báo lại kiểu trả về hay danh sách tham số, nên không bị lệch khi hàm đổi.

```ts
async function loadUser(id: number): Promise<{ id: number; name: string } | null> {
  return id > 0 ? { id, name: "a" } : null;
}
function makeToken(userId: number, ttl = 60): string { return `${userId}:${ttl}`; }

type R1 = ReturnType<typeof makeToken>;              // string
type P1 = Parameters<typeof makeToken>;              // [userId: number, ttl?: number]
type U = Awaited<ReturnType<typeof loadUser>>;       // { id: number; name: string } | null
```

## Ý chính

- Các utility này nhận **kiểu** hàm, nên với hàm cụ thể phải viết `typeof tenHam`; viết `ReturnType<tenHam>` là lỗi vì `tenHam` là giá trị.
- `ReturnType<F>` lấy kiểu trả về; `Parameters<F>` lấy tuple các tham số (có cả tên và dấu `?`); `ConstructorParameters` và `InstanceType` làm tương tự cho class.
- `Awaited<T>` "bóc" `Promise` (đệ quy). Hàm `async` trả `Promise<X>`, nên thường phải `Awaited<ReturnType<typeof fn>>` để lấy `X`.
- Với hàm **overload** chỉ thấy chữ ký cuối; với hàm **generic** tham số kiểu bị thay bằng constraint (thường là `unknown`).
- Bên trong, chúng là conditional type với `infer` (Bài 6). Bạn chưa cần tự viết, chỉ cần biết giới hạn của chúng.

## Lý thuyết chi tiết

**`typeof` là cầu nối từ giá trị sang kiểu.**

```ts
const config = { port: 80 };
type Bad = ReturnType<config>;     // Lỗi: 'config' refers to a value, but is being used as a type
type Bad2 = ReturnType<string>;    // Lỗi: string không thoả constraint là kiểu hàm
```

Dòng đầu quên `typeof`. Dòng hai: `ReturnType<T extends (...args: any) => any>` yêu cầu `T` là hàm.

**`Parameters` trả về tuple, giữ tên và optional.**

```ts
const p1: Parameters<typeof makeToken> = [1];          // ttl là optional
const p2: Parameters<typeof makeToken> = [1, 30];
const p3: Parameters<typeof makeToken> = ["1"];        // Lỗi
type First = Parameters<typeof makeToken>[0];          // number
```

Với method của interface/class, dùng indexed access để lấy kiểu method:

```ts
interface Repo { find(id: number, opts?: { withTrashed: boolean }): Promise<string> }
type FindArgs = Parameters<Repo["find"]>;   // [id: number, opts?: { withTrashed: boolean }]
```

**`Awaited` và `Promise` lồng nhau.**

```ts
type A1 = Awaited<Promise<Promise<number>>>;     // number
type A2 = Awaited<number | Promise<string>>;     // string | number
```

`Awaited` (TS 4.5+) mô phỏng cách `await` thực sự hoạt động: bóc đệ quy, xử lý cả union. Nó cũng là kiểu mà `Promise.all` dùng bên trong.

```ts
async function pall() {
  const [a, b] = await Promise.all([loadUser(1), Promise.resolve("s")]);
  return [a, b] as const;
}
type PA = Awaited<ReturnType<typeof pall>>;   // readonly [{ id: number; name: string } | null, string]
```

**`ConstructorParameters` và `InstanceType`.**

```ts
class Mailer {
  constructor(public host: string, public port: number) {}
  send(to: string): boolean { return !!to; }
}
type CP = ConstructorParameters<typeof Mailer>;   // [host: string, port: number]
type IT = InstanceType<typeof Mailer>;            // Mailer
```

Lưu ý `typeof Mailer` là kiểu của **class (constructor)**, còn `Mailer` là kiểu của **instance**.

**Giới hạn 1: overload.** Compiler dùng chữ ký **cuối cùng** (không tính chữ ký implementation):

```ts
function f(x: string): string;
function f(x: number): number;
function f(x: string | number): string | number { return x; }
type FR = ReturnType<typeof f>;   // number
```

**Giới hạn 2: hàm generic.** Tham số kiểu không còn người gọi để suy luận, nên về constraint:

```ts
function idf<T>(x: T): T { return x; }
type IR = ReturnType<typeof idf>;            // unknown
type IR2 = ReturnType<typeof idf<string>>;   // string (instantiation expression, TS 4.7+)
```

**Bên trong (giới thiệu).** Định nghĩa gần đúng:

```ts
type MyReturnType<F extends (...args: never[]) => unknown> =
  F extends (...args: never[]) => infer R ? R : never;
```

`infer R` nghĩa là "tìm `R` sao cho `F` khớp mẫu này, rồi cho tôi `R`". Bài 6 học kỹ. Hiểu được vậy là đủ để đoán: nếu `F` có nhiều chữ ký (overload) hay chứa generic, mẫu khớp theo cách đã nêu.

**Cũng cần biết:** `Uppercase`, `Lowercase`, `Capitalize`, `Uncapitalize` thao tác trên chuỗi literal (đã dùng ở file 2); `ThisParameterType`, `OmitThisParameter` ít gặp ở backend; `NoInfer` (TS 5.4+) đã gặp ở Bài 3.

## Tricks & tips thực tế

- **Lấy kiểu từ implementation thay vì viết tay, khi implementation là nguồn sự thật.** Ví dụ kiểu dữ liệu một service trả về: `type Created = ReturnType<Service["create"]>`. Lý do: đổi hàm thì kiểu tự đổi. Ngược lại, kiểu của một **hợp đồng công khai** (API response) nên viết tay làm nguồn sự thật và buộc hàm tuân theo; nếu không, sửa vô ý một hàm có thể đổi hợp đồng mà không ai biết.
- **Hay gặp: `Awaited<ReturnType<typeof fn>>` cho hàm async.** Nếu quên `Awaited` bạn được `Promise<...>` và lỗi kiểu như "Property 'name' does not exist on type 'Promise<...>'". Đọc thông báo: thấy `Promise<` trong kiểu thì thường là thiếu `await`/`Awaited`.
- **Bọc hàm mà giữ chữ ký bằng `Parameters` và `ReturnType`:**

  ```ts
  function logged<F extends (...args: never[]) => unknown>(fn: F) {
    return (...args: Parameters<F>): ReturnType<F> => fn(...args) as ReturnType<F>;
  }
  const lg = logged(makeToken);
  const r: string = lg(1);
  ```

  Lý do: chữ ký wrapper tự theo hàm gốc; gõ lại tay sẽ lệch. Dùng `never[]` thay `any[]` trong constraint để tránh `any` mà vẫn nhận mọi hàm. Ép `as ReturnType<F>` cần thiết vì compiler không chứng minh được `fn(...args)` trả đúng kiểu đó; giữ nó ở một chỗ duy nhất.
- **Dùng với object chứa nhiều hàm:** `typeof service` lấy kiểu cả object, rồi `Service["create"]` lấy từng hàm. Dùng cho mock/test để mock có cùng chữ ký với bản thật.
- **Khi kết quả là `unknown` hoặc kiểu lạ, nghĩ ngay tới overload hoặc generic.** Hai giới hạn trên chính là nguyên nhân thường gặp. Cách xử: dùng instantiation expression (`typeof fn<string>`), tách hàm thành chữ ký không overload, hoặc khai báo kiểu tường minh.
- **Đừng lạm dụng.** Chuỗi `Awaited<ReturnType<Parameters<...>[0]>>` khó đọc; đặt tên trung gian bằng `type` alias, vì tên diễn đạt ý nghĩa nghiệp vụ.
- **So với PHP/Laravel:** PHP không có cách lấy "kiểu giá trị trả về của hàm khác" để dùng làm kiểu ở chỗ khác (Reflection chỉ chạy lúc runtime, PHPStan cần bạn viết docblock). TypeScript làm được ngay ở cấp kiểu. Nên dùng, nhưng đừng để kiểu hợp đồng phụ thuộc ngầm vào implementation.
- **Debug:** gán kết quả vào `const _: never = {} as MyType;` để compiler in ra kiểu thật; hoặc hover vào alias. Khi `ReturnType` trả `any`, kiểm tra xem bạn có truyền `any` vào hay không.

## Liên hệ bài tập

DTO response của lab thường bắt nguồn từ thứ hàm map/serialize trả về. Hãy quyết định rõ: kiểu response là hợp đồng (viết tay, hàm map phải khớp) hay là dẫn xuất từ hàm map bằng `ReturnType`? Ghi lại lý do chọn và hệ quả khi đổi một trường.

## Đọc thêm

- [Utility Types: ReturnType, Parameters, Awaited, ConstructorParameters, InstanceType](https://www.typescriptlang.org/docs/handbook/utility-types.html)
- [Typeof Type Operator](https://www.typescriptlang.org/docs/handbook/2/typeof-types.html)
- [Conditional Types: Inferring Within Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#inferring-within-conditional-types)

## Ghi chú của bạn

