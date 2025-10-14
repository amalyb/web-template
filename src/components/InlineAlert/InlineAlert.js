import React from 'react';
import classNames from 'classnames';

import { Button, IconAlert } from '../../components';

import css from './InlineAlert.module.css';

/**
 * InlineAlert component for displaying inline error/warning/info messages
 * with optional action button
 *
 * @component
 * @param {Object} props
 * @param {string?} props.className add more style rules
 * @param {string?} props.rootClassName overwrite root class
 * @param {string} props.type 'error' | 'warning' | 'info'
 * @param {string} props.title Alert title
 * @param {string?} props.message Alert message body
 * @param {string?} props.actionText Optional button text
 * @param {Function?} props.onAction Optional button click handler
 * @returns {JSX.Element} InlineAlert component
 */
const InlineAlert = props => {
  const {
    rootClassName,
    className,
    type = 'error',
    title,
    message,
    actionText,
    onAction,
  } = props;

  const classes = classNames(rootClassName || css.root, className, {
    [css.error]: type === 'error',
    [css.warning]: type === 'warning',
    [css.info]: type === 'info',
  });

  return (
    <div className={classes}>
      <div className={css.iconWrapper}>
        <IconAlert className={css.icon} />
      </div>
      <div className={css.content}>
        <h4 className={css.title}>{title}</h4>
        {message && <p className={css.message}>{message}</p>}
        {actionText && onAction && (
          <Button
            rootClassName={css.actionButton}
            onClick={onAction}
          >
            {actionText}
          </Button>
        )}
      </div>
    </div>
  );
};

export default InlineAlert;

