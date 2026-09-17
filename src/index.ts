/***
 * Canonical Renovate policy and future automation provider for Ankhorage repositories.
 *
 * The shared preset is published as `default.json` and consumed from GitHub. The TypeScript
 * public API is intentionally reserved for the future `ankh renovate` provider.
 *
 * The `ankhorage-renovate-sync` GitHub App intentionally uses **selected repositories**, not
 * organization-wide access. Before a repository is added to `devtools-consumers.json` or treated
 * as managed-release ready, an organization owner must first add that repository to the existing
 * App installation. The rollout workflow validates the installation's accessible repository set
 * against the registry and fails with the missing repository names when this bootstrap step is
 * incomplete.
 *
 * @readme
 */
export {};
