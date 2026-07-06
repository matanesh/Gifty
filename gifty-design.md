# Gifty — Gift Card & Loyalty Club Manager
## Technical Design Document v1.0
### Production-Ready Mobile App (iOS + Android)

---

## 1. Vision & Goals

**Gifty** היא אפליקציית ניהול כרטיסי גיפט קארד ומועדוני לקוחות. המטרה: מקום אחד לכל הכרטיסים, עם יכולת הזנה ידנית, סריקת תמונות, ובעתיד — חיבור לAPI של חברות לעדכון יתרות אוטומטי.

### Core Principles
- **Mobile-first**: Designed for one-handed use, fast interactions
- **RTL-native**: Hebrew as primary language, with i18n support for English
- **Offline-capable**: Core features work without internet
- **Store-ready**: Built from day one for Google Play & App Store release
- **Security-first**: Gift card data is financial data — treat it accordingly

---

## 2. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Framework** | React Native (Expo SDK 52+) | Cross-platform, single codebase, Expo simplifies builds & OTA updates |
| **Language** | TypeScript (strict mode) | Type safety, better DX, fewer runtime bugs |
| **Navigation** | Expo Router (file-based) | Native navigation, deep linking, type-safe routes |
| **State** | Zustand + React Query (TanStack) | Zustand for local/UI state, React Query for server state & caching |
| **Database (local)** | SQLite via expo-sqlite | Offline-first, fast queries, structured data |
| **Database (remote)** | Supabase (PostgreSQL) | Auth, real-time sync, Row Level Security, free tier generous |
| **Auth** | Supabase Auth | Email/password, Google, Apple Sign-In (required for iOS) |
| **Image Processing** | expo-camera + expo-image-picker | Camera capture & gallery selection |
| **OCR/AI** | Google Cloud Vision API or Tesseract.js (offline fallback) | Text extraction from card images |
| **Storage** | Supabase Storage (images) + local cache | Card images with CDN delivery |
| **Notifications** | expo-notifications + Supabase Edge Functions | Expiry reminders |
| **Analytics** | PostHog (self-hostable, privacy-friendly) | Usage analytics without selling user data |
| **Styling** | Nativewind (Tailwind for RN) | Utility-first, consistent design system |
| **Testing** | Jest + React Native Testing Library + Detox (E2E) | Full coverage pyramid |
| **CI/CD** | EAS Build + EAS Submit | Automated builds & store submissions |

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                    Mobile App                     │
│  ┌───────────┐  ┌──────────┐  ┌──────────────┐  │
│  │  UI Layer  │  │  Hooks   │  │  Services    │  │
│  │  (Screens  │──│  (use*)  │──│  (API calls, │  │
│  │   + Comps) │  │          │  │   OCR, sync) │  │
│  └───────────┘  └──────────┘  └──────┬───────┘  │
│                                       │          │
│  ┌────────────────────────────────────┴───────┐  │
│  │         Local Database (SQLite)             │  │
│  │  gift_cards | usage_logs | sync_queue       │  │
│  └────────────────────┬───────────────────────┘  │
└───────────────────────┼──────────────────────────┘
                        │ Sync Engine
┌───────────────────────┼──────────────────────────┐
│              Supabase Backend                     │
│  ┌────────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ PostgreSQL  │ │  Auth    │ │    Storage     │  │
│  │ + RLS       │ │          │ │  (Images)      │  │
│  └────────────┘ └──────────┘ └────────────────┘  │
│  ┌────────────────────────────────────────────┐   │
│  │       Edge Functions                        │  │
│  │  - OCR processing                           │  │
│  │  - Expiry notifications (cron)              │  │
│  │  - Future: merchant API integrations        │  │
│  └────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────┘
```

### Offline-First Sync Strategy
1. All writes go to **local SQLite first** (instant UI response)
2. A **sync queue** table tracks pending changes
3. When online, a background sync pushes changes to Supabase
4. Conflicts resolved by **last-write-wins** with `updated_at` timestamps
5. On app open: pull remote changes, merge with local

---

## 4. Database Schema

### 4.1 Local SQLite Schema

```sql
-- Enable WAL mode for better concurrent read/write
PRAGMA journal_mode=WAL;

CREATE TABLE users (
  id TEXT PRIMARY KEY,               -- Supabase Auth UID
  email TEXT NOT NULL,
  display_name TEXT,
  preferred_currency TEXT DEFAULT 'ILS',
  language TEXT DEFAULT 'he',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE gift_cards (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id),
  
  -- Core info
  brand_name TEXT NOT NULL,
  card_type TEXT NOT NULL DEFAULT 'gift_card',  -- 'gift_card' | 'loyalty' | 'voucher' | 'prepaid'
  code TEXT,                          -- The actual card code/number
  barcode_data TEXT,                  -- Raw barcode data for rendering
  barcode_format TEXT,                -- 'CODE128' | 'QR' | 'EAN13' | 'PDF417' etc.
  pin TEXT,                           -- PIN/CVV (encrypted at rest)
  card_number TEXT,                   -- Additional card number
  
  -- Financial
  initial_amount REAL,               -- NULL for loyalty cards (points-based)
  current_balance REAL,
  currency TEXT DEFAULT 'ILS',
  points_balance INTEGER,            -- For loyalty cards
  
  -- Dates
  issue_date TEXT,                   -- ISO 8601
  valid_until TEXT,                  -- ISO 8601, NULL = no expiry
  
  -- Metadata
  category TEXT DEFAULT 'general',   -- 'shopping'|'dining'|'entertainment'|'services'|'online'|'grocery'|'fuel'|'general'
  color TEXT DEFAULT 'blue',         -- UI accent color
  networks TEXT DEFAULT '[]',        -- JSON array of accepted stores
  notes TEXT,
  tags TEXT DEFAULT '[]',            -- JSON array, user-defined tags
  is_favorite INTEGER DEFAULT 0,
  is_archived INTEGER DEFAULT 0,     -- For used-up / expired cards
  
  -- Images
  image_front_url TEXT,              -- Remote URL
  image_front_local TEXT,            -- Local file path (cache)
  image_back_url TEXT,
  image_back_local TEXT,
  
  -- Reminders
  reminder_days_before INTEGER DEFAULT 7,
  reminder_enabled INTEGER DEFAULT 1,
  
  -- Sync
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  deleted_at TEXT,                   -- Soft delete for sync
  is_synced INTEGER DEFAULT 0,
  remote_version INTEGER DEFAULT 0
);

CREATE INDEX idx_gift_cards_user ON gift_cards(user_id);
CREATE INDEX idx_gift_cards_brand ON gift_cards(brand_name);
CREATE INDEX idx_gift_cards_expiry ON gift_cards(valid_until);
CREATE INDEX idx_gift_cards_archived ON gift_cards(is_archived);

CREATE TABLE usage_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  gift_card_id TEXT NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  
  amount_used REAL NOT NULL,
  balance_after REAL NOT NULL,
  store_name TEXT,
  notes TEXT,
  used_at TEXT DEFAULT (datetime('now')),
  
  -- Sync
  created_at TEXT DEFAULT (datetime('now')),
  deleted_at TEXT,
  is_synced INTEGER DEFAULT 0
);

CREATE INDEX idx_usage_logs_card ON usage_logs(gift_card_id);

CREATE TABLE sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  operation TEXT NOT NULL,          -- 'INSERT' | 'UPDATE' | 'DELETE'
  payload TEXT NOT NULL,            -- JSON of the changed data
  created_at TEXT DEFAULT (datetime('now')),
  retry_count INTEGER DEFAULT 0,
  last_error TEXT
);

-- Brand catalog for autocomplete & logos
CREATE TABLE brand_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_he TEXT,
  logo_url TEXT,
  category TEXT,
  networks TEXT DEFAULT '[]',       -- JSON array
  website TEXT,
  has_api INTEGER DEFAULT 0,        -- Future: does this brand support balance checking?
  updated_at TEXT
);
```

### 4.2 Supabase (Remote) Schema

```sql
-- Mirror of local schema with RLS policies
-- All tables have: id UUID PRIMARY KEY DEFAULT gen_random_uuid()

-- Row Level Security (critical for multi-user)
ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only see their own cards"
  ON gift_cards FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can only insert their own cards"
  ON gift_cards FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can only update their own cards"
  ON gift_cards FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can only delete their own cards"
  ON gift_cards FOR DELETE
  USING (auth.uid() = user_id);

-- Same RLS pattern for usage_logs
-- Storage bucket policy: users can only access their own folder
```

---

## 5. Feature Specifications

### 5.1 Card Addition Flow

```
┌──────────┐    ┌───────────┐    ┌──────────────┐    ┌──────────┐
│  Choose   │───▶│  Camera/  │───▶│  AI/OCR      │───▶│  Review  │
│  Method   │    │  Gallery  │    │  Processing  │    │  & Save  │
│           │    │           │    │              │    │          │
│ • Scan    │    │ Front +   │    │ Extract:     │    │ Edit any │
│ • Manual  │    │ Back      │    │ brand, code, │    │ field    │
│ • Barcode │    │ optional  │    │ amount, date │    │          │
└──────────┘    └───────────┘    └──────────────┘    └──────────┘
```

**Scan Flow:**
1. Open camera with overlay guide (card outline)
2. Capture front → optional back
3. Upload to Edge Function for OCR processing
4. Display extracted data in editable form
5. User confirms/edits → save locally → queue sync

**Manual Entry Form Fields:**
- Brand name (with autocomplete from brand_catalog)
- Card type (gift card / loyalty / voucher / prepaid)
- Code (text input + paste support)
- PIN/CVV (optional, masked input)
- Amount / Balance
- Currency
- Expiry date (date picker component)
- Category (dropdown)
- Notes
- Color picker

**Barcode Scan (Phase 2):**
- Use expo-barcode-scanner
- Support: CODE128, QR, EAN13, PDF417, CODE39
- Auto-detect format and store both data + format

### 5.2 Dashboard

**Layout (top to bottom):**
1. **Summary bar**: Total balance (₪X,XXX) | Active cards count | Expiring soon count
2. **Expiry alerts**: Horizontal scroll of cards expiring within 30 days, sorted by urgency
3. **Card grid**: 2-column grid, each card shows:
   - Brand logo/color
   - Brand name
   - Current balance (or points)
   - Expiry indicator (green/yellow/red/grey)
   - Favorite star
4. **Quick actions FAB**: + Add Card

**Sorting options:** Recently added, Expiring soon, Highest balance, Alphabetical
**Filters:** Category, Archived, Favorites

### 5.3 Card Detail Screen

- Full card visualization with brand color
- Large code display (tap to copy)
- Barcode rendering (if barcode_data exists)
- Balance display with "Use" button
- Usage history list (scrollable)
- Card images (front/back, tappable to zoom)
- All metadata (dates, networks, notes)
- Actions: Edit, Archive, Delete, Share

### 5.4 Usage Tracking

```
User taps "Use Card" → Bottom sheet:
  - Amount used (number input, with quick buttons: 25%, 50%, 75%, All)
  - Store name (optional, autocomplete)
  - Date (defaults to now)
  - Notes (optional)
  → Updates current_balance
  → Creates usage_log entry
  → If balance = 0, prompt to archive
```

### 5.5 Store Search

- Search input with debounce (300ms)
- Searches: brand_name, networks array, tags
- Hebrew-aware search normalization (remove niqqud, handle final letters)
- Results grouped by brand
- "Popular stores" section based on user's cards

### 5.6 Analytics

- **Total value**: Sum of all active card balances
- **Total spent**: Sum of all usage_logs
- **Monthly spending**: Bar chart (last 12 months)
- **Balance by category**: Pie/donut chart
- **Expiry timeline**: Cards expiring by month
- **Top stores**: Where the user spends most

### 5.7 Settings

- Profile (name, email)
- Currency preference
- Language (Hebrew / English)
- Notification preferences
- Export data (CSV + JSON)
- Import data (CSV)
- Delete account (GDPR compliance)
- About / Version info
- Privacy policy & Terms of service links

---

## 6. Security Requirements

### 6.1 Data Protection
- **Encryption at rest**: Sensitive fields (code, pin, card_number) encrypted using expo-crypto before storing in SQLite
- **Key management**: Encryption key derived from user's auth token, stored in secure enclave (expo-secure-store)
- **No plaintext secrets**: Card codes/PINs never stored unencrypted
- **Image security**: Card images stored in private Supabase Storage bucket, signed URLs with 1hr expiry

### 6.2 Authentication
- **Minimum**: Email + password (with email verification)
- **Required for iOS**: Apple Sign-In
- **Recommended**: Google Sign-In
- **Session management**: JWT with refresh tokens, auto-refresh
- **Biometric lock**: Optional Face ID / Fingerprint to open app (expo-local-authentication)

### 6.3 Network Security
- All API calls over HTTPS
- Certificate pinning for Supabase endpoint
- API rate limiting on Edge Functions
- Input sanitization on all user inputs

### 6.4 Privacy (GDPR / Israeli Privacy Protection Law)
- Clear privacy policy explaining what data is collected and why
- Data export capability (right to portability)
- Account deletion capability (right to erasure)
- No tracking without consent
- No selling/sharing data with third parties
- Minimal data collection principle

---

## 7. Project Structure

```
gifty/
├── app/                          # Expo Router screens
│   ├── (auth)/                   # Auth group (login, register, forgot-password)
│   │   ├── login.tsx
│   │   ├── register.tsx
│   │   └── forgot-password.tsx
│   ├── (tabs)/                   # Main tab navigator
│   │   ├── index.tsx             # Dashboard
│   │   ├── stores.tsx            # Store search
│   │   ├── analytics.tsx         # Analytics
│   │   └── settings.tsx          # Settings
│   ├── card/
│   │   ├── [id].tsx              # Card detail
│   │   ├── add.tsx               # Add card flow
│   │   └── edit/[id].tsx         # Edit card
│   ├── _layout.tsx               # Root layout
│   └── +not-found.tsx
├── src/
│   ├── components/
│   │   ├── ui/                   # Base components (Button, Input, Card, Modal, etc.)
│   │   ├── cards/                # Card-related components
│   │   │   ├── CardPreview.tsx
│   │   │   ├── CardGrid.tsx
│   │   │   ├── CardForm.tsx
│   │   │   ├── BarcodeRenderer.tsx
│   │   │   ├── BalanceDisplay.tsx
│   │   │   └── ExpiryBadge.tsx
│   │   ├── dashboard/
│   │   │   ├── StatsBar.tsx
│   │   │   ├── ExpiryAlerts.tsx
│   │   │   └── QuickActions.tsx
│   │   ├── usage/
│   │   │   ├── UseCardSheet.tsx
│   │   │   └── UsageHistory.tsx
│   │   ├── camera/
│   │   │   ├── CardScanner.tsx
│   │   │   └── CameraOverlay.tsx
│   │   └── analytics/
│   │       ├── SpendingChart.tsx
│   │       └── CategoryPieChart.tsx
│   ├── hooks/
│   │   ├── useGiftCards.ts       # CRUD operations + React Query
│   │   ├── useUsageLogs.ts
│   │   ├── useSync.ts            # Sync engine hook
│   │   ├── useAuth.ts
│   │   ├── useBrandSearch.ts
│   │   └── useNotifications.ts
│   ├── services/
│   │   ├── database.ts           # SQLite setup & migrations
│   │   ├── sync.ts               # Sync engine logic
│   │   ├── ocr.ts                # OCR processing service
│   │   ├── encryption.ts         # Encrypt/decrypt sensitive fields
│   │   ├── notifications.ts      # Push notification setup
│   │   └── api.ts                # Supabase client setup
│   ├── stores/                   # Zustand stores
│   │   ├── authStore.ts
│   │   ├── uiStore.ts            # Theme, language, filters
│   │   └── syncStore.ts          # Sync status
│   ├── utils/
│   │   ├── constants.ts
│   │   ├── colors.ts             # Color palette & card colors
│   │   ├── dates.ts              # Date helpers
│   │   ├── currency.ts           # Format currency
│   │   ├── search.ts             # Hebrew-aware search normalization
│   │   ├── validators.ts         # Input validation
│   │   └── i18n.ts               # Internationalization setup
│   ├── types/
│   │   ├── gift-card.ts
│   │   ├── usage-log.ts
│   │   ├── navigation.ts
│   │   └── api.ts
│   └── locales/
│       ├── he.json               # Hebrew strings
│       └── en.json               # English strings
├── supabase/
│   ├── migrations/               # SQL migrations
│   ├── functions/                # Edge Functions
│   │   ├── ocr-process/          # Image → structured data
│   │   ├── expiry-notify/        # Cron job for reminders
│   │   └── balance-check/        # Future: merchant API integration
│   └── seed.sql                  # Brand catalog seed data
├── assets/                       # Fonts, static images, app icon
├── app.json                      # Expo config
├── eas.json                      # EAS Build config
├── tsconfig.json
├── tailwind.config.js
└── package.json
```

---

## 8. Development Phases

### Phase 1 — MVP (4-6 weeks)
- [ ] Project setup (Expo, TypeScript, Nativewind, SQLite)
- [ ] Auth (email/password + Google + Apple)
- [ ] Local database with migrations
- [ ] Manual card entry (full form)
- [ ] Dashboard (card grid, stats, expiry alerts)
- [ ] Card detail view
- [ ] Usage tracking (record spending)
- [ ] Basic search
- [ ] Settings (profile, export CSV)
- [ ] RTL support
- [ ] Biometric lock

### Phase 2 — Enhanced (2-3 weeks)
- [ ] Camera capture + OCR extraction
- [ ] Barcode scanning & rendering
- [ ] Supabase sync (cloud backup)
- [ ] Push notifications for expiry reminders
- [ ] Analytics screen with charts
- [ ] Import from CSV
- [ ] Brand catalog with logos & autocomplete
- [ ] Card archiving
- [ ] Favorites & tags

### Phase 3 — Polish & Store Release (2-3 weeks)
- [ ] Onboarding flow (first-time user)
- [ ] Empty states with illustrations
- [ ] Error handling & retry UI
- [ ] Accessibility (screen readers, contrast)
- [ ] Performance optimization (FlatList, image caching)
- [ ] App icon & splash screen
- [ ] Privacy policy & Terms of Service pages
- [ ] Store listings (screenshots, descriptions)
- [ ] Beta testing (TestFlight + Google Play Internal Testing)
- [ ] E2E tests with Detox

### Phase 4 — Future / API Integrations
- [ ] Merchant API integrations (balance checking)
- [ ] Widget (iOS/Android home screen widget showing top cards)
- [ ] Sharing cards with family members
- [ ] Recurring cards (subscriptions)
- [ ] AI-powered spending insights
- [ ] Multi-currency support with conversion

---

## 9. App Store Requirements Checklist

### Google Play
- [ ] Target SDK 34+ (Android 14)
- [ ] Data safety section filled out
- [ ] Content rating questionnaire completed
- [ ] Privacy policy URL provided
- [ ] App signing by Google Play
- [ ] 64-bit support
- [ ] Adaptive icon

### Apple App Store
- [ ] Apple Sign-In implemented (mandatory if other social logins exist)
- [ ] App Privacy nutrition labels filled out
- [ ] No use of private APIs
- [ ] IDFA disclosure (if analytics used)
- [ ] App Transport Security (HTTPS only)
- [ ] IPv6 compatibility
- [ ] Screenshots for all required device sizes

---

## 10. Edge Cases & Error Handling

| Scenario | Handling |
|----------|----------|
| OCR returns garbage data | Show extracted data in editable form, user corrects |
| No internet during sync | Queue changes locally, sync when back online, show sync indicator |
| Card already expired when added | Allow it, show as expired, suggest archiving |
| Duplicate card detection | Compare code + brand_name, warn user before saving |
| Balance goes negative | Prevent: validate amount_used <= current_balance |
| User deletes account | Delete all remote data, clear local DB, revoke tokens |
| App killed during sync | Sync queue persists, resume on next open |
| Very long card code | Horizontal scroll + reduce font size in display |
| Invalid barcode format | Fallback to text display of code |
| Camera permission denied | Show explanation + link to settings, offer manual entry |
| Storage full | Warn user, suggest clearing image cache |
| Concurrent edits (multi-device) | Last-write-wins based on updated_at, show conflict UI for balance discrepancies |
| Hebrew + English mixed text | Use Unicode bidi algorithm, test with mixed content |

---

## 11. Claude Code Workflow Guide

### How to work with Claude Code on this project:

**1. Initial Setup Prompt:**
```
I'm building Gifty, a React Native (Expo) app for managing gift cards.
Read the design doc at gifty-design.md for full context.
Let's start with Phase 1. Set up the project with:
- Expo SDK 52+ with TypeScript
- Expo Router (file-based routing)
- Nativewind (Tailwind CSS for RN)
- expo-sqlite for local database
- Zustand for state management
- @tanstack/react-query
Create the project structure as defined in section 7.
```

**2. Working in increments:**
- Ask Claude Code to build one feature at a time
- Always reference the design doc for specs
- Example: "Implement the gift card manual entry form per section 5.1 of the design doc"

**3. Testing each feature:**
```
Run the app and verify:
1. [specific acceptance criteria]
2. [specific acceptance criteria]
Fix any issues before moving on.
```

**4. Key commands for Claude Code:**
```bash
# Start development
npx expo start

# Run on device
npx expo start --android
npx expo start --ios

# Build for testing
eas build --profile preview --platform android

# Submit to store
eas submit --platform android
eas submit --platform ios

# Run tests
npm test
npm run test:e2e
```

**5. Tips for effective Claude Code sessions:**
- Keep the design doc in your project root — tell Claude Code to reference it
- Work on one screen/feature per session
- Commit after each working feature
- Use `git diff` to review changes before accepting
- If something breaks, share the error message and let Claude Code fix it
- For complex features (sync, OCR), break into sub-tasks

---

## 12. Initial Claude Code Prompt (Copy & Paste This)

```
You are building "Gifty" — a production-grade React Native (Expo) mobile app 
for managing gift cards and loyalty club cards.

CONTEXT: Read gifty-design.md in the project root for the complete technical 
design document. Follow it closely.

TECH STACK:
- Expo SDK 52+ with TypeScript (strict)
- Expo Router for navigation
- Nativewind for styling
- expo-sqlite for local database
- Zustand + React Query for state
- RTL layout (Hebrew primary language)

CURRENT TASK: [describe what you want to build]

REQUIREMENTS:
1. Follow the project structure in section 7 of the design doc
2. Use TypeScript strict mode — no `any` types
3. All UI must support RTL
4. All text must come from locale files (src/locales/)
5. Handle loading, error, and empty states for every screen
6. Validate all user inputs
7. Write clean, documented code with JSDoc comments

When done, tell me how to test what you built.
```
