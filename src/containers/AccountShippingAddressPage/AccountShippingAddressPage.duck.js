import { denormalisedResponseEntities } from '../../util/data';
import { storableError } from '../../util/errors';
import { fetchCurrentUser, currentUserShowSuccess } from '../../ducks/user.duck';

// NOTE: 'lender' is Sherbrt's external term; the server validates these
// as 'provider*' fields (see server/api/transition-privileged.js
// requiredProviderFields, line 1897). The mapping happens in:
//   - Step 2: TransactionPanel prefill into ProviderAddressForm
//   - Step 3: server fallback hydration in transition-privileged.js
//   - Step 5: mobile lib/lender-actions.ts

// ================ Action types ================ //

export const SAVE_SHIPPING_ADDRESS_REQUEST =
  'app/AccountShippingAddressPage/SAVE_SHIPPING_ADDRESS_REQUEST';
export const SAVE_SHIPPING_ADDRESS_SUCCESS =
  'app/AccountShippingAddressPage/SAVE_SHIPPING_ADDRESS_SUCCESS';
export const SAVE_SHIPPING_ADDRESS_ERROR =
  'app/AccountShippingAddressPage/SAVE_SHIPPING_ADDRESS_ERROR';
export const SAVE_SHIPPING_ADDRESS_CLEAR =
  'app/AccountShippingAddressPage/SAVE_SHIPPING_ADDRESS_CLEAR';

// ================ Reducer ================ //

const initialState = {
  saveShippingAddressInProgress: false,
  saveShippingAddressError: null,
  shippingAddressChanged: false,
};

export default function reducer(state = initialState, action = {}) {
  const { type, payload } = action;
  switch (type) {
    case SAVE_SHIPPING_ADDRESS_REQUEST:
      return {
        ...state,
        saveShippingAddressInProgress: true,
        saveShippingAddressError: null,
        shippingAddressChanged: false,
      };
    case SAVE_SHIPPING_ADDRESS_SUCCESS:
      return {
        ...state,
        saveShippingAddressInProgress: false,
        shippingAddressChanged: true,
      };
    case SAVE_SHIPPING_ADDRESS_ERROR:
      return {
        ...state,
        saveShippingAddressInProgress: false,
        saveShippingAddressError: payload,
      };
    case SAVE_SHIPPING_ADDRESS_CLEAR:
      return {
        ...state,
        saveShippingAddressInProgress: false,
        saveShippingAddressError: null,
        shippingAddressChanged: false,
      };
    default:
      return state;
  }
}

// ================ Action creators ================ //

export const saveShippingAddressRequest = () => ({ type: SAVE_SHIPPING_ADDRESS_REQUEST });
export const saveShippingAddressSuccess = () => ({ type: SAVE_SHIPPING_ADDRESS_SUCCESS });
export const saveShippingAddressError = error => ({
  type: SAVE_SHIPPING_ADDRESS_ERROR,
  payload: error,
  error: true,
});
export const saveShippingAddressClear = () => ({ type: SAVE_SHIPPING_ADDRESS_CLEAR });

// ================ Thunks ================ //

// Sharetribe Flex SDK shallow-merges only the TOP-LEVEL keys of
// protectedData (verified via ContactDetailsPage.duck.js:107-114 and
// :217-218, where independent updates of `phoneNumber` and `shippingZip`
// preserve each other). The value of the `lenderShippingAddress` key
// itself is replaced wholesale on each save — so we always send all six
// fields, including any cleared optional ones as ''.
export const saveShippingAddress = params => (dispatch, getState, sdk) => {
  dispatch(saveShippingAddressRequest());

  const lenderShippingAddress = {
    streetAddress: params?.streetAddress ?? '',
    streetAddress2: params?.streetAddress2 ?? '',
    city: params?.city ?? '',
    state: params?.state ?? '',
    zipCode: params?.zipCode ?? '',
    phoneNumber: params?.phoneNumber ?? '',
  };

  // Phone write-through: also save phoneNumber to protectedData.phone so
  // existing consumers stay in sync (server/scripts/sendShipByReminders.js:159
  // reads profile.protectedData.phone). Deprecate once all consumers have
  // moved to lenderShippingAddress.phoneNumber.
  const profileUpdate = {
    protectedData: {
      lenderShippingAddress,
      phone: lenderShippingAddress.phoneNumber,
    },
  };

  return sdk.currentUser
    .updateProfile(profileUpdate, {
      expand: true,
      include: ['profileImage'],
      'fields.image': ['variants.square-small', 'variants.square-small2x'],
    })
    .then(response => {
      const entities = denormalisedResponseEntities(response);
      if (entities.length !== 1) {
        throw new Error('Expected a resource in the sdk.currentUser.updateProfile response');
      }
      const currentUser = entities[0];
      dispatch(currentUserShowSuccess(currentUser));
      dispatch(saveShippingAddressSuccess());
      return currentUser;
    })
    .catch(e => {
      dispatch(saveShippingAddressError(storableError(e)));
    });
};

export const loadData = () => fetchCurrentUser();
