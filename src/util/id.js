/**
 * Utility functions for handling IDs and UUIDs
 */

/**
 * Normalizes any ID format to a string UUID
 * @param {string|object|null|undefined} id - The ID to normalize
 * @returns {string|null} - The normalized UUID string or null if invalid
 */
export const toUuidString = id =>
  typeof id === 'string' ? id : (id && (id.uuid || id.id)) || null;

