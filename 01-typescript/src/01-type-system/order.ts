export interface OrderItem {
    productId: number;
    qty: number;
    price: number;
}

export interface Order {
    id: number;
    items: readonly OrderItem[];
}


export function calculateOrderTotal(order: Order): number {
    // nên để trả về tường minh để nếu trả về chuỗi hoặc thiếu return ,ts báo lỗi ngay
    return order.items
        .reduce((t, item) => t + Math.round(item.price * item.qty * 100) / 100, 0);
}