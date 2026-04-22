# Day 1 — Sherbrt mobile app scaffold (Expo + Sharetribe + auth)

Paste the fenced block below into a **fresh Claude Code session** opened in a new folder: `~/sherbrt-mobile`. Create that folder first if it doesn't exist, then launch CC inside it.

**Before you run the prompt:**

1. Create the folder: `mkdir ~/sherbrt-mobile && cd ~/sherbrt-mobile`
2. Initialize git: `git init`
3. Launch Claude Code in that folder.
4. Have your Sharetribe SDK client ID ready — it's in your web repo's `.env` file as `REACT_APP_SHARETRIBE_SDK_CLIENT_ID`. You'll paste it into the mobile app's `.env` file after CC scaffolds.

---

```
# Sherbrt mobile app — Day 1 scaffold

## Context

This is a new React Native mobile app for Sherbrt, a peer-to-peer rental
marketplace built on Sharetribe Flex. Backend lives at ~/shop-on-sherbet-cursor
(do NOT modify it — it's a separate repo). The mobile app will use the same
Sharetribe Flex SDK that the web app uses (`sharetribe-flex-sdk` npm package),
hitting the same marketplace (marketplaceId: `shoponsherbet`).

Today's scope: create a working Expo app that a test user can sign into with
their existing Sherbrt credentials and see a placeholder post-auth screen.
Nothing more — no listings, no browse feed, no booking flow. Just scaffold
the project and prove end-to-end auth works.

## Tech decisions (lock these in)

- **Framework:** Expo SDK latest stable (currently 54), managed workflow
- **Language:** TypeScript
- **Routing:** Expo Router (file-based, v3+)
- **State:** React Context + hooks (no Redux for MVP — add later if needed)
- **Storage:** expo-secure-store for auth tokens (never AsyncStorage for secrets)
- **Navigation pattern:** root stack with a `(tabs)` group for post-auth
- **Node version:** match the web repo at ~/shop-on-sherbet-cursor (>=20.10.0)

## Project structure to create

```
sherbrt-mobile/
├── app.json               # Expo config; slug: sherbrt-mobile, scheme: sherbrt
├── app/
│   ├── _layout.tsx        # Root stack + AuthProvider
│   ├── index.tsx          # Entry — redirects to /(auth)/sign-in or /(tabs)
│   ├── (auth)/
│   │   └── sign-in.tsx    # Email + password sign-in screen
│   └── (tabs)/
│       ├── _layout.tsx    # Bottom tabs: Browse, Trips, Profile
│       ├── browse.tsx     # Placeholder "Browse — coming Day 2"
│       ├── trips.tsx      # Placeholder "Trips — coming Day 4"
│       └── profile.tsx    # Shows "Hello, {firstName}" + sign-out button
├── lib/
│   ├── sharetribe.ts      # SDK singleton, initialized with client ID from env
│   └── auth.ts            # signIn(email, password), signOut(), getCurrentUser()
├── contexts/
│   └── AuthContext.tsx    # Provider + useAuth hook
├── components/
│   └── (empty — leave for Day 2+)
├── .env.example           # Commit template; real .env gitignored
├── .gitignore             # Standard + /ios /android /.expo
├── tsconfig.json
├── package.json
└── README.md              # Brief: how to run, env vars needed
```

## Packages to install

**Core (required for Day 1):**
- `expo` (latest stable)
- `expo-router` (latest)
- `expo-secure-store` (for auth token)
- `expo-constants` (for env access)
- `expo-splash-screen`
- `expo-status-bar`
- `react` `react-native`
- `react-native-safe-area-context`
- `react-native-screens`
- `react-native-gesture-handler`
- `sharetribe-flex-sdk` — check the web repo ~/shop-on-sherbet-cursor/package.json
  for the exact version it uses; pin to the same major.

**Scaffolding for later days (install now to avoid churn):**
- `@stripe/stripe-react-native` (Day 3 booking flow — install but don't configure yet)
- `expo-image-picker` (Day 4 profile photo — install, don't use)

**Dev:**
- `typescript`
- `@types/react`
- `@types/react-native`

## Implementation details

### `lib/sharetribe.ts`

Create a singleton Flex SDK instance. Pull the client ID from
`process.env.EXPO_PUBLIC_SHARETRIBE_CLIENT_ID` (Expo's convention for
public-at-build-time env vars). This is NOT a secret — it's a public client
ID, same one the web app uses. Reference the web repo's usage pattern
in ~/shop-on-sherbet-cursor/src/util/sdkLoader.js for the init signature
if needed, but the SDK setup itself is identical.

Base URL: `https://flex-api.sharetribe.com` (SDK default).

### `lib/auth.ts`

Three functions:
- `signIn(email, password)` — calls `sdk.login({ username: email, password })`
  and stores the returned access token in expo-secure-store under key
  `sherbrt_auth_token`. Returns the user object.
- `signOut()` — calls `sdk.logout()` and clears the secure store key.
- `getCurrentUser()` — if token exists in store, re-hydrate the SDK with it
  and call `sdk.currentUser.show()`. Returns user or null.

### `contexts/AuthContext.tsx`

Standard Provider pattern. State: `{ user, isLoading, signIn, signOut }`.
On mount, call `getCurrentUser()` to check for existing session. Expose via
`useAuth()` hook.

### `app/_layout.tsx`

Wraps app in `<AuthProvider>`. Uses Expo Router's Stack with a conditional:
if loading, show splash; if user, redirect to `/(tabs)`; else redirect to
`/(auth)/sign-in`.

### `app/(auth)/sign-in.tsx`

Minimal form: email TextInput, password TextInput (secure), "Sign in" button.
On submit, call `auth.signIn()`. Show inline error on failure. On success,
Expo Router's `useRouter().replace('/(tabs)')` navigates to tabs.

Styling: clean, centered, no brand polish yet. Use Sherbrt's existing color
from web (search web repo for primary color if unsure — but keep it simple).

### `app/(tabs)/_layout.tsx`

Bottom tabs with three tabs: Browse, Trips, Profile. Use Expo Router's Tabs
component. No icons needed today — placeholder text labels are fine.

### `app/(tabs)/profile.tsx`

Shows `Hello, {user.attributes.profile.firstName}` and a "Sign out" button.
On sign-out, call `auth.signOut()` then `router.replace('/(auth)/sign-in')`.

### `app/(tabs)/browse.tsx` and `trips.tsx`

Just a centered Text component saying "Browse — coming Day 2" and "Trips —
coming Day 4". Zero logic.

### `.env.example`

```
EXPO_PUBLIC_SHARETRIBE_CLIENT_ID=YOUR_CLIENT_ID_HERE
```

### `README.md`

Brief. Sections: Setup (clone, `npm install`, copy `.env.example` to `.env`,
fill in client ID), Run (`npx expo start`, press `i` for iOS simulator),
Current state (Day 1 — auth scaffold only).

## Exit criterion — verify before ending session

1. `npx expo start` boots the Metro bundler with no errors.
2. Press `i` — iOS simulator opens the app.
3. App lands on the sign-in screen.
4. Enter the user's actual Sherbrt credentials (they'll have them). Hit Sign in.
5. App navigates to the tabs. Profile tab shows "Hello, [their first name]".
6. Sign out returns to the sign-in screen.
7. Kill and relaunch the app — if previously signed in, it skips sign-in and
   goes straight to tabs (session persistence via secure-store works).

If all 7 pass, commit with message: `feat: day 1 — expo scaffold + sharetribe auth`

## Out of scope (do NOT do these)

- Do NOT build any listing/browse UI.
- Do NOT wire up Stripe (just install the package).
- Do NOT build sign-up / password reset / forgot password.
- Do NOT set up push notifications.
- Do NOT build out Android-specific config (iOS-first; Android works by default with Expo).
- Do NOT configure EAS Build yet (that's Day 6).
- Do NOT add app icons / splash screen branding (Day 5 polish).
- Do NOT modify anything in ~/shop-on-sherbet-cursor.

## Report-out

After pushing (or committing locally if no remote yet), report:
1. Folder path created.
2. Commit SHA.
3. Confirmation that all 7 exit-criterion checks passed (with the output from step 5: what name appeared on the profile screen).
4. Any deviations from the prescribed approach.
5. Any packages that failed to install or required version pinning different from what the web repo uses.
```

---

## Notes before you run it

**New CC session in a new folder:** this MUST run in a fresh CC session opened in `~/sherbrt-mobile`, not in your current `shop-on-sherbet-cursor` folder. CC's file access is scoped to the folder it starts in, so mixing the two would either let it edit the web app (bad) or block it from creating the mobile app (worse).

**You'll need your Sharetribe client ID from the web repo's `.env` file.** The CC session doesn't have access to that file from the mobile folder — after CC finishes scaffolding, you'll copy-paste the client ID from your web `.env` into `~/sherbrt-mobile/.env`. That's the only credential you need for Day 1.

**iOS simulator:** Expo's CLI opens it via `npx expo start` → press `i`. If you've never used it before, it'll install Xcode Command Line Tools on first run. Don't be alarmed if that takes 5 minutes the first time.

**Timeline expectation:** CC should complete this in roughly 30-45 minutes (scaffolding Expo + auth is well-trod territory). Report back when the 7 exit-criterion checks all pass and I'll help you validate + queue up the Day 2 prompt (browse feed + listing detail).

**This session stays focused on Scenario 1** — keep using this thread for Twilio confirmations and marking PASS/WAITING in v11 as comms arrive. The mobile app work happens in its own CC session. When you need strategic input on the app (architecture, tradeoffs, debugging help), you can either start a fresh Cowork session or come back to this one — just tell me which mode you want.

[View the full Day 1 prompt file](computer:///Users/amaliabornstein/shop-on-sherbet-cursor/docs/mobile_day1_cc_prompt.md)

Once you've opened a new terminal, run `mkdir ~/sherbrt-mobile && cd ~/sherbrt-mobile && git init` and launched Claude Code there, paste the fenced block above into the new session and let it cook.

One thing I want to flag as you enroll in Apple Developer: **enroll as an individual, not an organization**, unless you've already set up an LLC for Sherbrt. Individual enrollment is instant-to-24 hours. Organization enrollment requires a D-U-N-S number and takes 1-2 weeks. You can always migrate to organization later if you incorporate. For MVP speed, individual is the play.