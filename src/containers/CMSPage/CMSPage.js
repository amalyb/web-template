import React from 'react';
import loadable from '@loadable/component';

import { bool, object } from 'prop-types';
import { compose } from 'redux';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';

import NotFoundPage from '../../containers/NotFoundPage/NotFoundPage';
import {
  editorialFieldComponents,
  EditorialFontPreload,
} from '../PageBuilder/editorialFieldComponents';
const PageBuilder = loadable(() =>
  import(/* webpackChunkName: "PageBuilder" */ '../PageBuilder/PageBuilder')
);

// CMS pages (/p/:pageId) that opt into editorial (brand) typography for their Console-managed
// heading1/heading2 fields (page and section titles). Step titles (h3) and FAQ questions (h5)
// keep the default UI headings. Every other CMS page keeps default headings.
const EDITORIAL_PAGE_IDS = ['about', 'how_to_lend', 'how_to_borrow'];
const editorialPageBuilderOptions = { fieldComponents: editorialFieldComponents };

export const CMSPageComponent = props => {
  const { params, pageAssetsData, inProgress, error } = props;
  const pageId = params.pageId || props.pageId;

  if (!inProgress && error?.status === 404) {
    return <NotFoundPage staticContext={props.staticContext} />;
  }

  const isEditorialPage = EDITORIAL_PAGE_IDS.includes(pageId);

  return (
    <>
      {isEditorialPage ? <EditorialFontPreload /> : null}
      <PageBuilder
        pageAssetsData={pageAssetsData?.[pageId]?.data}
        inProgress={inProgress}
        schemaType="Article"
        options={isEditorialPage ? editorialPageBuilderOptions : undefined}
      />
    </>
  );
};

CMSPageComponent.propTypes = {
  pageAssetsData: object,
  inProgress: bool,
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
const CMSPage = compose(
  withRouter,
  connect(mapStateToProps)
)(CMSPageComponent);

export default CMSPage;
