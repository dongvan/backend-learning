import {describe, it, expect} from "vitest";
import {Order, calculateOrderTotal} from "./order";

describe('01 type system', () => {
    it('Trường hợp thường', () => {
        const mockOrder: Order = {
            id: 100001,
            items: [
                {
                    productId: 1,
                    qty: 2,
                    price: 50
                },
                {
                    productId: 2,
                    qty: 1,
                    price: 100
                }
            ]
        };
        expect(calculateOrderTotal(mockOrder)).toBe(200);
    });

    it('Đơn rỗng', () => {
        const mockOrder: Order = {id: 100001, items: []};
        expect(calculateOrderTotal(mockOrder)).toBe(0);
    });

    it('Các giá trị biên với qty 0', () => {
        const mockOrder = {
            id: 100001,
            items: [
                {
                    productId: 1,
                    qty: 0,
                    price: 50
                }
            ]
        };
        expect(calculateOrderTotal(mockOrder)).toBe(0);
    });

    it('Các giá trị biên với qty lớn', () => {
        const mockOrder = {
            id: 100001,
            items: [
                {
                    productId: 1,
                    qty: 100000,
                    price: 50
                }
            ]
        };
        expect(calculateOrderTotal(mockOrder)).toBe(5000000);
    });

    it('Các giá trị biên với qty lẻ', () => {
        const mockOrder = {
            id: 100001,
            items: [
                {
                    productId: 1,
                    qty: 0.1,
                    price: 0.2
                }
            ]
        };
        expect(calculateOrderTotal(mockOrder)).toBeCloseTo(0.02, 2);
    });

    it('Các giá trị biên với giá bằng 0', () => {
        const mockOrder = {
            id: 100001,
            items: [
                {
                    productId: 1,
                    qty: 1,
                    price: 0
                }
            ]
        };
        expect(calculateOrderTotal(mockOrder)).toBe(0);
    });

    it('Các giá trị biên với qty và số lượng lẻ', () => {
        const mockOrder = {
            id: 100001,
            items: [
                {
                    productId: 1,
                    qty: 1,
                    price: 0.035
                },
                {
                    productId: 2,
                    qty: 3,
                    price: 0.5
                },
                {
                    productId: 2,
                    qty: 0.2,
                    price: 0.5
                }
            ]
        };
        expect(calculateOrderTotal(mockOrder)).toBeCloseTo(1.64, 2);
    });
})