import React from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { ensureCurrentUser } from '../../util/data';
import { isScrollingDisabled } from '../../ducks/ui.duck';

import { Page, UserNav, H3, LayoutSideNavigation } from '../../components';

import TopbarContainer from '../../containers/TopbarContainer/TopbarContainer';
import FooterContainer from '../../containers/FooterContainer/FooterContainer';

import AccountShippingAddressForm from './AccountShippingAddressForm/AccountShippingAddressForm';

import { saveShippingAddress, saveShippingAddressClear } from './AccountShippingAddressPage.duck';
import css from './AccountShippingAddressPage.module.css';

export const AccountShippingAddressPageComponent = props => {
  const intl = useIntl();
  const {
    currentUser,
    saveShippingAddressInProgress,
    saveShippingAddressError,
    shippingAddressChanged,
    onChange,
    onSubmitShippingAddress,
    scrollingDisabled,
  } = props;

  const user = ensureCurrentUser(currentUser);
  const protectedData = user.attributes?.profile?.protectedData || {};
  const saved = protectedData.lenderShippingAddress || {};
  const initialValues = {
    streetAddress: saved.streetAddress || '',
    streetAddress2: saved.streetAddress2 || '',
    city: saved.city || '',
    state: saved.state || '',
    zipCode: saved.zipCode || '',
    phoneNumber: saved.phoneNumber || '',
  };

  // Always normalize to all six fields with empty-string fallbacks. The
  // duck does the same belt-and-suspenders, but normalizing here keeps
  // the dispatched payload predictable (test 4: cleared streetAddress2
  // must arrive as '' not undefined).
  const handleSubmit = values =>
    onSubmitShippingAddress({
      streetAddress: values.streetAddress || '',
      streetAddress2: values.streetAddress2 || '',
      city: values.city || '',
      state: values.state || '',
      zipCode: values.zipCode || '',
      phoneNumber: values.phoneNumber || '',
    });

  const form = user.id ? (
    <AccountShippingAddressForm
      className={css.form}
      formId="AccountShippingAddressForm"
      initialValues={initialValues}
      onSubmit={handleSubmit}
      onChange={onChange}
      inProgress={saveShippingAddressInProgress}
      ready={shippingAddressChanged}
      saveError={saveShippingAddressError}
    />
  ) : null;

  const title = intl.formatMessage({ id: 'AccountShippingAddressPage.title' });

  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <LayoutSideNavigation
        topbar={
          <>
            <TopbarContainer
              desktopClassName={css.desktopTopbar}
              mobileClassName={css.mobileTopbar}
            />
            <UserNav currentPage="AccountShippingAddressPage" />
          </>
        }
        sideNav={null}
        useAccountSettingsNav
        currentPage="AccountShippingAddressPage"
        footer={<FooterContainer />}
      >
        <div className={css.content}>
          <H3 as="h1">
            <FormattedMessage id="AccountShippingAddressPage.heading" />
          </H3>
          <p className={css.intro}>
            <FormattedMessage id="AccountShippingAddressPage.intro" />
          </p>
          {form}
        </div>
      </LayoutSideNavigation>
    </Page>
  );
};

const mapStateToProps = state => {
  const { currentUser } = state.user;
  const {
    saveShippingAddressInProgress,
    saveShippingAddressError,
    shippingAddressChanged,
  } = state.AccountShippingAddressPage;
  return {
    currentUser,
    saveShippingAddressInProgress,
    saveShippingAddressError,
    shippingAddressChanged,
    scrollingDisabled: isScrollingDisabled(state),
  };
};

const mapDispatchToProps = dispatch => ({
  onChange: () => dispatch(saveShippingAddressClear()),
  onSubmitShippingAddress: values => dispatch(saveShippingAddress(values)),
});

const AccountShippingAddressPage = compose(connect(mapStateToProps, mapDispatchToProps))(
  AccountShippingAddressPageComponent
);

export default AccountShippingAddressPage;
