// Map zodiac signs to their Unicode emoji symbols
const zodiacEmojis = {
  Aries: '♈',
  Taurus: '♉',
  Gemini: '♊',
  Cancer: '♋',
  Leo: '♌',
  Virgo: '♍',
  Libra: '♎',
  Scorpio: '♏',
  Sagittarius: '♐',
  Capricorn: '♑',
  Aquarius: '♒',
  Pisces: '♓',
};

/**
 * Get the emoji symbol for a given zodiac sign
 * @param {string} sign - The zodiac sign name (e.g., "Virgo")
 * @returns {string|null} The emoji symbol or null if not found
 */
const getZodiacEmoji = sign => {
  if (!sign) return null;
  return zodiacEmojis[sign] || null;
};

export default getZodiacEmoji;

