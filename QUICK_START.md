# 🚀 Quick Start - Secure Configuration

## ⚡ 5-Minute Setup

### 1. Replace Your .env File

```bash
# Backup current .env
cp .env .env.backup

# Use the secure client-safe version
cp .env.client-safe .env
```

### 2. Configure Your Backend

Copy all variables from `.env.backend` to your backend deployment:

**Railway:** Project Settings → Variables  
**Vercel:** Project Settings → Environment Variables  
**Custom Server:** Copy `.env.backend` to your backend directory

### 3. Restart Everything

```bash
# Clear cache and restart mobile app
npm start -- --clear

# Redeploy backend (Railway/Vercel will auto-deploy on variable changes)
```

### 4. Test

- [ ] Login with OTP works
- [ ] Products load
- [ ] Maps display
- [ ] Can place order

---

## 🔴 What Changed?

### Removed from Client .env (SECURITY FIX)
- ❌ `EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` - Full database access
- ❌ `TWILIO_*` credentials - SMS sending
- ❌ `RAZORPAY_KEY_SECRET` - Payment processing

### Kept in Client .env (Safe)
- ✅ `EXPO_PUBLIC_SUPABASE_URL` - Public URL
- ✅ `EXPO_PUBLIC_SUPABASE_ANON_KEY` - Public key with RLS
- ✅ `EXPO_PUBLIC_API_BASE_URL` - Your backend URL
- ✅ `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` - Maps (restrict in console)

---

## 📚 Full Documentation

- **SECURITY.md** - Security best practices and guidelines
- **MIGRATION_GUIDE.md** - Detailed step-by-step migration
- **.env.client-safe** - Template for client environment variables
- **.env.backend** - Template for backend environment variables

---

## ⚠️ Important

**DO NOT commit these files to git:**
- `.env`
- `.env.backend`
- `google-service-account.json`

They're already in `.gitignore` ✅

---

## 🆘 Need Help?

See **MIGRATION_GUIDE.md** for troubleshooting common issues.
