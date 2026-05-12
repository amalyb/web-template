/**
 * Transaction process graph for bookings:
 *   - default-booking
 */

/**
 * Transitions
 *
 * These strings must sync with values defined in Marketplace API,
 * since transaction objects given by API contain info about last transitions.
 * All the actions in API side happen in transitions,
 * so we need to understand what those strings mean.
 */

export const transitions = {
  // When a customer makes a booking to a listing, a transaction is
  // created with the initial request-payment transition.
  // At this transition a PaymentIntent is created by Marketplace API.
  // After this transition, the actual payment must be made on client-side directly to Stripe.
  REQUEST_PAYMENT: 'transition/request-payment',

  // A customer can also initiate a transaction with an inquiry, and
  // then transition that with a request.
  INQUIRE: 'transition/inquire',
  REQUEST_PAYMENT_AFTER_INQUIRY: 'transition/request-payment-after-inquiry',

  // Stripe SDK might need to ask 3D security from customer, in a separate front-end step.
  // Therefore we need to make another transition to Marketplace API,
  // to tell that the payment is confirmed.
  CONFIRM_PAYMENT: 'transition/confirm-payment',

  // If the payment is not confirmed in the time limit set in transaction process (by default 15min)
  // the transaction will expire automatically.
  EXPIRE_PAYMENT: 'transition/expire-payment',

  // When the provider accepts or declines a transaction from the
  // SalePage, it is transitioned with the accept or decline transition.
  ACCEPT: 'transition/accept',
  DECLINE: 'transition/decline',

  // The operator can accept or decline the offer on behalf of the provider
  OPERATOR_ACCEPT: 'transition/operator-accept',
  OPERATOR_DECLINE: 'transition/operator-decline',

  // The backend automatically expire the transaction.
  EXPIRE: 'transition/expire',

  // Admin can also cancel the transition.
  CANCEL: 'transition/cancel',

  // Payout / completion guarded by return scan or replacement charge.
  COMPLETE_RETURN: 'transition/complete-return',
  COMPLETE_REPLACEMENT: 'transition/complete-replacement',

  // Reviews are given through transaction transitions. Review 1 can be
  // by provider or customer, and review 2 will be the other party of
  // the transaction.
  REVIEW_1_BY_PROVIDER: 'transition/review-1-by-provider',
  REVIEW_2_BY_PROVIDER: 'transition/review-2-by-provider',
  REVIEW_1_BY_CUSTOMER: 'transition/review-1-by-customer',
  REVIEW_2_BY_CUSTOMER: 'transition/review-2-by-customer',
  EXPIRE_CUSTOMER_REVIEW_PERIOD: 'transition/expire-customer-review-period',
  EXPIRE_PROVIDER_REVIEW_PERIOD: 'transition/expire-provider-review-period',
  EXPIRE_REVIEW_PERIOD: 'transition/expire-review-period',

  // Auto-cancel when an accepted booking is unshipped past its ship-by deadline
  // (fired by server/scripts/sendAutoCancelUnshipped.js). Same effect as CANCEL.
  AUTO_CANCEL_UNSHIPPED: 'transition/auto-cancel-unshipped',

  // Operator-fired payout transition (kept for parity with process.edn even
  // though it currently has no client-driven call site).
  OPERATOR_COMPLETE: 'transition/operator-complete',

  // Privileged late-fee charge transitions — they DO change protectedData
  // and create a Stripe charge, but the transaction stays in the same state
  // (delivered → delivered, accepted → accepted). They show up as
  // `lastTransition` after a charge succeeds, so the client must know about
  // them, otherwise `getState()` returns null and renders the broken
  // `TransactionPage.default-booking.<role>.null.title` translation key.
  PRIVILEGED_APPLY_LATE_FEES: 'transition/privileged-apply-late-fees',
  PRIVILEGED_APPLY_LATE_FEES_NON_RETURN: 'transition/privileged-apply-late-fees-non-return',

  // Operator-only protected-data self-loops added in process.edn v6 (Task #30,
  // May 1 2026). The server fires these via Integration SDK whenever it
  // persists protectedData (shipping artifacts, shippingNotification,
  // autoCancel flags, etc.). They keep the state the same but become the
  // tx's `lastTransition`, so the client MUST map them back to the underlying
  // state — otherwise PanelHeading renders e.g.
  // `TransactionPage.default-booking.provider.null.title`.
  OPERATOR_UPDATE_PD_ACCEPTED: 'transition/operator-update-pd-accepted',
  OPERATOR_UPDATE_PD_DELIVERED: 'transition/operator-update-pd-delivered',
  OPERATOR_UPDATE_PD_CANCELLED: 'transition/operator-update-pd-cancelled',
  OPERATOR_UPDATE_PD_REVIEWED: 'transition/operator-update-pd-reviewed',
  OPERATOR_UPDATE_PD_REVIEWED_BY_P: 'transition/operator-update-pd-reviewed-by-p',
  OPERATOR_UPDATE_PD_REVIEWED_BY_C: 'transition/operator-update-pd-reviewed-by-c',
};

/**
 * States
 *
 * These constants are only for making it clear how transitions work together.
 * You should not use these constants outside of this file.
 *
 * Note: these states are not in sync with states used transaction process definitions
 *       in Marketplace API. Only last transitions are passed along transaction object.
 */
export const states = {
  INITIAL: 'initial',
  INQUIRY: 'inquiry',
  PENDING_PAYMENT: 'pending-payment',
  PAYMENT_EXPIRED: 'payment-expired',
  PREAUTHORIZED: 'preauthorized',
  DECLINED: 'declined',
  ACCEPTED: 'accepted',
  EXPIRED: 'expired',
  CANCELED: 'canceled',
  DELIVERED: 'delivered',
  REVIEWED: 'reviewed',
  REVIEWED_BY_CUSTOMER: 'reviewed-by-customer',
  REVIEWED_BY_PROVIDER: 'reviewed-by-provider',
};

/**
 * Description of transaction process graph
 *
 * You should keep this in sync with transaction process defined in Marketplace API
 *
 * Note: we don't use yet any state machine library,
 *       but this description format is following Xstate (FSM library)
 *       https://xstate.js.org/docs/
 */
export const graph = {
  // id is defined only to support Xstate format.
  // However if you have multiple transaction processes defined,
  // it is best to keep them in sync with transaction process aliases.
  id: 'default-booking/release-1',

  // This 'initial' state is a starting point for new transaction
  initial: states.INITIAL,

  // States
  states: {
    [states.INITIAL]: {
      on: {
        [transitions.INQUIRE]: states.INQUIRY,
        [transitions.REQUEST_PAYMENT]: states.PENDING_PAYMENT,
      },
    },
    [states.INQUIRY]: {
      on: {
        [transitions.REQUEST_PAYMENT_AFTER_INQUIRY]: states.PENDING_PAYMENT,
      },
    },

    [states.PENDING_PAYMENT]: {
      on: {
        [transitions.EXPIRE_PAYMENT]: states.PAYMENT_EXPIRED,
        [transitions.CONFIRM_PAYMENT]: states.PREAUTHORIZED,
      },
    },

    [states.PAYMENT_EXPIRED]: {},
    [states.PREAUTHORIZED]: {
      on: {
        [transitions.DECLINE]: states.DECLINED,
        [transitions.OPERATOR_DECLINE]: states.DECLINED,
        [transitions.EXPIRE]: states.EXPIRED,
        [transitions.ACCEPT]: states.ACCEPTED,
        [transitions.OPERATOR_ACCEPT]: states.ACCEPTED,
      },
    },

    [states.DECLINED]: {},
    [states.EXPIRED]: {},
    [states.ACCEPTED]: {
      on: {
        [transitions.CANCEL]: states.CANCELED,
        [transitions.AUTO_CANCEL_UNSHIPPED]: states.CANCELED,
        [transitions.COMPLETE_RETURN]: states.DELIVERED,
        [transitions.COMPLETE_REPLACEMENT]: states.DELIVERED,
        [transitions.OPERATOR_COMPLETE]: states.DELIVERED,
        // Self-loops — keep state but become `lastTransition` once fired.
        [transitions.OPERATOR_UPDATE_PD_ACCEPTED]: states.ACCEPTED,
        [transitions.PRIVILEGED_APPLY_LATE_FEES_NON_RETURN]: states.ACCEPTED,
      },
    },

    [states.CANCELED]: {
      on: {
        [transitions.OPERATOR_UPDATE_PD_CANCELLED]: states.CANCELED,
      },
    },
    [states.DELIVERED]: {
      on: {
        [transitions.EXPIRE_REVIEW_PERIOD]: states.REVIEWED,
        [transitions.REVIEW_1_BY_CUSTOMER]: states.REVIEWED_BY_CUSTOMER,
        [transitions.REVIEW_1_BY_PROVIDER]: states.REVIEWED_BY_PROVIDER,
        // Self-loops — keep state but become `lastTransition` once fired.
        [transitions.OPERATOR_UPDATE_PD_DELIVERED]: states.DELIVERED,
        [transitions.PRIVILEGED_APPLY_LATE_FEES]: states.DELIVERED,
      },
    },

    [states.REVIEWED_BY_CUSTOMER]: {
      on: {
        [transitions.REVIEW_2_BY_PROVIDER]: states.REVIEWED,
        [transitions.EXPIRE_PROVIDER_REVIEW_PERIOD]: states.REVIEWED,
        [transitions.OPERATOR_UPDATE_PD_REVIEWED_BY_C]: states.REVIEWED_BY_CUSTOMER,
      },
    },
    [states.REVIEWED_BY_PROVIDER]: {
      on: {
        [transitions.REVIEW_2_BY_CUSTOMER]: states.REVIEWED,
        [transitions.EXPIRE_CUSTOMER_REVIEW_PERIOD]: states.REVIEWED,
        [transitions.OPERATOR_UPDATE_PD_REVIEWED_BY_P]: states.REVIEWED_BY_PROVIDER,
      },
    },
    [states.REVIEWED]: {
      // Was `{ type: 'final' }` — but the server can still fire an operator
      // protected-data self-loop here, so we accept it without changing state.
      on: {
        [transitions.OPERATOR_UPDATE_PD_REVIEWED]: states.REVIEWED,
      },
    },
  },
};

// Check if a transition is the kind that should be rendered
// when showing transition history (e.g. ActivityFeed)
// The first transition and most of the expiration transitions made by system are not relevant
export const isRelevantPastTransition = transition => {
  return [
    transitions.ACCEPT,
    transitions.OPERATOR_ACCEPT,
    transitions.CANCEL,
    transitions.AUTO_CANCEL_UNSHIPPED,
    transitions.COMPLETE_RETURN,
    transitions.COMPLETE_REPLACEMENT,
    transitions.OPERATOR_COMPLETE,
    transitions.CONFIRM_PAYMENT,
    transitions.DECLINE,
    transitions.OPERATOR_DECLINE,
    transitions.EXPIRE,
    transitions.REVIEW_1_BY_CUSTOMER,
    transitions.REVIEW_1_BY_PROVIDER,
    transitions.REVIEW_2_BY_CUSTOMER,
    transitions.REVIEW_2_BY_PROVIDER,
  ].includes(transition);
};

// Processes might be different on how reviews are handled.
// Default processes use two-sided diamond shape, where either party can make the review first
export const isCustomerReview = transition => {
  return [transitions.REVIEW_1_BY_CUSTOMER, transitions.REVIEW_2_BY_CUSTOMER].includes(transition);
};

// Processes might be different on how reviews are handled.
// Default processes use two-sided diamond shape, where either party can make the review first
export const isProviderReview = transition => {
  return [transitions.REVIEW_1_BY_PROVIDER, transitions.REVIEW_2_BY_PROVIDER].includes(transition);
};

// Check if the given transition is privileged.
//
// Privileged transitions need to be handled from a secure context,
// i.e. the backend. This helper is used to check if the transition
// should go through the local API endpoints, or if using JS SDK is
// enough.
export const isPrivileged = transition => {
  return [transitions.REQUEST_PAYMENT, transitions.REQUEST_PAYMENT_AFTER_INQUIRY].includes(
    transition
  );
};

// Check when transaction is completed (booking over)
export const isCompleted = transition => {
  const txCompletedTransitions = [
    transitions.COMPLETE_RETURN,
    transitions.COMPLETE_REPLACEMENT,
    transitions.OPERATOR_COMPLETE,
    transitions.REVIEW_1_BY_CUSTOMER,
    transitions.REVIEW_1_BY_PROVIDER,
    transitions.REVIEW_2_BY_CUSTOMER,
    transitions.REVIEW_2_BY_PROVIDER,
    transitions.EXPIRE_REVIEW_PERIOD,
    transitions.EXPIRE_CUSTOMER_REVIEW_PERIOD,
    transitions.EXPIRE_PROVIDER_REVIEW_PERIOD,
  ];
  return txCompletedTransitions.includes(transition);
};

// Check when transaction is refunded (booking did not happen)
// In these transitions action/stripe-refund-payment is called
export const isRefunded = transition => {
  const txRefundedTransitions = [
    transitions.EXPIRE_PAYMENT,
    transitions.EXPIRE,
    transitions.CANCEL,
    transitions.AUTO_CANCEL_UNSHIPPED,
    transitions.DECLINE,
  ];
  return txRefundedTransitions.includes(transition);
};

export const statesNeedingProviderAttention = [states.PREAUTHORIZED];
