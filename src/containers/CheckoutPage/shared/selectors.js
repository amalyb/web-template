/**
 * Selectors for checkout state
 * Extracted to break circular dependencies between containers and ducks
 */

/**
 * Select if current user has been fetched with Stripe customer data
 * @param {Object} state - Redux state
 * @returns {boolean}
 */
export function selectHasFetchedCurrentUser(state) {
  const userState = state.user || {};
  return !!userState.currentUserFetched;
}

/**
 * Select if current user is being fetched
 * @param {Object} state - Redux state  
 * @returns {boolean}
 */
export function selectIsFetchingCurrentUser(state) {
  const userState = state.user || {};
  return !!userState.currentUserShowInProgress;
}

