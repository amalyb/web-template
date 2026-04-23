const {
  calculateQuantityFromDates,
  calculateQuantityFromHours,
  calculateTotalFromLineItems,
  calculateShippingFee,
  hasCommissionPercentage,
} = require('./lineItemHelpers');
const { types } = require('sharetribe-flex-sdk');
const { Money } = types;
const { estimateRoundTrip } = require('../lib/shipping');
const { DEBUG_SHIPPING_VERBOSE } = require('../config/shipping');

// Verbose logging helper
const vlog = (...args) => DEBUG_SHIPPING_VERBOSE && console.log(...args);

const LINE_ITEM_ESTIMATED_SHIPPING = 'line-item/estimated-shipping';

/**
 * Fetch borrower and lender ZIP codes
 * Strategy: Try to get lender ZIP from listing include first, then fetch separately if needed
 * @param {Object} params - { listingId, currentUserId, sdk }
 * @returns {Promise<{ borrowerZip: string|null, lenderZip: string|null }>}
 */
async function getZips({ listingId, currentUserId, sdk }) {
  try {
    if (!sdk) {
      console.log('[getZips] No SDK provided');
      return { borrowerZip: null, lenderZip: null };
    }

    // Fetch listing with author profile included (minimize API calls)
    const { data: listingData } = await sdk.listings.show({ 
      id: listingId, 
      include: ['author', 'author.profile'],
      'fields.user': ['profile'],
      'fields.profile': ['publicData']
    });
    
    const listing = listingData?.data;
    const included = listingData?.included || [];
    
    // Extract lender info from relationships
    const lenderId = listing?.relationships?.author?.data?.id?.uuid;

    if (!lenderId) {
      console.log('[getZips] No lender ID found in listing');
      return { borrowerZip: null, lenderZip: null };
    }

    console.log('[getZips] Found lender', { 
      hasLenderId: !!lenderId,
      hasBorrowerId: !!currentUserId 
    });

    // Try to extract lender ZIP from included data (listing already fetched author)
    let lenderZip = null;
    let viaIncludedAuthor = false;
    const lenderUser = included.find(inc => 
      inc.type === 'user' && inc.id?.uuid === lenderId
    );
    
    if (lenderUser) {
      lenderZip = lenderUser?.attributes?.profile?.publicData?.shippingZip ||
                  lenderUser?.attributes?.profile?.protectedData?.shippingZip ||
                  null;
      viaIncludedAuthor = !!lenderZip;
      vlog('[getZips] Lender ZIP from listing include', { hasLenderZip: !!lenderZip });
      console.log('[getZips] Lender ZIP from listing include', { hasLenderZip: !!lenderZip });
    }

    // If lender ZIP not in included data, fetch separately
    if (!lenderZip && lenderId) {
      try {
        const { data: lenderData } = await sdk.users.show({
          id: lenderId,
          include: ['profile'],
          'fields.user': ['profile'],
          'fields.profile': ['publicData']
        });
        
        const lenderProfile = lenderData?.data?.attributes?.profile;
        lenderZip = lenderProfile?.publicData?.shippingZip ||
                    lenderProfile?.protectedData?.shippingZip ||
                    null;
        vlog('[getZips] Lender ZIP from separate fetch', { hasLenderZip: !!lenderZip });
        console.log('[getZips] Lender ZIP from separate fetch', { hasLenderZip: !!lenderZip });
      } catch (err) {
        vlog('[getZips] Error fetching lender', { error: err.message });
        console.error('[getZips] Error fetching lender:', err.message);
      }
    }

    // Fetch borrower (current user) ZIP
    let borrowerZip = null;
    if (currentUserId) {
      try {
        const { data: borrowerData } = await sdk.users.show({
          id: currentUserId,
          include: ['profile'],
          'fields.user': ['profile'],
          'fields.profile': ['publicData']
        });
        
        const borrowerProfile = borrowerData?.data?.attributes?.profile;
        borrowerZip = borrowerProfile?.publicData?.shippingZip ||
                      borrowerProfile?.protectedData?.shippingZip ||
                      null;
        vlog('[getZips] Borrower ZIP fetched', { hasBorrowerZip: !!borrowerZip });
        console.log('[getZips] Borrower ZIP fetched', { hasBorrowerZip: !!borrowerZip });
      } catch (err) {
        vlog('[getZips] Error fetching borrower', { error: err.message });
        console.error('[getZips] Error fetching borrower:', err.message);
      }
    }

    vlog('[getZips]', { 
      hasBorrowerZip: !!borrowerZip, 
      hasLenderZip: !!lenderZip,
      viaIncludedAuthor 
    });
    console.log('[getZips] Result', { 
      hasBorrowerZip: !!borrowerZip, 
      hasLenderZip: !!lenderZip 
    });
    
    return { borrowerZip, lenderZip };
  } catch (err) {
    console.error('[getZips] Error:', err.message);
    return { borrowerZip: null, lenderZip: null };
  }
}

// Zero-priced placeholder used when we can't estimate (missing ZIPs, Shippo
// down, etc.). Keeps totals math happy; Sharetribe will display
// "calculated at checkout" to the user.
const PLACEHOLDER_LINE_ITEM = {
  code: LINE_ITEM_ESTIMATED_SHIPPING,
  unitPrice: new Money(0, 'USD'),
  quantity: 1,
  includeFor: ['customer'],
  calculatedAtCheckout: true,
};

/**
 * Build shipping line item with estimate or calculatedAtCheckout fallback.
 *
 * 10.0 PR-2 step 4: return shape now carries `outboundRate` and `returnRate`
 * locked-rate payloads so the caller can persist them to
 * protectedData.{outbound,return}.lockedRate at preauth time.
 *
 * @param {Object} params - { listing, currentUserId, sdk }
 * @returns {Promise<{lineItem: Object, outboundRate: Object|null, returnRate: Object|null}>}
 */
async function buildShippingLine({ listing, currentUserId, sdk }) {
  try {
    const { borrowerZip, lenderZip } = await getZips({
      listingId: listing.id.uuid,
      currentUserId,
      sdk,
    });

    if (!borrowerZip || !lenderZip) {
      vlog('[buildShippingLine] Missing ZIPs', {
        hasBorrowerZip: !!borrowerZip,
        hasLenderZip: !!lenderZip,
      });
      console.log('[buildShippingLine] Missing ZIPs, using calculatedAtCheckout');
      return { lineItem: PLACEHOLDER_LINE_ITEM, outboundRate: null, returnRate: null };
    }

    // Optional: read per-listing parcel from listing.publicData
    const parcel = listing?.attributes?.publicData?.parcel || null;
    vlog('[buildShippingLine] Calling estimateRoundTrip', {
      hasBorrowerZip: !!borrowerZip,
      hasLenderZip: !!lenderZip,
      hasParcel: !!parcel,
    });

    const est = await estimateRoundTrip({ lenderZip, borrowerZip, parcel });
    if (!est) {
      console.log('[buildShippingLine] Estimate failed, using calculatedAtCheckout');
      return { lineItem: PLACEHOLDER_LINE_ITEM, outboundRate: null, returnRate: null };
    }

    vlog('[buildShippingLine]', {
      hasBorrowerZip: !!borrowerZip,
      hasLenderZip: !!lenderZip,
      estOk: !!est,
      amountCents: est?.amountCents,
    });
    console.log('[buildShippingLine] Estimate successful', {
      amountCents: est.amountCents,
      outboundRateId: est.outboundRate?.rateObjectId || null,
      returnRateId: est.returnRate?.rateObjectId || null,
    });
    const lineItem = {
      code: LINE_ITEM_ESTIMATED_SHIPPING,
      unitPrice: new Money(est.amountCents, est.currency),
      quantity: 1,
      includeFor: ['customer'],
      calculatedAtCheckout: false,
    };
    return {
      lineItem,
      outboundRate: est.outboundRate || null,
      returnRate: est.returnRate || null,
    };
  } catch (e) {
    vlog('[buildShippingLine] Error caught', { error: e.message });
    console.error('[buildShippingLine] Error:', e.message);
    // Keep UI resilient — placeholder keeps totals math happy.
    return { lineItem: PLACEHOLDER_LINE_ITEM, outboundRate: null, returnRate: null };
  }
}

/**
 * Get quantity and add extra line-items that are related to delivery method
 *
 * @param {Object} orderData should contain stockReservationQuantity and deliveryMethod
 * @param {*} publicData should contain shipping prices
 * @param {*} currency should point to the currency of listing's price.
 */
const getItemQuantityAndLineItems = (orderData, publicData, currency) => {
  // Check delivery method and shipping prices
  const quantity = orderData ? orderData.stockReservationQuantity : null;
  const deliveryMethod = orderData && orderData.deliveryMethod;
  const isShipping = deliveryMethod === 'shipping';
  const isPickup = deliveryMethod === 'pickup';
  const { shippingPriceInSubunitsOneItem, shippingPriceInSubunitsAdditionalItems } =
    publicData || {};

  // Calculate shipping fee if applicable
  const shippingFee = isShipping
    ? calculateShippingFee(
        shippingPriceInSubunitsOneItem,
        shippingPriceInSubunitsAdditionalItems,
        currency,
        quantity
      )
    : null;

  // Add line-item for given delivery method.
  // Note: by default, pickup considered as free.
  const deliveryLineItem = !!shippingFee
    ? [
        {
          code: 'line-item/shipping-fee',
          unitPrice: shippingFee,
          quantity: 1,
          includeFor: ['customer', 'provider'],
        },
      ]
    : isPickup
    ? [
        {
          code: 'line-item/pickup-fee',
          unitPrice: new Money(0, currency),
          quantity: 1,
          includeFor: ['customer', 'provider'],
        },
      ]
    : [];

  return { quantity, extraLineItems: deliveryLineItem };
};

/**
 * Get quantity for fixed bookings with seats.
 * @param {Object} orderData
 * @param {number} [orderData.seats]
 */
const getFixedQuantityAndLineItems = orderData => {
  const { seats } = orderData || {};
  const hasSeats = !!seats;
  // If there are seats, the quantity is split to factors: units and seats.
  // E.g. 1 session x 2 seats (aka unit price is multiplied by 2)
  return hasSeats ? { units: 1, seats, extraLineItems: [] } : { quantity: 1, extraLineItems: [] };
};

/**
 * Get quantity for arbitrary units for time-based bookings.
 *
 * @param {Object} orderData
 * @param {string} orderData.bookingStart
 * @param {string} orderData.bookingEnd
 * @param {number} [orderData.seats]
 */
const getHourQuantityAndLineItems = orderData => {
  const { bookingStart, bookingEnd, seats } = orderData || {};
  const hasSeats = !!seats;
  const units =
    bookingStart && bookingEnd ? calculateQuantityFromHours(bookingStart, bookingEnd) : null;

  // If there are seats, the quantity is split to factors: units and seats.
  // E.g. 3 hours x 2 seats (aka unit price is multiplied by 6)
  return hasSeats ? { units, seats, extraLineItems: [] } : { quantity: units, extraLineItems: [] };
};

/**
 * Calculate quantity based on days or nights between given bookingDates.
 *
 * @param {Object} orderData
 * @param {string} orderData.bookingStart
 * @param {string} orderData.bookingEnd
 * @param {number} [orderData.seats]
 * @param {'line-item/day' | 'line-item/night'} code
 */
const getDateRangeQuantityAndLineItems = (orderData, code) => {
  const { bookingStart, bookingEnd, seats } = orderData;
  const hasSeats = !!seats;
  const units =
    bookingStart && bookingEnd ? calculateQuantityFromDates(bookingStart, bookingEnd, code) : null;

  // If there are seats, the quantity is split to factors: units and seats.
  // E.g. 3 nights x 4 seats (aka unit price is multiplied by 12)
  return hasSeats ? { units, seats, extraLineItems: [] } : { quantity: units, extraLineItems: [] };
};

/**
 * Returns collection of lineItems (max 50)
 *
 * All the line-items dedicated to _customer_ define the "payin total".
 * Similarly, the sum of all the line-items included for _provider_ create "payout total".
 * Platform gets the commission, which is the difference between payin and payout totals.
 *
 * Each line items has following fields:
 * - `code`: string, mandatory, indentifies line item type (e.g. \"line-item/cleaning-fee\"), maximum length 64 characters.
 * - `unitPrice`: money, mandatory
 * - `lineTotal`: money
 * - `quantity`: number
 * - `percentage`: number (e.g. 15.5 for 15.5%)
 * - `seats`: number
 * - `units`: number
 * - `includeFor`: array containing strings \"customer\" or \"provider\", default [\":customer\"  \":provider\" ]
 *
 * Line item must have either `quantity` or `percentage` or both `seats` and `units`.
 *
 * `includeFor` defines commissions. Customer commission is added by defining `includeFor` array `["customer"]` and provider commission by `["provider"]`.
 *
 * @param {Object} listing
 * @param {Object} orderData
 * @param {Object} providerCommission
 * @param {Object} customerCommission
 * @param {Object} options - Optional { currentUserId, sdk } for shipping estimation
 * @returns {Promise<Array>} lineItems
 */
exports.transactionLineItems = async (listing, orderData, providerCommission, customerCommission, options = {}) => {
  const { publicData, price: flatPrice } = listing.attributes;
  const unitType = publicData.unitType;
  const currency = flatPrice.currency;

  // Ensure 3-night minimum
  const { bookingStart, bookingEnd } = orderData || {};
  const startDate = new Date(bookingStart);
  const endDate = new Date(bookingEnd);
  const nights = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));

  // Add debug logging
  console.log('🕓 Booking dates debug:');
  console.log('📅 bookingStart (raw):', bookingStart);
  console.log('📅 bookingEnd (raw):', bookingEnd);
  console.log('📆 Parsed startDate:', startDate);
  console.log('📆 Parsed endDate:', endDate);
  console.log('🌙 Calculated nights:', nights);

  if (nights < 3) {
    throw new Error('Minimum booking is 3 nights');
  }

  // Calculate base per-day rate from flat price (3-night value)
  const basePerDay = Math.round(flatPrice.amount / 3);
  const unitPrice = new Money(basePerDay, currency);

  const order = {
    code: 'line-item/day',
    unitPrice,
    quantity: nights,
    includeFor: ['customer', 'provider'],
  };

  // Calculate discount
  let discountPercent = 0;
  let discountCode = '';
  if (nights >= 4 && nights <= 5) {
    discountPercent = 0.25;
    discountCode = 'line-item/discount-25';
  } else if (nights >= 6 && nights <= 7) {
    discountPercent = 0.3;
    discountCode = 'line-item/discount-30';
  } else if (nights >= 8 && nights <= 10) {
    discountPercent = 0.4;
    discountCode = 'line-item/discount-40';
  } else if (nights >= 11) {
    discountPercent = 0.5;
    discountCode = 'line-item/discount-50';
  }

  const discountLineItem = discountPercent > 0 ? {
    code: discountCode,
    unitPrice: new Money(-Math.round(unitPrice.amount * nights * discountPercent), currency),
    quantity: 1,
    includeFor: ['customer', 'provider']
  } : null;

  const getNegation = percentage => -1 * percentage;

  // Calculate subtotal including any discounts
  const subtotalLineItems = [
    order,
    ...(discountLineItem ? [discountLineItem] : [])
  ];

  // Calculate base subtotal for commission calculations
  const subtotal = calculateTotalFromLineItems(subtotalLineItems);
  
  // Defensive logging to validate subtotal and commission calculations
  console.log('=== Commission Calculation Debug ===');
  console.log('💰 Raw subtotal:', subtotal);
  console.log('💵 Subtotal amount (in minor units/cents):', subtotal.amount);
  console.log('📊 Raw commission percentage:', customerCommission.percentage);
  
  // Convert percentage from whole number to decimal (e.g., 15 -> 0.15)
  const decimalPercentage = customerCommission.percentage / 100;
  console.log('📊 Converted decimal percentage:', decimalPercentage);
  
  // Validate percentage conversion
  if (customerCommission.percentage < 0 || customerCommission.percentage > 100) {
    console.warn('⚠️ Warning: Commission percentage seems invalid:', customerCommission.percentage);
  }
  
  // Calculate expected commission amount for validation
  const expectedCommissionAmount = Math.round(subtotal.amount * decimalPercentage);
  console.log('💸 Expected commission amount (in minor units/cents):', expectedCommissionAmount);
  console.log('💵 Expected commission amount (in dollars):', (expectedCommissionAmount / 100).toFixed(2));
  
  // Validate commission calculation
  if (expectedCommissionAmount <= 0) {
    console.warn('⚠️ Warning: Commission amount is zero or negative:', expectedCommissionAmount);
  }
  if (expectedCommissionAmount > subtotal.amount) {
    console.warn('⚠️ Warning: Commission amount exceeds subtotal:', { expectedCommissionAmount, subtotal: subtotal.amount });
  }

  // Test case validation
  if (subtotal.amount === 8001 && customerCommission.percentage === 15) {
    console.log('✅ Test case validation:');
    console.log('   Expected commission for $80.01 at 15%: 1200 cents ($12.00)');
    console.log('   Actual commission calculated:', expectedCommissionAmount, 'cents');
    console.log('   Test passed:', expectedCommissionAmount === 1200);
  }
  console.log('================================');

  const providerCommissionMaybe = hasCommissionPercentage(providerCommission)
    ? [{
        code: 'line-item/provider-commission',
        unitPrice: subtotal,
        percentage: getNegation(providerCommission.percentage),
        includeFor: ['provider'],
      }]
    : [];

  const customerCommissionMaybe = hasCommissionPercentage(customerCommission)
    ? [{
        code: 'line-item/customer-commission',
        unitPrice: subtotal,
        percentage: customerCommission.percentage,
        includeFor: ['customer']
      }]
    : [];

  // Build shipping line item if we have the necessary context.
  //
  // 10.0 PR-2 step 4: if `options.shippingLock` is an object, buildShippingLine's
  // outbound/return rate payloads are mirrored into it. Callers (e.g.,
  // initiate-privileged.js) use this to persist `protectedData.{outbound,
  // return}.lockedRate` at preauth time. Callers that don't care omit
  // `shippingLock` — the function stays backward-compatible.
  let shippingLineItem = null;
  if (options.currentUserId && options.sdk) {
    console.log('[transactionLineItems] Building shipping estimate');
    const built = await buildShippingLine({
      listing,
      currentUserId: options.currentUserId,
      sdk: options.sdk,
    });
    shippingLineItem = built.lineItem;
    if (options.shippingLock && typeof options.shippingLock === 'object') {
      options.shippingLock.outboundRate = built.outboundRate;
      options.shippingLock.returnRate = built.returnRate;
    }
  } else {
    console.log('[transactionLineItems] No currentUserId/sdk, skipping shipping estimate');
  }

  // Final lineItems array: order, discount, commissions, and shipping
  const lineItems = [
    ...subtotalLineItems,
    ...providerCommissionMaybe,
    ...customerCommissionMaybe,
    ...(shippingLineItem ? [shippingLineItem] : [])
  ];

  // Calculate and log payin/payout totals for debugging
  const payinItems = lineItems.filter(item => item.includeFor.includes('customer'));
  const payoutItems = lineItems.filter(item => item.includeFor.includes('provider'));
  
  const payinTotal = calculateTotalFromLineItems(payinItems);
  const payoutTotal = calculateTotalFromLineItems(payoutItems);
  
  console.log('💵 Transaction totals:');
  console.log('📥 Payin total (customer pays):', payinTotal);
  console.log('📤 Payout total (provider gets):', payoutTotal);
  console.log('✅ Payin >= Payout:', payinTotal.amount >= payoutTotal.amount);
  console.log('🧾 Final line items:', lineItems);

  return lineItems;
};
