# 6. Tiền và số thực dấu phẩy động

`number` trong JavaScript là số thực nhị phân 64-bit (IEEE 754), nên nhiều số thập phân quen thuộc không biểu diễn chính xác được.

```ts
0.1 + 0.2;           // 0.30000000000000004
1.005 * 100;         // 100.49999999999999
Math.round(1.005 * 100) / 100;   // 1 (không phải 1.01)
```

## Ý chính

- Lỗi nằm ở cách biểu diễn, không phải lỗi của JS: `0.1` trong hệ nhị phân là số tuần hoàn vô hạn, bị cắt ở 53 bit.
- Số nguyên thì **chính xác tuyệt đối** cho tới `Number.MAX_SAFE_INTEGER` (2^53 − 1 = 9 007 199 254 740 991). Vì vậy cách chuẩn trong backend là lưu tiền bằng **số nguyên đơn vị nhỏ nhất** (cent, đồng), gọi là *minor units*.
- Làm tròn bằng `Math.round(x * 100) / 100` **không sửa** được lỗi, vì phép nhân `x * 100` đã sai trước khi làm tròn.
- Làm tròn là **quyết định nghiệp vụ** (làm tròn từng dòng hay làm tròn tổng, làm tròn lên hay làm tròn chẵn), phải ghi lại và có test.
- Không dùng `===` để so sánh kết quả của phép tính số thực.

## Lý thuyết chi tiết

**Vì sao `0.1` không chính xác?** Máy tính lưu số dạng `mantissa × 2^exponent`. Giống như `1/3 = 0.333…` không viết hữu hạn được trong hệ thập phân, `1/10` không viết hữu hạn được trong hệ nhị phân. Giá trị thật đang lưu của `0.1` là `0.1000000000000000055511151231257827…`.

**Sai số lan truyền theo phép tính.** Mỗi phép `+`, `*` làm tròn lại về 53 bit. Cộng nhiều số lẻ thì sai số cộng dồn, và kết quả phụ thuộc cả thứ tự cộng:

```ts
0.1 + 0.2 + 0.3;   // 0.6000000000000001
0.3 + 0.2 + 0.1;   // 0.6
```

**Các bẫy làm tròn thường gặp**

| Biểu thức | Kết quả | Vì sao |
|---|---|---|
| `0.035 * 100` | `3.5000000000000004` | `Math.round` ra 4, tình cờ "đúng" |
| `1.005 * 100` | `100.49999999999999` | `Math.round` ra 100, "sai" so với kỳ vọng 1.01 |
| `(1.005).toFixed(2)` | `"1.00"` | `toFixed` cũng làm trên giá trị nhị phân thật, trả về **string** |
| `Math.round(2.5)` / `Math.round(-2.5)` | `3` / `-2` | `Math.round` làm tròn nửa về phía +∞, không đối xứng quanh 0 |

Vì vậy một test biên "ra đúng" với một giá trị không chứng minh được thuật toán làm tròn đúng; hãy thử cả những giá trị như `1.005`, `1.015`, `2.675`.

**So sánh số thực.** Dùng sai số cho phép thay vì `===`:

```ts
Math.abs(a - b) < Number.EPSILON;   // chỉ đúng cho số cỡ 1; số lớn cần sai số tương đối
```

Trong Vitest dùng `toBeCloseTo(expected, digits)`. Lưu ý `digits = 2` nghĩa là sai số cho phép là `0.005`, khá lỏng; muốn chặt hơn thì tăng `digits`. Với tiền lưu số nguyên, dùng `toBe` được, vì không có sai số để bù.

**Bốn hướng biểu diễn tiền**

| Cách | Ưu | Nhược | Khi dùng |
|---|---|---|---|
| `number` thập phân + làm tròn | Đơn giản | Sai ở biên như `1.005`; phải làm tròn đúng chỗ mọi nơi | Bài học, ví dụ nhanh |
| `number` nguyên (minor units) | Chính xác, nhanh, JSON-friendly, không thêm dependency | Phải nhớ đơn vị; quy đổi khi hiển thị; vượt 2^53 thì sai | **Mặc định cho đa số backend** |
| `bigint` (minor units) | Không bị giới hạn 2^53 | Không trộn được với `number`; `JSON.stringify` ném lỗi | Số rất lớn (tiền mã hoá, tổng hợp tài chính) |
| Thư viện decimal (`decimal.js`, `big.js`, `dinero.js`) hoặc `string` thập phân | Hỗ trợ phần trăm, nhiều loại tiền, chế độ làm tròn | Thêm dependency, chậm hơn | Tính thuế, chiết khấu, tỷ giá phức tạp |

**Phép tính trên số nguyên vẫn cần làm tròn ở phép chia/phần trăm.** Cộng, trừ, nhân số nguyên cho kết quả nguyên chính xác. Chỉ khi chia hoặc nhân với phần trăm mới phát sinh phần lẻ, và lúc đó bạn chọn một lần, ở một chỗ:

```ts
// amountMinor: số nguyên (ví dụ cent). percent: ví dụ 8 nghĩa là 8%.
function percentOf(amountMinor: number, percent: number): number {
  return Math.round((amountMinor * percent) / 100);
}

percentOf(1999, 8);   // 160 (1999 × 8 = 15992 → chia 100 = 159.92 → làm tròn 160)
```

Tích `amountMinor * percent` vẫn là số nguyên khi `percent` nguyên, nên không có sai số nhị phân; phần lẻ chỉ còn ở bước chia cuối.

**Làm tròn từng dòng hay làm tròn tổng?** Hai cách cho kết quả khác nhau:

```ts
// 3 món, mỗi món 0.333 (giả sử đơn giá có 3 chữ số thập phân)
// từng dòng: 3 × round(0.333) = 3 × 0.33 = 0.99
// tổng:      round(3 × 0.333)  = round(0.999) = 1.00
```

Quy định thuế/kế toán của từng nước thường chỉ rõ cách nào, nên đó là câu hỏi cho business chứ không phải cho lập trình viên tự chọn.

**Tiền thật có nhiều hơn một con số**: đơn vị tiền tệ (`VND` không có số lẻ, `USD` có 2, `KWD` có 3), nên "minor unit" phụ thuộc loại tiền. `amount` mà không có `currency` là mô hình chưa đủ.

```ts
type Money = { readonly amountMinor: number; readonly currency: "USD" | "VND" };
```

## Tricks & tips thực tế

- **Đặt tên trường nói rõ đơn vị**: `priceMinor`, `amountCents`, `totalVnd`. Nếu chỉ gọi `price`, người đọc không biết là 1999 hay 19.99. Đây là loại lỗi gấp 100 lần rất đắt.
- **Chuyển đổi ở biên, không ở giữa**: API ngoài nhận/trả số thập phân hoặc chuỗi (`"19.99"`) thì chuyển sang minor units ngay khi vào (parse, kiểm tra `Number.isSafeInteger`), chuyển ngược khi hiển thị. Phần domain chỉ thấy số nguyên.
- **Kiểm tra `Number.isSafeInteger(x)`** sau khi parse hoặc sau phép tính lớn. Vượt 2^53 thì số sai im lặng, không có lỗi.
- **Database**: dùng `DECIMAL(p, s)` hoặc `BIGINT` (minor units), không dùng `FLOAT`/`DOUBLE` cho tiền. Lưu ý: driver Node (ví dụ `pg`) có thể trả `DECIMAL`/`BIGINT` dưới dạng **string**, chuyển đổi có chủ đích.
- **JSON**: chuẩn JSON không có số nguyên lớn riêng; số vượt 2^53 mất chính xác khi `JSON.parse`. `bigint` thì `JSON.stringify` ném `TypeError: Do not know how to serialize a BigInt`. Với số rất lớn, truyền dưới dạng chuỗi.
- **Hiển thị**: dùng `Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" })` thay vì tự ghép chuỗi. Định dạng chỉ để hiển thị, không để tính toán, và không `parseFloat` ngược lại từ chuỗi đã định dạng.
- **Một hàm làm tròn duy nhất** trong codebase (ví dụ `percentOf`), có test cho các biên `x.5`. Rải `Math.round` khắp nơi là nguồn của sai lệch một đồng khó truy vết.
- **Test cho tiền nên có các ca "xấu"**: `0.1 + 0.2`, `1.005`, `19.99 * 3` (ra `59.97`, nhưng `0.1 * 3` ra `0.30000000000000004`), số lượng lớn, số lượng 0. Nếu dùng số nguyên, test các ca chia lẻ ở bước làm tròn.
- **So với Laravel/PHP**: PHP cũng có float IEEE 754 và cùng lỗi này; người ta dùng `bcmath`, `brick/money`, hoặc cast `decimal:2` của Eloquent, và cột `DECIMAL`. Cách nghĩ giống hệt: tránh float cho tiền.
- **Khi nào "number thập phân + làm tròn" vẫn chấp nhận được**: bài học, prototype, hoặc số liệu không tài chính (điểm, thống kê). Khi tiền thật đi qua, chuyển sang minor units.

## Liên hệ bài tập

Câu hỏi 2 trong `EXERCISE.md`: tiền nên là `number` hay kiểu khác. Hãy thử `price: 1.005` với cách làm tròn của bạn và xem kết quả; đồng thời cân nhắc nếu `price` là số nguyên thì code và test thay đổi ra sao.

## Đọc thêm

- [Number.MAX_SAFE_INTEGER (MDN)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/MAX_SAFE_INTEGER)
- [Intl.NumberFormat (MDN)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat)
- [What Every Computer Scientist Should Know About Floating-Point Arithmetic](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html)

## Ghi chú của bạn

