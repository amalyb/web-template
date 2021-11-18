import React from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../../util/reactIntl';

import css from './TransactionPanel.module.css';

// Functional component as a helper to build ActivityFeed section
const FeedSection = props => {
  const {
    className,
    rootClassName,
    activityFeed,
    hasTransitions,
    fetchMessagesError,
    initialMessageFailed,
    hasMessages,
  } = props;

  const showFeed = hasMessages || hasTransitions || initialMessageFailed || fetchMessagesError;

  const classes = classNames(rootClassName || css.feedContainer, className);

  return showFeed ? (
    <div className={classes}>
      <h3 className={css.sectionHeading}>
        <FormattedMessage id="TransactionPanel.activityHeading" />
      </h3>
      {initialMessageFailed ? (
        <p className={css.messageError}>
          <FormattedMessage id="TransactionPanel.initialMessageFailed" />
        </p>
      ) : null}
      {fetchMessagesError ? (
        <p className={css.messageError}>
          <FormattedMessage id="TransactionPanel.messageLoadingFailed" />
        </p>
      ) : null}
      <div className={css.feedContent}>{activityFeed}</div>
    </div>
  ) : null;
};

export default FeedSection;
