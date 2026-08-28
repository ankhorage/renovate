---
'@ankhorage/renovate': patch
---

Extend the trusted Renovate workflow with a Devtools-owner mode that runs only the fixed
base-commit synchronization entrypoint in its read-only preparation job, proves byte stability and
current status, and commits the validated owner-managed policy output through the existing Git API
write boundary.
