---
name: package-deployment
description: Install, repair, uninstall or copy an exact repository package to explicit Windows targets.
---
# Package deployment

Use for Atlas Workspace/Bulk deploy style package actions through Axis.

1. Establish the requested action (`Install`, `Repair` or `Uninstall`) and explicit Windows PCs. Resolve people to eligible hostnames through Atlas when necessary. Never turn a team, desk or ambiguous user into an assumed bulk target list.
2. Call `find_packages` with the supplied package query and action. A unique match may already contain the scripts: reuse that result. Several versions or action scripts require the user's selection unless an existing local procedure makes it unambiguous. List order does not identify the newest version.
3. Use the exact returned package and action-specific script. Do not guess switches, synthesize an uninstall command or fall back to another version because a script is absent.
4. Use `deploy_package` with `computers`, `package`, `script` and `action`. Mode `full` copies and executes; `copy` only stages; `execute` uses an existing staged package. Choose a non-default mode only when it matches the request. At most 200 explicit PCs are accepted, processed in order.
5. Briefly state the change and let the tool present its approval. The worker does connectivity/access preflight and checks the approved script; do not duplicate those checks routinely. Axis holds a per-PC lock while it works. A blocked or unknown prior operation is not permission to bypass it.
6. A returned job ID means queued. Give the ID and `/jobs ID`, then return unless asked to wait or verify. For a requested wait, call `it_job_status` with `wait_seconds=10` and inspect every relevant target's final outcome.

A job finishes only after the script and the installers it started (and Windows Installer) finish. To verify an install, read `software_changes` first: added, removed or version-changed registrations.

Distinguish `copied`, `script_succeeded`, `reboot_required`, `failed` and `unknown`. Exit 0 proves script execution, not application health. Exit 3010/1641 requires a reboot, not an automatic one. Never automatically retry an unknown outcome; use the job-recovery workflow. Axis jobs are Axis's own records; they do not appear in Atlas's history or queue.
