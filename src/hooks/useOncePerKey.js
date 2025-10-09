import { useEffect, useRef } from 'react';

/**
 * A hook that runs a function only once per unique key, per component lifetime and per browser session.
 * Uses both a ref (for component lifetime) and sessionStorage (for browser session) to prevent duplicate executions.
 * 
 * @param {string} key - A unique key identifying this particular action (e.g. "checkout-session-abc123")
 * @param {function} fn - The function to run once per key
 * @param {object} options - Optional configuration
 * @param {Storage} options.storage - Storage to use for persistence (default: window.sessionStorage)
 */
export default function useOncePerKey(key, fn, { storage = window?.sessionStorage } = {}) {
  const ranRef = useRef(false);

  useEffect(() => {
    if (!key || typeof fn !== 'function') return;
    // If already run in this component lifetime
    if (ranRef.current) return;

    // If already run in this browser session (sessionStorage)
    let already = false;
    try {
      const marker = storage?.getItem?.(`once:${key}`);
      if (marker === '1') already = true;
    } catch (_) {}

    if (already) return;

    ranRef.current = true;
    Promise.resolve()
      .then(() => fn())
      .then(() => {
        try { storage?.setItem?.(`once:${key}`, '1'); } catch (_) {}
      })
      .catch(err => {
        // Allow retry next mount if it failed
        ranRef.current = false;
        // Do not set the storage key on failure
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.error('[useOncePerKey] error for key', key, err);
        }
      });
  // key must be a string; fn is excluded on purpose to avoid re-run
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

