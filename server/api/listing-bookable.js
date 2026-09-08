/**
 * GET /api/listing-bookable?listingId=<uuid>
 *
 * Answers one question for the listing page: can a borrower actually complete
 * a booking on this listing right now?
 *
 * WHY THIS EXISTS
 *
 * A lender may publish without connecting Stripe — that is deliberate and must
 * stay that way. But a borrower who reaches checkout on such a listing gets
 * HTTP 409 `transaction-missing-stripe-account` from Sharetribe, which before
 * this surfaced as a blank page.
 *
 * The front end cannot answer this itself. The public Marketplace API exposes
 * only `banned, deleted, createdAt, state, profile` for a listing's author —
 * `stripeConnected` is absent, and `include: ['stripeAccount']` is silently
 * ignored (empty `included`, no error). Only the Integration API can see it,
 * which means server-side, which means this endpoint.
 *
 * FAIL OPEN — THIS IS THE IMPORTANT PART
 *
 * Every failure path here returns `bookable: true`. If the Integration API is
 * down, slow, rate-limited, or misconfigured, borrowers keep shopping and
 * Sharetribe's own 409 remains the backstop at checkout. Blocking the entire
 * storefront because one lookup failed is far worse than the problem being
 * solved. The ONLY thing that returns `bookable: false` is a successful
 * lookup that positively says the author has no connected Stripe account.
 *
 * Cached for CACHE_TTL_MS keyed by author id, so repeat views of a lender's
 * listings cost nothing.
 */

const { getIntegrationSdk } = require('../api-util/integrationSdk');

const CACHE_TTL_MS = 60 * 1000;
const LOOKUP_TIMEOUT_MS = 3000;

// authorId -> { stripeConnected: boolean, expiresAt: number }
const cache = new Map();

// listingId -> authorId. Listing authorship never changes, so this needs no TTL.
const authorCache = new Map();

const prune = now => {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
};

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);

const BOOKABLE = { bookable: true, reason: null };

module.exports = async (req, res) => {
  const listingId = req.query?.listingId;

  const allow = (reason, extra = {}) =>
    res.status(200).json({ bookable: true, reason, ...extra });

  if (!listingId || typeof listingId !== 'string') {
    // Malformed request: fail open rather than gating on our own bug.
    return allow('missing-listing-id');
  }

  try {
    const sdk = getIntegrationSdk();
    const now = Date.now();
    prune(now);

    // Resolve author (cached forever — authorship is immutable).
    let authorId = authorCache.get(listingId);
    if (!authorId) {
      // `include: ['author']` is REQUIRED — without it the Integration API
      // omits `relationships` entirely and the author id can never be
      // resolved, which would silently fail open for every listing and make
      // this endpoint a no-op.
      const listingRes = await withTimeout(
        sdk.listings.show({ id: listingId, include: ['author'] }),
        LOOKUP_TIMEOUT_MS,
        'listings.show'
      );
      authorId = listingRes?.data?.data?.relationships?.author?.data?.id?.uuid;
      if (!authorId) return allow('author-not-resolved');
      authorCache.set(listingId, authorId);
    }

    // Stripe status, cached with a short TTL so a lender who connects Stripe
    // becomes bookable within a minute without a deploy or a cache bust.
    const cached = cache.get(authorId);
    if (cached && cached.expiresAt > now) {
      return res.status(200).json(
        cached.stripeConnected
          ? BOOKABLE
          : { bookable: false, reason: 'provider-missing-stripe-account' }
      );
    }

    const userRes = await withTimeout(
      sdk.users.show({ id: authorId }),
      LOOKUP_TIMEOUT_MS,
      'users.show'
    );
    const stripeConnected = !!userRes?.data?.data?.attributes?.stripeConnected;
    cache.set(authorId, { stripeConnected, expiresAt: now + CACHE_TTL_MS });

    if (!stripeConnected) {
      console.log('[listing-bookable] not bookable', {
        listingId,
        authorId,
        reason: 'provider-missing-stripe-account',
      });
      return res
        .status(200)
        .json({ bookable: false, reason: 'provider-missing-stripe-account' });
    }

    return res.status(200).json(BOOKABLE);
  } catch (e) {
    // FAIL OPEN. Log loudly, let the borrower through, let checkout be the
    // backstop. Never let this endpoint take down the storefront.
    console.error('[listing-bookable] lookup failed — failing open', {
      listingId,
      status: e?.status,
      message: e?.message,
      errors: JSON.stringify(e?.data?.errors ?? null),
    });
    return allow('lookup-failed');
  }
};
