# Railway Backend — Required API Endpoints

The customer app no longer uses the Supabase service role key directly.
All privileged database operations now go through the Railway backend.
The following endpoints **must be implemented** on the Railway server.

---

## Authentication (Already Implemented)
- `POST /api/auth/send-otp`
- `POST /api/auth/verify-otp` → returns `{ user, customer, token }`

All protected endpoints below expect:
```
Authorization: Bearer <token>   ← token returned by verify-otp
```

---

## 1. GET /api/orders

Fetch all orders for the authenticated user.

**Query params:** `?userId=<uuid>` *(also validate against the Bearer token)*

**Response:**
```json
[
  {
    "id": "uuid",
    "order_number": "NN20260307001",
    "order_status": "pending_at_store",
    "payment_status": "pending",
    "payment_method": "cod",
    "order_total": 250.00,
    "subtotal": 220.00,
    "delivery_fee": 30.00,
    "delivery_address": "123 Main St, Mumbai",
    "created_at": "2026-03-07T10:00:00Z",
    "items": [
      {
        "product_id": "uuid",
        "name": "Milk 1L",
        "price": 60,
        "quantity": 2,
        "unit": "litre",
        "image": "https://..."
      }
    ]
  }
]
```

**Supabase query logic (use service role key server-side):**
```js
const { data: orders } = await supabaseAdmin
  .from('customer_orders')
  .select('id, order_code, status, payment_status, payment_method, subtotal_amount, delivery_fee, total_amount, delivery_address, placed_at, created_at')
  .eq('customer_id', userId)
  .order('placed_at', { ascending: false });

// Then join store_orders → order_items for each order
// Return shaped as the Order interface above
```

**Status values** the app recognises:
| DB value | Display |
|---|---|
| `pending_at_store` | Pending |
| `accepted_by_store` | Accepted |
| `awaiting_rider` | Finding Rider |
| `rider_assigned` | Rider Assigned |
| `out_for_delivery` | On the Way |
| `delivered` | Delivered |
| `cancelled` | Cancelled |
| `rejected_by_store` | Rejected |

---

## 2. POST /api/orders

Create a new order. Contains all the store-assignment logic previously in the client.

**Request body:**
```json
{
  "user_id": "uuid",
  "customer_name": "John Doe",
  "customer_phone": "+919876543210",
  "customer_email": "john@example.com",
  "payment_method": "cod",
  "payment_status": "pending",
  "subtotal": 220.00,
  "delivery_fee": 30.00,
  "order_total": 250.00,
  "delivery_address": "123 Main St, Mumbai",
  "delivery_latitude": 19.0760,
  "delivery_longitude": 72.8777,
  "items": [
    {
      "product_id": "master-product-uuid",
      "name": "Milk 1L",
      "price": 60,
      "quantity": 2,
      "unit": "litre",
      "image": "https://..."
    }
  ]
}
```

**Response:** Same shape as a single Order object from GET /api/orders

**Server-side logic to implement:**
1. Call `get_nearby_store_ids(cust_lat, cust_lng, 50)` RPC
2. Call `generate_next_order_number(prefix)` RPC
3. Match products to stores using `master_product_id`
4. Assign items to best store (greedy algorithm)
5. Insert into `customer_orders`, `store_orders`, `order_items`, `order_status_history`

---

## 3. POST /api/push-token

Register a device push token for sending order notifications.

**Request body:**
```json
{
  "userId": "uuid",
  "token": "ExponentPushToken[xxxx]",
  "platform": "android"
}
```

**Response:** `{ "success": true }`

**Server action:** Upsert token into a `push_tokens` table:
```sql
CREATE TABLE push_tokens (
  user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id)
);
```

---

## 4. Supabase Realtime Setup

For instant order status updates in the customer app (without polling):

1. In Supabase Dashboard → **Database → Replication** → enable `customer_orders` table
2. Add a SELECT policy so the realtime channel can send updates:

```sql
-- Allow the anon role to receive realtime updates for customer_orders
-- (The filter `id=eq.<orderId>` in the client limits what they see)
ALTER TABLE customer_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers_read_own_orders"
  ON customer_orders FOR SELECT
  TO anon
  USING (true);  -- Filtered client-side by order ID in the subscription
```

---

## 5. Google Maps API Key Restrictions

In [Google Cloud Console](https://console.cloud.google.com/):
- **Android app restriction:** Add SHA-1 fingerprint + package `com.nearandnow.customer`
- **iOS app restriction:** Add bundle ID `com.nearandnow.customer`
- **API restrictions:** Limit to Maps SDK for Android/iOS + Geocoding API + Places API

---

## 6. EAS Setup Steps

```bash
# 1. Install EAS CLI
npm install -g eas-cli

# 2. Login to Expo account
eas login

# 3. Initialize project (updates app.json projectId automatically)
npx eas init

# 4. Build for internal testing
eas build --profile preview --platform android

# 5. Build for production
eas build --profile production --platform all

# 6. Submit to stores
eas submit --profile production --platform all
```

---

## 7. Razorpay Integration (Required for UPI)

The app uses `@codearcade/expo-razorpay` (WebView-based, works with Expo). Add this endpoint to the Railway backend:

### POST /api/razorpay/create-order

Creates a Razorpay order. **Requires Razorpay secret key on the server** (never in the app).

**Request body:**
```json
{
  "amount": 25000,
  "currency": "INR",
  "receipt": "order_1739260800000"
}
```
- `amount`: in paise (e.g. ₹250 = 25000)
- `currency`: "INR"
- `receipt`: optional string for your reference

**Response:**
```json
{
  "order_id": "order_xxxxxxxxxxxx"
}
```

**Server-side logic (Node.js example):**
```js
const Razorpay = require('razorpay');
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

app.post('/api/razorpay/create-order', async (req, res) => {
  const { amount, currency = 'INR', receipt } = req.body;
  const order = await razorpay.orders.create({ amount, currency, receipt });
  res.json({ order_id: order.id });
});
```

**Environment variables on Railway:**
- `RAZORPAY_KEY_ID` = rzp_test_xxx (or rzp_live_xxx)
- `RAZORPAY_KEY_SECRET` = your secret key (never expose to client)
