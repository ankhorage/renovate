# @ankhorage/renovate

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
