import React from 'react';
import loadable from '@loadable/component';
import { Helmet } from 'react-helmet-async';

import { bool, object } from 'prop-types';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { camelize } from '../../util/string';
import { propTypes } from '../../util/types';

import FallbackPage from './FallbackPage';
import { ASSET_NAME } from './LandingPage.duck';
import { editorialFieldComponents } from '../PageBuilder/editorialFieldComponents';

const PageBuilder = loadable(() =>
  import(/* webpackChunkName: "PageBuilder" */ '../PageBuilder/PageBuilder')
);

// The landing page opts into editorial (brand) typography for its Console-managed
// heading1/heading2 fields. Other Page Builder pages keep the default UI headings.
const pageBuilderOptions = { fieldComponents: editorialFieldComponents };
const EDITORIAL_FONT_URL = '/static/fonts/bodoni-moda-latin-opsz-normal.woff2';

export const LandingPageComponent = props => {
  const { pageAssetsData, inProgress, error } = props;

  return (
    <>
      <Helmet>
        {/* Editorial font is only used on this page, so it's only preloaded here */}
        <link
          rel="preload"
          href={EDITORIAL_FONT_URL}
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </Helmet>
      <PageBuilder
        pageAssetsData={pageAssetsData?.[camelize(ASSET_NAME)]?.data}
        inProgress={inProgress}
        error={error}
        fallbackPage={<FallbackPage error={error} />}
        options={pageBuilderOptions}
      />
    </>
  );
};

LandingPageComponent.propTypes = {
  pageAssetsData: object,
  inProgress: bool,
  error: propTypes.error,
};

const mapStateToProps = state => {
  const { pageAssetsData, inProgress, error } = state.hostedAssets || {};
  return { pageAssetsData, inProgress, error };
};

// Note: it is important that the withRouter HOC is **outside** the
// connect HOC, otherwise React Router won't rerender any Route
// components since connect implements a shouldComponentUpdate
// lifecycle hook.
//
// See: https://github.com/ReactTraining/react-router/issues/4671
const LandingPage = compose(connect(mapStateToProps))(LandingPageComponent);

export default LandingPage;
