import React from 'react';
import { formatMoney } from '../../util/currency';
import { FormattedMessage } from '../../util/reactIntl';
import { LINE_ITEM_ESTIMATED_SHIPPING } from '../../util/types';
import css from './OrderBreakdown.module.css';

/**
 * A component that renders the estimated shipping cost as a line item.
 *
 * @component
 * @param {Object} props
 * @param {Array<propTypes.lineItem>} props.lineItems - The line items to render
 * @param {intlShape} props.intl - The intl object
 * @returns {JSX.Element}
 */
const LineItemEstimatedShippingMaybe = props => {
  const { lineItems, intl } = props;

  const shippingItem = lineItems.find(
    item => item.code === LINE_ITEM_ESTIMATED_SHIPPING && !item.reversal
  );

  if (!shippingItem) {
    return null;
  }

  // Decide what to show on the right-hand side
  let valueText = null;
  if (shippingItem.lineTotal) {
    valueText = formatMoney(intl, shippingItem.lineTotal);
  } else {
    // No estimate yet (missing ZIPs or can't compute)
    valueText = 'calculated at checkout';
  }

  return (
    <div className={css.lineItem}>
      <div className={css.itemLabel}>
        <FormattedMessage id="OrderBreakdown.estimatedShipping" />
      </div>
      <div className={css.itemValue}>{valueText}</div>
    </div>
  );
};

export default LineItemEstimatedShippingMaybe;

