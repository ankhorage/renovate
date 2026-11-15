/***
 * Canonical Renovate policy and future automation provider for Ankhorage repositories.
 *
 * The shared preset is published as `default.json` and consumed from GitHub. The TypeScript
 * public API is intentionally reserved for the future `ankh renovate` provider.
 *
 * The `ankhorage-renovate-sync` GitHub App intentionally uses **selected repositories**, not
 * organization-wide access. The selected App installation is the sole positive enrollment source.
 * The coordinator reports selected repositories that still need the immutable workflow bootstrap
 * instead of silently omitting them.
 *
 * @readme
 */
export {};
