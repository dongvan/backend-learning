type OrderStatus = 'pending' | 'processing' | 'complete' | 'removed';

type OrderItem = {
    id: number;
    productId: number;
    qty: number;
    price: number;
}

type Order = {
    id: number;
    items: OrderItem[] | []
}


export default function calculateTotalOrder(order: Order) {
    if (!order || !Object.keys(order).length || !Array.isArray(order.items) || order.items.length === 0) {
        return 0;
    }

    const items: OrderItem[] = order.items;
    return items.reduce((t: number = 0, item: OrderItem) => t + item.price * item.qty, 0);
}