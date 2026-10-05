# PrivaTools release preparation

**Prepared for review on September 14, 2026. Nothing in this runbook has been deployed.** The current workspace contains uncommitted implementation work. No release commit, tag or image digest has been selected or pushed. These commands describe a future approved release; reading this document is not authorization to execute the publication steps.

## Destination established from repository evidence

| Item | Source configuration | Verification limit |
| --- | --- | --- |
| Repository | `https://github.com/ethereaglehq/privatools.git` | Local `git remote` matches. No remote settings changed. |
| Application origin | `https://privatools.me`; `www` redirects to apex | Oracle nginx source. Current installed config was not read. |
| Optional direct API origin | `https://api.privatools.me` | Enabled only with `PUBLIC_API_BASE_URL`; preserve the operator's existing choice. |
| Host | Oracle VM `140.245.15.140`, user `ubuntu` | Address documented in existing deployment files, not a new provisioning target or a live host inspection. |
| Checkout / service | `/home/ubuntu/privatools`, Docker Compose service `privatools` | `deploy/oracle-vm/privatools-auto-deploy.service`, root Compose. |
| Artifact | `ghcr.io/ethereaglehq/privatools`, Linux arm64 | `.github/workflows/release.yml`; signed by this repository's release workflow. |
| Ingress | Host nginx → upstream `privatools_app` → `127.0.0.1:8000` → FastAPI + built SPA | Compose binds only loopback. TLS is managed outside the container. During a deploy the upstream briefly names `127.0.0.1:8001` ([zero-downtime deploys](#zero-downtime-deploys)). |
| Durable state | Docker `app-data` volume at `/app/data` | Local identity mirror, legacy accounts and API-key records persist here. It requires backups. |
| Temporary processing | `app-temp` at `/app/temp`; small `/tmp` tmpfs | User uploads/results are temporary, not account backups. |

`deploy/deploy.sh`, `deploy/nginx.conf` and `deploy/privatool-backend.service` describe an older `/opt/privatool` systemd arrangement. **Do not install those files over the Oracle Docker deployment.** The previous README mixed these layouts, included `.com` certificate instructions, and incorrectly described the app as stateless. The Oracle files above are the release path being prepared.

## What this preparation fixes

- The release's reusable test workflow now checks the actual app TypeScript project, zero-warning lint, generated-content tests and component tests. The duplicate unlocked Python 3.11 and nonblocking/uninstalled Playwright jobs were removed from `ci.yml`; they were not reliable evidence. Existing isolated browser audit reports remain separate from CI.
- Docker excludes local environments, databases, backups and audit evidence from its build context. The image build asserts FFmpeg subtitle-filter, H.264 and AAC support, alongside existing native dependencies. The frontend build verifies U²-Net-P by SHA-256 and stages it with the CPU ONNX Runtime WASM/bootstrap on the same origin; the backend cache links to the same weights instead of downloading a second copy. Base digests and Python hashes stay pinned; package repositories/model-download availability still affect whether a new build succeeds.
- The deploy timer defaults to release tags only. A missing cosign binary, bad signature or absent digest prevents deployment. Verification and execution use the same immutable digest, and the image revision must match the selected tag's commit. An explicit legacy `DEPLOY_MODE=auto` or `branch` remains an operator override, not the default.
- Rollback retains the previous immutable image ID and its build SHA (`.privatools-deploy.previous` in the checkout). Nothing prunes images; since 5 October the rollout's [image retention](#image-retention) removes old PrivaTools release images by name and always keeps that one. Since 18 September a release that fails never replaces the running one, so no automatic rollback is needed; `privatools-rollout --rollback` restores the recorded release with the **current** Compose configuration and existing database. It does not undo configuration/schema changes. Those require the manual procedure below.
- Manual and automated release health gates use `/readyz`, not the liveness-only `/api/health`, plus a real-page probe before any traffic moves.
- Oracle nginx restores visitor addresses only from the 22 verified Cloudflare networks. Country decisions still use the original socket peer and only the sanitized policy endpoint header; the direct API host remains unknown. See [country trust boundary](analytics-country-proxy.md).
- nginx's own error answers on the API host (413, 502, 503, 504) carry CORS headers for the allowed origins and a JSON detail. The page now reads nginx's 413 and 504 instead of reporting a network failure. While the app is down, nginx refuses an upload's CORS preflight with the 502, so an upload still fails as a network error unless the browser holds a cached preflight; a 503 that refuses the preflight does the same. The deploy never changes nginx: apply it by hand with [its runbook](api-subdomain-split.md#nginxs-own-error-answers-on-the-api-host-added-24-september-2026).

## Zero-downtime deploys

Added 18 September 2026. Until then `auto-deploy.sh` replaced the running container with `docker compose up` and only afterwards waited for `/readyz`. A release that failed to start took the site offline until the rollback finished, and even a good release left a gap while the new container booted. The manual `deploy.sh` never rolled back at all.

Now `privatools-rollout` ([`oracle-vm/rollout.sh`](oracle-vm/rollout.sh)) replaces the release and nothing ever stops before its successor serves. `auto-deploy.sh` still chooses the release and verifies the tag, cosign signature, digest and revision, then hands the verified digest to the rollout. It runs as the deploy user, never as root (below).

0. **Reconcile.** Every switch is recorded (`.privatools-deploy.switching`) before the root helper runs and cleared once nginx is seen to have reloaded. If a run finds a switch still recorded, a killed run may have left the file renamed but not reloaded, so it re-applies the file's port. Otherwise it leaves the shared nginx alone: nothing reloads it for nothing, even while the rollout backs off in the degraded state. A port counts as down only after failing `/readyz` for 30 s, since one failure can be a busy uvicorn's 503. Even then, traffic falls back only to a canonical container that passes the page probe again. It never falls back to an interim the file does not name, because that interim may never have passed the gates: a run killed in phase 1 leaves one behind. Any interim a previous run left behind is then drained and removed.
1. **Candidate.** Start the new image as a second compose project, `privatools-interim`, on `127.0.0.1:8001`, with the same compose file and the live container's two volumes ([`compose.interim.yml`](oracle-vm/compose.interim.yml)). Wait up to 180 s for `/readyz` to report the new build; a crash loop is caught early. Then run the real-page probe, `scripts/ci/probe-image.py --running`. It runs the page checks CI also runs on a freshly booted image: readiness, a real 404, the homepage's advertised tool count, two server-rendered tool pages and the sitemap. It leaves out CI's conversion of a Word equation, which a release from before LibreOffice's Math module would fail. It asks for `Host: privatools.me`, as nginx does. A release whose `TRUSTED_HOSTS` rejects the public name therefore fails here (exit 1), not at the check through nginx after the switch.
2. **Queue handover, before any traffic moves.** The old container's job supervisor finishes its current job and releases the lock (SIGUSR1). The candidate's supervisor must take the lock and keep it for 5 s without its container restarting. If it cannot, the candidate is removed, the old supervisor resumes (SIGUSR2) and the release is rejected (exit 1). If the old supervisor's job does not finish within 360 s, the attempt is undone and retried later (exit 2). A failed Docker call proves nothing. A status poll or `docker inspect` that fails is asked again until the deadline. A supervisor fails only on an answer: its container restarted or stopped, or it reported that it did not hold the queue. If Docker never answers, that is a host problem (exit 2).
3. **Switch.** Point host nginx at 8001 through the root helper. The helper checks that 8001 is ready, runs `nginx -t` and reloads gracefully. The rollout then checks two things: that nginx's previous worker generation is retiring, which proves the reload happened, and that `https://privatools.me/readyz` through nginx reports the new build. If either fails, it switches back, returns the queue and removes the candidate (exit 2).
4. **Drain.** Keep the old container until no request has been open on it for 3 s. Also wait until the nginx worker generation that this deploy's reload retired has exited, capped at 300 s. That includes the generation a killed run's switch retired, which its record lists. Other sites' reloads are not waited for: their workers never reach PrivaTools. The wait matters because nginx buffers a request body before it connects upstream, so an upload that began before the switch still reaches the old container afterwards. A container that still receives requests after that generation has exited means nginx still routes to it. It is kept, and the rollout stops with exit 4. Rarely the requests instead come from a generation retired just before the switch that is still finishing a long upload. That false alarm loses nothing, and the next run drains the container cleanly (runbook step 7).
5. **Steady state.** Check again that the new supervisor holds the queue and its container never restarted. If that fails, return traffic to the old container, which is still running. Record the replaced release for `--rollback`, then recreate `privatools-privatools-1` on 8000 with the new image; Compose stops the drained old container. Gate it on readiness and the page probe, hand the queue from the interim to it, switch nginx back to 8000, drain the interim like step 4 and remove it.

The exit status tells the timer what to do:

| Exit | Meaning | The timer |
| --- | --- | --- |
| 0 | The new release serves from the canonical container | Records it as deployed |
| 1 | The release is at fault: not ready, broken pages, or its job supervisor cannot hold the queue. The previous release serves | Marks the tag failed until a newer one |
| 2 | Nothing started, or a host problem undid the attempt: nginx, Docker, memory, port 8001, or a job that would not finish. The previous release serves | Retries after a 10-minute backoff |
| 3 | Degraded: the new release serves from the interim container. Either the canonical one did not come up (retried once), or in the cut-over deploy the new supervisor has not confirmed the queue while its container serves | Pings failure; retries after a 10-minute backoff |
| 4 | nginx could not be brought to a verified state, or a container that still receives requests was kept | Pings failure; act now; the next attempt waits 10 minutes |

A run interrupted at any point is reconciled by the next one. An interim that the upstream file names is moved back to 8000; one it does not name is drained and removed, never given traffic. The rollout never falls back to a stop-and-start deploy.

### Image retention

Added 5 October 2026. Each deploy pulls a release image of about 3.4 GB, and until then nothing removed one: the production VM's disk reached 99 % with 50 of them. Now, once a run ends with the release serving from the canonical container (exit 0, also after `--rollback` and in a run that finds its release already serving), the rollout removes old PrivaTools release images. It never runs after exits 1 to 4.

- **Kept:**
  - the newest `KEEP_IMAGES` images by creation time (`Created` from `docker image inspect`), 3 by default;
  - the image of every container on the host, running or stopped, in any project;
  - the release recorded for `--rollback` (`.privatools-deploy.previous`), by image ID, so a moved tag cannot cost it and it stays when it is older than the newest.
- **Candidates:** only images named in PrivaTools' own repositories (`IMAGE_REPOS` in `rollout.sh`). These are `DEPLOY_IMAGE_REPO` (`ghcr.io/ethereaglehq/privatools`), `DEPLOY_IMAGE_REPO_FALLBACK` when set (auto-deploy passes both), the repository of the image the run deploys, so a run by hand needs neither, and `privatools-privatools`, a local build's name. An image also named in any other repository is kept. Other projects' images, local test builds such as `privatools-py312:test`, the build cache and volumes are never touched.
- **How:** by name and never forced: each `repo:tag`, or `repo@digest` for a repository where the image has no tag. Docker itself then refuses the last name of an image a container uses, running or stopped. Nothing is pruned: a prune would delete the rollback image once its tag had moved, and other projects' images.
- **Best effort:** it reads everything before it removes anything. If Docker cannot list the images or the containers, or resolve the rollback record, it logs why and keeps every image. A removal Docker refuses is logged and the others go ahead. Nothing in it changes the exit status.
- **Log:** a line per image with its size and why it stays, then a summary such as `image retention: kept 3, removed 1 (3.4 GB as listed; layers a kept image shares stay on disk)`.
- **`KEEP_IMAGES`:** 3 by default. A value below 2, or one that is not a number, skips retention with a log line, so `KEEP_IMAGES=0` turns it off. For the timer, set it in a drop-in, which a reinstall keeps: `sudo systemctl edit privatools-auto-deploy.service`, then `[Service]` and `Environment=KEEP_IMAGES=4`. auto-deploy passes its environment on to the rollout. By hand: `sudo runuser -u ubuntu -g ubuntu -G docker -- env KEEP_IMAGES=4 privatools-rollout ...`.
- **Disk:** auto-deploy pulls the next release before the rollout runs, so the disk needs room for `KEEP_IMAGES` + 1 release images, about 13.6 GB by default. Add the rollback image when it is older than those, and any image a stopped container keeps.
- **Limit:** a local build (`deploy.sh`) that lost its name to a newer build has no name left to remove it by, so it stays. Remove it by hand once no container uses it and it is not the rollback record.

**It takes effect only after a reinstall.** The timer runs the installed copies in `/usr/local/bin`, and a deploy never reinstalls them. Once a release that contains image retention has deployed, the checkout is at its tag; reinstall from there:

```bash
sudo systemctl stop privatools-auto-deploy.timer
systemctl is-active privatools-auto-deploy.service     # inactive: no deploy is running
cd /home/ubuntu/privatools
grep -c retain_images deploy/oracle-vm/rollout.sh      # not 0: this checkout has image retention
sudo bash deploy/oracle-vm/install-auto-deploy.sh      # no --start: installs and validates only
cmp deploy/oracle-vm/rollout.sh /usr/local/bin/privatools-rollout && echo "rollout installed"
cmp deploy/oracle-vm/auto-deploy.sh /usr/local/bin/privatools-auto-deploy && echo "auto-deploy installed"
```

The reinstall also rewrites the unit files from the checkout: settings in a drop-in survive it, edits to the installed unit do not. Then start the timer again. To see retention before the next release, first run the rollout on the release that already serves (the three optional lines below). In the steady state it touches neither nginx nor the containers: it logs `already serves`, then the retention lines.

```bash
image=$(sudo docker inspect -f '{{.Image}}' privatools-privatools-1)                                         # optional
sha=$(curl -fsS http://127.0.0.1:8000/readyz | python3 -c 'import json, sys; print(json.load(sys.stdin)["build_sha"])')  # optional
sudo runuser -u ubuntu -g ubuntu -G docker -- privatools-rollout "$image" "$sha"   # optional; with three releases: "kept 3, removed 0"
sudo systemctl start privatools-auto-deploy.timer
```

### Why it is built this way

**The steady state does not change.** The installed backup script (`CONTAINER=privatools-privatools-1`), the rollback commands, the CI image probe, the unit's `HEALTH_URL` and every operator habit address the canonical container on 127.0.0.1:8000. Blue/green slots that alternate would move the live container between names and ports on every deploy. The first deploy that landed on the other slot would silently break the untouched backup timer. Passing traffic through a temporary interim costs a second boot of the new image (about 10 s here) and a second nginx reload, and keeps every one of those contracts.

The backup timer is still never touched. The backup *script* ([`backup-app-data.sh`](oracle-vm/backup-app-data.sh)) gains two things, installed by the runbook. It takes the deploy lock, waiting up to 8 minutes, so the 03:17 backup does not race a container replacement; a deploy still running after that is backed up from whichever container runs, and a failure pings as usual. And while a deploy has left the new release on the interim container (exit 3), it backs up from that container instead of failing; both mount the same accounts volume.

**Shared state during the overlap.** Both containers mount the same `app-data` and `app-temp` volumes for about a minute.

- *Accounts, API keys, quotas, admission leases and the job queue* are one SQLite database in WAL mode (`backend/app/store.py`). Two containers on one host share the kernel, the file's inode, its POSIX locks and its `-shm` mapping. SQLite's multi-process rules therefore hold exactly as they already do between the two uvicorn workers and the job supervisor inside one container. That would not be true on a network filesystem, which this is not.
- *Migrations* run in `store.init()` when the new container starts, while the old one still serves. The old code must work on the new schema, as it already must for any rollback. The rule:
  - Keep migrations additive.
  - Keep them quick: they run in one `BEGIN IMMEDIATE` against a database the live release is writing, so a long one blocks its writes (each waits up to 10 s, then fails).
  - Never add a column to a table written with a positional `INSERT ... VALUES`: `api_async_worker`, `api_async_ingest`, `api_async_submit_window`, `api_v1_leases`, `api_v1_rate_buckets`. Nothing unpacks a `SELECT *` by position.

  One gap remains: `main.py` only logs a failed `store.init()` ("accounts disabled"). Neither `/readyz` nor the page probe checks the store, so a release whose migration fails would pass both gates with accounts and the API down.
- *Temporary files* are safe to share. The janitor deletes only files older than ten minutes and nothing wipes `app-temp` at startup, so a second container is no different from a second worker.
- *Per-process state* doesn't need a handover. The website's per-IP limits are in memory per worker, so a client can briefly get a second allowance during the overlap. API admission leases identify their owner by PID and start time. A container cannot see the other's PIDs, so it treats their leases as dead only once expired, and a live request renews its lease. That is what already happens after every restart.
- *Async jobs, which production runs* (its public `/readyz` lists `api_job_worker`). The supervisor's singleton is an `flock` on `app-data/jobs/worker.lock`, which is shared across containers because it is the same inode on one kernel. Before this change, a second container's supervisor gave up after 30 s and exited, and the launcher then stopped that whole container. Its `/readyz` also failed, because the heartbeat row named the old build. A naive overlap could never pass the gate.
  - **Standby and drain.** A supervisor that finds the lock taken now waits as a standby. `docker kill --signal SIGUSR1` (relayed by the launcher, PID 1) drains it: it finishes the job it is running, stops claiming and releases the lock. It then waits as a passive standby that retakes the lock only if nobody heartbeats for 30 s, so a failed handover heals itself; SIGUSR2 makes it eager again.
  - **The handover happens before the switch.** The new supervisor must take the lock, and keep it for a soak period without its container restarting, while the old container still serves every request. The launcher stops the whole container when a child exits. So a release whose supervisor crashes on taking the queue is rejected there, instead of taking its web server down after the switch. Only the lock holder claims, so no job is interrupted and none runs twice. Jobs accepted by the old web during the handover are processed by the new supervisor, since the queue is durable.
  - **Signals are safe.** The launcher starts its children with SIGUSR1 and SIGUSR2 ignored, until the worker installs its handlers; their default action would kill it. The rollout sends SIGUSR1 only to a supervisor that reports itself alive and holding the queue, and SIGUSR2 only to a live one that reports itself passive or still draining.
  - **A standby counts as ready, for a bounded time.** Readiness and job admission count this container's own live standby of the same build, through the state file `backend/app/job_handover.py` reads from its private `/tmp`; the shared heartbeat names the old build until the handover. While another supervisor visibly serves the queue, a standby stays ready however long it waits. Serving means a fresh heartbeat that still accepts work, from any build, so every job this container accepts will run. The first deploy after the cut-over depends on this: a long drain and then the wait for v2.6.1 to go idle can keep the new container a standby for more than 15 minutes while it serves. With nobody serving, a standby counts for at most `queue_seconds` (900 s), the time after which a queued job fails anyway. Past that, `/readyz` turns 503 and submissions get `jobs_unavailable`, which is loud (monitor.yml probes `/readyz` every 30 minutes) while pages keep serving. The alternative, failing loudly by exiting, was rejected. The launcher stops the whole container when its supervisor exits, so a routing anomaly between two containers would become a site outage or a crash-looping live container.
- *The one exception is the first deploy after the cut-over.* Its old container runs v2.6.x, whose supervisor cannot drain, so the new supervisor can only take the queue after the switch. The rollout stops the old container as soon as nothing is queued or running, waiting up to 60 s for that, otherwise as soon as nothing is running. A job claimed in the instant before SIGTERM is interrupted and retried once, never lost. The rollout then confirms the new supervisor holds the queue before it destroys the old container.
  - If the new supervisor crashes there, its container restarts, and its web server with it. The rollout then restarts the old container, waits for it to be ready and switches back (exit 1). That double fault costs about as long as the old container's boot of 502s.
  - If the new supervisor merely does not confirm the queue, the container nginx routes to is healthy. That covers a supervisor that never takes the lock, or Docker failing to answer. Stopping it would cause exactly that outage, so the rollout leaves it serving and records the stopped old release for `--rollback`. It exits degraded (3), and the next run tries the queue again. A single failed status poll is asked again, not taken for a failure.
  - If the old container will not stop, the switch is undone (exit 2): its supervisor would keep the lock from the new one.
  - CI makes it unlikely: the `test.yml` image probe now boots every image with async jobs enabled, as production runs, and requires its supervisor to take the queue.

**Resources.** Compose caps each container at 4 GB, 1.8 CPUs and 512 PIDs. During the overlap the caps add up to more than a 2-core, 12 GB VM shared with other projects can promise, but the caps are not usage.

- **Memory.** A ready instance serving the load test used 305–370 MiB on the dev VM, and the two containers together peaked at 745 MiB during an overlap, with async jobs running. The overlap lasts about a minute, and the old container takes no new work after the switch, so the combined load is the old one's in-flight tail plus new requests. A burst of heavy conversions during a deploy could raise that, so the rollout refuses rather than overcommits: it needs `MIN_AVAILABLE_MB` (default 1536). Memory is checked before the first overlap, and before a run resumed from the degraded state starts the canonical container beside the interim. The second overlap of a deploy is never larger: Compose stops the drained old container before it starts the new canonical one, so that overlap is the interim plus one new container again.
- **The deploy's own polling.** The job handover is polled through `python -m backend.app.job_handover --status`, which is standard library only: about 0.06 CPU-s and 12 MB per call. The app's job package imports FastAPI, pydantic and the auth stack, about 0.9 CPU-s and 103 MB. Polled once a second for up to 6 minutes, the old way would have cost a busy VM real CPU and memory.
- **CPU.** It is shared while the new container boots, about 10 s. In the test, p99 latency rose from 68 ms before the rollouts to 125 ms during them.

Production's current free memory was not verified for this change (no host access from where it was built), so the runbook checks it first.

**The nginx switch.** One upstream, `privatools_app`, is defined in `/etc/nginx/privatools-upstream.conf`, and the site includes it and proxies every location to it. The upstream has a single server and no keepalive, exactly like the `proxy_pass http://127.0.0.1:8000` it replaces: nginx never marks a lone server down, and each request has its own upstream connection, which is what draining counts. A backup server would be worse. After one slow request timed out, nginx would send all traffic to an empty port for `fail_timeout`.

The root helper [`nginx-upstream.sh`](oracle-vm/nginx-upstream.sh) (installed as `/usr/local/sbin/privatools-nginx-upstream`) makes each switch in this order:

1. It serializes concurrent calls.
2. It refuses a port where nothing answers `/readyz` as ready, so a stray `set 8001` cannot become an outage. Root can add `--force`; the sudoers rule cannot.
3. It writes the file beside the old one and renames it over it.
4. It runs `nginx -t` on the whole configuration, then `systemctl reload nginx`.
5. On any failure it puts the previous file back, so the file always matches what nginx runs.

From the rename to the reload or restore, it ignores SIGTERM, SIGINT and SIGHUP, so `systemctl stop` or the unit's start timeout cannot interrupt it there. Its children, `nginx -t` and the reload, inherit that. The load test's SIGTERM, sent to every process of a deploy inside that window, left a completed switch: the reload came three seconds later. If a child is killed anyway, the helper counts it as a failure and restores the old file. SIGKILL cannot be ignored at all. Two further safeguards cover what is left. The rollout records each switch before calling the helper and clears the record only once nginx has visibly reloaded, so the next run re-applies any switch that did not finish. And every switch is proven by the retirement of nginx's previous worker generation.

**Privileges.** The deploy service stays `User=ubuntu` with the docker group. Its only root step is `sudo -n /usr/local/sbin/privatools-nginx-upstream set 8000|8001`, allowed by [`/etc/sudoers.d/privatools-deploy`](oracle-vm/privatools-deploy.sudoers) for exactly those two argument lists. The helper validates the port, ignores its environment as root and writes one fixed file. The drain and resume signals and the containers go through the docker group like every other deploy action. The unit must not set `NoNewPrivileges`, or sudo stops working and every deploy refuses at the switch while the previous release keeps serving.

The sudoers rule narrows what the deploy *scripts* do as root, which limits the damage a bug can do. It is not a boundary against the deploy user itself: membership of the docker group is equivalent to root on the host.

**Run as the deploy user, never root.** `rollout.sh`, `auto-deploy.sh` and `deploy.sh` refuse to run as root. The deploy lock `/tmp/privatools-auto-deploy.lock` belongs to ubuntu in sticky `/tmp`. With `fs.protected_regular=2`, Ubuntu's default, root's open of that file fails, so a root rollback would die before doing anything. And a root run before the file exists would create one the timer can no longer open, blocking every later deploy. By hand, run the rollout as the service does:

```bash
sudo runuser -u ubuntu -g ubuntu -G docker -- privatools-rollout --rollback
```

This works whether or not ubuntu's login session is in the docker group.

**Stable interfaces.** The installed `privatools-rollout` changes only when someone reinstalls it, but it reads these from the checkout of whichever release it deploys. Change them only compatibly, or reinstall the rollout in the same release:
- `scripts/ci/probe-image.py --running CONTAINER --url BASE_URL --sha BUILD_SHA`: exit 0 means real pages serve. The rollout sets `PRIVATOOLS_PROBE_HOST=privatools.me` for it. It is an environment variable, so an older probe ignores it and asks for `127.0.0.1` as before.
- `deploy/oracle-vm/compose.interim.yml`, which takes `PRIVATOOLS_DATA_VOLUME` and `PRIVATOOLS_TEMP_VOLUME`, and `docker-compose.yml`'s `PRIVATOOLS_HOST_PORT`.
- `python -m backend.app.job_handover --status` in the container: the JSON keys `enabled`, `local.role` (`active`, `draining` or `standby`), `local.passive`, `local.alive`, `local.ready`, `running_jobs` and `queued_jobs`. A release without it is treated as predating the handover.
- The signals, sent to the container: SIGUSR1 drains its job supervisor and SIGUSR2 resumes it. `/readyz`'s `status` and `build_sha` complete the list.

**Cut-over.** The timer runs the installed copies in `/usr/local/bin`, not the checkout, and a deploy resets the checkout but never reinstalls them. It does use the checkout's `docker-compose.yml` at the target tag. The compose change is therefore backward compatible: the host port defaults to 8000 and the service is unchanged, so the old installed script deploys a release that contains this change exactly as before, gap included. The new scripts refuse to run (exit 2) until the nginx site routes through the upstream, so installing in the wrong order changes nothing. The runbook below installs from the release's own files, then runs the first zero-downtime deploy by hand.

### Load test on the dev VM

Rerun on 18 September 2026 after the second review, on the shared 2-core ARM dev VM (not production), with other projects' containers running. Every row uses the final scripts in this change: the rollout's checksum was the same before and after the run. The scenarios ran back to back from fresh volumes, each starting from the state the previous one left.

**Setup.** The image was built once from this branch. Each "release" is a throwaway image `FROM` that build:

- A good release changes only a label.
- The release that never becomes ready appends `raise RuntimeError(...)` to `main.py`. Uvicorn keeps respawning its workers, so it never answers and never exits.
- The release that is ready but broken deletes `frontend/dist/index.html`, so `/readyz` passes while `/` and tool pages return 404.
- The release whose supervisor crashes raises in the supervisor's loop as soon as it holds the queue's lock. Its web app is sound, so it passes readiness and the page probe. The launcher then stops its container, and Docker restarts it.
- The pre-handover release copies main's four job, launcher and storage files back in and removes the status module. That is what v2.6.1 runs.

The canonical and interim projects ran from this checkout's `docker-compose.yml` on 127.0.0.1:8016 and 8017, because another application owns 8000 on that VM. The nginx stand-in was `nginx:alpine` in a host-network container on 127.0.0.1:8015, with production's proxying: the included upstream file, `Host $host`, and the `/api/` limits and timeouts. The switch ran the real `nginx-upstream.sh` through its unprivileged testing hook, with `nginx -t` and the reload executed in that container. The rollout verified each reload against that container's nginx master. The page probe asked for `Host: privatools.me`, which the compose file's `TRUSTED_HOSTS` accepts. Async jobs were enabled as in production. `READY_TIMEOUT` was 120 s (production default 180 s).

**Faults injected.**
- **(f)** The helper's `nginx -t` rejects any configuration naming the interim port, as a broken site elsewhere on a shared nginx would.
- **(h)** The helper's `nginx -t` takes 3 s longer on the switch to the interim. As soon as the helper is inside its rename-to-reload window, SIGTERM goes to every process of the deploy: its process group, as `systemctl stop` signals the unit's cgroup. The rollout then runs again.
- **(g)** SIGKILL to the rollout as soon as it logs `phase 1 done`, then the rollout runs again 15 s later.
- **(j)** A leftover interim that never passed the gates, as a run killed in phase 1 leaves one: the broken-pages release, ready on 8017, with its home page returning 404. The first readiness probe of the live port also fails once, through a `curl` wrapper on the rollout's `PATH`, as a busy uvicorn's 503 would. Then a normal rollout runs.
- **(k)** The first deploy after the cut-over, with a `docker` wrapper on the rollout's `PATH`. After the old container is stopped, the first status poll that shows the new supervisor holding the queue starts the soak; the next poll fails once, as a busy Docker daemon's can.

**Load and pass criteria.** Through nginx, `GET /` and `GET /readyz` each every 100 ms, a fresh connection per request. A request failed on any transport error or timeout, a non-200 status, a page without `<div id="root">`, or a `/readyz` that was not `ready`. At the same time an API client kept two async `compress` jobs outstanding through nginx. It recorded each job's final state and attempt count, then deleted the result, so retained results never filled the job-storage budget.

| Scenario | Rollout | Page + `/readyz` requests | Failed | Jobs: first attempt / accepted |
| --- | --- | --- | --- | --- |
| (a) Good release (image changes) | exit 0, 62 s | 1448 | **0** | 35 / 35 |
| (b) Release that never becomes ready | exit 1 after the readiness deadline, 130 s | 2818 | **0** | 55 / 55 |
| (c) Ready release that fails the page probe | exit 1, 23 s | 668 | **0** | 14 / 14 |
| (i) Ready release whose job supervisor crashes on taking the lock | exit 1 before any switch, 18 s | 582 | **0** | 13 / 13 |
| (e) `privatools-rollout --rollback` | exit 0, 43 s | 1076 | **0** | 31 / 31 |
| (f) nginx rejects the switch (`nginx -t` fails) | exit 2, undone, 24 s | 688 | **0** | 19 / 19 |
| (h) SIGTERM to the whole deploy inside the helper's rename-to-reload window, then rerun | killed (143); rerun exit 0, 32 s | 1518 | **0** | 41 / 41 |
| (g) Rollout SIGKILLed right after its switch, then rerun | rerun exit 0, 35 s | 1638 | **0** | 44 / 44 |
| (j) Leftover interim that never passed the gates, plus one failed probe of the live port | exit 0, 53 s; the leftover never took traffic | 1419 | **0** | 37 / 37 |
| (d) First deploy after the cut-over (old container runs the pre-handover supervisor) | exit 0, 105 s | 2308 | **0** | 60 / 61; the other succeeded on its retry |
| (k) The same, with one failed status poll inside the soak | exit 0, 110 s | 2414 | **0** | 61 / 62; the other succeeded on its retry |

- **Build SHA.** In every run, `/readyz` through nginx reported the old build until the switch and the new one after it, and changed exactly once. The rejected releases and the leftover of (j) never appeared.
- **nginx reloads.** The rejected releases (b, c, i) never touched nginx, and a good deploy reloaded it exactly twice: to the interim and back. Only the rerun of (h) re-applied the upstream, because the killed run's switch was still recorded. The reload came three seconds after the SIGTERM, since the helper ignored the signal and finished; the load generator saw the new build from then on, and no staged file was left.
- **(i).** The candidate's supervisor took the lock and raised, and the launcher stopped its container. The rollout saw that within 4 s of the handover. It removed the candidate, resumed the old supervisor, and exited 1 while the old release kept serving.
- **(j).** The failed probe was asked again a second later and passed. The leftover was drained and removed without traffic, and the new release went through every gate.
- **(k).** The failed poll was asked again, and the soak completed 5 s after the old container stopped. Without the fix, that poll would have stopped the interim nginx routed to and restarted the old release.
- **(d) and (k).** The v2.6.1-style supervisor could not drain. Under a saturated job stream the queue was never empty, so the rollout used its full 60 s idle wait, then stopped the old container once nothing was running. In each run one job claimed in that instant was interrupted, retried once and succeeded. This is the documented one-time exception.
- **Latency.** In the seconds before each rollout started: p50 9 ms, p99 68 ms. During the rollouts: p50 11 ms, p99 125 ms. The slowest request during a rollout took 0.69 s.
- **Timeline of (a).** Seconds from the start:
  - 0–2: checks; nginx was left alone, since no switch was unfinished.
  - 2: the interim started.
  - 13: the interim was ready.
  - 15: it passed the page probe, and the old supervisor was asked to hand over.
  - 23: the new supervisor had held the queue for the 5 s soak, and nginx switched.
  - 27: the switch was verified through nginx.
  - 30: the old container had drained.
  - 36: the queue was confirmed again, and the old release was recorded and replaced.
  - 47: the canonical container was ready.
  - 56: the canonical container held the queue, and nginx switched back.
  - 61: the interim had drained and was removed.

  In every drain of every run, the retired nginx workers had exited and the container was quiet within 2–4 s.
- **Memory.** A ready instance serving the test load used 305–370 MiB. The two containers together peaked at 745 MiB during an overlap, and one container at 436 MiB, with jobs running.
- **Refusals.** The only refusals were the test key's fair-use limits: two `429 job_rate_limited` and two `429 rate_limit_exceeded`. No submission was refused with a 503.
- **Backing out a degraded cut-over.** The runbook's command block for it was rehearsed on the same stand-in, extracted from this file and changed only in names. The starting state was a cut-over killed right after it stopped v2.6.1: nginx on the interim, v2.6.1 stopped. The block drained the interim's supervisor in 2 s and had v2.6.1 ready, holding the queue, 6 s later. It switched nginx back, verified it through nginx, and removed the interim, 11 s in all. Under the same load, 0 of 1486 requests failed, and 38 of 38 jobs ran on their first attempt.
- **nginx 1.18.** The shipped production site with the upstream include also passed `nginx -t` on `nginx:1.18.0-alpine`, production's version, with the upstream file naming 8000 and naming 8001.

Reproduce with a stand-in of your own. Never point these at production.

### Production rollout runbook

For someone with production access. Nothing here has been run against production. The environment that built this change could not reach `ssh priva`, so the live host was inspected only through its public `/readyz`: build `b2cb85c`, async jobs enabled. Run everything on the VM as `ubuntu` in `/home/ubuntu/privatools`, unless a step says otherwise. The Docker commands use `sudo`, because ubuntu's login session may not be in the docker group (the deploy service adds it). The backup timer is not touched at any point.

**0. Read-only checks. Record the output; stop if any line disagrees.**

```bash
cd /home/ubuntu/privatools
git status --short --untracked-files=no                # nothing (v2.6.1 does not ignore the timer's own marker files)
git describe --tags --exact-match HEAD                 # the deployed tag (v2.6.1 on 18 September)
curl -fsS http://127.0.0.1:8000/readyz                 # ready, that build_sha, "api_job_worker":true
curl -fsS --resolve privatools.me:443:127.0.0.1 https://privatools.me/readyz
                                                       # the same, through nginx: the rollout's own check after every switch;
                                                       # if this fails, every deploy is undone at its switch (exit 2)
sudo docker compose version                            # v2 or later; deploys already use --pull never
sudo docker ps --format '{{.Names}}\t{{.Ports}}'       # privatools-privatools-1 on 127.0.0.1:8000
sudo docker inspect privatools-privatools-1 --format \
  '{{index .Config.Labels "com.docker.compose.project"}} {{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}'
                                                       # privatools 4294967296 1800000000
grep -c '^COMPOSE_PROJECT_NAME=' .env || true          # 0 (a key-name check; prints no values)
free -m                                                # "available" comfortably above 1.5 GB
sudo docker stats --no-stream                          # what the other projects use right now
ss -ltn | grep ':8001 ' || echo "8001 free"            # the interim port must be free
nginx -v; cat /run/nginx.pid                           # 1.18 on Ubuntu 22.04, and a PID the deploy can read
diff <(git show v2.6.1:deploy/oracle-vm/nginx-privatools.conf) /etc/nginx/sites-enabled/privatools \
  && echo "installed site = repository copy"
sysctl fs.protected_regular                            # 2 on Ubuntu: why the deploy scripts refuse root
ls -l /tmp/privatools-auto-deploy.lock                 # owned by ubuntu, or absent; a root-owned lock blocks every deploy
systemctl list-timers privatools-backup.timer privatools-auto-deploy.timer --no-pager
sudo -n true && echo "non-interactive sudo works"      # for this runbook; the service needs only its own rule
```

If 8001 is taken, choose a free port. Change it in `rollout.sh` (`INTERIM_PORT`), `nginx-upstream.sh` (`ALLOWED_PORTS`), the sudoers file and `test_zero_downtime_rollout.py`, and release that change first. If the installed site differs from the repository copy, do not copy the new file over it in step 6. Apply the two edits to the installed file instead: add `include /etc/nginx/privatools-upstream.conf;` at the top, and change every `proxy_pass http://127.0.0.1:8000;` to `proxy_pass http://privatools_app;`. One difference is expected, not a local edit: if the API host's error pages were applied before this cut-over ([their runbook](api-subdomain-split.md#nginxs-own-error-answers-on-the-api-host-added-24-september-2026)), the diff shows their two maps, `error_page` lines and named locations, and the comments #207 wrote about the upstream. Step 6 may copy the release's file over such a site only if the release contains those error pages (#282): `grep -q pt_cors_origin /tmp/privatools-cutover/deploy/oracle-vm/nginx-privatools.conf && echo "has the error pages"` says so after step 3. A release without them, v2.7.1 among them, silently removes them at step 6. After such a cut-over, run the error-pages runbook again, from its step 1.

**Measure how long retired nginx workers live** before relying on "zero failed requests". This performs one graceful reload of the unchanged configuration, as a certbot renewal does:

```bash
master=$(cat /run/nginx.pid)
sudo nginx -t && sudo systemctl reload nginx
for i in $(seq 1 90); do
  n=$(ps -o args= --ppid "$master" | grep -c 'shutting down')
  echo "$(date +%T) ${n} retiring"; [ "$n" = 0 ] && break; sleep 5
done
ps -o pid,etimes,args --ppid "$master"                 # anything still shutting down, and for how long
```

Each deploy switch leaves the previous worker generation to finish its requests, and the rollout keeps the old container until that generation exits, capped at 300 s (then 120 s more if requests are still open on it).

- **If they exit within seconds** (the dev VM's case), drains take seconds and a deploy about two to three minutes.
- **If they linger**, whether from other sites' websockets, long downloads or Cloudflare's long-lived origin connections, a deploy takes up to about 15 minutes. Anything still in progress on those workers when the cap is reached is cut.
- **What to expect from nginx.** A retiring worker closes a keep-alive connection after its current request and sends GOAWAY on HTTP/2, so new requests should move to the new generation. This measurement confirms that for this host behind Cloudflare, which the dev-VM load test could not reproduce.
- **If lingering is routine,** raise `DRAIN_MAX` with an `Environment=` line in the deploy unit rather than accepting cut requests.

**1. Stop automatic deploys, before any tag exists.**

```bash
sudo systemctl stop privatools-auto-deploy.timer
systemctl is-active privatools-auto-deploy.service     # inactive
```

**2. Merge and release.** Merge the pull request; a merge to `main` ships nothing. Tag the release from `main` and wait for the release workflow to push and sign its image. With the timer stopped, the tag does not deploy yet. Check that `curl -fsS http://127.0.0.1:8000/readyz` still reports v2.6.1's build. If it already reports the tag's commit, the old timer deployed it before step 1, the old way. Step 7 then only says `already serves`, step 8's rollback record does not exist yet, and the first zero-downtime deploy is the next tag.

**3. Take the release's deploy files without moving the checkout.**

```bash
git fetch --tags origin
rm -rf /tmp/privatools-cutover && mkdir /tmp/privatools-cutover
git archive vX.Y.Z deploy | tar -x -C /tmp/privatools-cutover
```

**4. Back up what the cut-over replaces.** The stamp goes in a file because the Undo steps need it later, possibly from another shell.

```bash
stamp=$(date +%s); mkdir -p /home/ubuntu/nginx-backups; echo "$stamp" > /home/ubuntu/nginx-backups/cutover-stamp
sudo cp /etc/nginx/sites-enabled/privatools /home/ubuntu/nginx-backups/privatools.$stamp.bak
sudo cp /usr/local/bin/privatools-auto-deploy /home/ubuntu/nginx-backups/privatools-auto-deploy.$stamp.bak
sudo cp /etc/systemd/system/privatools-auto-deploy.service /home/ubuntu/nginx-backups/privatools-auto-deploy.service.$stamp.bak
sudo cp /usr/local/bin/privatools-backup /home/ubuntu/nginx-backups/privatools-backup.$stamp.bak
cp ~/deploy.sh /home/ubuntu/nginx-backups/deploy.sh.$stamp.bak 2>/dev/null || true
```

**5. Install.** This installs the scripts, the helper, the sudoers rule and the upstream file. It also installs the new backup script and manual deploy script. None of it changes traffic: the upstream file names 8000 and nothing includes it yet.

```bash
sudo bash /tmp/privatools-cutover/deploy/oracle-vm/install-auto-deploy.sh   # no --start: install and validate only
sudo install -m 0755 /tmp/privatools-cutover/deploy/oracle-vm/backup-app-data.sh /usr/local/bin/privatools-backup
                                                       # the script only; the backup timer and unit stay untouched
install -m 0755 /tmp/privatools-cutover/deploy/oracle-vm/deploy.sh ~/deploy.sh
                                                       # the old one stops and starts the container and prunes images
cat /etc/nginx/privatools-upstream.conf                # server 127.0.0.1:8000;
sudo -n -l /usr/local/sbin/privatools-nginx-upstream set 8001                # as ubuntu: prints the allowed command
```

**6. Route the site through the upstream.** This also changes no traffic: the upstream still names 8000. Other projects share this nginx, so a rejected site file must not stay in place. The next reload by anyone, such as a certbot hook, would fail, and an nginx restart would take every site down.

```bash
sudo cp /tmp/privatools-cutover/deploy/oracle-vm/nginx-privatools.conf /etc/nginx/sites-enabled/privatools
if sudo nginx -t; then
  sudo systemctl reload nginx
else
  sudo cp /home/ubuntu/nginx-backups/privatools.$(cat /home/ubuntu/nginx-backups/cutover-stamp).bak \
    /etc/nginx/sites-enabled/privatools
  sudo nginx -t && echo "restored the previous site; stop here"
fi
curl -fsS https://privatools.me/readyz                                          # still the running build
python3 /tmp/privatools-cutover/deploy/release-preflight.py --zero-downtime     # as ubuntu; no "fail"
```

**7. First zero-downtime deploy, by hand and watched.** From another machine, watch the public site throughout:

```bash
while true; do printf '%s %s ' "$(date +%T)" "$(curl -s -o /dev/null -w '%{http_code}' https://privatools.me/)"
  curl -s https://privatools.me/readyz | cut -c1-70; sleep 0.5; done
```

On the VM:

```bash
sudo systemctl start --no-block privatools-auto-deploy.service
journalctl -fu privatools-auto-deploy.service
```

Expect in the journal, in order:

1. `cosign signature verified`, then `phase 1: starting …` and `page probe passed`.
2. `predates handover`: the v2.6.1 supervisor cannot drain, so this deploy hands the queue over after the switch.
3. The switch to 8001, then `drained`, then `stopped …, whose job supervisor predates handover`.
4. `holds the queue`, then `recorded … as the release to roll back to`.
5. `phase 2`, the handover to the canonical container, the switch back to 8000, `done` and `deploy complete`.

It takes two to three minutes if retiring nginx workers exit promptly (step 0's measurement), and up to about 15 minutes if they linger to the caps. The watch loop shows only 200s, and the build SHA changes once.

The timer stays stopped until step 9, so nothing below retries by itself. To retry, start the service again as above once 10 minutes have passed. Inside those 10 minutes a rerun only logs `backing off`, unless you first `rm -f .privatools-auto-deploy.retry` (after exit 3, also `.privatools-deploy.resume`). Other outcomes:

- `REJECTED` (exit 1): the release was at fault and the old release kept serving; read the probe or supervisor lines above it.
- `host problem` or `refused` (exit 2): nothing changed or the attempt was undone; retry as above.
- `DEGRADED` (exit 3): the new release serves from the interim container. The log says whether the canonical container did not come up, or whether the new job supervisor has not confirmed the queue. For the queue, check `sudo docker exec privatools-interim-privatools-1 python -m backend.app.job_handover --status`. `"role": "active"` means the queue is held, and a retry finishes the move. If it never becomes active and you would rather return to v2.6.1, which is stopped, not removed, and recorded, follow **Back out a degraded cut-over** below.
- `CRITICAL` (exit 4): act now; the log says whether nginx or a container still receiving requests needs attention. A container still receiving requests can be a false alarm. nginx workers retired shortly before the switch, by another site's reload or an earlier switch in the same run, may still be finishing a long upload to it. The container is kept either way, so nothing is lost. Check through nginx that the expected build answers, and that the kept container's requests stop, then retry. A clean retry drains and removes the kept container, which shows it was benign; a second exit 4 means nginx really routes there.

**8. Verify.**

```bash
curl -fsS http://127.0.0.1:8000/readyz                         # the new build_sha, "api_job_worker":true
sudo docker ps --format '{{.Names}}\t{{.Ports}}'               # privatools-privatools-1 only; no interim
cat /etc/nginx/privatools-upstream.conf                        # 127.0.0.1:8000
cat .privatools-deploy.previous                                # the v2.6.1 image ID and b2cb85c…
sudo docker exec privatools-privatools-1 python -m backend.app.job_handover --status   # local role "active"
systemctl list-timers privatools-backup.timer --no-pager       # unchanged; check the next 03:17 run in its journal
```

**9. Re-enable automatic deploys.** The timer stays enabled across a stop:

```bash
sudo systemctl start privatools-auto-deploy.timer
```

From the next tag on, deploys run through the timer with zero downtime and a draining job handover.

**Roll back a release** (after the cut-over). This is zero-downtime, also from the degraded state:

```bash
sudo systemctl stop privatools-auto-deploy.timer
sudo runuser -u ubuntu -g ubuntu -G docker -- privatools-rollout --rollback
```

**Back out a degraded cut-over to v2.6.1.** Use this when step 7 ended `DEGRADED` because the new job supervisor never confirmed the queue, and you choose v2.6.1 over a retry. In that state the upstream names 8001, the interim serves every request, and v2.6.1's container is stopped but kept. The stop-and-start command under Rollback does not work here. It starts v2.6.1 on 8000, whose own check passes, while nginx keeps sending all traffic to the interim: the rollback looks done and is not. Only one supervisor can hold the queue, and v2.6.1's gives up after 30 s without it (its container then restart-loops), so keep this order:

```bash
cd /home/ubuntu/privatools
systemctl is-active privatools-auto-deploy.service      # inactive: no deploy is running
interim=privatools-interim-privatools-1
holds_queue() { sudo docker exec "$interim" python -m backend.app.job_handover --status \
  | python3 -c 'import json, sys; print((json.load(sys.stdin)["local"] or {}).get("role") in ("active", "draining"))'; }

# 1. Drain the interim's job supervisor. It finishes the job it is running
#    (up to 5 minutes), then releases the queue. Only a real "False" ends the
#    wait; a failed docker call prints nothing.
sudo docker kill --signal SIGUSR1 "$interim"
until [ "$(holds_queue)" = False ]; do sleep 2; done

# 2. Straight away, start v2.6.1 and wait for it. Its /readyz reports ready
#    only once its own supervisor holds the queue. A drained supervisor takes
#    the queue back after 30 s without a heartbeat: if v2.6.1 is not ready
#    within a minute, repeat step 1 while it restarts.
sudo docker start privatools-privatools-1
until curl -fsS http://127.0.0.1:8000/readyz 2>/dev/null | grep -q '"api_job_worker":true'; do sleep 2; done
curl -fsS http://127.0.0.1:8000/readyz                  # build_sha = the v2.6.1 SHA in .privatools-deploy.previous

# 3. Move traffic back. nginx applies a reload a moment after the command
#    returns: wait until its old workers are retiring, then check through
#    nginx, the path visitors take.
old=$(ps -o pid=,args= --ppid "$(cat /run/nginx.pid)" | awk 'NF == 4 && $3 == "worker" { print $1 }' | paste -sd, -)
sudo /usr/local/sbin/privatools-nginx-upstream set 8000
for i in $(seq 30); do ps -o args= -p "$old" | grep -qx 'nginx: worker process' || break; sleep 1; done
cat /etc/nginx/privatools-upstream.conf                                        # server 127.0.0.1:8000;
curl -fsS --resolve privatools.me:443:127.0.0.1 https://privatools.me/readyz   # the v2.6.1 build_sha

# 4. Let those retired workers finish their requests to the interim (at most
#    5 minutes here), then remove it. Its volumes are external.
for i in $(seq 60); do ps -o args= -p "$old" | grep -q '^nginx: worker process' || break; sleep 5; done
sudo docker stop --time 45 "$interim" && sudo docker rm "$interim"
sudo docker network rm privatools-interim_default

# Keep the timer from redeploying the withdrawn tag, clear the degraded state,
# and re-enable automatic deploys.
git rev-parse HEAD > .privatools-auto-deploy.failed
rm -f .privatools-deploy.resume .privatools-auto-deploy.retry
sudo systemctl start privatools-auto-deploy.timer
```

**Undo the cut-over** if anything above misbehaves. First restore the steady state:

- **If the upstream names 8001,** an interim container is serving. Finish the move with `sudo runuser -u ubuntu -g ubuntu -G docker -- privatools-rollout IMAGE SHA`, using the release it serves. Or return to v2.6.1 with **Back out a degraded cut-over** above; if the canonical container already serves, `sudo /usr/local/sbin/privatools-nginx-upstream set 8000` is enough.
- **Once the upstream names 8000,** remove any interim container that is left: `sudo docker rm -f privatools-interim-privatools-1; sudo docker network rm privatools-interim_default`. Its volumes are external, so this never touches data.

Then:

```bash
stamp=$(cat /home/ubuntu/nginx-backups/cutover-stamp)
sudo systemctl stop privatools-auto-deploy.timer
sudo cp /home/ubuntu/nginx-backups/privatools.$stamp.bak /etc/nginx/sites-enabled/privatools
sudo nginx -t && sudo systemctl reload nginx                  # proxy_pass 127.0.0.1:8000 again
sudo install -m 0755 /home/ubuntu/nginx-backups/privatools-auto-deploy.$stamp.bak /usr/local/bin/privatools-auto-deploy
sudo install -m 0644 /home/ubuntu/nginx-backups/privatools-auto-deploy.service.$stamp.bak /etc/systemd/system/privatools-auto-deploy.service
sudo install -m 0755 /home/ubuntu/nginx-backups/privatools-backup.$stamp.bak /usr/local/bin/privatools-backup
cp /home/ubuntu/nginx-backups/deploy.sh.$stamp.bak ~/deploy.sh 2>/dev/null || true
sudo rm -f /etc/sudoers.d/privatools-deploy /usr/local/sbin/privatools-nginx-upstream /usr/local/bin/privatools-rollout \
  /etc/nginx/privatools-upstream.conf /etc/nginx/privatools-upstream.conf.previous /run/privatools-nginx-upstream.lock
sudo systemctl daemon-reload && sudo systemctl start privatools-auto-deploy.timer
```

The canonical container needs nothing: the steady state is the same container on the same port. The old script then deploys with its old gap again.

## Review gates before any publication

| Gate | What must be recorded | Current preparation status |
| --- | --- | --- |
| Exact candidate | Reviewed full commit SHA, release tag and immutable image digest; app and content diffs reviewed | Pending. No commit/tag/push performed. |
| Source checks | Final frontend/backend suites, app typecheck, lint, content generation, bundle/SRI checks | Record results privately for the exact release revision. |
| Container | Successful no-push candidate build and functional outputs using the Linux image, including subtitle burn-in | Docker/Podman unavailable locally. Build-time capability assertion is prepared, not an executed image result. |
| Host validation | Compose model, installed nginx syntax/real-IP module, disk/memory, TLS files, running build/image, timer state | Not inspected on the VM. No SSH or live mutation performed. |
| Auth | Matching production public key at build/runtime, enabled providers, real HTTPS login, passkey and recovery tests | Configuration instructions prepared; production end-to-end behavior is not verified. |
| Google OAuth | Production configuration and real hosted provider sign-in | Verified on September 14: hosted Google login completed and the production Clerk user shows a verified, linked Google identity. The callback still uses the older deployed website; new release key/account/API integration remains pending. |
| Clerk deletion | Signed `user.deleted` webhook delivery removes local API access | Handler/tests exist; live delivery and production secret configuration remain unverified. |
| Analytics | Reviewed remote tag settings, correct authorized account, intercepted fresh-browser validation | Root reports site-search/form/download/history automation and automatic user-data detection disabled. Scroll/outbound/video remain enabled by user choice. Browser collection is enabled in production and default-on for every visitor since 17 September 2026; the Privacy page switch is the only opt-out. |
| Edge discovery | Served robots, sitemap, redirects and cache rules match reviewed intent | Previous public robots included Cloudflare-managed directives. Local files cannot change that dashboard policy. |
| Backup / rollback | Consistent DB backup and restore rehearsal; old image/config retained | Backup script exists; no live backup/restore or off-host copy verified in this task. |

Google/Clerk/GA and DNS settings are outside the image. A clean build does not activate or prove them. This deployment-preparation task did not access Google accounts or browser profiles. Root coordinates the separately authorized account setup and reports its current verification state.

## Expected configuration — names, never secrets

Use [the Oracle Compose template](oracle-vm/.env.example) for `/home/ubuntu/privatools/.env`, protected with mode `0600`. Compose substitutes only variables referenced in `docker-compose.yml`; it does not pass every key in `.env` to the container. Do not print `docker compose config` or `docker inspect .Config.Env` into shared reports. `docker compose config --quiet` validates without printing resolved values. [Docker documentation](https://docs.docker.com/reference/cli/docker/compose/config/)

| Name | Where | Required relationship / safe setting |
| --- | --- | --- |
| `CLERK_PUBLISHABLE_KEY` | GitHub repository variable and Compose runtime | Same `pk_live_…` instance, correct production domain. Public key only; never a secret build argument. |
| `CLERK_SOCIAL_PROVIDERS` | GitHub repository variable | Workflow defaults `google,github` after verified production Google sign-in. An explicit repository variable still overrides this default; review it before release. |
| `VITE_CLERK_SOCIAL_PROVIDERS` | Local Docker build argument via Compose | Defaults to `google,github`; an explicit Compose/build value still wins. Does not modify an already-built image. |
| `VITE_AUTH_PROVIDER` | Build | `clerk` for this consumer deployment. Missing key shows unavailable accounts; it does not silently create native accounts. |
| `VITE_CLERK_USERNAME_ENABLED`, `VITE_CLERK_PASSKEYS_ENABLED` | Build | Match enabled Clerk instance features; workflow currently enables both. |
| `CLERK_WEBHOOK_SECRET` | Runtime only | Signed deletion endpoint `https://privatools.me/api/clerk/webhook`; subscribe to `user.deleted`. |
| `PUBLIC_API_BASE_URL` | Runtime | Preserve current approved value. Empty means same-origin; split origin requires its DNS/TLS/CORS checks. |
| `GA4_MEASUREMENT_ID` | Runtime | Preserve the existing public measurement ID; no new property/ID was created. |
| `GA_BROWSER_TAG_ENABLED` | Runtime | `false` until the user-selected Google measurement settings and automatic user-data detection safeguards are verified. Follow the current analytics runbook; do not disable the three explicitly retained features. |
| `PRIVATOOLS_IMAGE`, `GIT_SHA` | Release invocation | Verified immutable digest and matching full source SHA. Runtime `PRIVATOOLS_BUILD_SHA` is derived by Compose. |

The backend verifies Clerk with public JWKS and does not need `CLERK_SECRET_KEY`. The legacy GA Measurement Protocol compatibility endpoint may still read `GA4_API_SECRET` for cached older clients; it is not needed to enable the new browser tag and must never appear in frontend variables. See [Clerk setup](clerk-production.md) and [analytics switches and verification](analytics.md).

## Read-only preflight

This is safe to run during review:

```bash
python3 deploy/release-preflight.py
```

On the existing host, after read-only host access is authorized:

```bash
cd /home/ubuntu/privatools
python3 deploy/release-preflight.py --host
```

To check only what the zero-downtime rollout needs (the upstream file, the site's `proxy_pass`, the sudo rule, the check through nginx, the deploy lock's owner, port 8001 and memory), run this as ubuntu. It works from a `git archive` export and runs neither nginx nor Docker:

```bash
python3 deploy/release-preflight.py --zero-downtime
```

The report never prints environment values and never fetches, builds, pulls, deploys or reloads. Its exit status flags executed-check failures; `releaseReady: false` is deliberate because the script cannot approve publication or attest to external account configuration. `nginx -t` may need operator privileges to read private TLS files. Check the installed nginx includes `--with-http_realip_module`; do not replace `$realip_remote_addr` with a visitor-controlled header if it does not. The backend and proxy must both use the new country contract before the trust switch is enabled.

Before release, privately record the actual installed Compose project name, current container/image SHA, latest good DB backup, nginx configuration and timer state. Check at least 4 GB container memory plus host headroom, enough disk for `KEEP_IMAGES` + 1 release images ([image retention](#image-retention)) and uploads, and valid apex/API certificates. The two-worker native stack and native codec capabilities need an actual Linux-image smoke check; `/readyz` alone does not test every converter or browser model.

## Future approved release sequence

1. Review the source diff and root's final test report. Choose one exact commit/tag. A tag push triggers the release workflow and may be picked up by the existing VM timer; **do not push a tag merely to preview a build**. The workflow itself pushes/signs an image and publishes a GitHub Release. Its image CVE scan is report-only, so inspect that report separately.
2. Confirm the existing auto-deploy timer is stopped and no deployment service is running before a coordinated manual release. `install-auto-deploy.sh` installs and validates only; with `--start` it also enables the timer **and immediately starts deployment**. Updating the checked-out script alone does not update `/usr/local/bin/privatools-auto-deploy` or `/usr/local/bin/privatools-rollout`; the installed copies/service must be reviewed and installed deliberately after approval.
3. Make a consistent account DB snapshot with `oracle-vm/backup-app-data.sh` and verify it, retain an encrypted off-host copy, and retain the previous image plus protected copies of Compose, `.env`, nginx and installed service/script. Do not back up transient uploads as account state. See rollback below.
4. Run the reviewed CI checks and a no-push image build first. For the approved publication, create the release artifact via the existing workflow. Record its digest and full revision, verify cosign with the repository's tag-workflow identity and GitHub OIDC issuer, then deploy that same digest. Signature verification binds the artifact to an allowed identity, not merely a mutable image label. [Sigstore documentation](https://docs.sigstore.dev/cosign/verifying/verify/)
5. Validate and install the reviewed Oracle nginx file with a rollback copy. `nginx -t` must pass before reloading. Maintain apex/API certificates and the existing API split. Never install the legacy `.com` config. Compare edge robots behavior and bypass caching for `/api/*`; `/api/analytics/policy` must remain `private, no-store` on both hosts. Preserve direct API unknown-region behavior.
6. Use the approved digest and SHA with `privatools-rollout DIGEST SHA`, run as the deploy user. The auto-deploy script does exactly that for tagged releases after signature verification. The rollout starts the release beside the running one and gates it on `/readyz`, the real-page probe and its job supervisor holding the queue. Only then does it move traffic ([zero-downtime deploys](#zero-downtime-deploys)). Inspect normal error rates afterwards. Compose recreation preserves named volumes; do not use `down -v`. [Docker documentation](https://docs.docker.com/reference/cli/docker/compose/up/)
7. Verify public home plus Air/Play/theme transitions, one real PDF/image/media output, pipeline/batch output, new blog and comparison deep links, canonical/404/noindex behavior, search/Markdown handoff, service-worker update and offline browser tool. Check anonymous tools and signed-in API-key controls separately. The hosted production Google flow has been verified. The new release must still verify its production key/account/API wiring, passkey enrollment/sign-in, recovery email and deletion webhook with explicit real account/device actions.
8. Enable only independently verified integrations. Retain disabled analytics until approved; release defaults now expose the verified Google and GitHub providers. Explicit provider overrides remain respected. Once regional analytics is deliberately configured, test direct spoofed country headers, unknown country, GPC/DNT, saved opt-out, and shared-cache isolation before exposing default-on behavior. No raw country should be returned to the browser.
9. Re-enable the tag-only timer only after the deployment is accepted and its installed script/settings match the reviewed files. The rollout's [image retention](#image-retention) keeps the prior image while it is the rollback record and bounds the rest; nothing else should remove PrivaTools images. Submit discovery changes only after the actual public URLs return their intended status/content. Existing auto-deploy includes a best-effort IndexNow request after success, not a ranking or indexing guarantee.

## Rollback and state preservation

For a code-only failure, stop the timer first, then restore the **recorded** previous release without downtime. The rollout records the release it replaces (image ID and full source SHA) in `/home/ubuntu/privatools/.privatools-deploy.previous` before destroying it, so the record is right even after a degraded run. `--rollback` also works from the degraded state, without waiting for its backoff. Run it as the deploy user, never with plain `sudo`: root cannot open the deploy lock in `/tmp` and would leave state the timer cannot use, so the rollout refuses root. Do not run the manual `deploy.sh` as a rollback tool: it pulls main and rebuilds.

```bash
# Authorized rollback between releases that both contain the drainable job
# supervisor (the zero-downtime release and later).
sudo systemctl stop privatools-auto-deploy.timer
cat /home/ubuntu/privatools/.privatools-deploy.previous        # IMAGE SHA to restore
bad_sha="$(git -C /home/ubuntu/privatools rev-parse HEAD)"      # the release being withdrawn
sudo runuser -u ubuntu -g ubuntu -G docker -- privatools-rollout --rollback
curl --fail --silent http://127.0.0.1:8000/readyz               # build_sha = the recorded old SHA
# Keep the timer from redeploying the withdrawn tag until a newer one exists.
echo "$bad_sha" > /home/ubuntu/privatools/.privatools-auto-deploy.failed
sudo systemctl start privatools-auto-deploy.timer
```

A release older than the drainable supervisor (v2.6.1 and earlier) cannot start beside a newer one while async jobs are enabled: its supervisor gives up on the shared lock and its `/readyz` rejects the newer heartbeat, so the rollout rejects it and nothing changes. Restore such a release with the stop-and-start form, which has the old gap of a few seconds. It is only for the steady state: the upstream names 8000 (`cat /etc/nginx/privatools-upstream.conf`) and no interim container runs. After a degraded cut-over, follow **Back out a degraded cut-over** in the runbook instead. There, this command would start the old release on 8000 while nginx kept routing to the interim.

```bash
# Rollback to a pre-handover release. Fill only from the recorded values.
cd /home/ubuntu/privatools
sudo env PRIVATOOLS_IMAGE="$RELEASE_PREVIOUS_IMAGE" GIT_SHA="$RELEASE_PREVIOUS_SHA" \
  docker compose up -d --no-build --pull never
curl --fail --silent http://127.0.0.1:8000/readyz
```

Confirm the returned `build_sha` equals the recorded old SHA. The automatic script marks a rejected new SHA so it does not retry it every minute. Keep that marker until a fixed release or an explicit reviewed retry. An image rollback is not a database rollback: if a change modifies schema or configuration, restore the reviewed old Compose/configuration separately and check compatibility first. Do not overwrite a newer database casually; records created since the snapshot would be lost.

The backup script uses SQLite `VACUUM INTO` for a consistent snapshot and verifies the `users` table. Rehearse restoring a copied snapshot into an **isolated** empty data volume, run SQLite integrity checks, and check account/API-key behavior with synthetic data before trusting it. A same-VM backup is not disaster recovery. A production restore requires a maintenance window, stopped writers, a current emergency backup, correct appuser ownership, and intentional preservation/removal of matching WAL/SHM files; do not copy a live WAL-mode database with plain `cp`.

For nginx failure, restore the recorded old config, validate with `nginx -t`, then reload. If the browser tag configuration is uncertain, keep `GA_BROWSER_TAG_ENABLED=false`. Do not change DNS merely to roll back the app; the [API split runbook](api-subdomain-split.md) explains the upload-cap implications of reverting that separate setting.

## Local evidence and remaining work

- `python3 deploy/release-preflight.py`: source/shell checks and explicit missing native tools. With `--host` it also checks the zero-downtime prerequisites: the upstream file, the site's `proxy_pass`, the sudo rule, a free port 8001 and enough memory.
- `backend/tests/test_release_deploy_contract.py`: inert command-double executions of the tag, signature and digest paths, and of what auto-deploy does with each rollout outcome. No network or Docker commands run in these tests.
- `backend/tests/test_zero_downtime_rollout.py`: `rollout.sh` against a simulated host that models nginx's worker generations, where nginx really routes, and supervisors that take a free lock or crash. It covers:
  - the order of every switch, drain and handover, with the queue held by the new release before any traffic moves, and signals sent only to supervisors that can take them;
  - rejection of never-ready and page-broken releases, and of a supervisor that crashes on taking the queue or after the switch, including in the cut-over deploy;
  - host failures exiting 2;
  - a killed switch-back repaired rather than trusted, a still-routed container kept, and late requests from the workers a killed run retired not mistaken for routing;
  - a leftover interim that never passed the gates never given traffic, after one failed probe or a canonical container that stays down;
  - no reload of the shared nginx unless a switch was left unfinished, including in the degraded state;
  - failed status polls and `docker inspect` calls inside the soak asked again, and a cut-over whose supervisor does not confirm the queue left serving, degraded;
  - drains that wait only for the workers this deploy retired, and a page probe that asks for the public host name;
  - a reload that nginx never applied, undone;
  - degraded mode, its backoff, its memory check and `--rollback` from it, and the rollback record written before the old release is destroyed;
  - resuming after a killed run, root refusal and preconditions;
  - the root helper: readiness of the target, restore on failure, serialization and a SIGTERM inside its rename-to-reload window;
  - image retention, only after exit 0 and also after `--rollback`: the newest `KEEP_IMAGES`, every container's image (stopped, another project's, an interim Docker could not remove) and the rollback record kept; the rest of PrivaTools' images removed by name, never forced; other repositories' images, and ours also named there, never touched; the fallback and a run by hand's own repository counted; `KEEP_IMAGES` below 2 skipped; and a failed or refused Docker call that leaves exit 0 and the release serving.
- `backend/tests/test_api_v1_jobs.py` and `test_launcher.py`:
  - Two real supervisors on one lock. A standby takes over only after a drain, the drained job finishes where it started, and a drained supervisor heals itself.
  - Readiness accepts only this container's live standby of the same build: while another supervisor serves the queue, or otherwise only within `queue_seconds`.
  - The status command imports no web stack.
  - The launcher relays the drain signals to the worker only, and an early signal is harmless.
- `backend/tests/test_release_deploy_contract.py`: the timer's handling of each rollout exit (marked failed only for exit 1; exits 2, 3 and 4 back off), and the image repositories it passes to the rollout. It and the manual deploy both refuse root.
- `backend/tests/test_backup_script.py`: the backup falls back to the interim container and waits for a deploy's lock.
- `backend/tests/test_probe_image.py`: the CI image probe boots with async jobs and requires the supervisor to hold the queue; the deploy's probe sends the public Host header; only the CI probe converts a Word equation.
- `backend/tests/test_release_preflight.py`: `--zero-downtime` runs from an export without a checkout, nginx or Docker.
- `backend/tests/test_nginx_country_boundary.py`: source-level proxy/header/CIDR checks, including visitor-IP restoration, original-peer preservation, and every location proxying through `privatools_app` with `Host $host`. It is not native nginx validation; the load test above ran real nginx.
- Keep deployment, browser, provider and account-specific evidence privately with the release record.

Deployment remains **prepared, not published** until a release candidate, host/native image checks, rollback evidence and final approval are recorded. Verified hosted OAuth and remaining new-release auth, analytics, webhook and edge-policy steps remain individually visible; they are not hidden behind a generic “all done” status.
