# Complete Integration Guide: Customer, Rider, Shopkeeper Apps + Backend

## Overview

This guide explains how to connect all four components of the Near & Now ecosystem:
1. **Backend** (`D:\near-now\near-and-now`)
2. **Customer App** (`D:\near-now\nearandnowcustomerapp`)
3. **Rider App** (`D:\near-now\NAT_Near-Now_Rider-`)
4. **Shopkeeper App** (`D:\near-now\near-now-store_owner`)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Shared Backend API                        │
│         https://near-and-now-frontend.vercel.app            │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Auth API   │  │  Orders API  │  │ Tracking API │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Delivery API │  │Shopkeeper API│  │  Payment API │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────▼────────┐  ┌───────▼────────┐  ┌──────▼─────────┐
│  Customer App  │  │   Rider App    │  │ Shopkeeper App │
│   (React      │  │  (React        │  │  (React        │
│    Native)    │  │   Native)      │  │   Native)      │
└───────────────┘  └────────────────┘  └────────────────┘
```

## Backend Setup (`D:\near-now\near-and-now`)

### 1. Environment Configuration

Ensure `.env` file in backend has:

```env
# Database
SUPABASE_URL=https://bfgqnsyriiuejvlqaylu.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Server
PORT=3000
NODE_ENV=production

# API Keys
RAZORPAY_KEY_ID=your_razorpay_key
RAZORPAY_KEY_SECRET=your_razorpay_secret
GOOGLE_MAPS_API_KEY=your_google_maps_key

# Frontend URL (for CORS)
FRONTEND_URL=https://near-and-now-frontend.vercel.app
```

### 2. Start Backend Server

```bash
cd D:\near-now\near-and-now\backend
npm install
npm run dev
```

Backend should be running on `http://localhost:3000` or deployed to Vercel.

### 3. Required Backend Endpoints

Verify these endpoints exist and are working:

#### Authentication
- `POST /api/auth/send-otp` - Send OTP to phone
- `POST /api/auth/verify-otp` - Verify OTP and create session
- `POST /api/auth/logout` - Logout user

#### Customer Orders
- `POST /api/orders` - Create new order
- `GET /api/orders` - Get user's orders
- `GET /api/orders/:id` - Get order details
- `PATCH /api/orders/:id/cancel` - Cancel order

#### Tracking (Public - No Auth Required)
- `GET /api/tracking/orders/:id/full` - Get full tracking data with OTP
- `GET /api/tracking/orders/:id/driver-locations` - Get driver locations

#### Delivery Partner
- `GET /api/delivery-partner/orders` - Get assigned orders
- `GET /api/delivery-partner/orders/:id/pickup-sequence` - Get pickup sequence
- `POST /api/delivery-partner/orders/:id/stores/:allocationId/verify-code` - Verify pickup code
- `POST /api/delivery-partner/orders/:id/verify-delivery` - **NEW** Verify OTP and deliver
- `POST /api/delivery-partner/orders/:id/delivered` - Mark delivered (fallback)

#### Store Owner
- `GET /api/store-owner/orders` - Get store orders
- `POST /api/store-owner/orders/:id/accept` - Accept order
- `POST /api/store-owner/orders/:id/ready` - Mark ready for pickup
- `PATCH /api/store-owner/store/status` - Update store online/offline status

## Customer App Setup (`D:\near-now\nearandnowcustomerapp`)

### 1. Environment Configuration

Create/update `.env` file:

```env
EXPO_PUBLIC_API_BASE_URL=https://near-and-now-frontend.vercel.app
EXPO_PUBLIC_SUPABASE_URL=https://bfgqnsyriiuejvlqaylu.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_key
EXPO_PUBLIC_RAZORPAY_KEY_ID=your_razorpay_key
```

### 2. Key Features Implemented

✅ **Order Confirmation Page** (`app/order/confirmation/[id].tsx`)
- 40-second add-more window with countdown timer
- Quick-add product suggestions
- Seamless navigation to tracking

✅ **Order Tracking Page** (`app/order/track/[id].tsx`)
- Real-time order status updates
- Live driver location on map
- **4-digit OTP display** when order is dispatched
- Fetches OTP from backend via `/api/tracking/orders/:id/full`

✅ **Checkout Flow** (`app/support/checkout.tsx`)
- Razorpay payment integration
- COD support
- Navigates to confirmation page after order placement

### 3. API Integration

The customer app uses `lib/apiClient.ts` which automatically:
- Injects auth token from AsyncStorage
- Handles timeouts (30s)
- Provides user-friendly error messages

### 4. Start Customer App

```bash
cd D:\near-now\nearandnowcustomerapp
npm install
npx expo start
```

## Rider App Setup (`D:\near-now\NAT_Near-Now_Rider-`)

### 1. Environment Configuration

Create/update `.env` file:

```env
EXPO_PUBLIC_API_BASE_URL=https://near-and-now-frontend.vercel.app
EXPO_PUBLIC_SUPABASE_URL=https://bfgqnsyriiuejvlqaylu.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_key
```

### 2. Key Features Implemented

✅ **Delivery Screen** (`app/delivery/[orderId].tsx`)
- Pickup sequence with store stops
- 4-digit pickup code verification
- **OTP verification modal** for delivery confirmation
- Calls `POST /delivery-partner/orders/:id/verify-delivery` with OTP
- Fallback: "Customer unavailable? Mark as delivered"

✅ **Orders Screen** (`app/(tabs)/orders.tsx`)
- List of assigned orders
- Navigation to delivery screen

✅ **Session Management** (`session.ts`)
- In-memory session caching
- Automatic token refresh
- Session expiry handling

### 3. API Integration

The rider app uses `constants/api.ts` which provides:
- Automatic retry with exponential backoff
- Session expiry detection (401 → logout)
- Bearer token authentication

### 4. Start Rider App

```bash
cd D:\near-now\NAT_Near-Now_Rider-
npm install
npx expo start
```

## Shopkeeper App Setup (`D:\near-now\near-now-store_owner`)

### 1. Environment Configuration

Create/update `.env` file:

```env
EXPO_PUBLIC_API_BASE_URL=https://near-and-now-frontend.vercel.app
EXPO_PUBLIC_SUPABASE_URL=https://bfgqnsyriiuejvlqaylu.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_key
```

### 2. Key Features

✅ **Home Tab** (`app/(tabs)/home.tsx`)
- Store online/offline toggle
- Product inventory management
- Real-time product updates via Supabase

✅ **Orders Management**
- Accept/reject incoming orders
- Mark orders ready for pickup
- Generate pickup codes for riders

✅ **Session Management** (`lib/session.ts`)
- In-memory session caching
- Role-based access control

### 3. API Integration

The shopkeeper app uses `lib/api-client.ts` which provides:
- Centralized error handling
- Request/response interceptors
- Timeout support (30s)

### 4. Start Shopkeeper App

```bash
cd D:\near-now\near-now-store_owner
npm install
npx expo start
```

## Complete Order Flow with OTP Verification

### Step-by-Step Flow

```
1. CUSTOMER APP
   └─> Places order via checkout
   └─> Navigates to /order/confirmation/:id
   └─> 40-second add-more window
   └─> Navigates to /order/track/:id

2. BACKEND
   └─> Creates order in database
   └─> Notifies shopkeeper via push notification

3. SHOPKEEPER APP
   └─> Receives new order notification
   └─> Reviews order details
   └─> Accepts order
   └─> Prepares items
   └─> Marks order as "ready_for_pickup"
   └─> Generates 4-digit pickup code

4. BACKEND
   └─> Assigns delivery partner
   └─> Updates status to "delivery_partner_assigned"
   └─> Notifies rider via push notification

5. RIDER APP
   └─> Receives order assignment
   └─> Navigates to store
   └─> Enters pickup code from shopkeeper
   └─> Backend verifies code
   └─> Marks as "order_picked_up"
   └─> Status changes to "in_transit"

6. BACKEND (OTP Generation)
   └─> Detects status change to "in_transit"
   └─> Generates 4-digit delivery OTP
   └─> Stores in customer_orders.delivery_otp

7. CUSTOMER APP (OTP Display)
   └─> Tracking page polls /api/tracking/orders/:id/full
   └─> Receives order with delivery_otp field
   └─> Displays OTP card: "Show this PIN to delivery partner"

8. RIDER APP (OTP Verification)
   └─> Arrives at customer location
   └─> Taps "Verify & Deliver" button
   └─> OTP verification modal opens
   └─> Enters 4-digit PIN from customer
   └─> Calls POST /delivery-partner/orders/:id/verify-delivery

9. BACKEND (OTP Validation)
   └─> Receives OTP from rider
   └─> Compares with stored delivery_otp
   └─> If match: Updates status to "order_delivered"
   └─> If mismatch: Returns error "Invalid PIN"
   └─> Sends delivery notification to customer

10. ALL APPS (Real-time Sync)
    └─> Supabase real-time updates
    └─> Customer sees "Delivered" status
    └─> Rider sees "Completed" status
    └─> Shopkeeper sees order completed
```

## Database Schema Requirements

### customer_orders table

```sql
CREATE TABLE customer_orders (
  id UUID PRIMARY KEY,
  order_code VARCHAR(20) UNIQUE,
  user_id UUID REFERENCES app_users(id),
  status VARCHAR(50),
  delivery_address TEXT,
  total_amount DECIMAL(10,2),
  payment_method VARCHAR(20),
  payment_status VARCHAR(20),
  delivery_otp VARCHAR(4),  -- NEW: 4-digit delivery PIN
  delivery_otp_expires_at TIMESTAMP,  -- Optional: OTP expiry
  placed_at TIMESTAMP,
  delivered_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for faster OTP lookups
CREATE INDEX idx_customer_orders_delivery_otp ON customer_orders(delivery_otp);
```

## Testing the Integration

### 1. Test Customer Order Flow

```bash
# Customer App
1. Login with customer account
2. Browse products and add to cart
3. Proceed to checkout
4. Place order (COD or online payment)
5. Verify navigation to confirmation page
6. Wait for 40-second timer
7. Navigate to tracking page
8. Verify order status updates
```

### 2. Test Shopkeeper Flow

```bash
# Shopkeeper App
1. Login with store owner account
2. Verify new order notification appears
3. Accept the order
4. Mark items as prepared
5. Mark order as "ready for pickup"
6. Generate pickup code
7. Share code with rider
```

### 3. Test Rider Flow

```bash
# Rider App
1. Login with delivery partner account
2. Verify order assignment notification
3. Navigate to delivery screen
4. Go to store location
5. Enter pickup code from shopkeeper
6. Verify pickup confirmation
7. Navigate to customer location
8. Tap "Verify & Deliver"
9. Enter OTP from customer
10. Verify delivery confirmation
```

### 4. Test OTP Verification

```bash
# Test correct OTP
1. Customer sees OTP: "1234"
2. Rider enters: "1234"
3. Expected: Order marked as delivered

# Test incorrect OTP
1. Customer sees OTP: "1234"
2. Rider enters: "5678"
3. Expected: Error "Invalid PIN — please try again"

# Test OTP display
1. Check customer tracking page when status = "in_transit"
2. Verify OTP card is visible
3. Verify OTP is 4 digits
```

## Troubleshooting

### Issue: Apps can't connect to backend

**Solution:**
1. Verify backend is running: `curl http://localhost:3000/health`
2. Check `.env` files in all apps have correct `EXPO_PUBLIC_API_BASE_URL`
3. Ensure CORS is configured in backend to allow app origins

### Issue: OTP not displaying in customer app

**Solution:**
1. Check order status is `in_transit` or `order_picked_up`
2. Verify backend includes `delivery_otp` in tracking response
3. Check browser/app console for API errors
4. Test endpoint: `curl http://localhost:3000/api/tracking/orders/:id/full`

### Issue: OTP verification fails in rider app

**Solution:**
1. Verify OTP was generated when status changed to `in_transit`
2. Check database: `SELECT delivery_otp FROM customer_orders WHERE id = ':id'`
3. Ensure rider is assigned to the order
4. Check backend logs for verification errors

### Issue: Real-time updates not working

**Solution:**
1. Verify Supabase real-time is enabled
2. Check Supabase connection in all apps
3. Ensure `EXPO_PUBLIC_SUPABASE_ANON_KEY` is correct
4. Test Supabase connection: Check network tab for websocket connections

## Security Checklist

- [ ] All API endpoints use proper authentication
- [ ] OTP verification requires rider to be assigned to order
- [ ] Rate limiting on OTP verification endpoint
- [ ] OTP expires after 24 hours (optional)
- [ ] Session tokens are stored securely (AsyncStorage)
- [ ] HTTPS used for all API calls in production
- [ ] Supabase RLS policies are properly configured
- [ ] Sensitive data (API keys) not committed to git

## Deployment Checklist

### Backend
- [ ] Database migration for `delivery_otp` column
- [ ] Environment variables configured in Vercel
- [ ] OTP verification endpoint implemented
- [ ] Tracking endpoint includes OTP in response
- [ ] Backend deployed and accessible

### Customer App
- [ ] `.env` file configured with production URLs
- [ ] Build APK/IPA for testing
- [ ] Test order placement flow
- [ ] Test OTP display on tracking page
- [ ] Submit to app stores

### Rider App
- [ ] `.env` file configured with production URLs
- [ ] Build APK/IPA for testing
- [ ] Test OTP verification modal
- [ ] Test delivery confirmation
- [ ] Submit to app stores

### Shopkeeper App
- [ ] `.env` file configured with production URLs
- [ ] Build APK/IPA for testing
- [ ] Test order acceptance flow
- [ ] Test pickup code generation
- [ ] Submit to app stores

## Monitoring & Maintenance

### Key Metrics to Monitor

1. **Order Completion Rate**
   - Track orders from placement to delivery
   - Identify bottlenecks in the flow

2. **OTP Verification Success Rate**
   - Monitor successful vs failed OTP verifications
   - Alert on high failure rates

3. **API Response Times**
   - Track latency for critical endpoints
   - Optimize slow queries

4. **Error Rates**
   - Monitor 4xx and 5xx errors
   - Set up alerts for spikes

### Logs to Keep

- Order status changes with timestamps
- OTP generation and verification attempts
- API request/response logs
- Session creation and expiry events

## Support & Documentation

- **Backend API Docs**: `D:\near-now\near-and-now\backend\README.md`
- **Customer App Docs**: `D:\near-now\nearandnowcustomerapp\README.md`
- **Routing Sync Guide**: `D:\near-now\ROUTING_SYNC_GUIDE.md`
- **Backend OTP Implementation**: `D:\near-now\nearandnowcustomerapp\BACKEND_OTP_IMPLEMENTATION.md`

---

**Last Updated**: May 4, 2026
**Version**: 2.0.0
**Status**: Ready for Production
