import React from 'react';
import PropTypes from 'prop-types';
import { Form as FinalForm } from 'react-final-form';
import SharedAddressFields from '../SharedAddressFields/SharedAddressFields';
import css from './ProviderAddressForm.module.css';

/**
 * ProviderAddressForm - Lender address form for Accept flow
 * Now uses SharedAddressFields for consistency with borrower checkout
 * 
 * Field mapping (for backward compatibility with existing code):
 * - streetAddress → street (auto-extracted to street2 if contains unit)
 * - streetAddress2 → street2
 * - city → city
 * - state → state (dropdown with US states)
 * - zipCode → zip
 * - phoneNumber → phone (E.164 normalized)
 */
const ProviderAddressForm = ({ initialValues, onChange }) => {
  // Map legacy field names to new field names for SharedAddressFields
  const mappedInitialValues = {
    street: initialValues?.streetAddress || '',
    street2: initialValues?.streetAddress2 || '',
    city: initialValues?.city || '',
    state: initialValues?.state || '',
    zip: initialValues?.zipCode || '',
    phone: initialValues?.phoneNumber || '',
  };

  return (
    <div className={css.root}>
      <h3 className={css.title}>Lender Shipping Address</h3>
      <p className={css.description}>
        Please provide your shipping address. This ensures your item makes it back to you smoothly after each borrow.
      </p>
      <FinalForm
        initialValues={mappedInitialValues}
        onSubmit={() => {}}
        render={({ handleSubmit, values }) => {
          React.useEffect(() => {
            console.log('[ProviderAddressForm] raw values:', values);
            
            if (onChange) {
              // Map back to legacy field names for compatibility
              const mappedValues = {
                streetAddress: values.street || '',
                streetAddress2: values.street2 || '',
                city: values.city || '',
                state: values.state || '',
                zipCode: values.zip || '',
                phoneNumber: values.phone || '',
              };
              console.log('[ProviderAddressForm] mapped values:', mappedValues);
              onChange(mappedValues);
            }
          }, [values, onChange]);

          return (
            <form onSubmit={handleSubmit} className={css.form}>
              <SharedAddressFields
                prefix="" // No prefix since we're using legacy field names
                requiredFields={{
                  street: true,
                  city: true,
                  state: true,
                  zip: true,
                  phone: true,
                }}
                showPhone={true}
                autoExtractUnit={true} // Auto-extract units like "#7", "Apt 4" from street to street2
              />
            </form>
          );
        }}
      />
    </div>
  );
};

ProviderAddressForm.propTypes = {
  initialValues: PropTypes.object,
  onChange: PropTypes.func.isRequired,
};

export default ProviderAddressForm; 