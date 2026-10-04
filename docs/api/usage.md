# Using the free PrivaTools API

The hosted base URL is `https://api.privatools.me/api/v1`. Send an account-issued
key through `X-API-Key` or `Authorization: Bearer`. Use an environment variable
or the integration platform's credential store; do not put a key in a URL.

The public `/operations` catalog reports exact supported operations, request
schemas, response formats, current costs/limits, and async availability. The
public `/openapi.json` can be imported into OpenAPI-compatible tooling. These
documents exclude the website's internal, account, and unversioned routes.
Cross-origin browser requests are supported on v1 using explicit key headers
and `credentials: "omit"`; this does not open website account/session routes.
Keep an application's shared secret on its server. Browser interfaces should
use a key supplied by the person making the request.

## Synchronous processing

Existing calls still return their result directly. A PDF merge uses repeated
multipart `files` fields; other operations can require `file`, JSON, or
additional form fields. Consult the operation schema rather than assuming
every tool has the same upload shape.

```sh
curl --fail-with-body https://api.privatools.me/api/v1/merge \
  -H "X-API-Key: $PRIVATOOLS_API_KEY" \
  -F files=@first.pdf -F files=@second.pdf -o merged.pdf
```

In JavaScript, append files to `FormData` and let `fetch` set the multipart
boundary. In Python, use the repeated `files` tuples supported by `requests`.
The website's API reference includes both examples. For an HTTP Request node
in n8n or a similar platform, store the key in header credentials, select
multipart form data for upload operations, and select file/binary output for
PDF/image/archive responses. JSON operations require a JSON response setting.

## Limits and retries

- Daily defaults: 500 processing units and 262,144,000 request-body bytes per
  key, reset at 00:00 UTC. Body bytes include multipart overhead and fields.
- Most operations cost one unit; the reviewed heavy-operation list costs five.
  The catalog gives the exact cost. A pipeline costs the sum of its steps.
- Authenticated processing has a shared 30-per-minute token bucket, burst six,
  three admitted requests per key, and six total across web workers by default.
- Polling job status, downloading an existing result, checking identity/usage,
  and reading discovery documents do not spend processing units.
- Read `X-RateLimit-*`, `X-Quota-Bytes-*`, and `Retry-After`. Different limits
  have different recovery times; a daily quota does not recover after a short
  concurrency wait. The front proxy also limits per-IP traffic.
- `400`/`422` means correct the request. Authentication failures require a valid
  key. Admission `429`/`503` responses can be retried after their indicated delay.
  Use a small randomized backoff and a finite retry/deadline budget.
- A timed-out synchronous call might already have computed its result. A retry
  can run and charge again. Background submissions support explicit idempotency.
- Framework validation and explicit pre-processing rejections refund their
  reservation. A tool error after execution starts may still consume units.

Limits describe admitted HTTP requests. They do not promise native computation
ends when a connection is canceled. Work submitted to the bounded heavy pool
keeps its slot until the native future finishes. Queue worker children are
separate processes with termination and deadline handling.

## Optional background jobs

Check the catalog's `async.available` and supported operation names first.
Existing endpoints remain synchronous. Initial async operation IDs are
`merge`, `compress`, `grayscale`, and `pdf-to-text`.

```sh
curl --fail-with-body https://api.privatools.me/api/v1/jobs \
  -H "X-API-Key: $PRIVATOOLS_API_KEY" \
  -H "Idempotency-Key: invoice-merge-2026-09-14-001" \
  -F operation=merge \
  -F files=@first.pdf -F files=@second.pdf
```

On `202`, save the returned job ID and status URL. Poll at the indicated
interval until the job succeeds, fails, is canceled, or expires. A failed job's
`error.code` is `job_input_damaged` when an input PDF can't be read, and
`job_input_password_protected` when one needs a password; its `error.message`
says which. Correct the input: submitting it unchanged fails the same way.
Other codes, such as `job_processing_failed`, are the job's own failure.
Retrieve the result with the same key. A result can be downloaded repeatedly
until one hour after completion. `DELETE /jobs/{job_id}` removes a completed
result or requests cancellation; deletion of a running job completes after its
child is stopped.

Reuse an `Idempotency-Key` only for the same logical request, operation/options,
and ordered file contents. Concurrent/retried identical submissions reuse the
job and processing charge. Conflicting content returns `409`. Retry records
are eligible for cleanup 24 hours after the job finishes; do not intentionally reuse keys for
new work or assume deduplication lasts forever. Status and downloads require
the submitting key; possession of a job ID is not sufficient authorization.

Initial background limits are 50 MiB total input, 100 MiB result, three
outstanding jobs per key and six per account. The worker runs one job at a time,
with a 24-job outstanding ceiling (uploading, queued, and running) and a 1 GiB aggregate storage reservation budget.
Storage reservations can fill before the job-count ceiling. Jobs have a
15-minute queue deadline, five-minute execution deadline per attempt, and at
most two attempts for interrupted processing. The catalog distinguishes these
limits from synchronous request admission.

## Playground, starter projects, and account activity

The website's API page offers sample merge, compression, and text-extraction
requests. These use normal API allowance and synthetic sample PDFs. The key
stays in the page's memory and is cleared when you leave or clear the form.
The displayed usage change compares two observations and may include other
requests using the same key; it is not an isolated invoice for the sample.

Download the complete [starter bundle](https://privatools.me/api-starters/privatools-api-starters.zip)
or see [the starter guide](starters.md) for Python, JavaScript, n8n, and
Postman. Starter clients demonstrate idempotent job submission and recovery
after a failed connection or failed local save.

Signed-in accounts can view current allowance and request history without
pasting a key. `GET /api/account/api-activity` uses an account session, not an
API key. An optional `key_id` filter must belong to that account. Seven UTC
dates of aggregate HTTP counts are separate from the capped recent history
(1,000 per key, 100,000 globally, latest 50 displayed). History is best effort
and starts with this feature; past calls cannot be reconstructed. A 202
records an accepted background submission, not its eventual result. Polling,
downloads, deletion, identity and usage checks are excluded.

History retains only canonical operation/key/request identifiers, method,
HTTP status, a fixed error category, elapsed request time, and timestamp.
Document contents, filenames, query strings, credentials, and raw error
messages are excluded. v1 request IDs are generated by the server, so client
text cannot enter durable history through `X-Request-ID`. Account deletion
removes its activity; operational backups follow their separate rotation.

## Running jobs on a server

Jobs are enabled on the hosted API: on 18 September 2026 its catalog reported
`async.enabled: true` and `/readyz` reported a live job worker. A self-hosted
server keeps them off until it sets `API_V1_JOBS_ENABLED=true`.

`API_V1_JOBS_ENABLED` defaults to false. With it disabled, the container
executes the existing two-worker Uvicorn server. With it enabled, the launcher
starts one job supervisor beside Uvicorn inside the same 4 GB / 1.8 CPU cgroup.
No second server, queue service, or database service is required.

Job artifacts live under `/app/data/jobs`, outside the website's ten-minute
temporary-file sweep. Inputs and queue acceptance are durable before a 202 is
returned. The job supervisor and web maintenance remove expired artifacts.
Readiness requires a fresh worker heartbeat matching the application build
when jobs are enabled. A failed child service stops the other service so
Docker can restart the complete application consistently. The stop grace is
45 seconds, covering the bounded worker stop and web request drain.

Before enabling jobs on another server, run the job, cancellation, restart,
expiry and readiness tests there, and verify its signed-image rollout and
rollback. Measure workload latency and memory on that host before publishing
higher throughput guarantees. Local fixture measurements validate behavior but
are not capacity measurements for a real host.
