# Backend OTP Verification Implementation Guide

## Overview

This document outlines the backend changes needed to support delivery OTP verification across the customer, rider, and shopkeeper apps.

## Database Schema Changes

### Add `delivery_otp` column to `customer_orders` table

```sql
-- Add delivery_otp column to customer_orders table
ALTER TABLE customer_orders 
ADD COLUMN delivery_otp VARCHAR(4);

-- Add index for faster OTP lookups
CREATE INDEX idx_customer_orders_delivery_otp ON customer_orders(delivery_otp);
```

## Backend Implementation

### 1. OTP Generation Function

Add to `backend/src/services/otp.service.ts` (create if doesn't exist):

```typescript
/**
 * Generate a 4-digit delivery OTP
 */
export function generateDeliveryOTP(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/**
 * Verify delivery OTP matches the stored value
 */
export async function verifyDeliveryOTP(orderId: string, otp: string): Promise<boolean> {
  const { data: order } = await supabaseAdmin
    .from('customer_orders')
    .select('delivery_otp')
    .eq('id', orderId)
    .single();
  
  if (!order || !order.delivery_otp) {
    return false;
  }
  
  return order.delivery_otp === otp;
}
```

### 2. Generate OTP When Order is Dispatched

Update the order status change logic to generate OTP when status becomes `in_transit`:

In `backend/src/controllers/deliveryPartner.controller.ts` or wherever order status is updated:

```typescript
import { generateDeliveryOTP } from '../services/otp.service.js';

// When order status changes to 'in_transit' or 'order_picked_up'
async function updateOrderStatus(orderId: string, newStatus: string) {
  const updateData: any = { status: newStatus };
  
  // Generate OTP when order is dispatched
  if (newStatus === 'in_transit' || newStatus === 'order_picked_up') {
    updateData.delivery_otp = generateDeliveryOTP();
  }
  
  const { error } = await supabaseAdmin
    .from('customer_orders')
    .update(updateData)
    .eq('id', orderId);
  
  if (error) throw error;
}
```

### 3. Add OTP Verification Endpoint

Add to `backend/src/controllers/deliveryPartner.controller.ts`:

```typescript
/**
 * Verify delivery OTP and mark order as delivered
 * POST /delivery-partner/orders/:orderId/verify-delivery
 * Body: { otp: string }
 */
async verifyDelivery(req: Request, res: Response) {
  try {
    const { orderId } = req.params;
    const { otp } = req.body;
    
    if (!otp || !/^\d{4}$/.test(otp)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid OTP format. Must be 4 digits.' 
      });
    }
    
    // Get order and verify rider is assigned
    const { data: order, error: orderError } = await supabaseAdmin
      .from('customer_orders')
      .select('id, status, delivery_otp')
      .eq('id', orderId)
      .single();
    
    if (orderError || !order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }
    
    // Verify rider is assigned to this order
    const { data: storeOrders } = await supabaseAdmin
      .from('store_orders')
      .select('delivery_partner_id')
      .eq('customer_order_id', orderId);
    
    const isAssigned = storeOrders?.some(
      (so: any) => so.delivery_partner_id === req.riderId
    );
    
    if (!isAssigned) {
      return res.status(403).json({ 
        success: false, 
        message: 'You are not assigned to this order' 
      });
    }
    
    // Verify OTP
    if (order.delivery_otp !== otp) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid OTP. Please check the PIN from customer.' 
      });
    }
    
    // Mark order as delivered
    const { error: updateError } = await supabaseAdmin
      .from('customer_orders')
      .update({ 
        status: 'order_delivered',
        delivered_at: new Date().toISOString()
      })
      .eq('id', orderId);
    
    if (updateError) {
      console.error('Error updating order status:', updateError);
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to update order status' 
      });
    }
    
    // Update store orders status
    await supabaseAdmin
      .from('store_orders')
      .update({ status: 'order_delivered' })
      .eq('customer_order_id', orderId);
    
    // Send notification to customer
    try {
      await notificationService.sendOrderDelivered(orderId);
    } catch (notifError) {
      console.error('Failed to send delivery notification:', notifError);
      // Don't fail the request if notification fails
    }
    
    return res.json({ 
      success: true, 
      message: 'Order delivered successfully' 
    });
    
  } catch (error) {
    console.error('Error verifying delivery:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
}
```

### 4. Update Routes

Add to `backend/src/routes/deliveryPartner.routes.ts`:

```typescript
// Add this line after the existing routes
router.post('/orders/:orderId/verify-delivery', ctrl.verifyDelivery.bind(ctrl));
```

The updated routes section should look like:

```typescript
// Active order management
router.get('/orders',                                             ctrl.getOrders.bind(ctrl));
router.get('/orders/:orderId',                                    ctrl.getOrderById.bind(ctrl));
router.get('/orders/:orderId/pickup-sequence',                    ctrl.getPickupSequence.bind(ctrl));
router.post('/orders/:orderId/stores/:allocationId/verify-code', ctrl.verifyPickupCode.bind(ctrl));
router.post('/orders/:orderId/accept',                            ctrl.acceptOrder.bind(ctrl));
router.post('/orders/:orderId/reject',                            ctrl.rejectOrder.bind(ctrl));
router.post('/orders/:orderId/picked-up',                         ctrl.markPickedUp.bind(ctrl));
router.post('/orders/:orderId/verify-delivery',                   ctrl.verifyDelivery.bind(ctrl)); // NEW
router.post('/orders/:orderId/delivered',                         ctrl.markDelivered.bind(ctrl));
```

### 5. Include OTP in Tracking Response

Update `backend/src/controllers/tracking.controller.ts`:

In the `getOrderTrackingFull` method, ensure `delivery_otp` is included in the select:

```typescript
async getOrderTrackingFull(req: Request, res: Response) {
  try {
    const { orderId } = req.params;
    
    const { data: order, error } = await supabaseAdmin
      .from('customer_orders')
      .select(`
        id,
        order_code,
        status,
        placed_at,
        created_at,
        delivery_address,
        total_amount,
        payment_method,
        payment_status,
        delivery_latitude,
        delivery_longitude,
        estimated_delivery_time,
        delivery_otp
      `)
      .eq('id', orderId)
      .single();
    
    // ... rest of the method
  }
}
```

## Testing

### 1. Test OTP Generation

```bash
# Place an order and update status to in_transit
curl -X PATCH http://localhost:3000/api/orders/{orderId}/status \
  -H "Content-Type: application/json" \
  -d '{"status": "in_transit"}'

# Verify OTP is generated in database
SELECT id, order_code, status, delivery_otp FROM customer_orders WHERE id = '{orderId}';
```

### 2. Test OTP Verification

```bash
# Verify delivery with correct OTP
curl -X POST http://localhost:3000/api/delivery-partner/orders/{orderId}/verify-delivery \
  -H "Authorization: Bearer {rider_token}" \
  -H "Content-Type: application/json" \
  -d '{"otp": "1234"}'

# Expected response:
# {"success": true, "message": "Order delivered successfully"}
```

### 3. Test OTP in Tracking Response

```bash
# Get tracking data
curl http://localhost:3000/api/tracking/orders/{orderId}/full

# Verify response includes delivery_otp field
```

## Security Considerations

1. **OTP Expiry**: Consider adding an expiry time for OTPs (e.g., 24 hours)
2. **Rate Limiting**: Implement rate limiting on OTP verification to prevent brute force
3. **Audit Log**: Log all OTP verification attempts for security auditing
4. **Clear OTP**: Clear the OTP after successful delivery

### Optional: Add OTP Expiry

```typescript
// Add to customer_orders table
ALTER TABLE customer_orders 
ADD COLUMN delivery_otp_expires_at TIMESTAMP;

// Update OTP generation
updateData.delivery_otp = generateDeliveryOTP();
updateData.delivery_otp_expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

// Check expiry in verification
if (new Date(order.delivery_otp_expires_at) < new Date()) {
  return res.status(400).json({ 
    success: false, 
    message: 'OTP has expired' 
  });
}
```

## Deployment Checklist

- [ ] Run database migration to add `delivery_otp` column
- [ ] Create `otp.service.ts` with generation and verification functions
- [ ] Add `verifyDelivery` method to `DeliveryPartnerController`
- [ ] Update `deliveryPartner.routes.ts` to include new endpoint
- [ ] Update order status change logic to generate OTP
- [ ] Update `tracking.controller.ts` to include OTP in response
- [ ] Test OTP generation on status change
- [ ] Test OTP verification endpoint
- [ ] Test OTP display in customer app
- [ ] Test OTP verification in rider app
- [ ] Deploy to production

## Related Files

### Customer App
- `lib/trackingService.ts` - Fetches OTP from backend
- `app/order/track/[id].tsx` - Displays OTP to customer

### Rider App
- `app/delivery/[orderId].tsx` - OTP verification modal

### Backend
- `backend/src/controllers/deliveryPartner.controller.ts` - OTP verification logic
- `backend/src/routes/deliveryPartner.routes.ts` - OTP verification endpoint
- `backend/src/controllers/tracking.controller.ts` - Include OTP in tracking response
- `backend/src/services/otp.service.ts` - OTP generation and verification (NEW)

## Support

For issues or questions about this implementation:
1. Check the error logs in the backend console
2. Verify the database schema changes were applied
3. Test the endpoints using curl or Postman
4. Check the rider app and customer app are using the correct API endpoints

---

**Created**: May 4, 2026
**Status**: Ready for Implementation
