import React from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { ensureCurrentUser } from '../../util/data';
import { isScrollingDisabled } from '../../ducks/ui.duck';

import { Page, NamedLink, LayoutSingleColumn } from '../../components';

import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import css from './WelcomeLenderPage.module.css';

/**
 * Post-signup welcome page for lenders.
 *
 * WHY THIS EXISTS. New lenders arrive from Instagram/Meta ads pointed at
 * /signup/lender. Before this page they landed on the "check your email"
 * interstitial, which is a dead end at the exact moment intent is highest.
 * AuthenticationPage now redirects a freshly signed-up lender here instead
 * (see AuthenticationPage.js — shouldRedirectToWelcome), so the first thing
 * they see is a single CTA into the listing wizard.
 *
 * The verification email is still sent by Sharetribe; nothing here bypasses
 * it. The user is already authenticated at this point — signup logs them in.
 */

const EARNINGS_TIERS = [
  { list: 'List $100', keep: 'Keep $85', equals: "= girls' night 🍸" },
  { list: 'List $200', keep: 'Keep $170', equals: '= your next mani 💅' },
  { list: 'List $300', keep: 'Keep $255', equals: '= shopping 🛍️' },
];

export const WelcomeLenderPageComponent = props => {
  const { currentUser, scrollingDisabled } = props;

  const user = ensureCurrentUser(currentUser);
  const firstName = user?.attributes?.profile?.firstName || null;

  return (
    <Page title="You're in — Sherbrt" scrollingDisabled={scrollingDisabled}>
      <LayoutSingleColumn topbar={<TopbarContainer />} footer={<FooterContainer />}>
        <div className={css.root}>
          {firstName ? <p className={css.eyebrow}>Hey {firstName} 👋</p> : null}

          <h1 className={css.heading}>
            You're in. Let your closet earn her keep. 💸
          </h1>

          <NamedLink name="NewListingPage" className={css.cta}>
            Add my first listing →
          </NamedLink>
          <p className={css.ctaNote}>List your first piece in 4 minutes or less. No fees.</p>

          <p className={css.sectionLabel}>You keep 85% of everything you lend 💰</p>
          <div className={css.tiles}>
            {EARNINGS_TIERS.map(tier => (
              <div className={css.tile} key={tier.list}>
                <p className={css.tileList}>{tier.list}</p>
                <p className={css.tileKeep}>{tier.keep}</p>
                <p className={css.tileEquals}>{tier.equals}</p>
              </div>
            ))}
          </div>

          <p className={css.kicker}>Why sell once when you can earn again and again? ♻️</p>

          <NamedLink name="ProfileSettingsPage" className={css.skip}>
            I'll do this later
          </NamedLink>
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

const mapStateToProps = state => {
  const { currentUser } = state.user;
  return {
    currentUser,
    scrollingDisabled: isScrollingDisabled(state),
  };
};

const WelcomeLenderPage = compose(connect(mapStateToProps))(WelcomeLenderPageComponent);

export default WelcomeLenderPage;
