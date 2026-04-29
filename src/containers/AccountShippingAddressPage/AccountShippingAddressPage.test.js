import React, { act } from 'react';
import '@testing-library/jest-dom';

import { createCurrentUser, fakeIntl } from '../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import { AccountShippingAddressPageComponent } from './AccountShippingAddressPage';
import { saveShippingAddress } from './AccountShippingAddressPage.duck';

const { screen, userEvent } = testingLibrary;
const noop = () => null;

const FILLED_ADDRESS = {
  streetAddress: '742 Evergreen Terrace',
  streetAddress2: 'Apt 3B',
  city: 'Springfield',
  state: 'IL',
  zipCode: '62704',
  phoneNumber: '5551234567',
};

const renderPage = (overrides = {}) =>
  render(
    <AccountShippingAddressPageComponent
      currentUser={createCurrentUser('user1')}
      saveShippingAddressInProgress={false}
      saveShippingAddressError={null}
      shippingAddressChanged={false}
      onChange={noop}
      onSubmitShippingAddress={noop}
      scrollingDisabled={false}
      intl={fakeIntl}
      {...overrides}
    />
  );

const fillField = async (labelId, value) => {
  const input = screen.getByLabelText(labelId);
  await act(async () => {
    userEvent.type(input, value);
    input.blur();
  });
};

describe('AccountShippingAddressPageComponent', () => {
  it('renders all six fields and the save button', async () => {
    renderPage();
    expect(
      await screen.findByLabelText('AccountShippingAddressForm.streetAddressLabel')
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('AccountShippingAddressForm.streetAddress2Label')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('AccountShippingAddressForm.cityLabel')).toBeInTheDocument();
    expect(screen.getByLabelText('AccountShippingAddressForm.stateLabel')).toBeInTheDocument();
    expect(screen.getByLabelText('AccountShippingAddressForm.zipCodeLabel')).toBeInTheDocument();
    expect(
      screen.getByLabelText('AccountShippingAddressForm.phoneNumberLabel')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'AccountShippingAddressForm.save' })
    ).toBeInTheDocument();
  });

  // Test 1 — happy path
  it('happy path: filling all six fields and submitting dispatches the correct payload', async () => {
    const onSubmit = jest.fn();
    renderPage({ onSubmitShippingAddress: onSubmit });

    await fillField('AccountShippingAddressForm.streetAddressLabel', FILLED_ADDRESS.streetAddress);
    await fillField(
      'AccountShippingAddressForm.streetAddress2Label',
      FILLED_ADDRESS.streetAddress2
    );
    await fillField('AccountShippingAddressForm.cityLabel', FILLED_ADDRESS.city);
    await fillField('AccountShippingAddressForm.stateLabel', FILLED_ADDRESS.state);
    await fillField('AccountShippingAddressForm.zipCodeLabel', FILLED_ADDRESS.zipCode);
    await fillField('AccountShippingAddressForm.phoneNumberLabel', FILLED_ADDRESS.phoneNumber);

    const saveButton = screen.getByRole('button', { name: 'AccountShippingAddressForm.save' });
    expect(saveButton).toBeEnabled();

    await act(async () => {
      userEvent.click(saveButton);
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(FILLED_ADDRESS);
  });

  // Test 2 — required-field validation
  it('required-field validation: empty required fields keep submit disabled and surface errors', async () => {
    const onSubmit = jest.fn();
    renderPage({ onSubmitShippingAddress: onSubmit });

    const requiredLabels = [
      'AccountShippingAddressForm.streetAddressLabel',
      'AccountShippingAddressForm.cityLabel',
      'AccountShippingAddressForm.stateLabel',
      'AccountShippingAddressForm.zipCodeLabel',
      'AccountShippingAddressForm.phoneNumberLabel',
    ];

    for (const label of requiredLabels) {
      const input = screen.getByLabelText(label);
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        input.focus();
        input.blur();
      });
    }

    const errorIds = [
      'AccountShippingAddressForm.streetAddressRequired',
      'AccountShippingAddressForm.cityRequired',
      'AccountShippingAddressForm.stateRequired',
      'AccountShippingAddressForm.zipCodeRequired',
      'AccountShippingAddressForm.phoneNumberRequired',
    ];
    for (const id of errorIds) {
      expect(screen.getByText(id)).toBeInTheDocument();
    }

    expect(screen.getByRole('button', { name: 'AccountShippingAddressForm.save' })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // Test 3 — optional streetAddress2 may be empty
  it('optional streetAddress2 left empty still allows submit to dispatch', async () => {
    const onSubmit = jest.fn();
    renderPage({ onSubmitShippingAddress: onSubmit });

    await fillField('AccountShippingAddressForm.streetAddressLabel', FILLED_ADDRESS.streetAddress);
    await fillField('AccountShippingAddressForm.cityLabel', FILLED_ADDRESS.city);
    await fillField('AccountShippingAddressForm.stateLabel', FILLED_ADDRESS.state);
    await fillField('AccountShippingAddressForm.zipCodeLabel', FILLED_ADDRESS.zipCode);
    await fillField('AccountShippingAddressForm.phoneNumberLabel', FILLED_ADDRESS.phoneNumber);

    const saveButton = screen.getByRole('button', { name: 'AccountShippingAddressForm.save' });
    expect(saveButton).toBeEnabled();

    await act(async () => {
      userEvent.click(saveButton);
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual({
      ...FILLED_ADDRESS,
      streetAddress2: '',
    });
  });

  // Test 6 — initial values from currentUser.profile.protectedData.lenderShippingAddress
  it('pre-populates initial values from currentUser.profile.protectedData.lenderShippingAddress', async () => {
    const userWithSaved = createCurrentUser('user-with-address', {
      profile: {
        firstName: 'Saved',
        lastName: 'Address',
        displayName: 'Saved Address',
        abbreviatedName: 'SA',
        protectedData: { lenderShippingAddress: FILLED_ADDRESS },
      },
    });

    renderPage({ currentUser: userWithSaved });

    expect(await screen.findByDisplayValue(FILLED_ADDRESS.streetAddress)).toBeInTheDocument();
    expect(screen.getByDisplayValue(FILLED_ADDRESS.streetAddress2)).toBeInTheDocument();
    expect(screen.getByDisplayValue(FILLED_ADDRESS.city)).toBeInTheDocument();
    expect(screen.getByDisplayValue(FILLED_ADDRESS.state)).toBeInTheDocument();
    expect(screen.getByDisplayValue(FILLED_ADDRESS.zipCode)).toBeInTheDocument();
    expect(screen.getByDisplayValue(FILLED_ADDRESS.phoneNumber)).toBeInTheDocument();
  });
});

// Mock SDK response for duck-level tests below. denormalisedResponseEntities
// expects { data: { data: <resource>, included: [] } } shape.
const buildSdkResponse = address => ({
  data: {
    data: {
      id: { uuid: 'user1' },
      type: 'currentUser',
      attributes: {
        profile: {
          protectedData: {
            lenderShippingAddress: address,
            phone: address.phoneNumber,
          },
        },
      },
    },
    included: [],
  },
});

describe('AccountShippingAddressPage duck', () => {
  // Test 4 — regression: cleared streetAddress2 must be sent as ''
  it('regression: cleared streetAddress2 is sent to the SDK as "" (not omitted, not undefined)', async () => {
    const updateProfile = jest.fn().mockResolvedValue(buildSdkResponse(FILLED_ADDRESS));
    const sdk = { currentUser: { updateProfile } };
    const dispatch = jest.fn();

    await saveShippingAddress({ ...FILLED_ADDRESS, streetAddress2: '' })(dispatch, () => ({}), sdk);

    expect(updateProfile).toHaveBeenCalledTimes(1);
    const [profileArg] = updateProfile.mock.calls[0];
    const { lenderShippingAddress } = profileArg.protectedData;

    expect(lenderShippingAddress).toHaveProperty('streetAddress2', '');
    expect(Object.prototype.hasOwnProperty.call(lenderShippingAddress, 'streetAddress2')).toBe(
      true
    );
    expect(Object.keys(lenderShippingAddress).sort()).toEqual(
      ['city', 'phoneNumber', 'state', 'streetAddress', 'streetAddress2', 'zipCode'].sort()
    );
  });

  // Test 5 — phone write-through to legacy field
  it('phone write-through: dispatched payload includes both lenderShippingAddress.phoneNumber and protectedData.phone, equal', async () => {
    const updateProfile = jest.fn().mockResolvedValue(buildSdkResponse(FILLED_ADDRESS));
    const sdk = { currentUser: { updateProfile } };
    const dispatch = jest.fn();

    await saveShippingAddress(FILLED_ADDRESS)(dispatch, () => ({}), sdk);

    const [profileArg] = updateProfile.mock.calls[0];
    expect(profileArg.protectedData.lenderShippingAddress.phoneNumber).toBe(
      FILLED_ADDRESS.phoneNumber
    );
    expect(profileArg.protectedData.phone).toBe(FILLED_ADDRESS.phoneNumber);
    expect(profileArg.protectedData.phone).toBe(
      profileArg.protectedData.lenderShippingAddress.phoneNumber
    );
  });
});
