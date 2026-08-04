# Meta Conversions API (CAPI) — Sherbrt Implementation

Browser Pixel + server Conversions API for the two meaningful Sherbrt
conversions, with shared-event-id deduplication. The browser Pixel is
**not** replaced — this is additive.

- Meta dataset / pixel: **Sherbrt Web Pixel**, ID `838865308919724`
- Graph API version: from `META_GRAPH_API_VERSION` (default `v23.0`) — bump to the
  current supported version; never hard-coded in code paths.

## 1. Summary

| Event | Browser Pixel | Server CAPI | Dedup key |
|---|---|---|---|
| `CompleteRegistration` | fires after account created (existing) | new: `/api/meta/complete-registration` | shared `event_id` |
| `LenderActivated` (custom) | fires **only** on first activation now | new: `/api/meta/lender-activated` | shared `event_id` |
| `Lead` | browser only (unchanged) | **not sent** (see §3) | n/a |
| `PageView` | browser only (unchanged) | not sent | n/a |

Server events are sent only after the backend action succeeds, are idempotent,
retry on transient Meta errors, time out fast, and never block signup or publish.

## 2. Exact business triggers

- **CompleteRegistration** — the Sharetribe `currentUser.create` succeeded (email
  path) or IdP confirm succeeded (social path). Fired from `src/ducks/auth.duck.js`
  (`signup` and `signupWithIdp`). NOT fired for opening/starting the signup form.
- **LenderActivated** — a lender publishes a listing that becomes `state:
  "published"`, and it is that user's **first** activation. Fired from
  `src/containers/EditListingPage/EditListingPage.duck.js` (`requestPublishListingDraft`).
  The server verifies the listing is live, owned by the user, and enforces
  once-per-user idempotency. Does NOT fire for drafts, abandoned/unpublished
  listings, edits to an already-published listing, or any subsequent listing.
- **Lead** — browser only. Confirmed trigger: `SignupForm.js` fires
  `Lead { content_name: 'Signup Started' }` when the user begins the signup form.
  That is a form interaction, not a completed business action, so per the brief it
  is intentionally **not** sent via CAPI. CompleteRegistration is the true signup
  conversion.

## 3. Code paths

Browser (Pixel):
- `src/util/metaPixel.js` — `track/trackCustom` now accept an fbq options arg;
  `completeRegistration({ eventId })` passes `{ eventID }`; `customEvent(name, params, options)`;
  `newEventId()` generates the shared id.
- `src/ducks/auth.duck.js` — generates `regEventId`, passes it to the browser
  `CompleteRegistration` and to the server endpoint.
- `src/containers/EditListingPage/EditListingPage.duck.js` — calls the server
  endpoint first; fires the browser `LenderActivated` only when the server
  responds `firstActivation: true`, using the same event id.

Server (CAPI):
- `server/api-util/metaCapi.js` — normalization + SHA-256 hashing, `user_data`
  builder, request-context reader (`_fbp`/`_fbc`/IP/UA), timeout + retry sender,
  safe logging. Never throws.
- `server/api/meta/complete-registration.js` — `POST /api/meta/complete-registration`
- `server/api/meta/lender-activated.js` — `POST /api/meta/lender-activated`
- `server/apiRouter.js` — route registration.

## 4. Deduplication method

One durable `event_id` per real-world event is generated in the browser
(`newEventId()`), attached to the Pixel event as `eventID`, and posted to the
server which sends it as `event_id` with the **same** `event_name`. Meta collapses
the browser + server pair into a single event. For `LenderActivated` the browser
event is only emitted after the server confirms the first activation (and echoes
the id back), so the two channels stay in lockstep.

## 5. User-data fields, normalization & hashing

SHA-256 hashed after normalization (lowercased/trimmed):
`em` (email), `ph` (phone → digits only, incl. country code), `fn`, `ln`,
`ct` (city, letters only), `st` (state, letters only), `zp` (zip, 5-digit),
`country` (2-letter), `external_id` (Sharetribe user UUID).

Sent in the clear (Meta requires raw): `fbp` (`_fbp` cookie), `fbc` (`_fbc`
cookie), `client_ip_address`, `client_user_agent`.

Also sent per event: `event_name`, `event_time`, `event_id`,
`action_source: "website"`, `event_source_url`.

Never sent: passwords, payment details, or unnecessary personal data. Logs record
event name, event id, timestamp, match-key **count**, Meta response status and
`fbtrace_id` — never raw tokens or raw PII.

## 6. Idempotency & reliability

- `CompleteRegistration`: after a successful send, `profile.privateData.metaRegistrationSent`
  is set; subsequent calls are suppressed.
- `LenderActivated`: gated on `profile.privateData.metaLenderActivatedSent`; set only
  after a successful send (so a failed send can be retried later).
- Transient Meta errors (HTTP 5xx / 429 / timeout) retry up to `META_CAPI_MAX_RETRIES`
  with backoff; `META_CAPI_TIMEOUT_MS` bounds each attempt. Failures are swallowed.

## 7. Consent & privacy

The current site has **no cookie-consent / opt-out framework** — the browser Pixel
loads unconditionally whenever `metaPixelId` is set. Because there is no opt-out
signal today, the server CAPI does not bypass one; it fires under the same
condition as the Pixel. If/when a consent banner is added, gate both the Pixel init
(`src/util/includeScripts.js`), `_fbp`/`_fbc` usage, and these CAPI calls on the
stored consent, and apply Meta `data_processing_options` for regulated
jurisdictions. This is the one privacy change to plan for; it is documented here as
a follow-up, not silently assumed.

## 8. Configuration (env)

Local dev uses `.env`; production uses Render dashboard env vars. Test and prod
credentials are kept in separate env files.

```
META_CAPI_ACCESS_TOKEN=<System User token>   # secret; never commit
META_DATASET_ID=838865308919724
META_GRAPH_API_VERSION=v23.0
META_CAPI_ENABLED=true
META_TEST_EVENT_CODE=<set while testing; blank in prod>
```

## 9. Testing

Standalone connectivity/EMQ check (no app run needed):
```
# set META_TEST_EVENT_CODE in .env first (Events Manager > Test Events)
node scripts/meta-capi-test-event.js
```
End-to-end (with `META_TEST_EVENT_CODE` set, watching Events Manager > Test Events):
1. Create a new account → expect ONE browser + ONE server `CompleteRegistration`,
   deduplicated into one.
2. Publish that account's first listing → expect ONE browser + ONE server
   `LenderActivated`, deduplicated.
3. Refresh / repeat requests → no duplicate business events.
4. Publish a second listing → `LenderActivated` does NOT fire again.
5. Confirm `_fbp`, `_fbc` and available matching fields appear on the server event.

Remove `META_TEST_EVENT_CODE` (leave blank) for production once verified.

## 10. Rollback plan

- Fastest kill switch: set `META_CAPI_ENABLED=false` (or unset
  `META_CAPI_ACCESS_TOKEN`) in the environment and redeploy — the server sender
  no-ops; the browser Pixel is unaffected.
- Full revert: this is an isolated feature branch (`feature/meta-capi`). Revert the
  commit or delete the branch; the only edits to existing files are in
  `metaPixel.js`, `auth.duck.js`, `EditListingPage.duck.js`, and `apiRouter.js`.
- The browser Pixel continues working independently at every step; nothing here can
  block signup or listing publication (all CAPI calls are non-blocking and caught).
