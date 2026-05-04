# ⚡ IMMEDIATE ACTIONS REQUIRED

## 🔴 Critical Security Fixes - DO THIS NOW

### Step 1: Replace .env File (2 minutes)

```bash
# Backup current .env
cp .env .env.backup.$(date +%Y%m%d)

# Replace with secure version
cp .env.client-safe .env

# Verify no secrets remain
cat .env | grep -E "(TWILIO|SERVICE_ROLE|KEY_SECRET)"
# Should return NOTHING
```

### Step 2: Configure Backend (5 minutes)

Open `.env.backend` and copy ALL variables to your backend:

**If using Railway:**
- Go to your Railway project → Variables
- Add each variable from `.env.backend`
- Railway will auto-redeploy

**If using Vercel:**
- Go to Project Settings → Environment Variables
- Add each variable from `.env.backend`
- Redeploy from Deployments tab

**If using custom server:**
- Copy `.env.backend` to your backend directory as `.env`
- Restart your server

### Step 3: Initialize EAS (2 minutes)

```bash
npx eas-cli init
# Follow prompts to create project
# This will update app.config.js with real project ID
```

### Step 4: Test Everything (10 minutes)

```bash
# Clear cache and restart
npm start -- --clear
```

**Test these flows:**
- [ ] Login with OTP (tests backend + Twilio)
- [ ] Browse products (tests Supabase)
- [ ] View map (tests Google Maps)
- [ ] Place order (tests backend API)

### Step 5: Verify Security (5 minutes)

```bash
# Build and check for secrets
npx expo export --platform android

# These should return NOTHING:
grep -r "TWILIO_AUTH" dist/
grep -r "service_role" dist/
grep -r "KEY_SECRET" dist/

# If you find ANY secrets, STOP and contact support
```

---

## ✅ Success Criteria

You're done when:
- [ ] `.env` contains ONLY `EXPO_PUBLIC_*` variables
- [ ] Backend has all secrets from `.env.backend`
- [ ] App starts without errors
- [ ] OTP login works
- [ ] No secrets found in build output
- [ ] `.env.backend` is NOT committed to git

---

## 🚨 If Something Breaks

**Rollback:**
```bash
cp .env.backup.YYYYMMDD .env
npm start -- --clear
```

Then check **MIGRATION_GUIDE.md** for detailed troubleshooting.

---

## 📚 Documentation

- **SECURITY.md** - Why these changes matter
- **MIGRATION_GUIDE.md** - Detailed step-by-step guide
- **.env.client-safe** - Template for client variables
- **.env.backend** - Template for backend variables

---

## ⏱️ Total Time: ~25 minutes

**Priority:** 🔴 CRITICAL - Do before any deployment
