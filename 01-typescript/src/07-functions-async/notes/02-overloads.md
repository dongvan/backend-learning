# 2. Overloads và khi nào nên dùng cách khác

Overload cho một hàm nhiều "chữ ký gọi", mỗi chữ ký gắn một kiểu trả về riêng, và chỉ có một phần thân (implementation) xử lý tất cả.

```ts
function parseId(input: string): number;
function parseId(input: string[]): number[];
function parseId(input: string | string[]): number | number[] {
  return Array.isArray(input) ? input.map(Number) : Number(input);
}

const one = parseId("42");           // number
const many = parseId(["1", "2"]);    // number[]
export { one, many };
```

## Ý chính

- Overload gồm các **overload signature** (không có thân) và đúng một **implementation signature** (có thân). Người gọi chỉ thấy các overload signature; implementation signature **bị ẩn**.
- Compiler thử các overload **từ trên xuống**, chọn cái đầu tiên khớp. Thứ tự quan trọng: đặt chữ ký cụ thể trước, tổng quát sau.
- Implementation signature phải tương thích với mọi overload, nhưng compiler không kiểm tra thân hàm có thực sự trả đúng kiểu cho từng overload. Đó là lời hứa của bạn, cũng gần như `as`.
- Trước khi viết overload, thử **union**, **generic**, hoặc **tham số optional**. Phần lớn trường hợp chúng đơn giản hơn.
- Overload hợp lý khi **kiểu trả về phụ thuộc vào kiểu/giá trị đầu vào** và không biểu diễn gọn bằng generic.

## Lý thuyết chi tiết

**Implementation signature bị ẩn.** Ví dụ trên, dù thân hàm nhận `string | string[]`, bạn không gọi được với union:

```ts
function toList(input: string): string[];
function toList(input: string[]): string[];
function toList(input: string | string[]): string[] {
  return Array.isArray(input) ? input : [input];
}

declare const raw: string | string[];
// @ts-expect-error  No overload matches this call
toList(raw);
```

Muốn nhận cả union, phải **thêm một overload** cho union đó, hoặc bỏ overload và dùng một chữ ký union duy nhất. Trường hợp này (cả hai overload cùng trả `string[]`) rõ ràng là không cần overload:

```ts
function toList2(input: string | string[]): string[] {
  return Array.isArray(input) ? input : [input];
}
export { toList2 };
```

**Thứ tự overload.** Compiler dừng ở overload đầu tiên khớp. Nếu để chữ ký rộng lên trước, các chữ ký hẹp phía sau không bao giờ được chọn:

```ts
function pick(x: unknown): string;
function pick(x: number): number;       // không bao giờ được chọn: unknown đã "nuốt" mọi thứ
function pick(x: unknown): unknown {
  return x;
}

const r = pick(1);                      // r: string (!), vì khớp overload đầu tiên
export { r };
```

Quy tắc: xếp từ cụ thể đến tổng quát. TS không báo lỗi ở ví dụ trên, nên đây là bẫy im lặng.

**Overload theo giá trị literal.** Dạng rất hay gặp là kiểu trả về đổi theo một tham số literal. Mẫu này giống cách một wrapper `fetch` trả kiểu khác nhau theo định dạng:

```ts
// Giả lập phần cần dùng của Response, để ví dụ không phụ thuộc kiểu toàn cục của Node
interface Res {
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

type Body = { text: string; json: unknown; bytes: Uint8Array };

async function readBody(res: Res, as: "text"): Promise<string>;
async function readBody(res: Res, as: "json"): Promise<unknown>;
async function readBody(res: Res, as: "bytes"): Promise<Uint8Array>;
async function readBody(res: Res, as: keyof Body): Promise<Body[keyof Body]> {
  switch (as) {
    case "text": return res.text();
    case "json": return res.json();
    case "bytes": return new Uint8Array(await res.arrayBuffer());
  }
}
export { readBody };
```

Gọi `readBody(res, "text")` được `Promise<string>`. Nhưng ví dụ này có cách thay thế tốt hơn: **generic cộng bảng tra kiểu**.

```ts
type BodyMap = { text: string; json: unknown; bytes: Uint8Array };

interface Res {
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

async function readBody2<K extends keyof BodyMap>(res: Res, as: K): Promise<BodyMap[K]> {
  switch (as) {
    case "text": return (await res.text()) as BodyMap[K];
    case "json": return (await res.json()) as BodyMap[K];
    case "bytes": return new Uint8Array(await res.arrayBuffer()) as BodyMap[K];
    default: throw new Error(`Unsupported: ${String(as)}`);
  }
}
export { readBody2 };
```

Thêm một định dạng mới chỉ cần sửa `BodyMap` (một chỗ) thay vì thêm một dòng overload. Cái giá là bên trong thân hàm phải `as` vì compiler không thu hẹp được kiểu `BodyMap[K]` theo `case`. Đây là điểm yếu chung: cả overload lẫn generic indexed access đều dựa vào lời hứa của người viết ở thân hàm.

**Thay overload bằng union khi trả về như nhau.** Nếu mọi overload cùng kiểu trả về, hãy gộp tham số thành union (ví dụ `toList2` ở trên).

**Thay overload bằng generic khi trả về "cùng kiểu với đầu vào".**

```ts
function firstOr<T, D>(items: readonly T[], fallback: D): T | D {
  return items[0] ?? fallback;     // noUncheckedIndexedAccess: items[0] là T | undefined
}

const a = firstOr([1, 2], "none");        // number | string
export { a };
```

Một generic duy nhất thay cho cặp overload "có fallback / không có fallback".

**Thay overload bằng tham số optional** khi chữ ký chỉ khác ở việc thêm tham số cuối:

```ts
// Thay vì: function fmt(d: Date): string; function fmt(d: Date, locale: string): string;
function fmtDate(d: Date, locale?: string): string {
  return d.toLocaleDateString(locale);
}
export { fmtDate };
```

**Overload và callback.** Tránh viết overload chỉ khác nhau ở callback có thêm tham số (ví dụ `(a) => void` và `(a, b) => void`). Một chữ ký với callback tham số "nhiều nhất" đã chấp nhận cả hai, vì hàm ít tham số gán được vào kiểu nhiều tham số.

**Overload trong class và method.** Cú pháp giống nhau, đặt các overload signature liền kề ngay trên implementation:

```ts
class Cache {
  private store = new Map<string, unknown>();

  get(key: string): unknown;
  get<T>(key: string, guard: (v: unknown) => v is T): T | undefined;
  get(key: string, guard?: (v: unknown) => boolean): unknown {
    const v = this.store.get(key);
    return guard === undefined || guard(v) ? v : undefined;
  }

  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }
}

const cache = new Cache();
cache.set("n", 1);
const n = cache.get("n", (v): v is number => typeof v === "number");   // number | undefined
export { n };
```

**Overload cho kiểu hàm (không phải khai báo).** Dùng call signature nhiều dòng trong object type hoặc interface:

```ts
type Logger = {
  (message: string): void;
  (message: string, meta: Record<string, unknown>): void;
};
export type { Logger };
```

Với hàm khai báo bằng `const x: Logger = (message, meta?) => ...` thì phải chọn tham số sao cho tương thích với **mọi** call signature.

**Thông báo lỗi "No overload matches this call".** Compiler liệt kê từng overload thất bại và lý do. Thường lỗi thật nằm ở **overload cuối cùng** được in ra (thông báo hiển thị lý do của overload gần nhất), nhưng đừng tin tuyệt đối: hãy so tay kiểu đối số của bạn với từng chữ ký.

## Tricks & tips thực tế

- **Thử theo thứ tự: union → tham số optional → generic → overload.** Lý do: mỗi bước nặng hơn bước trước về số chữ ký phải bảo trì và về rủi ro lệch giữa overload và thân hàm (compiler không kiểm tra).
- **Giữ ít overload (thường ≤ 3-4).** Lý do: danh sách dài làm thông báo lỗi khó đọc và IntelliSense hiện từng dòng một. Nếu thấy mình viết 6 overload, kiểu `BodyMap[K]` ở trên thường gọn hơn.
- **Đặt chữ ký cụ thể trước.** Lý do: compiler dừng ở overload khớp đầu tiên, và overload sai thứ tự là lỗi im lặng (không có cảnh báo).
- **Viết test kiểu cho overload.** Dùng `expectTypeOf(fn("x")).toEqualTypeOf<number>()` của Vitest (Bài 11), hoặc một dòng `const r: number = fn("x")` kèm `// @ts-expect-error` cho ca sai. Lý do: thân hàm có thể trả sai kiểu mà compiler không biết.
- **Đừng dùng overload để mô phỏng giá trị mặc định kiểu PHP** (nhiều dòng `function f()`, `function f($a)`). Lý do: tham số optional/default của TS làm đúng việc đó với một chữ ký.
- **Khai báo overload cho API công khai, nội bộ thì để generic/union đơn giản.** Lý do: overload thật sự hữu ích ở ranh giới thư viện (người dùng thấy IntelliSense đẹp); trong code nội bộ nó chỉ thêm chi phí.
- **Debug**: gặp "No overload matches", đặt riêng đối số ra biến có kiểu và rê chuột xem kiểu thực. Thường đối số bị `string` rộng thay vì literal (`"json"`). Dùng `as const` hoặc khai báo `const` thay `let` để giữ literal.
- **Cạm bẫy `let`/biến trung gian làm mất literal.** `let kind = "json"` có kiểu `string` nên không khớp overload `"json"`. `const kind = "json"` thì giữ `"json"`. Lý do: `let` có thể gán lại nên TS mở rộng literal (widening).
- **So với PHP**: PHP không có overload (một tên hàm, một định nghĩa). Thường dùng union type (`int|string`) hoặc tham số nullable, đúng với hướng "ưu tiên union" ở đây. Laravel hay dùng `mixed` rồi kiểm tra bên trong, TS cho bạn kiểu chính xác hơn mà vẫn cùng thân hàm.

## Liên hệ bài tập

Khi hàm trong bài lab cần trả kiểu khác nhau theo đầu vào, hãy tự quyết định có thực sự cần overload không. Thử viết bản dùng union hoặc generic trước, so sánh với bản overload và ghi lại lý do chọn. Hãy thử gọi hàm với đối số "không hợp lệ" và với union để xem compiler phản ứng thế nào (implementation signature bị ẩn).

## Đọc thêm

- [Function Overloads](https://www.typescriptlang.org/docs/handbook/2/functions.html#function-overloads)
- [Guidelines for writing good overloads](https://www.typescriptlang.org/docs/handbook/2/functions.html#writing-good-overloads)

## Ghi chú của bạn
