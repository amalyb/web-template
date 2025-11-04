/**
 * Order params builder and booking date normalizer
 * Re-exports from orderParamsCore to maintain backward compatibility
 * while avoiding circular dependencies
 */

export {
  extractListingId,
  normalizeISO,
  normalizeBookingDates,
  buildOrderParams,
} from './orderParamsCore';

