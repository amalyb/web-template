import React, { act } from 'react';
import '@testing-library/jest-dom';

import { createCurrentUser, createUser, createListing, fakeIntl } from '../../../util/testData';
import {
  getDefaultConfiguration,
  renderWithProviders as render,
  testingLibrary,
} from '../../../util/testHelpers';
import { types as sdkTypes } from '../../../util/sdkLoader';

import { TransactionPanelComponent } from './TransactionPanel';

const { UUID } = sdkTypes;
const { screen, waitFor } = testingLibrary;
const noop = () => null;

const SAVED_ADDRESS = {
  streetAddress: '742 Evergreen Terrace',
  streetAddress2: 'Apt 3B',
  city: 'Springfield',
  state: 'IL',
  zipCode: '62704',
  phoneNumber: '5551234567',
};

const buildCurrentUser = (id, lenderShippingAddress) =>
  createCurrentUser(id, {
    profile: {
      firstName: 'Lender',
      lastName: 'Lenderson',
      displayName: 'Lender Lenderson',
      abbreviatedName: 'LL',
      protectedData: lenderShippingAddress ? { lenderShippingAddress } : {},
    },
  });

const buildListing = id =>
  createListing(id, {
    publicData: {
      listingType: 'rent-bicycles',
      transactionProcessAlias: 'default-booking/release-1',
      unitType: 'day',
    },
  });

const buildTransaction = id => ({
  id: new UUID(id),
  type: 'transaction',
  attributes: {
    protectedData: {},
    transitions: [],
  },
});

const buildStateData = (transaction, listing, nextTransitions = []) => ({
  processName: 'default-booking',
  processState: 'preauthorized',
  showActionButtons: true,
  showOrderPanel: false,
  showDetailCardHeadings: true,
  showDispute: false,
  showExtraInfo: false,
  isPendingPayment: false,
  primaryButtonProps: {
    buttonText: 'Accept',
    inProgress: false,
    error: null,
    transitionName: 'transition/accept',
  },
  secondaryButtonProps: null,
  transaction,
  listing,
  nextTransitions,
});

const buildPanelProps = (overrides = {}) => {
  const provider = createUser('provider');
  const customer = createUser('customer');
  const listing = buildListing('listing-1');
  const transaction = buildTransaction('tx-1');
  const acceptTransition = {
    attributes: { name: 'transition/accept' },
  };
  return {
    currentUser: buildCurrentUser('provider'),
    transactionRole: 'provider',
    listing,
    customer,
    provider,
    hasTransitions: false,
    transaction,
    protectedData: {},
    messages: [],
    initialMessageFailed: false,
    savePaymentMethodFailed: false,
    fetchMessagesError: null,
    sendMessageInProgress: false,
    sendMessageError: null,
    onOpenDisputeModal: noop,
    intl: fakeIntl,
    stateData: buildStateData(transaction, listing, [acceptTransition]),
    showBookingLocation: false,
    activityFeed: <div data-testid="activity-feed" />,
    isInquiryProcess: false,
    orderBreakdown: null,
    orderPanel: null,
    config: getDefaultConfiguration(),
    hasViewingRights: true,
    onTransition: noop,
    onSaveShippingAddress: noop,
    ...overrides,
  };
};

describe('TransactionPanelComponent — lender address prefill', () => {
  it('does not prefill when currentUser has no saved lenderShippingAddress', async () => {
    await act(async () => {
      render(<TransactionPanelComponent {...buildPanelProps()} />);
    });

    const street = await screen.findByLabelText(/Street \*/i);
    expect(street).toHaveValue('');
    expect(screen.getByLabelText(/City \*/i)).toHaveValue('');
    expect(screen.getByLabelText(/Phone Number/i)).toHaveValue('');
    expect(
      screen.queryByText(/Save these as my default shipping address/i)
    ).not.toBeInTheDocument();
  });

  it('prefills form fields when currentUser arrives via prop update with a saved address', async () => {
    const props = buildPanelProps({ currentUser: buildCurrentUser('provider', null) });
    let result;
    await act(async () => {
      result = render(<TransactionPanelComponent {...props} />);
    });

    // Initially empty.
    expect(await screen.findByLabelText(/Street \*/i)).toHaveValue('');

    const updated = buildPanelProps({
      currentUser: buildCurrentUser('provider', SAVED_ADDRESS),
    });
    await act(async () => {
      result.rerender(<TransactionPanelComponent {...updated} />);
    });

    await waitFor(() =>
      expect(screen.getByLabelText(/Street \*/i)).toHaveValue(SAVED_ADDRESS.streetAddress)
    );
    expect(screen.getByLabelText(/Street \(line 2\)/i)).toHaveValue(SAVED_ADDRESS.streetAddress2);
    expect(screen.getByLabelText(/City \*/i)).toHaveValue(SAVED_ADDRESS.city);
    expect(screen.getByLabelText(/State \*/i)).toHaveValue(SAVED_ADDRESS.state);
    expect(screen.getByLabelText(/Postal code \/ zip \*/i)).toHaveValue(SAVED_ADDRESS.zipCode);
    expect(screen.getByLabelText(/Phone Number/i)).toHaveValue(SAVED_ADDRESS.phoneNumber);
  });

  it('prefills exactly once: a later unrelated prop update does not clobber user edits', async () => {
    const props = buildPanelProps({
      currentUser: buildCurrentUser('provider', SAVED_ADDRESS),
    });
    let result;
    await act(async () => {
      result = render(<TransactionPanelComponent {...props} />);
    });

    const street = await screen.findByLabelText(/Street \*/i);
    await waitFor(() => expect(street).toHaveValue(SAVED_ADDRESS.streetAddress));

    // User edits the city field.
    await act(async () => {
      testingLibrary.fireEvent.change(screen.getByLabelText(/City \*/i), {
        target: { value: 'Shelbyville' },
      });
    });
    expect(screen.getByLabelText(/City \*/i)).toHaveValue('Shelbyville');

    // Trigger an unrelated prop update (different transaction reference).
    const updated = buildPanelProps({
      currentUser: buildCurrentUser('provider', SAVED_ADDRESS),
      hasTransitions: true,
    });
    await act(async () => {
      result.rerender(<TransactionPanelComponent {...updated} />);
    });

    // The user's edit must survive — prefill must NOT fire again.
    await waitFor(() => expect(screen.getByLabelText(/City \*/i)).toHaveValue('Shelbyville'));
  });

  it('hides "Save as default" until the user edits a prefilled field; shows it after an edit', async () => {
    const props = buildPanelProps({
      currentUser: buildCurrentUser('provider', SAVED_ADDRESS),
    });
    await act(async () => {
      render(<TransactionPanelComponent {...props} />);
    });

    await waitFor(() =>
      expect(screen.getByLabelText(/Street \*/i)).toHaveValue(SAVED_ADDRESS.streetAddress)
    );

    // No edits yet → checkbox hidden.
    expect(
      screen.queryByText(/Save these as my default shipping address/i)
    ).not.toBeInTheDocument();

    // Edit a field.
    await act(async () => {
      testingLibrary.fireEvent.change(screen.getByLabelText(/Street \*/i), {
        target: { value: '123 New Street' },
      });
    });

    expect(
      await screen.findByText(/Save these as my default shipping address/i)
    ).toBeInTheDocument();
  });
});

describe('TransactionPanelComponent — accept dispatch wiring', () => {
  it('does NOT call onSaveShippingAddress when "Save as default" is unchecked', async () => {
    const onSaveShippingAddress = jest.fn().mockResolvedValue({ id: 'user' });
    const onTransition = jest.fn();
    const props = buildPanelProps({
      currentUser: buildCurrentUser('provider', SAVED_ADDRESS),
      onSaveShippingAddress,
      onTransition,
    });
    await act(async () => {
      render(<TransactionPanelComponent {...props} />);
    });

    await waitFor(() =>
      expect(screen.getByLabelText(/Street \*/i)).toHaveValue(SAVED_ADDRESS.streetAddress)
    );

    // Click Accept without ticking the checkbox.
    const acceptButtons = screen.getAllByRole('button', { name: /Accept/i });
    await act(async () => {
      testingLibrary.fireEvent.click(acceptButtons[0]);
    });

    expect(onSaveShippingAddress).not.toHaveBeenCalled();
    expect(onTransition).toHaveBeenCalledTimes(1);
    expect(onTransition.mock.calls[0][1]).toBe('transition/accept');
  });

  it('calls onSaveShippingAddress BEFORE onTransition when "Save as default" is checked', async () => {
    const calls = [];
    const onSaveShippingAddress = jest.fn(values => {
      calls.push('save');
      return Promise.resolve({ id: 'user', attributes: {} });
    });
    const onTransition = jest.fn(() => {
      calls.push('transition');
    });

    const props = buildPanelProps({
      currentUser: buildCurrentUser('provider', SAVED_ADDRESS),
      onSaveShippingAddress,
      onTransition,
    });
    await act(async () => {
      render(<TransactionPanelComponent {...props} />);
    });

    await waitFor(() =>
      expect(screen.getByLabelText(/Street \*/i)).toHaveValue(SAVED_ADDRESS.streetAddress)
    );

    // Edit a field so the checkbox renders.
    await act(async () => {
      testingLibrary.fireEvent.change(screen.getByLabelText(/Street \*/i), {
        target: { value: '999 New Street' },
      });
    });

    const checkbox = await screen.findByRole('checkbox', {
      name: /Save these as my default shipping address/i,
    });
    await act(async () => {
      testingLibrary.fireEvent.click(checkbox);
    });
    expect(checkbox).toBeChecked();

    const acceptButtons = screen.getAllByRole('button', { name: /Accept/i });
    await act(async () => {
      testingLibrary.fireEvent.click(acceptButtons[0]);
    });

    await waitFor(() => expect(onTransition).toHaveBeenCalledTimes(1));
    expect(onSaveShippingAddress).toHaveBeenCalledTimes(1);
    expect(onSaveShippingAddress).toHaveBeenCalledWith({
      ...SAVED_ADDRESS,
      streetAddress: '999 New Street',
    });
    expect(calls).toEqual(['save', 'transition']);
  });

  it('does NOT call onTransition if onSaveShippingAddress resolves with falsy (duck-swallowed error)', async () => {
    const onSaveShippingAddress = jest.fn().mockResolvedValue(undefined);
    const onTransition = jest.fn();

    const props = buildPanelProps({
      currentUser: buildCurrentUser('provider', SAVED_ADDRESS),
      onSaveShippingAddress,
      onTransition,
    });
    await act(async () => {
      render(<TransactionPanelComponent {...props} />);
    });

    await waitFor(() =>
      expect(screen.getByLabelText(/Street \*/i)).toHaveValue(SAVED_ADDRESS.streetAddress)
    );

    await act(async () => {
      testingLibrary.fireEvent.change(screen.getByLabelText(/Street \*/i), {
        target: { value: '999 New Street' },
      });
    });
    const checkbox = await screen.findByRole('checkbox', {
      name: /Save these as my default shipping address/i,
    });
    await act(async () => {
      testingLibrary.fireEvent.click(checkbox);
    });

    const acceptButtons = screen.getAllByRole('button', { name: /Accept/i });
    await act(async () => {
      testingLibrary.fireEvent.click(acceptButtons[0]);
    });

    await waitFor(() => expect(onSaveShippingAddress).toHaveBeenCalledTimes(1));
    expect(onTransition).not.toHaveBeenCalled();
  });
});
