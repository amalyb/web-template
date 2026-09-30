import React from 'react';
import loadable from '@loadable/component';

import { bool, object } from 'prop-types';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { camelize } from '../../util/string';
import { propTypes } from '../../util/types';

import FallbackPage from './FallbackPage';
import { ASSET_NAME } from './LandingPage.duck';
import {
  editorialFieldComponents,
  EditorialFontPreload,
} from '../PageBuilder/editorialFieldComponents';

const PageBuilder = loadable(() =>
  import(/* webpackChunkName: "PageBuilder" */ '../PageBuilder/PageBuilder')
);

// The landing page opts into editorial (brand) typography for its Console-managed
// heading1/heading2 fields. Other Page Builder pages keep the default UI headings.
const pageBuilderOptions = { fieldComponents: editorialFieldComponents };

export const LandingPageComponent = props => {
  const { pageAssetsData, inProgress, error } = props;

  return (
    <>
      <EditorialFontPreload />
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
