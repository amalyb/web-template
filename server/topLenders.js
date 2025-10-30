// server/topLenders.js

// --- helper: calculate zodiac sign from birthday month and day
function getZodiacSign(month, day) {
  const zodiac = [
    { sign: 'Capricorn', from: '01-01', to: '01-19' },
    { sign: 'Aquarius', from: '01-20', to: '02-18' },
    { sign: 'Pisces', from: '02-19', to: '03-20' },
    { sign: 'Aries', from: '03-21', to: '04-19' },
    { sign: 'Taurus', from: '04-20', to: '05-20' },
    { sign: 'Gemini', from: '05-21', to: '06-20' },
    { sign: 'Cancer', from: '06-21', to: '07-22' },
    { sign: 'Leo', from: '07-23', to: '08-22' },
    { sign: 'Virgo', from: '08-23', to: '09-22' },
    { sign: 'Libra', from: '09-23', to: '10-22' },
    { sign: 'Scorpio', from: '10-23', to: '11-21' },
    { sign: 'Sagittarius', from: '11-22', to: '12-21' },
    { sign: 'Capricorn', from: '12-22', to: '12-31' },
  ];

  const birth = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const match = zodiac.find(({ from, to }) => birth >= from && birth <= to);
  return match ? match.sign : null;
}

// --- helper: get the Flex SDK that Express stored on the app
function getIntegrationSdkFromReq(req) {
  // Express stores it via app.set('integrationSdk', sdk)
  const sdk =
    (req.app && req.app.get && req.app.get('integrationSdk')) ||
    (req.app && req.app.integrationSdk) || // backup, just in case
    null;

  if (!sdk) {
    console.error('[topLenders] integrationSdk missing on req.app');
    throw new Error('No usable Flex SDK instance');
  }

  return sdk;
}



// --- turn Flex listings.query response into lender leaderboard
function aggregateTopLenders(apiResponse) {
  const listingsArr = apiResponse?.data?.data || [];
  const includedArr = apiResponse?.data?.included || [];

  // Build lookup maps for users and images
  const usersById = {};
  const imagesById = {};

  includedArr.forEach(entity => {
    if (entity.type === 'user') {
      const uid = entity.id?.uuid || entity.id;
      if (uid) usersById[uid] = entity;
    }
    if (entity.type === 'image') {
      const imgId = entity.id?.uuid || entity.id;
      if (imgId) imagesById[imgId] = entity;
    }
  });

  // Count listings per author and attach user
  const counts = new Map();

  listingsArr.forEach(listing => {
    const relAuthorData = listing?.relationships?.author?.data;
    const authorId =
      relAuthorData?.id?.uuid ||
      relAuthorData?.id ||
      relAuthorData?.uuid ||
      null;

    if (!authorId) return;

    const userEntity = usersById[authorId] || null;
    const prev = counts.get(authorId) || { userId: authorId, count: 0, user: null };

    counts.set(authorId, {
      userId: authorId,
      count: prev.count + 1,
      user: prev.user || userEntity,
    });
  });

  // Shape for frontend
  let loggedOne = false;
  let rowPreviewLogged = false;

  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
    .map(row => {
      const userEntity = row.user || null;

      const displayName =
        userEntity?.attributes?.profile?.displayName ||
        userEntity?.attributes?.profile?.abbreviatedName ||
        'Lender';

      // Extract zodiac and Instagram from user profile
      const publicData = userEntity?.attributes?.profile?.publicData || {};
      const protectedData = userEntity?.attributes?.protectedData || {};
      
      // Calculate zodiac from birthday if available, fallback to protectedData
      const { birthdayMonth, birthdayDay } = publicData;
      const calculatedZodiacSign = birthdayMonth && birthdayDay 
        ? getZodiacSign(birthdayMonth, birthdayDay) 
        : null;
      const zodiacSign = calculatedZodiacSign || protectedData.zodiacSign || null;
      
      const instagramHandle = publicData.instagramHandle || null;

      // Keep the existing one-time full user entity log for debugging
      if (!loggedOne && userEntity) {
        try {
          // eslint-disable-next-line no-console
          console.log('[topLenders] sample user entity ->', JSON.stringify(userEntity, null, 2));
        } catch (e) {
          // eslint-disable-next-line no-console
          console.log('[topLenders] sample user entity -> (unserializable)');
        }
      }

      // Resolve avatar from user's profileImage relationship to included image entity
      let avatarUrl = null;
      const imgRel = userEntity?.relationships?.profileImage?.data;
      const imgId = imgRel?.id?.uuid || imgRel?.id || imgRel?.uuid || null;
      let imageEntity = null;
      let variants = {};
      if (imgId && imagesById[imgId]) {
        imageEntity = imagesById[imgId];
        variants = imageEntity?.attributes?.variants || imageEntity?.variants || {};
        // Try square variants first, then 'default', then any available variant
        const order = [
          'square-small',
          'square-small2x',
          'squareSmall',
          'squareSmall2x',
          'default',
          'square-xsmall',
          'square-xsmall2x',
        ];
        for (const key of order) {
          if (variants[key]?.url) {
            avatarUrl = variants[key].url;
            break;
          }
        }
        // If none of the preferred variants exist, grab the first available variant URL
        if (!avatarUrl) {
          const allVariantKeys = Object.keys(variants);
          for (const key of allVariantKeys) {
            if (variants[key]?.url) {
              avatarUrl = variants[key].url;
              break;
            }
          }
        }
      }

      // dev log preview (one time for sanity)
      if (!rowPreviewLogged) {
        // eslint-disable-next-line no-console
        console.log('[topLenders] row preview:', {
          userId: row.userId,
          displayName,
          avatarUrl,
          hasUser: !!userEntity,
          hasProfileImageRel: !!userEntity?.relationships?.profileImage,
          imageEntityKeys: imageEntity ? Object.keys(imageEntity) : null,
          variantKeys: Object.keys(variants || {}),
        });
        rowPreviewLogged = true;
      }

      return {
        userId: row.userId,
        displayName,
        count: row.count,
        avatarUrl,
        zodiacSign,
        instagramHandle,
      };
    });
}



// --- main exported fn used by /api/top-lenders route
async function fetchTopLenders(req) {
  // 1. get the SDK from Express app
  const flexSdk = getIntegrationSdkFromReq(req);

  let apiResponse;
  try {
    apiResponse = await flexSdk.listings.query({
      perPage: 50,
      include: [
        'author',
        'author.profileImage',
      ],
      'fields.user': [
        'profile',
        'profileImage',
      ].join(','),
      'fields.image': [
        'variants',
      ].join(','),
    });
  } catch (err) {
    // surface details to server log so we can see Flex error payload
    console.error('[topLenders] listings.query threw', {
      message: err.message,
      status: err.status,
      statusText: err.statusText,
      data: err.data,
      stack: err.stack,
    });
    throw err;
  }

  // 3. turn that into leaderboard-ish structure
  return aggregateTopLenders(apiResponse);
}

module.exports = { fetchTopLenders };

