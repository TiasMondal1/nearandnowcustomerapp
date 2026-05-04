# 🔐 Security Guidelines for Near & Now Customer App

## ⚠️ CRITICAL: Environment Variable Security

### Client vs Server Environment Variables

**RULE:** The mobile app binary can be decompiled. Any secret in the client `.env` can be extracted.

#### ✅ SAFE for Client (Mobile App)
Variables prefixed with `EXPO_PUBLIC_` are automatically bundled into the app:

```env
EXPO_PUBLIC_API_BASE_URL=https://your-api.com
EXPO_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...  # Public anon key with RLS
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=AIza...    # Restrict in Google Cloud Console
```

#### ❌ NEVER in Client (Backend Only)
These must ONLY exist on your backend server:

```env
# BACKEND ONLY - NEVER in mobile app
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...      # Full database access
TWILIO_ACCOUNT_SID=AC...                   # SMS sending
TWILIO_AUTH_TOKEN=...                      # SMS authentication
RAZORPAY_KEY_SECRET=...                    # Payment processing
RAZORPAY_WEBHOOK_SECRET=...                # Payment webhooks
JWT_SECRET=...                             # Session tokens
```

---

## 🚨 Current Security Issues Fixed

### 1. Service Role Key Exposure (CRITICAL)
**Before:** Service role key was in `.env` with `EXPO_PUBLIC_` prefix
**After:** Removed from client, only on backend
**Impact:** Prevented complete database compromise

### 2. Twilio Credentials Exposure (CRITICAL)
**Before:** Twilio SID, auth token in client `.env`
**After:** Moved to backend only
**Impact:** Prevented unauthorized SMS sending on your account

### 3. Razorpay Secret Key Exposure (CRITICAL)
**Before:** Razorpay secret key in client `.env`
**After:** Moved to backend only
**Impact:** Prevented unauthorized payment operations

---

## 📋 Security Checklist

### Before Every Deployment

- [ ] No secrets in `.env` (only `EXPO_PUBLIC_*` variables)
- [ ] All backend secrets in Railway/Vercel environment variables
- [ ] `.env.backend` is NOT committed to git
- [ ] `google-service-account.json` is NOT committed to git
- [ ] Google Maps API key is restricted in Cloud Console
- [ ] Razorpay keys are test keys (for staging) or live keys (for production)
- [ ] Supabase RLS policies are enabled and tested

### API Key Restrictions

#### Google Maps API Key
1. Go to Google Cloud Console → APIs & Services → Credentials
2. Edit your API key
3. **Application restrictions:**
   - Android: Add package name `com.nearandnow.customer` + SHA-1 fingerprint
   - iOS: Add bundle ID `com.nearandnow.customer`
4. **API restrictions:**
   - Maps SDK for Android
   - Maps SDK for iOS
   - Places API
   - Geocoding API

#### Razorpay Keys
- Use `rzp_test_*` keys for development/staging
- Use `rzp_live_*` keys ONLY in production
- Never commit live keys to git
- Rotate keys if exposed

---

## 🔒 File Security

### Files That Must NEVER Be Committed

```
.env                          # Contains local environment variables
.env.backend                  # Contains backend secrets
.env.production              # Production environment
google-service-account.json  # Google Play API credentials
*.keystore                   # Android signing keys
*.jks                        # Java keystore files
credentials.json             # Any credential files
```

These are already in `.gitignore`. If you accidentally committed any:

```bash
# Remove from git history (DANGEROUS - coordinate with team)
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch .env.backend" \
  --prune-empty --tag-name-filter cat -- --all

# Then force push (WARNING: rewrites history)
git push origin --force --all
```

---

## 🛡️ Backend Security Best Practices

### 1. Environment Variables on Backend

**Railway:**
```bash
# Set via Railway dashboard or CLI
railway variables set SUPABASE_SERVICE_ROLE_KEY="your-key"
railway variables set TWILIO_AUTH_TOKEN="your-token"
```

**Vercel:**
```bash
# Set via Vercel dashboard or CLI
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add TWILIO_AUTH_TOKEN production
```

### 2. API Endpoint Security

All backend endpoints should:
- Validate JWT tokens
- Check user permissions
- Rate limit requests
- Sanitize inputs
- Log security events

Example:
```javascript
// Backend endpoint example
app.post('/api/orders/create', 
  authenticateToken,      // Verify JWT
  validateOrderData,      // Sanitize input
  rateLimiter,           // Prevent abuse
  async (req, res) => {
    // Use SUPABASE_SERVICE_ROLE_KEY here (server-side only)
  }
);
```

### 3. Supabase RLS Policies

Enable Row Level Security on all tables:

```sql
-- Example: Customers can only read their own orders
ALTER TABLE customer_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own orders"
  ON customer_orders
  FOR SELECT
  USING (auth.uid() = customer_id);
```

---

## 🔍 How to Verify Security

### 1. Check Client Bundle
```bash
# Build the app
npx expo export

# Search for secrets in the bundle
grep -r "TWILIO" dist/
grep -r "service_role" dist/

# Should return NO results
```

### 2. Test API Endpoints
```bash
# Try accessing protected endpoints without auth
curl https://your-api.com/api/orders/create \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'

# Should return 401 Unauthorized
```

### 3. Verify Supabase RLS
```javascript
// Try accessing data with anon key (client-side)
const { data, error } = await supabase
  .from('customer_orders')
  .select('*')
  .eq('customer_id', 'someone-elses-id');

// Should return empty or error due to RLS
```

---

## 🚨 Incident Response

### If a Secret is Exposed

1. **Immediately rotate the credential:**
   - Supabase: Generate new service role key in dashboard
   - Twilio: Regenerate auth token
   - Razorpay: Generate new key pair
   - Google Maps: Create new API key, delete old one

2. **Update backend environment variables**

3. **Redeploy backend services**

4. **Monitor for unauthorized usage:**
   - Check Supabase logs
   - Check Twilio usage
   - Check Razorpay transactions
   - Check Google Maps quota

5. **Document the incident**

---

## 📚 Additional Resources

- [Expo Security Best Practices](https://docs.expo.dev/guides/security/)
- [Supabase Security](https://supabase.com/docs/guides/auth/row-level-security)
- [OWASP Mobile Security](https://owasp.org/www-project-mobile-security/)
- [React Native Security Guide](https://reactnative.dev/docs/security)

---

## 📞 Security Contact

If you discover a security vulnerability:
1. Do NOT open a public GitHub issue
2. Email: security@nearandnow.com (replace with your email)
3. Include: Description, steps to reproduce, potential impact

---

**Last Updated:** May 4, 2026  
**Review Schedule:** Monthly security audit recommended
