# 🔄 Security Migration Guide

## Overview

This guide helps you migrate from the insecure environment variable setup to the secure configuration.

**Time Required:** 15-30 minutes  
**Difficulty:** Easy  
**Risk:** Low (if you follow steps carefully)

---

## 📋 Pre-Migration Checklist

- [ ] You have access to your backend deployment (Railway/Vercel)
- [ ] You have access to Google Cloud Console (for Maps API)
- [ ] You have access to Razorpay dashboard
- [ ] You have a backup of your current `.env` file
- [ ] Your backend code is deployed and running

---

## 🚀 Step-by-Step Migration

### Step 1: Backup Current Configuration

```bash
# Backup your current .env file
cp .env .env.backup.$(date +%Y%m%d)

# You can restore it later if needed:
# cp .env.backup.YYYYMMDD .env
```

### Step 2: Replace Client .env File

```bash
# Replace your .env with the secure client-safe version
cp .env.client-safe .env

# Verify it only contains EXPO_PUBLIC_* variables
cat .env | grep -v "^#" | grep -v "^$"
```

**Expected output:**
```
EXPO_PUBLIC_API_BASE_URL=https://near-and-now-frontend.vercel.app
EXPO_PUBLIC_SUPABASE_URL=https://bfgqnsyriiuejvlqaylu.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=AIza...
RAZORPAY_KEY_ID=rzp_test_...
EXPO_PUBLIC_SAVED_METHODS_ENABLED=false
```

### Step 3: Configure Backend Environment Variables

#### Option A: Railway

1. Go to your Railway project dashboard
2. Click on your service → Variables tab
3. Add these variables one by one:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_SERVICE_SID=your_twilio_service_sid
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
RAZORPAY_WEBHOOK_SECRET=your_razorpay_webhook_secret
```

4. Click "Deploy" to restart with new variables

#### Option B: Vercel

1. Go to your Vercel project → Settings → Environment Variables
2. Add each variable from above
3. Select all environments (Production, Preview, Development)
4. Click "Save"
5. Redeploy: Deployments → Latest → Redeploy

#### Option C: Custom Node.js Server

1. Copy `.env.backend` to your backend directory:
```bash
cp .env.backend /path/to/your/backend/.env
```

2. Ensure your server loads it:
```javascript
// At the top of your server.js or index.js
require('dotenv').config();
```

3. Restart your server:
```bash
pm2 restart your-app
# or
npm run start
```

### Step 4: Verify Backend Configuration

Test that your backend can access the secrets:

```bash
# Test OTP sending (should work)
curl https://near-and-now-frontend.vercel.app/api/auth/send-otp \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"phone": "+919999999999"}'

# Expected: {"success": true} or similar
# If error: Check backend logs for missing env vars
```

### Step 5: Restrict Google Maps API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Navigate to: APIs & Services → Credentials
3. Find your API key (example format): `AIza...`
4. Click Edit (pencil icon)

**Application restrictions:**
- Select "Android apps"
- Click "Add an item"
- Package name: `com.nearandnow.customer`
- SHA-1 fingerprint: Get from your keystore (see below)

**API restrictions:**
- Select "Restrict key"
- Enable only:
  - Maps SDK for Android
  - Maps SDK for iOS
  - Places API
  - Geocoding API

**Get SHA-1 fingerprint:**
```bash
# For debug keystore
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android

# For production keystore (when you create one)
keytool -list -v -keystore /path/to/your.keystore -alias your-key-alias
```

### Step 6: Test the Mobile App

```bash
# Clear cache and restart
npm start -- --clear

# Or rebuild
npx expo prebuild --clean
npm run android  # or ios
```

**Test these flows:**
1. ✅ Login with OTP (tests Twilio via backend)
2. ✅ Browse products (tests Supabase anon access)
3. ✅ View map (tests Google Maps API)
4. ✅ Place order (tests backend API)
5. ✅ Payment flow (tests Razorpay)

### Step 7: Clean Up

```bash
# Remove the backup if everything works
rm .env.backup.*

# Ensure sensitive files are not tracked
git status

# Should NOT show:
# - .env
# - .env.backend
# - google-service-account.json

# If they appear, they're not in .gitignore properly
```

---

## ✅ Verification Checklist

After migration, verify:

- [ ] Mobile app starts without errors
- [ ] OTP login works (backend sends SMS)
- [ ] Products load from Supabase
- [ ] Google Maps displays correctly
- [ ] Can place test order
- [ ] Payment flow works (test mode)
- [ ] No secrets in client bundle (see below)
- [ ] Backend logs show no missing env var errors

### Verify No Secrets in Client Bundle

```bash
# Build the app
npx expo export --platform android

# Search for secrets (should return NOTHING)
grep -r "TWILIO_AUTH_TOKEN" dist/
grep -r "service_role" dist/
grep -r "RAZORPAY_KEY_SECRET" dist/

# If you find any secrets, DO NOT DEPLOY - contact support
```

---

## 🚨 Troubleshooting

### Issue: "Supabase credentials missing" error

**Cause:** `.env` file not loaded or missing variables

**Fix:**
```bash
# Verify .env exists and has content
cat .env | grep EXPO_PUBLIC_SUPABASE

# Restart metro bundler
npm start -- --clear
```

### Issue: OTP not sending

**Cause:** Backend doesn't have Twilio credentials

**Fix:**
1. Check backend logs for errors
2. Verify Twilio variables are set on backend
3. Test Twilio credentials:
```bash
curl -X POST https://api.twilio.com/2010-04-01/Accounts/AC.../Messages.json \
  -u "AC...:your-auth-token" \
  -d "From=+1234567890" \
  -d "To=+919999999999" \
  -d "Body=Test"
```

### Issue: Payment fails with "Invalid key"

**Cause:** Razorpay keys not on backend or wrong mode (test vs live)

**Fix:**
1. Verify backend has `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`
2. Ensure both are test keys (`rzp_test_*`) or both are live keys
3. Check Razorpay dashboard for API errors

### Issue: Google Maps not loading

**Cause:** API key restrictions too strict or not applied yet

**Fix:**
1. Temporarily remove all restrictions in Google Cloud Console
2. Test if maps load
3. Re-apply restrictions one by one to find the issue
4. Ensure SHA-1 fingerprint matches your keystore

### Issue: "Network request failed" errors

**Cause:** Backend API URL wrong or backend is down

**Fix:**
```bash
# Test backend is reachable
curl https://near-and-now-frontend.vercel.app/api/health

# If 404 or timeout, check:
# 1. Backend is deployed
# 2. URL in .env is correct (no trailing slash)
# 3. Backend has CORS enabled for mobile app
```

---

## 🔄 Rollback Plan

If something goes wrong and you need to rollback:

```bash
# Restore old .env
cp .env.backup.YYYYMMDD .env

# Restart app
npm start -- --clear

# Note: This puts secrets back in client - only temporary!
# Fix the issue and re-migrate ASAP
```

---

## 📊 Migration Status Tracker

Use this to track your progress:

```
[ ] Step 1: Backed up current .env
[ ] Step 2: Replaced with .env.client-safe
[ ] Step 3: Configured backend env vars
    [ ] Railway/Vercel variables set
    [ ] Backend redeployed
[ ] Step 4: Verified backend works
    [ ] OTP endpoint tested
    [ ] Payment endpoint tested
[ ] Step 5: Restricted Google Maps API
    [ ] Application restrictions added
    [ ] API restrictions added
[ ] Step 6: Tested mobile app
    [ ] Login works
    [ ] Products load
    [ ] Maps display
    [ ] Orders work
    [ ] Payments work
[ ] Step 7: Cleaned up backups
[ ] Verified no secrets in bundle

Migration completed: ___/___/______
Verified by: _________________
```

---

## 📞 Need Help?

If you encounter issues during migration:

1. Check the troubleshooting section above
2. Review backend logs for specific errors
3. Verify each environment variable is set correctly
4. Test each service independently (Twilio, Razorpay, Supabase)

---

**Migration completed successfully?** 🎉

Delete the backup files and commit your changes:

```bash
# Remove backups
rm .env.backup.*

# Commit the secure configuration
git add .env.client-safe .env.backend SECURITY.md MIGRATION_GUIDE.md .gitignore
git commit -m "Security: Migrate to secure environment variable configuration"
git push
```

**Remember:** Never commit `.env` or `.env.backend` to git!
