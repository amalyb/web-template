/**
 * A text field with phone number formatting.
 * 
 * Policy:
 * - UI displays friendly format: (510) 399-7781
 * - Never shows "+" prefix
 * - Stores raw digits only in form state
 * - Server normalizes to E.164 (+15103997781) before Twilio
 */
import React from 'react';

import { FieldTextInput } from '../../components';
// US phone formatter: displays (###) ###-####, stores digits only, no "+"
import { format, parse } from './usPhoneFormatter';

const FieldPhoneNumberInput = props => {
  const inputProps = {
    type: 'tel',
    format: format,
    parse: parse,
    ...props,
  };

  return <FieldTextInput {...inputProps} />;
};

export default FieldPhoneNumberInput;
