# Gifty Development Status

Last updated: 2026-07-07

## Stabilization summary

This branch stabilizes the recovered Gifty Expo app enough for continued MVP work.

## Completed

- Created working branch: `fix/stabilize-gifty-mvp`.
- Aligned Expo SDK 54 package versions.
- Rebuilt `package-lock.json` from a clean install.
- Added `react-native-web` + matching `react-dom` for web export smoke tests.
- Added NativeWind Metro configuration and fixed `global.css` newlines.
- Added Metro `wasm` asset support for `expo-sqlite` web bundling.
- Fixed TypeScript errors from:
  - `contentContainerClassName` on `ScrollView` / `FlatList`.
  - Zod v4 `required_error` API mismatch.
  - React Hook Form + Zod parsed/defaulted value typing.
  - Web Crypto `ArrayBuffer` typing in `encryption.ts`.
  - `noUncheckedIndexedAccess` base64 conversion issue.
  - Expo Router typed route mismatch.
- Added local Phase 1 bootstrap:
  - Initializes SQLite in `app/_layout.tsx`.
  - Ensures local user row exists.
  - Hydrates auth store with `local-user` before screens render.
- Added root `app/index.tsx` redirect to the dashboard.
- Added visible form submit errors and console logging for save failures.

## Verified commands

```bash
npm install --no-audit --no-fund
npx expo-doctor
npx tsc --noEmit
CI=1 EXPO_NO_TELEMETRY=1 npx expo export --platform web --clear
```

Observed results:

- `expo-doctor`: 18/18 checks passed.
- `tsc`: passed with 0 errors.
- `expo export --platform web --clear`: succeeded and exported `dist/`.

## Browser smoke test

Served the exported bundle with:

```bash
cd dist
python3 -m http.server 8090
```

Opened `http://localhost:8090` and verified:

- Dashboard renders without a red screen/runtime error.
- Hebrew dashboard title appears.
- Stats cards render.
- Empty state renders.
- Add-card FAB navigates to the add-card form.
- Add-card form renders with inputs and actions.

## Remaining limitations / next tasks

1. Complete a native Expo Go smoke test on an actual device or simulator.
2. Verify the full manual flow on device: dashboard → add card → save → detail screen.
3. Improve web smoke-test routing by serving `dist` with SPA fallback for nested routes.
4. Move remaining hardcoded English UI strings into `src/locales/he.json` and `src/locales/en.json`.
5. Decide whether Phase 1 should keep Web Crypto encryption or use an Expo-native crypto/storage approach for mobile-first reliability.
6. Add automated tests around pure helpers and card payload mapping before expanding features.
7. Implement edit-card route or hide edit action until the route exists.
8. Add a real settings/auth plan before Supabase sync.

## Not in scope for this stabilization

- Supabase auth/sync.
- OCR/camera scanning.
- Push notifications.
- Store submission / EAS builds.
- Merchant API integrations.
