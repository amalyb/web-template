import React from 'react';
import { Form as FinalForm } from 'react-final-form';

import { useIntl } from '../../../../util/reactIntl';
import { getPropsForCustomUserFieldInputs } from '../../../../util/userHelpers';

import { Form, PrimaryButton, CustomExtendedDataField } from '../../../../components';

import css from './MeasurementsModal.module.css';

/**
 * The lender profile fields the listing page renders in its
 * "About the lender -> Details" block (ListingPageCarousel.js).
 * Kept in sync with mobile's lib/measurements.js MEASUREMENT_KEYS.
 */
export const MEASUREMENT_KEYS = [
  'height',
  'bra_size',
  'dress_size_number',
  'dress_size_letter',
  'jeans_size',
];

/**
 * True when the user already has every measurement saved on their profile.
 */
export const hasAllMeasurements = user => {
  const publicData = user?.attributes?.profile?.publicData || {};
  return MEASUREMENT_KEYS.every(key => {
    const value = publicData[key];
    return value !== undefined && value !== null && value !== '';
  });
};

/**
 * Initial form values, so a lender who filled in some fields earlier
 * only has to complete the rest.
 */
export const initialMeasurementValues = user => {
  const publicData = user?.attributes?.profile?.publicData || {};
  return MEASUREMENT_KEYS.reduce((values, key) => {
    const value = publicData[key];
    return value != null && value !== '' ? { ...values, [`pub_${key}`]: value } : values;
  }, {});
};

/**
 * Measurement inputs, driven by the Console-hosted user-fields config so the
 * labels and option lists stay editable in Console (no hardcoded size lists).
 * Required-ness is enforced here rather than via the config's isRequired flag,
 * because these fields were made optional when they came off the signup form.
 */
const MeasurementsForm = props => {
  const { onSubmit, initialValues, inProgress, userFields, userType, saveError } = props;
  const intl = useIntl();

  const fieldProps = getPropsForCustomUserFieldInputs(userFields, intl, userType, false).filter(
    ({ key }) => MEASUREMENT_KEYS.includes(key.replace(/^pub_/, ''))
  );

  // If the fields have been removed from Console entirely there is nothing to
  // ask for. Publish rather than trapping the lender behind an empty modal.
  if (fieldProps.length === 0) {
    return null;
  }

  return (
    <FinalForm
      onSubmit={onSubmit}
      initialValues={initialValues}
      render={formRenderProps => {
        const { handleSubmit, values, formId } = formRenderProps;

        const allFilled = fieldProps.every(({ name }) => {
          const value = values?.[name];
          return value !== undefined && value !== null && value !== '';
        });
        const submitDisabled = !allFilled || inProgress;

        return (
          <Form onSubmit={handleSubmit}>
            <div className={css.fields}>
              {fieldProps.map(({ key, ...rest }) => (
                <CustomExtendedDataField key={key} {...rest} formId={formId} />
              ))}
            </div>

            {saveError ? (
              <p className={css.error}>
                Something went wrong saving your details. Please try again.
              </p>
            ) : null}

            <PrimaryButton
              type="submit"
              className={css.submitButton}
              inProgress={inProgress}
              disabled={submitDisabled}
            >
              Save & publish my listing
            </PrimaryButton>
          </Form>
        );
      }}
    />
  );
};

export default MeasurementsForm;
