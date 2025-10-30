import React from 'react';
import { Form as FinalForm } from 'react-final-form';
import arrayMutators from 'final-form-arrays';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { propTypes } from '../../../util/types';
import * as validators from '../../../util/validators';
import { getPropsForCustomUserFieldInputs } from '../../../util/userHelpers';

import { Form, PrimaryButton, FieldTextInput, CustomExtendedDataField, FieldSelect } from '../../../components';

import FieldSelectUserType from '../FieldSelectUserType';
import UserFieldDisplayName from '../UserFieldDisplayName';
import UserFieldPhoneNumber from '../UserFieldPhoneNumber';

import css from './ConfirmSignupForm.module.css';

const getSoleUserTypeMaybe = userTypes =>
  Array.isArray(userTypes) && userTypes.length === 1 ? userTypes[0].userType : null;

const ConfirmSignupFormComponent = props => (
  <FinalForm
    {...props}
    mutators={{ ...arrayMutators }}
    initialValues={{ userType: props.preselectedUserType || getSoleUserTypeMaybe(props.userTypes) }}
    render={formRenderProps => {
      const {
        rootClassName,
        className,
        formId,
        handleSubmit,
        inProgress,
        invalid,
        intl,
        termsAndConditions,
        authInfo,
        idp,
        preselectedUserType,
        userTypes,
        userFields,
        values,
      } = formRenderProps;

      const { userType } = values || {};

      // email
      const emailRequired = validators.required(
        intl.formatMessage({
          id: 'ConfirmSignupForm.emailRequired',
        })
      );
      const emailValid = validators.emailFormatValid(
        intl.formatMessage({
          id: 'ConfirmSignupForm.emailInvalid',
        })
      );

      // Custom user fields. Since user types are not supported here,
      // only fields with no user type id limitation are selected.
      const userFieldProps = getPropsForCustomUserFieldInputs(userFields, intl, userType);

      const noUserTypes = !userType && !(userTypes?.length > 0);
      const userTypeConfig = userTypes.find(config => config.userType === userType);
      const showDefaultUserFields = userType || noUserTypes;
      const showCustomUserFields = (userType || noUserTypes) && userFieldProps?.length > 0;

      const classes = classNames(rootClassName || css.root, className);
      const submitInProgress = inProgress;
      const submitDisabled = invalid || submitInProgress;

      // If authInfo is not available we should not show the ConfirmForm
      if (!authInfo) {
        return;
      }

      // Initial values from idp provider
      const { email, firstName, lastName } = authInfo;

      return (
        <Form className={classes} onSubmit={handleSubmit}>
          <FieldSelectUserType
            name="userType"
            userTypes={userTypes}
            hasExistingUserType={!!preselectedUserType}
            intl={intl}
          />

          {showDefaultUserFields ? (
            <div className={css.defaultUserFields}>
              <FieldTextInput
                type="email"
                id={formId ? `${formId}.email` : 'email'}
                name="email"
                autoComplete="email"
                label={intl.formatMessage({
                  id: 'ConfirmSignupForm.emailLabel',
                })}
                placeholder={intl.formatMessage({
                  id: 'ConfirmSignupForm.emailPlaceholder',
                })}
                initialValue={email}
                validate={validators.composeValidators(emailRequired, emailValid)}
              />
              <div className={css.name}>
                <FieldTextInput
                  className={css.firstNameRoot}
                  type="text"
                  id={formId ? `${formId}.firstName` : 'firstName'}
                  name="firstName"
                  autoComplete="given-name"
                  label={intl.formatMessage({
                    id: 'ConfirmSignupForm.firstNameLabel',
                  })}
                  placeholder={intl.formatMessage({
                    id: 'ConfirmSignupForm.firstNamePlaceholder',
                  })}
                  initialValue={firstName}
                  validate={validators.required(
                    intl.formatMessage({
                      id: 'ConfirmSignupForm.firstNameRequired',
                    })
                  )}
                />
                <FieldTextInput
                  className={css.lastNameRoot}
                  type="text"
                  id={formId ? `${formId}.lastName` : 'lastName'}
                  name="lastName"
                  autoComplete="family-name"
                  label={intl.formatMessage({
                    id: 'ConfirmSignupForm.lastNameLabel',
                  })}
                  placeholder={intl.formatMessage({
                    id: 'ConfirmSignupForm.lastNamePlaceholder',
                  })}
                  initialValue={lastName}
                  validate={validators.required(
                    intl.formatMessage({
                      id: 'ConfirmSignupForm.lastNameRequired',
                    })
                  )}
                />
              </div>

              <UserFieldDisplayName
                formName="ConfirmSignupForm"
                className={css.row}
                userTypeConfig={userTypeConfig}
                intl={intl}
              />

              <div className={css.row}>
                <FieldTextInput
                  type="text"
                  id={formId ? `${formId}.shippingZip` : 'shippingZip'}
                  name="shippingZip"
                  autoComplete="postal-code"
                  label="Shipping zipcode"
                  placeholder="e.g. 10001"
                  validate={validators.required('ZIP code is required')}
                />
                <div className={css.helperText}>
                  We use this to estimate shipping. You can change it later.
                </div>
              </div>

              <UserFieldPhoneNumber
                formName="ConfirmSignupForm"
                className={css.row}
                userTypeConfig={userTypeConfig}
                intl={intl}
              />

              {/* Birthday row */}
              <div className={css.row}>
                {userType === 'lender' ? (
                  <div className={css.birthdayContainer}>
                    <FieldSelect
                      id="birthdayMonth"
                      name="birthdayMonth"
                      label="Month"
                      className={css.birthdayField}
                      validate={validators.required('Month is required')}
                    >
                      <option disabled value="">
                        Month
                      </option>
                      {[
                        { key: '1', label: 'January' },
                        { key: '2', label: 'February' },
                        { key: '3', label: 'March' },
                        { key: '4', label: 'April' },
                        { key: '5', label: 'May' },
                        { key: '6', label: 'June' },
                        { key: '7', label: 'July' },
                        { key: '8', label: 'August' },
                        { key: '9', label: 'September' },
                        { key: '10', label: 'October' },
                        { key: '11', label: 'November' },
                        { key: '12', label: 'December' },
                      ].map(option => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </FieldSelect>

                    <FieldSelect
                      id="birthdayDay"
                      name="birthdayDay"
                      label="Day"
                      className={css.birthdayField}
                      validate={validators.required('Day is required')}
                    >
                      <option disabled value="">
                        Day
                      </option>
                      {Array.from({ length: 31 }, (_, i) => ({
                        key: `${i + 1}`,
                        label: `${i + 1}`,
                      })).map(option => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </FieldSelect>

                    <FieldSelect
                      id="birthdayYear"
                      name="birthdayYear"
                      label="Year (optional)"
                      className={css.birthdayField}
                    >
                      <option disabled value="">
                        Year
                      </option>
                      {Array.from({ length: 100 }, (_, i) => {
                        const year = new Date().getFullYear() - i;
                        return { key: `${year}`, label: `${year}` };
                      }).map(option => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </FieldSelect>
                  </div>
                ) : null}
              </div>

              {/* Instagram handle row */}
              <div className={css.row}>
                <FieldTextInput
                  type="text"
                  id={formId ? `${formId}.instagramHandle` : 'instagramHandle'}
                  name="instagramHandle"
                  label="Instagram handle (optional)"
                  placeholder="@"
                />
              </div>
            </div>
          ) : null}

          {showCustomUserFields ? (
            <div className={css.customFields}>
              {userFieldProps.map(({ key, ...fieldProps }) => (
                <CustomExtendedDataField key={key} {...fieldProps} formId={formId} />
              ))}
            </div>
          ) : null}

          <div className={css.bottomWrapper}>
            {termsAndConditions}
            <PrimaryButton type="submit" inProgress={submitInProgress} disabled={submitDisabled}>
              <FormattedMessage id="ConfirmSignupForm.signUp" values={{ idp: idp }} />
            </PrimaryButton>
          </div>
        </Form>
      );
    }}
  />
);

/**
 * A component that renders the confirm signup form, which is used with SSO authentication.
 *
 * @component
 * @param {Object} props
 * @param {string} props.rootClassName - The root class name that overrides the default class css.root
 * @param {string} props.className - The class that extends the root class
 * @param {string} props.formId - The form id
 * @param {boolean} props.inProgress - Whether the form is in progress
 * @param {ReactNode} props.termsAndConditions - The terms and conditions
 * @param {string} props.preselectedUserType - The preselected user type
 * @param {propTypes.userTypes} props.userTypes - The user types
 * @param {propTypes.listingFields} props.userFields - The user fields
 * @returns {JSX.Element}
 */
const ConfirmSignupForm = props => {
  const intl = useIntl();
  return <ConfirmSignupFormComponent {...props} intl={intl} />;
};

export default ConfirmSignupForm; 