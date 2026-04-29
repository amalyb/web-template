import React, { Component } from 'react';
import { compose } from 'redux';
import classNames from 'classnames';
import isEqual from 'lodash/isEqual';
import { Form as FinalForm } from 'react-final-form';

import { FormattedMessage, injectIntl } from '../../../util/reactIntl';
import * as validators from '../../../util/validators';

import { Form, PrimaryButton, FieldTextInput } from '../../../components';

import css from './AccountShippingAddressForm.module.css';

class AccountShippingAddressFormComponent extends Component {
  constructor(props) {
    super(props);
    this.submittedValues = {};
  }

  render() {
    return (
      <FinalForm
        {...this.props}
        render={fieldRenderProps => {
          const {
            rootClassName,
            className,
            formId,
            handleSubmit,
            inProgress = false,
            ready = false,
            intl,
            invalid,
            saveError,
            values,
          } = fieldRenderProps;

          const requiredFor = id => validators.required(intl.formatMessage({ id }));

          const submittedOnce = Object.keys(this.submittedValues).length > 0;
          const pristineSinceLastSubmit = submittedOnce && isEqual(values, this.submittedValues);
          const submitDisabled = invalid || pristineSinceLastSubmit || inProgress;

          const classes = classNames(rootClassName || css.root, className);

          const genericError = saveError ? (
            <span className={css.error}>
              <FormattedMessage id="AccountShippingAddressForm.genericFailure" />
            </span>
          ) : null;

          const fieldId = name => (formId ? `${formId}.${name}` : name);

          return (
            <Form
              className={classes}
              onSubmit={e => {
                this.submittedValues = values;
                handleSubmit(e);
              }}
            >
              <FieldTextInput
                id={fieldId('streetAddress')}
                name="streetAddress"
                type="text"
                autoComplete="address-line1"
                label={intl.formatMessage({
                  id: 'AccountShippingAddressForm.streetAddressLabel',
                })}
                placeholder={intl.formatMessage({
                  id: 'AccountShippingAddressForm.streetAddressPlaceholder',
                })}
                validate={requiredFor('AccountShippingAddressForm.streetAddressRequired')}
              />
              <FieldTextInput
                className={css.field}
                id={fieldId('streetAddress2')}
                name="streetAddress2"
                type="text"
                autoComplete="address-line2"
                label={intl.formatMessage({
                  id: 'AccountShippingAddressForm.streetAddress2Label',
                })}
                placeholder={intl.formatMessage({
                  id: 'AccountShippingAddressForm.streetAddress2Placeholder',
                })}
              />
              <FieldTextInput
                className={css.field}
                id={fieldId('city')}
                name="city"
                type="text"
                autoComplete="address-level2"
                label={intl.formatMessage({
                  id: 'AccountShippingAddressForm.cityLabel',
                })}
                placeholder={intl.formatMessage({
                  id: 'AccountShippingAddressForm.cityPlaceholder',
                })}
                validate={requiredFor('AccountShippingAddressForm.cityRequired')}
              />
              <FieldTextInput
                className={css.field}
                id={fieldId('state')}
                name="state"
                type="text"
                autoComplete="address-level1"
                label={intl.formatMessage({
                  id: 'AccountShippingAddressForm.stateLabel',
                })}
                placeholder={intl.formatMessage({
                  id: 'AccountShippingAddressForm.statePlaceholder',
                })}
                validate={requiredFor('AccountShippingAddressForm.stateRequired')}
              />
              <FieldTextInput
                className={css.field}
                id={fieldId('zipCode')}
                name="zipCode"
                type="text"
                autoComplete="postal-code"
                label={intl.formatMessage({
                  id: 'AccountShippingAddressForm.zipCodeLabel',
                })}
                placeholder={intl.formatMessage({
                  id: 'AccountShippingAddressForm.zipCodePlaceholder',
                })}
                validate={requiredFor('AccountShippingAddressForm.zipCodeRequired')}
              />
              <FieldTextInput
                className={css.field}
                id={fieldId('phoneNumber')}
                name="phoneNumber"
                type="tel"
                autoComplete="tel"
                label={intl.formatMessage({
                  id: 'AccountShippingAddressForm.phoneNumberLabel',
                })}
                placeholder={intl.formatMessage({
                  id: 'AccountShippingAddressForm.phoneNumberPlaceholder',
                })}
                validate={requiredFor('AccountShippingAddressForm.phoneNumberRequired')}
              />

              <div className={css.bottomWrapper}>
                {genericError}
                <PrimaryButton
                  type="submit"
                  inProgress={inProgress}
                  ready={pristineSinceLastSubmit && ready}
                  disabled={submitDisabled}
                >
                  <FormattedMessage id="AccountShippingAddressForm.save" />
                </PrimaryButton>
              </div>
            </Form>
          );
        }}
      />
    );
  }
}

const AccountShippingAddressForm = compose(injectIntl)(AccountShippingAddressFormComponent);

AccountShippingAddressForm.displayName = 'AccountShippingAddressForm';

export default AccountShippingAddressForm;
