---
name: job-recovery
description: Inspect deployment/reboot outcomes, logs and PC blocks before any retry or acknowledgement.
---
# Jobs, operation recovery and staging

Use for a queued deployment, reboot status, failed/unknown outcome, retry request or a PC blocked by prior work.

1. Use the supplied Axis job ID with `it_job_status`; if no ID is known, list jobs and select the relevant returned job. Acknowledge nothing during discovery. `/jobs ID` also reads status without model inference.
2. Read each relevant target's state, exit code, monitoring details and log. Use `read_tool_output` with a returned `output_id` and character offsets if essential sections were omitted. Poll with `wait_seconds=10` only when asked to wait.
3. Separate queued/running, copied, script success, reboot required, failure, unknown and verified reboot. Unknown can mean work continued after monitoring stopped, including installers still running when the deployment timeout ended (`installer_activity.still_running`). Never report success or start another attempt from an absent exit record.
4. For an unknown outcome, inspect the actual PC and relevant evidence. Explain what remains uncertain. Use `acknowledge_unknown=true` only after the operator explicitly confirms inspection and requests release, through the normal approval. It releases the reservation; it does not cancel, retry or prove the old action succeeded.
5. An active or unresolved Axis job blocks its PCs until resolved. Work started from Atlas is Atlas's to resolve, in its **Operation recovery**. Never delete jobs/locks, edit job files or use shell execution to bypass a block.
6. Retry only the explicitly requested, resolved action with the package-deployment workflow.

For requested staging cleanup, `computer_action` with `action=cleanup_packages` deletes only Axis's staging on the explicit PC and keeps job evidence. Do not substitute broad temp-folder deletion or prune active/unresolved jobs. Closing chat or stopping a local shell does not guarantee remote work stopped.
