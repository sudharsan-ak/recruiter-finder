// aliases.js — Company slug alias map
// ─────────────────────────────────────────────────────────────────────────────
// Edit this file to add known LinkedIn company slug aliases.
// LinkedIn sometimes uses different slugs on profile pages vs the company page URL.
// Example: a recruiter's profile shows /company/onepay/ but the company page is
//          linkedin.com/company/joinonepay/ — add the entry below to fix the mismatch.
//
// Format:
//   'alias': 'canonical-slug'
//
// The alias can be:
//   - the slug from a profile's experience section link  (e.g. 'onepay')
//   - a normalized company name (lowercase, no spaces/symbols) (e.g. 'acmecorp')
//
// The canonical slug is the one in the actual company page URL.
//
// This map is checked first (instant, no network).
// Unknown aliases are resolved by a one-time network fetch and cached in local storage.
// ─────────────────────────────────────────────────────────────────────────────

var COMPANY_SLUG_ALIASES = globalThis.COMPANY_SLUG_ALIASES || {};

Object.assign(COMPANY_SLUG_ALIASES, {
  // Add entries here ONLY when a slug on someone's profile differs from the company page URL.
  // Format: 'profile-slug': 'company-page-slug'
  // Self-referencing entries (same key and value) have no effect — skip them.
  "onepay": "joinonepay",
});

globalThis.COMPANY_SLUG_ALIASES = COMPANY_SLUG_ALIASES;
