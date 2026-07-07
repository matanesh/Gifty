# Gifty

Gifty is a mobile-first Expo / React Native app for managing gift cards, loyalty cards, vouchers, and prepaid cards.

The current codebase is a recovered Phase 1 MVP. It is local-first and uses SQLite for card storage. Supabase sync, OCR scanning, camera capture, notifications, and store submission are future phases described in `gifty-design.md`.

## Current MVP scope

- Hebrew-first dashboard shell with RTL-friendly layout direction.
- Local SQLite schema for users, gift cards, usage logs, sync queue, and brand catalog.
- Local MVP bootstrap user (`local-user`) so the app can run before Supabase auth exists.
- Manual add-card form with validation and encrypted sensitive fields.
- Card detail screen with masked sensitive card code / PIN display.
- Expo SDK 54 dependency alignment.

## Setup

```bash
npm install
```

## Verification commands

```bash
npx expo-doctor
npx tsc --noEmit
npx expo export --platform web
```

Expected current result:

- `expo-doctor`: 18/18 checks pass.
- `tsc`: 0 TypeScript errors.
- `expo export --platform web`: web bundle exports to `dist/`.

## Running locally

For native/mobile development:

```bash
npx expo start
```

For web bundle smoke testing:

```bash
npx expo export --platform web
cd dist
python3 -m http.server 8090
```

Then open `http://localhost:8090`.

## Known limitations

- This is not a production-ready app yet.
- Supabase auth/sync is intentionally not implemented in Phase 1; the app uses a local MVP user.
- OCR/camera/image capture is deferred.
- Notification reminders are deferred.
- Some UI strings are still hardcoded in English and should be moved into `src/locales/he.json` and `src/locales/en.json`.
- Web static serving needs a fallback/rewrite server for direct nested routes like `/card/add`; navigate from `/` during simple static smoke tests.

## Important files

- `gifty-design.md` — product and technical design document.
- `DEVELOPMENT_STATUS.md` — current stabilization status.
- `src/services/database.ts` — SQLite schema and local MVP user bootstrap.
- `src/components/cards/CardForm.tsx` — manual card form.
- `src/hooks/useGiftCards.ts` — React Query hooks for card CRUD.
