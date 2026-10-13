# 7. Schema trong hệ thống thật: hiệu năng, giới hạn, codec và biến môi trường

Schema là code chạy trên mỗi request: nơi tạo ra nó, độ sâu của dữ liệu nó chấp nhận, và cách nó nối với DTO đều ảnh hưởng đến độ ổn định của dịch vụ.

```ts
import { z } from "zod";

// Tạo MỘT lần ở cấp module, dùng lại cho mọi request
const CreateShipment = z.object({ address: z.string().min(1), weightGrams: z.number().int().min(1) });

function handler(raw: unknown) {
  return CreateShipment.safeParse(raw); // không tạo lại schema trong hàm
}
```

## Ý chính

- **Khai báo schema ở cấp module, không trong handler.** Dựng schema là việc tốn kém so với parse (đo bên dưới).
- Dữ liệu lồng sâu có thể làm tràn stack; **giới hạn kích thước/độ sâu ở tầng đọc body**, không trông chờ vào Zod.
- `z.codec` (Zod 4.1+) mô tả hai chiều chuyển đổi (ví dụ chuỗi ISO và `Date`) trong một khai báo, rất hợp với ranh giới DTO.
- `z.toJSONSchema` biến schema thành JSON Schema, có ích cho tài liệu API và công cụ ngoài.
- Biến môi trường nên được parse **một lần lúc khởi động** thành một object cấu hình có kiểu, rồi truyền đi; không đọc `process.env` rải rác.

## Lý thuyết chi tiết

**Schema đặt trong hàm rất chậm so với đặt ở cấp module.** Thử nghiệm đã chạy (Zod 4.6.5, Node 24, 20 000 lần parse cùng một object nhỏ trên máy dev, chỉ mang tính tham khảo, hãy tự đo trên máy của bạn):

```text
tạo schema mới trong mỗi lần gọi : ~1050 ms
tạo một lần, parse nhiều lần      : ~4 ms
```

Chênh lệch hai bậc độ lớn. Cơ chế bên trong (Zod chuẩn bị sẵn hàm kiểm tra cho mỗi schema) tôi chưa kiểm chứng ở đây; điều đã đo được là chi phí *dựng* schema lớn hơn nhiều chi phí *parse*. Hệ quả trong thực tế: `z.object(...)` viết ngay trong controller (hay trong một helper được gọi mỗi request) làm tăng độ trễ và áp lực GC. Nếu schema phụ thuộc tham số (ví dụ giới hạn `max` đọc từ cấu hình), dựng nó một lần lúc khởi động từ cấu hình, hoặc đặt tham số vào `refine` đọc biến ngoài.

**Dữ liệu lồng quá sâu làm tràn stack.** Với schema đệ quy (cây danh mục) dùng `getter` (Zod 4 hỗ trợ getter cho kiểu đệ quy; `z.lazy` vẫn dùng được):

```ts
const Category = z.object({
  name: z.string(),
  get children() {
    return z.array(Category);
  },
});
type Category = z.infer<typeof Category>;
```

Một cây 20 000 tầng gây `RangeError: Maximum call stack size exceeded` ném ra từ `parse` (đã chạy), và đó là `RangeError` chứ không phải `ZodError`, nên rơi xuống nhánh 500 chứ không phải 400. Phòng thủ: giới hạn kích thước body ở framework (vài trăm KB đến vài MB tuỳ API), và nếu nhận cấu trúc đệ quy từ người dùng thì thêm giới hạn độ sâu tự đo trước khi parse (cần tự quyết định giá trị). Lỗi `path` của schema đệ quy vẫn đầy đủ: `["children", 0, "name"]` (đã chạy).

**`z.codec`: một khai báo cho hai chiều.** DTO dùng chuỗi ISO, domain dùng `Date`; codec khai báo cả `decode` (vào) và `encode` (ra):

```ts
const IsoDate = z.codec(z.iso.datetime(), z.date(), {
  decode: (s) => new Date(s),
  encode: (d) => d.toISOString(),
});
type In = z.input<typeof IsoDate>;   // string
type Out = z.output<typeof IsoDate>; // Date

IsoDate.decode("2026-01-02T03:04:05.000Z"); // Date
IsoDate.encode(new Date(0));                // "1970-01-01T00:00:00.000Z"
```

Đã chạy và đã kiểm kiểu `string` và `Date` bằng so sánh kiểu. `parse` cũng áp `decode` (đầu ra là `Date`). Lợi ích so với `transform`: `transform` chỉ một chiều, nên bạn phải viết mapper ngược bằng tay (và có thể lệch nhau). Theo changelog, `z.codec` xuất hiện từ Zod 4.1 (cần tự kiểm chứng); bản 4.6.5 của repo chạy được. Nếu `encode` chạy ở mapper response, hãy kiểm tra thêm `z.iso.datetime()` ở chiều ra để không phát ra ngày sai định dạng.

**`z.toJSONSchema`.**

```ts
z.toJSONSchema(z.object({ a: z.string().min(1), b: z.number().optional() }));
// { "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object",
//   "properties": { "a": { "type": "string", "minLength": 1 }, "b": { "type": "number" } },
//   "required": ["a"], "additionalProperties": false }
```

(Đã chạy.) Chú ý `additionalProperties: false` trong kết quả (đã chạy) trong khi chính `parse` lại strip chứ không báo lỗi khoá lạ; hai thứ không cùng nghĩa. Dùng nó để sinh tài liệu/kiểm tra phía client; `transform` và `refine` (hàm tuỳ ý) không biểu diễn được trong JSON Schema, nên đừng kỳ vọng nó mô tả đầy đủ luật. Thêm mô tả bằng `.meta({ description: "..." })` (đã chạy: trả `{ description: "..." }`).

**`z.url()` và các định dạng.** `z.url()` chấp nhận mọi scheme (kể cả `javascript:`), `z.httpUrl()` chỉ `http`/`https`. Nếu URL sẽ được hiển thị làm liên kết hay được server tự gọi (webhook của người dùng), dùng `httpUrl` và **thêm kiểm tra SSRF ở tầng gọi mạng** (chặn địa chỉ nội bộ); Zod không làm việc đó.

**Biến môi trường: parse một lần, thất bại sớm.**

```ts
const Env = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url(),
  ENABLE_CACHE: z.stringbool().default(false),
});
type Env = z.infer<typeof Env>;

export function loadEnv(source: Record<string, string | undefined>): Env {
  const r = Env.safeParse(source);
  if (!r.success) {
    throw new Error(`Cấu hình không hợp lệ:\n${z.prettifyError(r.error)}`);
  }
  return r.data;
}
// loadEnv({}) ném: "✖ Invalid input: expected string, received undefined\n  → at DATABASE_URL"  (đã chạy)
```

Gọi `loadEnv(process.env)` một lần ở điểm vào (cần `@types/node` được nạp, xem file 1). `z.stringbool()` đã chạy với các giá trị `1`, `0`, `on`, `off`, `TRUE`, `y`, `n`, `enabled`: lần lượt `true`, `false`, `true`, `false`, `true`, `true`, `false`, `true`; còn chuỗi rỗng là lỗi. Danh sách đầy đủ xem tài liệu Zod. Có sẵn `default` cho `PORT`, nhưng nhớ rằng `PORT=` (rỗng) không rơi về mặc định mà vi phạm `min(1)` (file 3).

**So sánh với Laravel.** `config/*.php` đọc `env('KEY', default)`; không có kiểm tra kiểu và thiếu biến chỉ lộ khi code chạm tới. `loadEnv` khiến tiến trình dừng ngay lúc khởi động, Ngoài ra, trong Laravel `env()` gọi ngoài file config sẽ trả `null` khi config đã được cache, một nguồn lỗi quen thuộc; tập trung đọc biến vào một hàm `loadEnv` ở TS tránh cùng loại lỗi.

## Tricks & tips thực tế

- **Schema ở cấp module, export từ file `*.schema.ts` cạnh handler.** Lý do: tránh chi phí dựng lại, và test import được schema mà không cần dựng server.
- **Không cache kết quả `parse` theo input.** Lý do: parse đủ rẻ khi schema đã dựng sẵn; cache thêm bộ nhớ và rủi ro dữ liệu cũ.
- **Giới hạn body ở framework trước khi parse.** Lý do: lúc Zod chạy, toàn bộ body đã nằm trong bộ nhớ và đã qua `JSON.parse`; schema không bảo vệ được bạn khỏi payload khổng lồ.
- **Bắt `RangeError` cùng đường với lỗi lạ (500) chỉ khi thật sự nhận cấu trúc đệ quy.** Lý do: ở endpoint không đệ quy, lỗi này gần như luôn là bug hay tấn công; ghi log mức cảnh báo.
- **Đưa `loadEnv` nhận tham số `source` thay vì đọc `process.env` bên trong.** Lý do: test truyền object giả, không phải sửa biến môi trường toàn cục.
- **Không in cả object cấu hình khi báo lỗi biến môi trường.** Lý do: có thể chứa mật khẩu trong `DATABASE_URL`; `prettifyError` chỉ nêu tên biến.
- **Với codec, đặt `decode` ở request và `encode` ở response, rồi viết một test vòng khứ hồi** (`encode(decode(x)) === x` với giá trị ISO chuẩn). Lý do: hai hàm viết tay có thể lệch nhau (múi giờ, mili giây).
- **Dùng `.meta({ description })` chỉ khi bạn thật sự sinh tài liệu từ schema.** Lý do: metadata không dùng thì là nhiễu.

## Liên hệ bài tập

Kiểm tra schema của bạn trong lab: nó được dựng ở đâu (cấp module hay trong hàm)? Thử đo `parse` 10 000 lần ở hai cách (tự đo, như trong thí nghiệm trên) và so sánh. Thử thêm một schema đệ quy nhỏ và đưa vào input lồng 20 000 tầng để thấy lỗi thật. Câu hỏi mở: lỗi `RangeError` đó, bạn muốn client thấy gì, và log chứa gì?

## Đọc thêm

- [Zod: Codecs](https://zod.dev/codecs)
- [Zod: JSON Schema](https://zod.dev/json-schema)
- [Zod: Defining schemas, recursive objects](https://zod.dev/api)
- [MDN: `RangeError`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RangeError)

## Ghi chú của bạn
