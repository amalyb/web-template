import React, { useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';

import { NamedLink, Page, IconSocialMediaInstagram } from '../../components';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';
import getZodiacEmoji from '../../util/getZodiacEmoji';

import css from './TopLendersPage.module.css';

const RESULT_LIMIT = 200;
const TOP_COUNT = 12;

const TopLendersPage = props => {
  const { className, rootClassName } = props;
  

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [topLenders, setTopLenders] = useState([]);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    fetch('/api/top-lenders', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    })
      .then(res => {
        if (!res.ok) throw new Error(`Server responded ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (!isMounted) return;
        const rows = data.topLenders || [];
        setTopLenders(rows);
        setLoading(false);
      })
      .catch(e => {
        if (!isMounted) return;
        // eslint-disable-next-line no-console
        console.error('TopLendersPage /api/top-lenders failed', e);
        setError(e);
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const classes = classNames(rootClassName || css.root, className);

  const getInitials = name => {
    if (!name) return '?';
    const parts = String(name).trim().split(/\s+/);
    const first = parts[0] ? parts[0][0] : '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase() || '?';
  };

  const content = useMemo(() => {
    if (loading) {
      return <div className={css.stateText}>Loading top lenders…</div>;
    }
    if (error) {
      return <div className={css.stateText}>Failed to load top lenders.</div>;
    }
    if (!topLenders || topLenders.length === 0) {
      return (
        <div className={css.stateText}>
          No active lenders yet — be the first to list ✨{' '}
          <span className={css.stateCta}>
            <NamedLink name="NewListingPage">Post a new listing</NamedLink>
          </span>
        </div>
      );
    }

    return (
      <div className={css.grid}>
        {topLenders.map(l => (
          <div className={`${css.card} ${css.topLenderCard}`} key={l.userId}>
            <NamedLink name="ProfilePage" params={{ id: l.userId }}>
              <div className={`${css.avatarWrapper} ${css.topLenderAvatarWrapper}`}>
                {l.avatarUrl ? (
                  <img
                    src={l.avatarUrl}
                    alt={l.displayName}
                    className={css.avatarImage}
                  />
                ) : (
                  <div className={css.avatarFallbackCircle}>
                    <div className={css.avatarInitials}>{getInitials(l.displayName)}</div>
                  </div>
                )}
              </div>
            </NamedLink>
            <NamedLink name="ProfilePage" params={{ id: l.userId }}>
              <div className={css.lenderName}>{l.displayName}</div>
            </NamedLink>
            {(l.zodiacSign || l.instagramHandle) ? (
              <div className={css.userMetaRow}>
                {l.zodiacSign ? (
                  <span className={css.metaItem}>
                    <span className={css.metaIcon}>
                      {getZodiacEmoji(l.zodiacSign)}
                    </span>
                    <span className={css.metaText}>
                      {l.zodiacSign}
                    </span>
                  </span>
                ) : null}
                {l.instagramHandle ? (
                  <a
                    className={css.metaItem}
                    href={`https://www.instagram.com/${l.instagramHandle.replace(/^@/, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className={css.metaIconInstagram}>
                      <IconSocialMediaInstagram />
                    </span>
                    <span className={css.metaText}>
                      @{l.instagramHandle.replace(/^@/, '')}
                    </span>
                  </a>
                ) : null}
              </div>
            ) : null}
            <div className={css.listingCount}>{l.count} listings</div>
            <NamedLink
              name="SearchPage"
              to={{ search: `?authorId=${encodeURIComponent(l.userId)}` }}
              className={`${css.listingsLink} ${css.borrowHerLooksLink}`}
            >
              Borrow her looks →
            </NamedLink>
          </div>
        ))}
      </div>
    );
  }, [loading, error, topLenders]);

  return (
    <Page
      title="Sherbrt Babes | Sherbrt"
      description="Borrow from the Sherbrt babes with the most looks live right now"
      scrollingDisabled={false}
    >
      <TopbarContainer />
      <div className={classes}>
        <header className={css.headerSection}>
          <h1 className={css.headerTitle}>Sherbrt Babes</h1>
          <p className={css.headerTagline}>
            Borrow from the Sherbrt babes with the most looks live right now! 🍧💅
          </p>
        </header>
        {content}
      </div>
      <FooterContainer />
    </Page>
  );
};

export default TopLendersPage;


