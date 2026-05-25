export interface Order {
  orderId: string;
  type: 'LIMIT' | 'MARKET' | 'CANCEL';
  side?: 'buy' | 'sell';
  price?: number;
  quantity?: number;
  cancelOrderId?: string;
}

const recentOrderIds: string[] = [];
const RING_BUFFER_CAP = 100;

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function generateOrderId(): string {
  return `ord-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function generateOrder(midPrice = 1000): Order {
  const roll = Math.random();
  const orderId = generateOrderId();

  if (roll < 0.60) {
    // LIMIT — 60%
    const side = Math.random() < 0.5 ? 'buy' : 'sell';
    const price = parseFloat((midPrice * randomBetween(0.95, 1.05)).toFixed(2));
    const quantity = Math.floor(randomBetween(1, 100));
    recentOrderIds.push(orderId);
    if (recentOrderIds.length > RING_BUFFER_CAP) recentOrderIds.shift();
    return { orderId, type: 'LIMIT', side, price, quantity };

  } else if (roll < 0.85) {
    // MARKET — 25%
    const side = Math.random() < 0.5 ? 'buy' : 'sell';
    const quantity = Math.floor(randomBetween(1, 50));
    recentOrderIds.push(orderId);
    if (recentOrderIds.length > RING_BUFFER_CAP) recentOrderIds.shift();
    return { orderId, type: 'MARKET', side, quantity };

  } else {
    // CANCEL — 15%
    const cancelOrderId =
      recentOrderIds.length > 0
        ? recentOrderIds[Math.floor(Math.random() * recentOrderIds.length)]
        : generateOrderId(); // fallback if buffer is empty
    return { orderId, type: 'CANCEL', cancelOrderId };
  }
}
