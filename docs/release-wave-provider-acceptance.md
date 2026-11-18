# Isolated release-wave provider acceptance

Run `bun run test:release-wave:provider-acceptance` to execute the isolated provider-contract track.
It uses no Ankhorage production repository, credential, dispatch, npm publication, PR, approval, or
release. The fixture reproduces the authenticated GitHub App REST and npm boundaries, including
terminal pagination, immutable repository revisions, private and nonpackage profiles, named release
workflow evidence, npm provenance/integrity, delayed diamond publishers, duplicate and reordered
events, queue compare-and-swap contention, restart, stale approval, tampered Changeset, and the
active legacy-workflow exclusion.

The acceptance track also executes the pre-publish acknowledgement boundary: an incomplete epoch
retains its post-publish event without acknowledgement, a persisted request-bound ACK survives a
lost response and restart, and a replay with changed source evidence is rejected. Its durable
cutover test exercises the same Contents-backed fence for legacy reconcile and coordinator work,
including the irreversible rollback boundary after a coordinator mutation.

This is executable provider-contract coverage, not real-provider E2E evidence. A full provider run
remains blocked until a separately owned isolated GitHub App installation, selected private/nonpackage
test repositories, an isolated npm scope/registry, protected test branch, and non-production release
workflow are provisioned. That run must use only those targets and must record the issued App token's
selected-repository inventory, pagination trace, exact tag/release/workflow SHA, npm `gitHead` and
tarball integrity, required-review/check evidence, candidate PR/Changeset, and release acknowledgement.

The isolated epoch-plan fixture proves authenticated GitHub Contents create, read, and update
compare-and-swap behavior; immutable revision binding; append-only independent epochs; and rejection
of CAS races, overlapping cohorts, source downgrades, and source decisions not bound to selected
immutable Changesets input. Candidate verification uses a complete immutable patch Changeset
publication fixture so stale approval, altered Changeset, and npm-lag assertions reach their
intended security gates. It does not create a GitHub candidate, obtain protected-branch approval,
or publish to npm.
