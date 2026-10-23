Moved to the dashboard on 261023: `~/dev/dashboard/apps/server/src/workflow/dispatch/jev.rs`.
The daemon no longer mounts a dispatch feature; the dashboard still asks Jev through
`POST /v1/decide` with feature `dispatch`, version `v1`, harness `dashboard`.
