import React, { useEffect, useState } from 'react';
import { bool, oneOf, shape } from 'prop-types';
import { compose } from 'redux';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';

import { useConfiguration } from '../../context/configurationContext';
import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { propTypes } from '../../util/types';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import {
  Page,
  LayoutSingleColumn,
  IconSpinner,
} from '../../components';

import TopbarContainer from '../../containers/TopbarContainer/TopbarContainer';
import FooterContainer from '../../containers/FooterContainer/FooterContainer';

import css from './ShipPage.module.css';

/**
 * ShipPage - Display shipping label and QR code for a transaction
 * 
 * This page is accessed via SMS links sent to lenders after a label is created.
 * It provides access to shipping labels and QR codes.
 */
const ShipPageComponent = props => {
  const config = useConfiguration();
  const intl = useIntl();
  const { scrollingDisabled, params } = props;
  const transactionId = params?.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [labelData, setLabelData] = useState(null);

  useEffect(() => {
    // Fetch label data from the API
    const fetchLabelData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Call the API to get label information
        const response = await fetch(`/api/ship/${transactionId}`);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch label: ${response.statusText}`);
        }

        const data = await response.json();
        setLabelData(data);
      } catch (err) {
        console.error('[ShipPage] Failed to fetch label:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (transactionId) {
      fetchLabelData();
    }
  }, [transactionId]);

  const title = intl.formatMessage({ id: 'ShipPage.title' });
  const schemaTitle = intl.formatMessage(
    { id: 'ShipPage.schemaTitle' },
    { title }
  );

  return (
    <Page
      title={schemaTitle}
      scrollingDisabled={scrollingDisabled}
      schema={{
        '@context': 'http://schema.org',
        '@type': 'WebPage',
        name: schemaTitle,
      }}
    >
      <LayoutSingleColumn topbar={<TopbarContainer />} footer={<FooterContainer />}>
        <div className={css.root}>
          <div className={css.content}>
            <h1 className={css.title}>
              <FormattedMessage id="ShipPage.heading" />
            </h1>

            {loading && (
              <div className={css.loading}>
                <IconSpinner />
                <p className={css.loadingText}>
                  <FormattedMessage id="ShipPage.loadingLabel" />
                </p>
              </div>
            )}

            {error && (
              <div className={css.error}>
                <h2>
                  <FormattedMessage id="ShipPage.errorTitle" />
                </h2>
                <p>{error}</p>
                <p className={css.helpText}>
                  <FormattedMessage id="ShipPage.errorHelp" />
                </p>
              </div>
            )}

            {!loading && !error && labelData && (
              <div className={css.labelContainer}>
                <div className={css.section}>
                  <h2 className={css.sectionTitle}>
                    <FormattedMessage id="ShipPage.qrCodeTitle" />
                  </h2>
                  {labelData.qrCodeUrl ? (
                    <div className={css.qrCode}>
                      <img src={labelData.qrCodeUrl} alt="Shipping QR Code" />
                      <p className={css.instructions}>
                        <FormattedMessage id="ShipPage.qrCodeInstructions" />
                      </p>
                    </div>
                  ) : (
                    <p>
                      <FormattedMessage id="ShipPage.noQrCode" />
                    </p>
                  )}
                </div>

                <div className={css.section}>
                  <h2 className={css.sectionTitle}>
                    <FormattedMessage id="ShipPage.labelTitle" />
                  </h2>
                  {labelData.labelUrl ? (
                    <div className={css.labelLinks}>
                      <a
                        href={labelData.labelUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={css.button}
                      >
                        <FormattedMessage id="ShipPage.viewLabel" />
                      </a>
                      {labelData.trackingNumber && (
                        <div className={css.tracking}>
                          <strong>
                            <FormattedMessage id="ShipPage.trackingNumber" />:
                          </strong>{' '}
                          {labelData.trackingNumber}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p>
                      <FormattedMessage id="ShipPage.noLabel" />
                    </p>
                  )}
                </div>

                {labelData.shipByDate && (
                  <div className={css.shipByNotice}>
                    <FormattedMessage
                      id="ShipPage.shipByNotice"
                      values={{ date: labelData.shipByDate }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

ShipPageComponent.defaultProps = {
  params: null,
};

ShipPageComponent.propTypes = {
  scrollingDisabled: bool.isRequired,
  params: shape({
    id: propTypes.uuid,
  }),
};

const mapStateToProps = state => {
  return {
    scrollingDisabled: isScrollingDisabled(state),
  };
};

const ShipPage = compose(
  withRouter,
  connect(mapStateToProps)
)(ShipPageComponent);

export default ShipPage;

