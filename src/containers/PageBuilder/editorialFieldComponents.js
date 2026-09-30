import { EditorialH1, EditorialH2 } from './Primitives/Heading';

// Same behavior as the pickers in ./Field/Field.helpers. Kept local so importing this
// mapping from a page (e.g. LandingPage) doesn't pull the rest of Field.helpers into that chunk.
const hasContent = data => typeof data?.content === 'string' && data?.content.length > 0;
const exposeContentAsChildren = data => (hasContent(data) ? { children: data.content } : {});
const omitInvalidPropsWarning = data => !hasContent(data);

/**
 * Opt-in editorial (brand) typography for Page Builder content.
 *
 * Pass as `options={{ fieldComponents: editorialFieldComponents }}` to <PageBuilder>
 * on a marketing/editorial page. Console-managed heading1/heading2 fields on that page
 * (hero title, section titles, block titles) then render with the editorial font.
 * Semantic levels (h1/h2) are unchanged. heading3-6, markdown, and body text keep
 * the default UI typography.
 *
 * Pages that don't pass this option (Terms of Service, Privacy Policy, other CMS pages)
 * keep the default UI headings.
 */
export const editorialFieldComponents = {
  heading1: {
    component: EditorialH1,
    pickValidProps: exposeContentAsChildren,
    omitInvalidPropsWarning,
  },
  heading2: {
    component: EditorialH2,
    pickValidProps: exposeContentAsChildren,
    omitInvalidPropsWarning,
  },
};
