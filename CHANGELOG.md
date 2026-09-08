# @ankhorage/renovate

## 0.2.11

### Patch Changes

- e3679ed: Delete validated same-repository Renovate branches after their pull requests merge so later dependency updates cannot remain blocked by retained edited heads.

## 0.2.10

### Patch Changes

- 3688ded: Allow the trusted Renovate automerge gate to run after a maintainer retries or updates a pull request.

## 0.2.9

### Patch Changes

- 1c0c770: Recognize the current PR-author trust condition when selecting rollout-ready repositories.

## 0.2.8

### Patch Changes

- a036e08: Allow the scoped Renovate merge token to merge validated workflow updates.

## 0.2.7

### Patch Changes

- 8e972a4: Use the caller-scoped GitHub token for read-only automerge checks while reserving the Renovate Sync App token for writes.

## 0.2.6

### Patch Changes

- bb563fa: Read automerge gate state through a repository-scoped App token so older consumer callers can invoke the current reusable workflow.

## 0.2.5

### Patch Changes

- 44a7c5f: Recognize the Renovate Sync GitHub App bot login when preparing and merging dependency updates.

## 0.2.4

### Patch Changes

- 100f4e9: Trust Renovate pull request authors when synchronizing updates, regardless of who triggers a rerun.

## 0.2.3

### Patch Changes

- 9e5f25a: Derive trusted Devtools-managed skill paths from their ownership manifest so new released skills do not block Renovate synchronization.

## 0.2.2

### Patch Changes

- 9850e21: Run immediate Devtools consumer rollouts on Node.js 24 as required by current Renovate.

## 0.2.1

### Patch Changes

- 9758db0: Synchronize the current Devtools release workflow and managed repository policy.

## 0.2.0

### Minor Changes

- 03f29fb: Merge explicitly eligible Renovate updates after the synchronized head passes CI without review findings.

## 0.1.12

### Patch Changes

- d3f138f: Trigger registered Devtools consumer updates immediately after each published release.

## 0.1.11

### Patch Changes

- 5111b74: Allow trusted consumer synchronization to use the exact Devtools release selected by Bun for a compatible declared package range.

## 0.1.10

### Patch Changes

- dc0c050: Keep the immutable consumer synchronization workflow pin current through a dedicated Renovate
  update before Devtools-managed skill synchronization runs.

## 0.1.9

### Patch Changes

- 70c6d2f: Authorize the exact Devtools-managed `zora-designer` skill tree only when its ownership manifest declares and hashes each synchronized file.

## 0.1.8

### Patch Changes

- df2d580: Automatically merge every green npm patch update while preserving synchronized Devtools ownership of the canonical development toolchain.

## 0.1.7

### Patch Changes

- 1721d24: Authorize the exact Devtools-managed `ankhorage-coding-rules` skill root in the trusted Renovate synchronization workflow while preserving the existing traversal and unexpected-path protections.

## 0.1.6

### Patch Changes

- 4deba0b: Commit trusted Renovate synchronization output through the repository-scoped Ankhorage Renovate
  Sync GitHub App so normal pull-request CI starts without manual workflow approval.

## 0.1.5

### Patch Changes

- ae2cde4: Authorize deterministic Renovate synchronization of the Devtools-managed root agent guide and canonical project-structure skill, including narrowly scoped stale skill-file deletions.

## 0.1.4

### Patch Changes

- a798ac9: Bootstrap consumers from the legacy Changeset-only workflow pin to the released automatic Devtools synchronization workflow.

## 0.1.3

### Patch Changes

- 7d4a510: Recreate split Ankhorage library and Devtools toolchain updates on distinct clean Renovate branches.

## 0.1.2

### Patch Changes

- aad51d0: Extend the trusted Renovate workflow with a Devtools-owner mode that runs only the fixed
  base-commit synchronization entrypoint in its read-only preparation job, proves byte stability and
  current status, and commits the validated owner-managed policy output through the existing Git API
  write boundary.

## 0.1.1

### Patch Changes

- 8f1fd6a: Restrict automated dependency updates to packages in the `@ankhorage` scope.
- c9ee948: Publish separate Renovate policies for normal consumers and the Devtools owner repository, and
  automatically synchronize consumer Renovate branches with their exact selected Ankh and Devtools
  releases through the least-privileged reusable workflow, using the workflow's exact canonical Ankh
  CLI pin when a Devtools-only consumer does not declare the CLI itself.

## 0.1.0

### Minor Changes

- b7305e8: Add safe automatic Changeset creation and green-CI automerge for Ankhorage dependency updates.
- f4526fd: Establish the standalone Renovate policy package and canonical Ankhorage preset.

### Patch Changes

- 38e46ee: Bump Ankhorage dependency ranges so every package release can propagate to downstream repositories.

## 0.0.0

Initial package foundation.
