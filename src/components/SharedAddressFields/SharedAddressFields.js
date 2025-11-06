/**
 * SharedAddressFields - Reusable address form fields
 * Used by both borrower (checkout) and lender (accept) flows
 * Ensures identical labels, placeholders, validation, and normalization
 */

import React, { useCallback } from 'react';
import PropTypes from 'prop-types';
import { Field, useFormState } from 'react-final-form';
import FieldTextInput from '../FieldTextInput/FieldTextInput';
import FieldSelect from '../FieldSelect/FieldSelect';
import { US_STATES } from '../../util/geoData';
import { normalizeStreet1AndStreet2 } from '../../util/addressNormalizers';
import css from './SharedAddressFields.module.css';

/**
 * SharedAddressFields Component
 * 
 * @param {Object} props
 * @param {string} props.prefix - Field name prefix (e.g., "provider", "customer", "billing", "shipping")
 * @param {Object} props.requiredFields - Which fields are required { name, line1, line2, city, state, postalCode, phone }
 * @param {boolean} props.disabled - Disable all fields
 * @param {string} props.title - Optional section title
 * @param {boolean} props.showPhone - Show phone field (default: true)
 * @param {boolean} props.autoExtractUnit - Auto-extract unit from street1 to street2 (default: true)
 * @param {Function} props.onStreetChange - Optional callback when street fields change
 */
export default function SharedAddressFields({
  prefix,
  requiredFields = {},
  disabled = false,
  title,
  showPhone = true,
  autoExtractUnit = true,
  onStreetChange,
}) {
  const form = useFormState({ subscription: { values: true } });
  
  // Get current values for this prefix
  const getFieldValue = (fieldName) => {
    if (prefix) {
      return form.values?.[`${prefix}${fieldName.charAt(0).toUpperCase()}${fieldName.slice(1)}`];
    }
    return form.values?.[fieldName];
  };

  // Handle street1 blur - extract unit to street2 if enabled
  const handleStreet1Blur = useCallback((event, fieldApi) => {
    if (!autoExtractUnit) return;

    const street1Value = event.target.value;
    const street2FieldName = prefix ? `${prefix}Street2` : 'street2';
    const street2Value = getFieldValue('street2') || '';

    // Only extract if street2 is empty
    if (!street2Value.trim()) {
      const normalized = normalizeStreet1AndStreet2(street1Value, street2Value);
      
      // If unit was extracted, update both fields
      if (normalized.street2) {
        // Update street1 (cleaned)
        fieldApi.change(normalized.street1);
        
        // Update street2 (extracted unit)
        const form = fieldApi.mutators?.setFieldData || fieldApi.form;
        if (form) {
          form.change(street2FieldName, normalized.street2);
          
          console.log('[SharedAddressFields] Auto-extracted unit:', {
            original: street1Value,
            street1: normalized.street1,
            street2: normalized.street2
          });
        }
      }
    }

    // Call optional callback
    if (onStreetChange) {
      onStreetChange({ street1: street1Value, street2: street2Value });
    }
  }, [autoExtractUnit, prefix, onStreetChange, getFieldValue]);

  // Build field names with prefix
  const field = (name) => prefix ? `${prefix}${name.charAt(0).toUpperCase()}${name.slice(1)}` : name;

  return (
    <div className={css.root} aria-disabled={disabled}>
      {title && <h3 className={css.title}>{title}</h3>}

      {/* Full Name */}
      <Field name={field('name')}>
        {({ input, meta }) => (
          <FieldTextInput
            {...input}
            className={css.field}
            id={field('name')}
            label="Full Name"
            placeholder="John Doe"
            required={!!requiredFields.name}
            autoComplete="name"
            disabled={disabled}
            meta={meta}
          />
        )}
      </Field>

      {/* Street Address Line 1 */}
      <Field name={field('street')}>
        {({ input, meta }) => (
          <FieldTextInput
            {...input}
            className={css.field}
            id={field('street')}
            label="Street Address *"
            placeholder="123 Example Street"
            required={!!requiredFields.line1 || !!requiredFields.street}
            autoComplete="address-line1"
            disabled={disabled}
            meta={meta}
            onBlur={(e) => {
              input.onBlur(e);
              handleStreet1Blur(e, { change: input.onChange, form: meta.form || {} });
            }}
          />
        )}
      </Field>

      {/* Street Address Line 2 - IDENTICAL to borrower form */}
      <Field name={field('street2')}>
        {({ input, meta }) => (
          <FieldTextInput
            {...input}
            className={css.field}
            id={field('street2')}
            label="Apartment, Suite, etc. (Optional)"
            placeholder="Apt 7, Suite 200, Unit B"
            required={false}
            autoComplete="address-line2"
            disabled={disabled}
            meta={meta}
          />
        )}
      </Field>

      {/* City */}
      <Field name={field('city')}>
        {({ input, meta }) => (
          <FieldTextInput
            {...input}
            className={css.field}
            id={field('city')}
            label="City *"
            placeholder="San Francisco"
            required={!!requiredFields.city}
            autoComplete="address-level2"
            disabled={disabled}
            meta={meta}
          />
        )}
      </Field>

      {/* State - Dropdown with US States */}
      <Field name={field('state')}>
        {({ input, meta }) => (
          <FieldSelect
            {...input}
            className={css.field}
            id={field('state')}
            label="State *"
            required={!!requiredFields.state}
            autoComplete="address-level1"
            disabled={disabled}
            meta={meta}
          >
            <option value="">Select a state</option>
            {US_STATES.map(state => (
              <option key={state.value} value={state.value}>
                {state.label}
              </option>
            ))}
          </FieldSelect>
        )}
      </Field>

      {/* ZIP Code */}
      <Field name={field('zip')}>
        {({ input, meta }) => (
          <FieldTextInput
            {...input}
            className={css.field}
            id={field('zip')}
            label="ZIP Code *"
            placeholder="94109 or 94109-1234"
            required={!!requiredFields.postalCode || !!requiredFields.zip}
            autoComplete="postal-code"
            disabled={disabled}
            meta={meta}
            maxLength={10}
          />
        )}
      </Field>

      {/* Phone Number - UI stores digits only, server normalizes to E.164 */}
      {showPhone && (
        <FieldTextInput
          className={css.field}
          id={field('phone')}
          name={field('phone')}
          label="Phone Number *"
          placeholder="(555) 123-4567"
          type="tel"
          required={!!requiredFields.phone}
          autoComplete="tel"
          disabled={disabled}
        />
      )}
    </div>
  );
}

SharedAddressFields.propTypes = {
  prefix: PropTypes.string,
  requiredFields: PropTypes.shape({
    name: PropTypes.bool,
    line1: PropTypes.bool,
    street: PropTypes.bool,
    line2: PropTypes.bool,
    street2: PropTypes.bool,
    city: PropTypes.bool,
    state: PropTypes.bool,
    postalCode: PropTypes.bool,
    zip: PropTypes.bool,
    phone: PropTypes.bool,
  }),
  disabled: PropTypes.bool,
  title: PropTypes.string,
  showPhone: PropTypes.bool,
  autoExtractUnit: PropTypes.bool,
  onStreetChange: PropTypes.func,
};

