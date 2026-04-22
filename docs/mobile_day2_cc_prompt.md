# Day 2 — Browse feed + listing detail

Paste the fenced block below into a **fresh Claude Code session** opened at `~/sherbrt-mobile`. Do NOT use a web-repo session or a session carrying Day 1 context — we want a clean context window for the Day 2 work.

**Before you run the prompt:**

1. Ensure Day 1 is committed and pushed (`git log` should show the import-fix commit above the scaffold commit).
2. Pull latest if working from a second machine (not usually applicable for solo dev).
3. Have the simulator / Expo Go ready so you can verify at the end.

---

```
# Sherbrt mobile app — Day 2: browse feed + listing detail

## Context

Read `CLAUDE_CONTEXT.md` at the repo root FIRST — it captures Day 1 decisions,
auth patterns, and the critical SDK import gotcha (namespace import required).

Day 1 shipped: Expo project scaffolded, Sharetribe auth working end-to-end,
three-tab navigation (Browse / Trips / Profile) scaffolded with Browse and
Trips as empty placeholders. Session persistence validated.

Day 2 scope: build the **Browse** tab into a functional listings feed, and add
a listing detail screen that opens when a card is tapped. After today, a
logged-in user can discover real Sharetribe listings and view a single listing
in detail. Booking action stays a placeholder until Day 3.

## Scope — what's IN Day 2

**Browse feed (`app/(tabs)/browse.tsx`):**
- Fetch public listings via `sdk.listings.query({ include: ['images', 'author'], 'fields.listing': ['title', 'price'], 'fields.image': ['variants.default', 'variants.square-small'], 'limit.images': 1, perPage: 20 })` — confirm exact param shape by reading the web repo's listing query at `~/shop-on-sherbet-cursor/src/containers/SearchPage/` if signatures are ambiguous.
- Render a vertically scrollable list using `FlatList` (NOT ScrollView — we want virtualization for performance).
- Each card shows: one image (square, ~full-width), listing title, price per day (use the SDK's Money type; format as `$X/day`).
- Loading state: ActivityIndicator centered.
- Error state: inline message + "Retry" button.
- Empty state: "No listings yet" centered (unlikely but possible).
- Pull-to-refresh enabled.
- Pagination: defer — 20 listings is enough for v0.1. Log a TODO comment where pagination would hook in.
- Tap a card → navigate to `/listing/[id]` passing the listing id.

**Listing detail screen (new file `app/listing/[id].tsx`):**
- Fetch the listing via `sdk.listings.show({ id, include: ['images', 'author'] })`.
- Show:
  - Image gallery: horizontal FlatList of all images, swipeable. Use full-width images with a pagination dot indicator if you have one quickly; otherwise skip indicator for Day 2.
  - Listing title (header-style)
  - Price per day (prominent)
  - Description (scrollable text; handle multi-paragraph)
  - Provider section: author's display name + small avatar if available; "Listed by {displayName}".
- "Request to borrow" button at the bottom: STATIC placeholder for Day 2 — wire an `onPress` that opens an Alert saying "Coming soon (Day 3)". Real booking flow lands Day 3.
- Loading / error / not-found states handled.
- Back button in nav bar (Expo Router provides this automatically).

## Scope — what's OUT

- Do NOT implement search input or filters. Add a TODO comment in browse.tsx noting where search would hook in.
- Do NOT implement the actual booking flow. The button is a placeholder only.
- Do NOT add reviews, favorites, sharing, or social links.
- Do NOT add map view or location-based filtering.
- Do NOT add infinite scroll / pagination past the first 20 results (TODO only).
- Do NOT modify anything outside `~/sherbrt-mobile/` (the web repo is read-only from this session).

## Implementation details

### SDK query shape

The `sharetribeSdk.types.LatLng` / `Money` types will come up. If you hit TS errors referencing these, extend the declarations file at `types/sharetribe-flex-sdk.d.ts` — do NOT use `any`. Read the web repo's `src/util/types.js` for the shape of `Money`, `listing`, `currentUser`, etc.

### Price formatting

Sharetribe returns prices as `{ amount: cents, currency: "USD" }`. Format as:

```ts
const formatPrice = (money: { amount: number; currency: string }) =>
  `$${(money.amount / 100).toFixed(2)}/day`;
```

Hardcode the "/day" suffix for v0.1 — all Sherbrt listings use day-based pricing.

### Image handling

Use the listing's included image variants. Fall back gracefully if images array is empty (display a gray placeholder). For the browse card, use `variants.square-small`. For the detail gallery, use `variants.default`. Dimensions: match width to device width, use aspectRatio: 1 for square, aspectRatio: 4/3 for default.

### Navigation

Expo Router v6: dynamic route at `app/listing/[id].tsx` is automatically handled. Navigate with:

```ts
import { useRouter } from 'expo-router';
const router = useRouter();
router.push(`/listing/${listing.id.uuid}`);
```

In the detail screen, read the param with `useLocalSearchParams<{ id: string }>()`.

### State management

Keep it simple — `useState` + `useEffect` for fetching. Do NOT introduce Redux, Zustand, or react-query. If you start feeling pain later (Day 3+), we'll add something.

## Styling notes

Match Day 1's minimal style — no brand polish yet. Use:
- Card padding: 16
- Card bg: white with subtle shadow (shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2)
- List background: #f8f8f8 (very light gray)
- Text: system default (Semibold for titles, Regular for everything else)
- Price accent: #6c2bd9 (Sherbrt purple, same as the sign-out button from Day 1)

Day 5 is the polish pass; don't sink time into pixel-perfect styling today.

## Exit criterion — verify before ending session

1. `npx expo start` boots Metro with no errors.
2. Scan the QR code in Expo Go (or press `i` if Xcode is installed now). App loads.
3. Sign in with existing credentials. App lands on Browse tab.
4. Browse tab shows a list of real listings from Sherbrt's live marketplace.
5. Each card has an image, title, and price.
6. Pull-to-refresh works: pull down, see the spinner, listings re-fetch.
7. Tap any card → detail screen opens with the full listing info.
8. Tap the "Request to borrow" button → Alert pops up saying "Coming soon".
9. Tap back → return to browse.
10. No TypeScript errors (`npx tsc --noEmit` passes).

If all 10 pass, commit with message: `feat: day 2 — listings browse + detail` and push to origin/main.

## Report-out

After pushing, report:
1. Commit SHA.
2. Confirmation that all 10 exit-criterion checks passed.
3. Number of listings that rendered in the feed (from your live marketplace).
4. Title and price of the first listing you tapped into detail view.
5. Any deviations from the prescribed approach.
6. Any SDK method signatures that differed from what the prompt anticipated.
7. Update `CLAUDE_CONTEXT.md` with a "Day 2 shipped" section summarizing:
   - Files added/modified
   - Commit SHA
   - New SDK methods used (so future sessions know they're covered by type declarations)
   - Any gotchas discovered today
```

---

## Notes before you run it

**Same rules as Day 1:** paste only the fenced block (starting from `# Sherbrt mobile app — Day 2...` through `...any gotchas discovered today`), NOT the "Notes before you run it" section.

**Fresh CC session, scoped to `~/sherbrt-mobile`.** Don't run this in a session carrying Day 1 context — start clean. The prompt tells CC to read `CLAUDE_CONTEXT.md` first, which is enough context to pick up where Day 1 left off.

**Expected time:** 1.5-2 hours of CC work for Day 2. More code surface than Day 1 (two new screens, SDK queries, image handling), but no unknowns.

**Context doc auto-update.** The prompt asks CC to update `CLAUDE_CONTEXT.md` with a Day 2 section at the end. This makes the context doc self-maintaining — each day's work appends to it, same pattern as the web repo's context.

**If you hit an issue during validation:** screenshot + paste the error here, same as yesterday. Most common Day 2 issues are (a) SDK query signature mismatches, (b) image aspect ratio weirdness, (c) Money type import paths. All are 1-5 minute fixes.

[View the Day 2 prompt file](computer:///Users/amaliabornstein/shop-on-sherbet-cursor/docs/mobile_day2_cc_prompt.md)
