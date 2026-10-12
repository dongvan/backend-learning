import {describe, it, expect} from "vitest";
import calculateTotalOrder from "./order";

describe('01 type system', () => {
    it('Kiểm tra order trống', () => {
        const mockOrder1 = null;
        expect(calculateTotalOrder(mockOrder1)).toBe(0);

        const mockOrder2 = 123;
        expect(calculateTotalOrder(mockOrder2)).toBe(0);
    });


    it('Kiểm tra order item trống', () => {
        const mockOrder = {id: 100001, items: null};
        expect(calculateTotalOrder(mockOrder)).toBe(0);
    });

    it('Kiểm tra tổng giá trị trả về', () => {
        const mockOrder = {
            id: 100001,
            items: [
                {
                    id: 1,
                    productId: 1,
                    qty: 2,
                    price: 50
                },
                {
                    id: 2,
                    productId: 2,
                    qty: 3,
                    price: 10
                }
            ]
        };
        expect(calculateTotalOrder(mockOrder)).toBe(130);
    });
})