# Shared Axis development

- Ship shared Axis improvements in both AOSPAndroid/Axis (`agent/`) and
  AOSPAndroid/AA (`axis/` plus its Admin adapters). Carry over relevant tests,
  model metadata, documentation and bundle changes together. Record the
  companion change or source commits.
- Preserve Axis's standalone engine and AA's Admin-backed engine/client. Adapt
  workflow guides to the actual engine; do not overwrite AA's integration with
  standalone files. AA-only map/inbox features can remain AA-specific.
- Keep the existing tool approvals, per-PC locks and outcome verification.
  Run tests with disposable files and simulated operations, never a live target.
- Keep model weights, credentials and runtime state out of Git. Preserve Python
  3.8 compatibility and the standard-library runtime.
- Publish the Windows bundle from main. Verify its source commit marker and
  runtime contents before reporting a download updated.
