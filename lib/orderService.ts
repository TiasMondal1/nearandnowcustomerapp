import { apiFetch } from './apiClient';

export interface OrderItem {
  product_id?: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  unit?: string;
}

export interface Order {
  id: string;
  order_number?: string;
  order_status: string;
  payment_status: string;
  payment_method: string;
  order_total: number;
  subtotal?: number;
  delivery_fee?: number;
  items?: OrderItem[];
  items_count?: number;
  delivery_address?: string;
  created_at: string;
}

export interface CreateOrderInput {
  user_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  payment_method: 'upi' | 'cod';
  payment_status: 'pending' | 'paid';
  subtotal: number;
  delivery_fee: number;
  order_total: number;
  delivery_address: string;
  delivery_latitude: number;
  delivery_longitude: number;
  items: OrderItem[];
}

// POST /api/orders — handled by Railway backend (service role key stays server-side)
export async function createOrder(input: CreateOrderInput): Promise<Order> {
  return apiFetch<Order>('/api/orders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// GET /api/orders — handled by Railway backend (reads with service role server-side)
export async function getUserOrders(userId: string): Promise<Order[]> {
  if (!userId) return [];
  try {
    const orders = await apiFetch<Order[]>(`/api/orders?userId=${userId}`);
    return Array.isArray(orders) ? orders : [];
  } catch {
    return [];
  }
}
