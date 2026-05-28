// PaymentsReturnPage — bounce target for the Sherbrt mobile app's Stripe
// Connect onboarding return.
//
// Why this exists:
//   The mobile app (sherbrt-mobile) opens Stripe-hosted Connect onboarding
//   inside an in-app ASWebAuthenticationSession. Stripe rejects custom-
//   scheme URLs (`sherbrt://...`) on `account_links` with
//   `validation-invalid-params` / `url_invalid`, so the mobile code passes
//   this HTTPS URL as the successURL/failureURL:
//     https://sherbrt.com/account/payments-return
//   Stripe redirects the lender here when onboarding completes; this page
//   immediately JS-redirects to the `sherbrt://account/payments-return`
//   deep link, preserving any query params Stripe appended (e.g.
//   `?account=acct_xxx`). The mobile app's auth session intercepts the
//   custom-scheme navigation, auto-dismisses the browser, and resumes the
//   wizard's publish() flow or the standalone payouts screen.
//
// Source of truth:
//   sherbrt-mobile/web/payments-return.html (standalone reference) and
//   sherbrt-mobile/lib/stripeConnect.ts (PAYOUT_RETURN_URL /
//   PAYOUT_RETURN_DEEP_LINK constants).
//
// Notes:
//   - SSR-safe: every `window` access is guarded.
//   - No marketplace chrome (header/footer). The page is meant to be
//     visible for ~0 seconds; chrome would only add noise.
//   - The visible button is a fallback for the unlikely case the JS
//     redirect doesn't fire (no-JS, user navigates back, etc.).
//   - No auth gate. Stripe's redirect doesn't carry web session state;
//     identity belongs to the mobile app side of this flow.
import React, { useEffect } from 'react';

const APP_RETURN_SCHEME = 'sherbrt://account/payments-return';

const styles = {
  wrap: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px 24px',
    textAlign: 'center',
    boxSizing: 'border-box',
    background: '#fef8f0',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    color: '#1a1a1a',
  },
  heading: { fontSize: 24, fontWeight: 700, margin: '0 0 8px' },
  body: { fontSize: 16, color: '#6b6b6b', margin: '0 0 24px', lineHeight: 1.4 },
  link: {
    display: 'inline-block',
    background: '#a8e6cf',
    color: '#1a1a1a',
    textDecoration: 'none',
    fontWeight: 600,
    fontSize: 16,
    padding: '14px 28px',
    borderRadius: 999,
  },
};

const buildTarget = () => {
  if (typeof window === 'undefined') return APP_RETURN_SCHEME;
  return APP_RETURN_SCHEME + (window.location.search || '');
};

const PaymentsReturnPage = () => {
  useEffect(() => {
    // setTimeout(0) so the navigation kicks on the next tick — in-app
    // browsers register the redirect more reliably than synchronous
    // location.replace on first paint.
    const t = window.setTimeout(() => {
      window.location.replace(buildTarget());
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const href = buildTarget();

  return (
    <div style={styles.wrap}>
      <h1 style={styles.heading}>Almost done!</h1>
      <p style={styles.body}>Returning you to the Sherbrt app…</p>
      <a style={styles.link} href={href}>
        Tap here if you’re not redirected
      </a>
    </div>
  );
};

export default PaymentsReturnPage;
