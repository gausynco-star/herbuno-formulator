# Tools — build & validation scripts

Scripts that generate/validate the theme assets. Conventions:
- Matrix edits ADD only; every run enforces the parity guard (0 signed-off overrides).
- Always `node --check` generated JS.
- Dry-run harness must pass (both modes, all products, 0 errors) before handover/deploy.
