import { Order } from './orderService';

export interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: string;
  orderNumber: string;
  orderId: string;
  
  // Business details
  businessName: string;
  businessAddress: string;
  businessGSTIN: string;
  businessPhone: string;
  businessEmail: string;
  
  // Customer details
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerAddress: string;
  customerGSTIN?: string;
  
  // Order details
  items: InvoiceItem[];
  subtotal: number;
  deliveryFee: number;
  taxAmount: number;
  taxRate: number;
  discount: number;
  total: number;
  
  // Payment details
  paymentMethod: string;
  paymentStatus: string;
  
  // Additional info
  notes?: string;
  termsAndConditions: string[];
}

export interface InvoiceItem {
  name: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}

/**
 * Generate invoice number from order
 */
export function generateInvoiceNumber(order: Order): string {
  const date = new Date(order.created_at);
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const orderNum = order.order_number?.replace('NAN-', '') || order.id.slice(0, 8).toUpperCase();
  return `INV-${year}${month}-${orderNum}`;
}

/**
 * Calculate GST breakdown (CGST + SGST for intra-state, IGST for inter-state)
 */
export function calculateGST(amount: number, gstRate: number = 5): {
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
} {
  const gstAmount = (amount * gstRate) / 100;
  // For simplicity, assuming intra-state (CGST + SGST)
  // In production, you'd check state codes from GSTIN
  return {
    cgst: gstAmount / 2,
    sgst: gstAmount / 2,
    igst: 0,
    total: gstAmount,
  };
}

/**
 * Convert order to invoice data
 */
export function orderToInvoice(
  order: Order,
  businessInfo?: {
    name?: string;
    address?: string;
    gstin?: string;
    phone?: string;
    email?: string;
  },
  customerInfo?: {
    name?: string;
    phone?: string;
    email?: string;
    gstin?: string;
  }
): InvoiceData {
  const invoiceNumber = generateInvoiceNumber(order);
  const invoiceDate = order.created_at;
  
  // Default business info (replace with actual business details)
  const business = {
    name: businessInfo?.name || 'Near & Now',
    address: businessInfo?.address || 'Business Address Line 1\nCity, State - PIN',
    gstin: businessInfo?.gstin || '29XXXXXXXXXXXXX',
    phone: businessInfo?.phone || '+91-XXXXXXXXXX',
    email: businessInfo?.email || 'support@nearandnow.com',
  };
  
  // Extract customer info from order
  const customer = {
    name: customerInfo?.name || 'Customer',
    phone: customerInfo?.phone || '',
    email: customerInfo?.email,
    gstin: customerInfo?.gstin,
  };
  
  // Calculate tax (assuming 5% GST on grocery items)
  const taxRate = 5;
  const subtotal = order.subtotal || order.order_total - (order.delivery_fee || 0);
  const taxableAmount = subtotal;
  const gst = calculateGST(taxableAmount, taxRate);
  
  // Process items
  const items: InvoiceItem[] = (order.items || []).map((item) => {
    const itemSubtotal = item.price * item.quantity;
    const itemGST = calculateGST(itemSubtotal, taxRate);
    return {
      name: item.name,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice: item.price,
      taxRate,
      taxAmount: itemGST.total,
      total: itemSubtotal + itemGST.total,
    };
  });
  
  // Terms and conditions
  const termsAndConditions = [
    'Goods once sold will not be taken back or exchanged.',
    'All disputes are subject to local jurisdiction only.',
    'Delivery charges are non-refundable.',
    'Please check items at the time of delivery.',
    'For any queries, contact customer support.',
  ];
  
  return {
    invoiceNumber,
    invoiceDate,
    orderNumber: order.order_number || order.id.slice(0, 8).toUpperCase(),
    orderId: order.id,
    
    businessName: business.name,
    businessAddress: business.address,
    businessGSTIN: business.gstin,
    businessPhone: business.phone,
    businessEmail: business.email,
    
    customerName: customer.name,
    customerPhone: customer.phone,
    customerEmail: customer.email,
    customerAddress: order.delivery_address || 'N/A',
    customerGSTIN: customer.gstin,
    
    items,
    subtotal,
    deliveryFee: order.delivery_fee || 0,
    taxAmount: gst.total,
    taxRate,
    discount: 0,
    total: order.order_total,
    
    paymentMethod: order.payment_method === 'cod' ? 'Cash on Delivery' : 'Online Payment',
    paymentStatus: order.payment_status === 'paid' ? 'Paid' : 'Pending',
    
    termsAndConditions,
  };
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number): string {
  return `₹${amount.toFixed(2)}`;
}

/**
 * Format date for invoice
 */
export function formatInvoiceDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
