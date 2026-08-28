---
'@ankhorage/renovate': patch
---

Publish separate Renovate policies for normal consumers and the Devtools owner repository, and
automatically synchronize consumer Renovate branches with their exact selected Ankh and Devtools
releases through the least-privileged reusable workflow, using the workflow's exact canonical Ankh
CLI pin when a Devtools-only consumer does not declare the CLI itself.
