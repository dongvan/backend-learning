# 3. `coerce`, `transform`, `refine`, `superRefine` và `default`

Zod không chỉ kiểm tra: nó còn có thể **biến đổi** dữ liệu trong lúc parse, nên kiểu vào và kiểu ra có thể khác nhau.

```ts
import { z } from "zod";

const Query = z.object({
  page: z.coerce.number().int().min(1).default(1), // "3" -> 3
  slug: z.string().trim().toLowerCase(),
});

Query.parse({ page: "3", slug: "  Hello " }); // { page: 3, slug: "hello" }
```

## Ý chính

- Dữ liệu từ query string, form, biến môi trường **luôn là chuỗi**. `z.coerce.*` ép kiểu trước khi kiểm tra, nhưng ép kiểu theo luật của JavaScript nên có cạm bẫy (`""` thành `0`, `"false"` thành `true`).
- `transform` biến đổi giá trị sau khi kiểm tra; `refine` / `superRefine` thêm luật tuỳ ý; `pipe` nối hai schema; `preprocess` biến đổi *trước* khi kiểm tra.
- Có `transform`/`coerce`/`default` thì `z.input` khác `z.output`. Luôn nhớ mình đang nói về kiểu nào.
- Trong Zod 4, `refine` ở cấp object **vẫn chạy** khi một trường chỉ vi phạm luật kiểm tra (ví dụ `min`), nhưng **bị bỏ qua** khi một trường sai kiểu hoặc thiếu (đã chạy thật). Viết refine phải chịu được dữ liệu "gần hợp lệ".
- Object có `refine` thì `.pick()`, `.omit()`, `.partial()` **ném lỗi** (Zod 4.6.5). Refine nên đặt cuối cùng sau khi đã dẫn xuất xong.

## Lý thuyết chi tiết

**`coerce`.** `z.coerce.number()` gọi `Number(x)` rồi kiểm tra kết quả là số. Với input đời thực:

```ts
z.coerce.number().parse("42");        // 42
z.coerce.number().parse("");          // 0   <- chuỗi rỗng thành 0, không báo lỗi
z.coerce.number().parse(null);        // 0
z.coerce.number().safeParse("abc");   // lỗi: expected number, received NaN
z.coerce.number().safeParse(undefined).success; // false (NaN)

z.coerce.boolean().parse("false");    // true  <- mọi chuỗi không rỗng đều truthy
z.coerce.boolean().parse("0");        // true
z.coerce.boolean().parse("");         // false

z.coerce.date().parse("2026-01-02");  // Date
```

Đã chạy thật. Hai điểm phải nhớ: (1) `""` và `null` thành `0` nên thêm `.min(1)` hay luật khác để chặn nếu `0` không hợp lệ; (2) **không dùng `z.coerce.boolean()` cho cờ từ query/env**. Dùng `z.stringbool()` (Zod 4):

```ts
const Flag = z.stringbool();
Flag.parse("true");   // true
Flag.parse("false");  // false  (đã chạy)
Flag.parse("yes");    // true
```

Kiểu input của trường `coerce.*` là `unknown` (đã kiểm: `z.input` của `z.object({ page: z.coerce.number() })` là `{ page: unknown }`), tức compiler không giúp kiểm tra đầu vào ở các trường này.

**`default` và các biến thể optional.**

```ts
const Opts = z.object({
  a: z.string().default("x"),      // thiếu hoặc undefined -> "x"; null -> LỖI
  b: z.number().optional(),        // được phép vắng mặt / undefined
  c: z.string().nullable(),        // bắt buộc có khoá, giá trị string | null
  d: z.string().nullish(),         // string | null | undefined
});

Opts.parse({ c: null });           // { a: "x", c: null }
type OptsIn = z.input<typeof Opts>;   // { a?: string; b?: number; c: string | null; d?: string | null }   (đã kiểm bằng so sánh kiểu)
type OptsOut = z.output<typeof Opts>; // { a: string; b?: number; c: string | null; d?: string | null }
```

`default` làm kiểu output *bắt buộc* còn kiểu input *tuỳ chọn*. Phân biệt `optional` (khoá có thể thiếu) với `nullable` (khoá có, giá trị `null`) quan trọng khi nối với DB/JSON: PATCH thường dùng `optional` ("không gửi nghĩa là không đổi"), còn `null` nghĩa là "xoá giá trị".

**`transform`**: nhận giá trị đã hợp lệ, trả giá trị mới có thể khác kiểu.

```ts
const Slug = z.string().trim().toLowerCase().transform((s) => s.replace(/\s+/g, "-"));
Slug.parse("  Hello World "); // "hello-world"
type SlugIn = z.input<typeof Slug>;   // string
type SlugOut = z.output<typeof Slug>; // string
```

`trim()` và `toLowerCase()` có sẵn trên `z.string()` (là các bước biến đổi dựng sẵn). Báo lỗi từ trong `transform` qua `ctx.issues` và trả `z.NEVER`:

```ts
const NumStr = z.string().transform((s, ctx) => {
  const n = Number(s);
  if (Number.isNaN(n)) {
    ctx.issues.push({ code: "custom", message: "Không phải số", input: s });
    return z.NEVER;
  }
  return n;
});
// NumStr.safeParse("x").error.issues -> [{ code: "custom", message: "Không phải số", path: [] }]
```

**`pipe`**: schema thứ hai nhận output của schema thứ nhất. Cách sạch để "biến đổi rồi kiểm tra tiếp":

```ts
const Port = z.string().transform(Number).pipe(z.number().int().min(1).max(65535));
Port.parse("8080");               // 8080
Port.safeParse("99999").success;  // false
```

**`preprocess`**: chạy trước kiểm tra, hợp với "chuẩn hoá hình dạng trước":

```ts
const Ids = z.preprocess((v) => (typeof v === "string" ? v.split(",") : v), z.array(z.string()));
Ids.parse("a,b");   // ["a", "b"]
Ids.parse(["x"]);   // ["x"]
```

**`refine`: luật tuỳ ý trả `boolean`.**

```ts
const Signup = z
  .object({ password: z.string().min(8), confirm: z.string() })
  .refine((d) => d.password === d.confirm, {
    error: "Mật khẩu xác nhận không khớp",
    path: ["confirm"], // gắn lỗi vào đúng trường, mặc định path là []
  });
```

Đã chạy: nếu `password` chỉ quá ngắn mà `confirm` là chuỗi, **cả hai lỗi** cùng xuất hiện (`path` `password` và `confirm`). Nhưng nếu `confirm` *thiếu* (`undefined`), refine bị bỏ qua và chỉ có lỗi `invalid_type`. Theo trí nhớ về Zod 3, refine cấp object bị bỏ qua khi bất kỳ trường nào lỗi (chưa kiểm chứng ở đây); hãy dè chừng khi đọc tài liệu cũ và tự thử với bản đang cài.

**`superRefine`: thêm nhiều issue, mỗi issue một mã/đường dẫn riêng.**

```ts
const Tags = z.array(z.string()).superRefine((arr, ctx) => {
  if (new Set(arr).size !== arr.length) {
    ctx.addIssue({ code: "custom", message: "Tag bị trùng", input: arr });
  }
});
```

(`ctx.addIssue` chạy được trong 4.6.5. Trong `transform` ở trên dùng `ctx.issues.push`; cả hai đều đã chạy thử.)

**Thứ tự phép kiểm tra.** Chuỗi `.min(3).refine(...)` chạy các bước theo thứ tự khai báo và *thu thập tất cả* lỗi, không dừng ở lỗi đầu: `z.string().min(3).refine(startsWithA).safeParse("b")` trả cả hai lỗi (đã chạy). Nếu refine thứ hai tốn kém hoặc giả định đã qua `min`, đừng giả định gì cả.

**So sánh với Laravel.** `prepareForValidation()` tương ứng `preprocess`/`transform`; rule `confirmed` tương ứng refine so khớp; `sometimes`, `nullable` tương ứng `optional`, `nullable`. Khác biệt: Laravel validate xong vẫn trả giá trị gốc (chuỗi `"3"`), còn Zod trả giá trị **đã ép/đã biến đổi**, nên bạn không phải tự cast ở controller.

**Bảng các giá trị "lạ" của `z.coerce.number()`** (đã chạy với Zod 4.6.5; vì nó gọi `Number(x)` nên kế thừa mọi quy tắc của JavaScript):

| Input | Kết quả | Ghi chú |
|---|---|---|
| `"  "` (chỉ khoảng trắng) | `0` | không báo lỗi |
| `"0x10"` | `16` | chuỗi hex được chấp nhận |
| `"1e3"` | `1000` | ký hiệu khoa học được chấp nhận |
| `[]` | `0` | mảng rỗng thành `0` |
| `[5]` | `5` | mảng một phần tử cũng "ép" được |
| `true` | `1` | boolean thành số |
| `"abc"` | lỗi | `expected number, received NaN` |

Hệ quả: `?page=0x10` thành trang 16, và `?limit=` (để trống) thành `0`. Chặn bằng `.min(1)`, hoặc nếu cần nghiêm ngặt hơn thì kiểm tra chuỗi bằng regex *trước* rồi mới chuyển: `z.string().regex(/^\d+$/).transform(Number)`.

Các `coerce` khác cũng có bẫy riêng (đã chạy): `z.coerce.date().parse(null)` ra `1970-01-01T00:00:00.000Z` (vì `new Date(null)`), `z.coerce.string().parse(undefined)` ra chuỗi `"undefined"`, và `z.coerce.string().parse({ a: 1 })` ra `"[object Object]"`. Với `coerce.date`, input không parse được cho lỗi `expected date, received Date` (message đọc khó hiểu vì `Invalid Date` vẫn là `Date`).

**`default` bỏ qua validation, `prefault` thì không (Zod 4).** Trong Zod 4, khi input là `undefined`, `.default(v)` trả thẳng `v` mà *không* chạy các luật phía trước; còn `.prefault(v)` đưa `v` vào như thể client đã gửi nó rồi mới validate:

```ts
z.object({ n: z.number().min(10).default(5) }).parse({});    // { n: 5 }  <- vi phạm min(10) mà vẫn qua
z.object({ n: z.number().min(10).prefault(5) }).safeParse({}).success; // false
```

Điều này hợp lý (giá trị mặc định do chính bạn viết), nhưng là chỗ khác Zod 3. Sau `default`, các `transform` phía sau vẫn chạy: `z.string().default("x").transform((s) => s.toUpperCase())` cho `"X"`.

**`default` không áp dụng cho chuỗi rỗng hay `null`.** `z.string().default("x").safeParse(null)` là lỗi. Với biến môi trường `PORT=` (khai báo nhưng rỗng), `z.coerce.number().int().min(1).default(3000)` *không* rơi về `3000`: `""` bị ép thành `0` rồi vi phạm `min(1)`. Muốn coi chuỗi rỗng là "không có", dùng `preprocess`:

```ts
const optionalNumber = (inner: z.ZodType<number>) =>
  z.preprocess((v) => (v === "" ? undefined : v), inner.optional());
```

**Union và `coerce` (thứ tự quan trọng).** `z.union` thử từng nhánh theo thứ tự và lấy nhánh đầu thành công. Với `z.union([z.coerce.number(), z.string()])`, chuỗi `"5"` thành số `5` (nhánh đầu "nuốt" nó) còn `"abc"` giữ nguyên chuỗi (đã chạy). Đảo thứ tự là kết quả khác. Hạn chế `coerce` trong union; nếu cần "số hoặc chuỗi", hãy ghi rõ ý định bằng `z.union([z.number(), z.string()])`.

**`.catch(v)` giấu lỗi.** `z.number().catch(0).parse("abc")` trả `0` mà không có lỗi nào (đã chạy). Hợp với dữ liệu *không quan trọng* (cờ giao diện tuỳ chọn), nguy hiểm với dữ liệu nghiệp vụ: client gửi sai mà không ai biết.

**`default` trong PATCH là bẫy kinh điển.** `Settings.partial()` với trường có `.default("light")` **vẫn áp default** khi trường vắng mặt: `z.object({ theme: z.enum(["light", "dark"]).default("light"), name: z.string() }).partial().parse({})` cho `{ theme: "light" }` (đã chạy). Nếu bạn dùng kết quả đó để `UPDATE`, một request PATCH rỗng sẽ **đặt lại** `theme` về `"light"`. Cách tránh: schema PATCH dẫn xuất từ schema *không có `default`*; chỉ schema tạo mới mới thêm `default` (xem file 06).

**Lỗi ném thẳng từ `refine`/`transform` không thành `ZodError`.** Nếu callback ném (bug, hay gọi `JSON.parse` hỏng), lỗi đó thoát nguyên vẹn: `z.string().refine(() => { throw new TypeError("bug") }).parse("x")` ném `TypeError`, không phải `ZodError` (đã chạy). Hệ quả tốt: ở ranh giới, `instanceof z.ZodError` chỉ gom lỗi *input*, còn bug rơi xuống nhánh 500. Muốn báo lỗi input từ trong `transform`, dùng `ctx.issues.push(...)` như trên chứ đừng `throw`.

## Tricks & tips thực tế

- **Dùng `coerce` chỉ ở rìa chuỗi (query, params, env), không ở body JSON.** Lý do: JSON có số thật; coerce làm `""`/`null` lọt thành `0` và che lỗi của client.
- **Với số từ query luôn đặt cận (`min`/`max`) và `int()`.** Lý do: chặn `""`→`0` và giá trị khổng lồ gây tốn tài nguyên (`perPage=1000000`).
- **Cờ boolean từ chuỗi dùng `z.stringbool()`.** Lý do: `z.coerce.boolean()` coi `"false"` là `true`, lỗi im lặng và rất khó thấy.
- **Chuẩn hoá (`trim`, `toLowerCase`) ngay trong schema cho email, slug.** Lý do: tránh hai bản ghi "A@x.co" và "a@x.co", và mọi tầng sau nhận dữ liệu đã sạch.
- **Hạn chế `transform` có tác dụng phụ hoặc I/O.** Lý do: schema nên thuần để test dễ, chạy lại an toàn; hàm async buộc dùng `parseAsync` ở mọi nơi dùng schema.
- **`refine` cấp object đặt `path`.** Lý do: không có `path`, lỗi gắn vào object gốc (`path: []`), form không biết tô đỏ ô nào.
- **Thứ tự: dẫn xuất (`pick`/`omit`/`partial`) trước, `refine` sau.** Lý do: Zod 4.6.5 ném `.omit() cannot be used on object schemas containing refinements` (tương tự `.pick()`, `.partial()`); `extend` thì chạy được (đã thử).
- **Khi `z.input` lạ so với `z.output`, in cả hai kiểu ra** (gán thử giá trị vào biến có kiểu đó). Lý do: lỗi "tại sao hàm của mình yêu cầu `number` mà bên gọi truyền `string`" thường do nhầm input/output.
- **Đừng dùng `default` để che dữ liệu thiếu mà nghiệp vụ bắt buộc.** Lý do: một client quên gửi `quantity` sẽ âm thầm nhận giá trị mặc định thay vì bị báo lỗi.
- **`z.number()` từ chối `NaN`, còn `Infinity` thì `z.number()` cũng từ chối** (đã chạy: `safeParse(Infinity).success === false`). `z.int()` (Zod 4) hoặc `z.number().int()` để chỉ nhận số nguyên; với tiền, ưu tiên số nguyên đơn vị nhỏ nhất (xu) thay vì số thực.

- **Schema PATCH dẫn xuất từ schema không có `default`.** Lý do: `partial()` vẫn áp `default`, nên PATCH rỗng âm thầm ghi đè dữ liệu hiện có bằng giá trị mặc định.
- **Dùng `prefault` khi giá trị mặc định cũng phải qua luật** (ví dụ mặc định lấy từ cấu hình do người vận hành nhập). Lý do: `default` bỏ qua `min`/`max`, mặc định sai sẽ lọt vào hệ thống mà không ai kiểm.
- **Với biến môi trường rỗng (`FOO=`), quyết định rõ nó nghĩa là "chưa đặt" hay "giá trị rỗng".** Lý do: dotenv/CI hay sinh ra chuỗi rỗng, `coerce.number` biến nó thành `0` và `default` không cứu được.
- **Tránh `catch()` cho dữ liệu nghiệp vụ.** Lý do: nó xoá dấu vết lỗi; nếu cần giá trị dự phòng, hãy `safeParse` và ghi log rồi mới dùng giá trị dự phòng.

## Liên hệ bài tập

Trong lab, đoán trước: trường nào của Order input có thể đến dưới dạng chuỗi? Trường nào cần mặc định? Có luật nào liên quan *nhiều trường cùng lúc* (cần `refine` ở cấp object, và `path` đặt ở đâu)? Hãy thử viết luật đó trước rồi đưa dữ liệu "gần hợp lệ" vào xem refine có chạy như bạn nghĩ không.

## Đọc thêm

- [Zod: API (mục coercion, refinements, transforms, defaults)](https://zod.dev/api)

## Ghi chú của bạn

