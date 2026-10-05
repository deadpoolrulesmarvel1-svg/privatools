"""Execute the actual deploy gate with inert command doubles; never use Docker/git/network.

These prove selection/signature/digest behavior and what auto-deploy does with
each rollout outcome, not a live VM rollout. The zero-downtime replacement
itself is tested in test_zero_downtime_rollout.py.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

import pytest

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT / 'deploy/oracle-vm/auto-deploy.sh'
NEW = 'a' * 40
DIGEST = 'ghcr.io/ethereaglehq/privatools@sha256:' + 'c' * 64

FAKE = r'''
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
mode = os.getenv('FAKE_MODE', '')
root = pathlib.Path(os.environ['FAKE_ROOT'])
with (root / 'commands.jsonl').open('a') as f:
    f.write(json.dumps({'name': name, 'args': args, 'image': os.getenv('PRIVATOOLS_IMAGE'), 'sha': os.getenv('GIT_SHA'),
                        'repos': [os.getenv('DEPLOY_IMAGE_REPO'), os.getenv('DEPLOY_IMAGE_REPO_FALLBACK')]}) + '\n')
new, old = 'a' * 40, 'b' * 40
digest = 'ghcr.io/ethereaglehq/privatools@sha256:' + 'c' * 64
old_image = 'sha256:' + 'd' * 64
if name == 'id':
    print(0 if mode == 'root' else 1000)
elif name == 'git':
    if args[0] == 'rev-parse': print(old if args[-1] == 'HEAD' else new)
    elif args[0] == 'tag': print('' if mode == 'no_tag' else 'v9.9.9')
elif name == 'docker':
    if args[:3] == ['compose', 'ps', '-q']: print('existing-container')
    elif args[:2] == ['inspect', '--format']:
        if args[2] == '{{.Image}}': print(old_image)
        else: print('PRIVATOOLS_BUILD_SHA=' + old)
    elif args[:2] == ['image', 'inspect']:
        if '.RepoDigests' in args[-1]: print('' if mode == 'no_digest' else digest)
        else: print(old if mode == 'wrong_revision' else new)
    elif args[:2] == ['compose', 'up']:
        (root / 'active').write_text('old' if os.getenv('PRIVATOOLS_IMAGE') == old_image else 'new')
        if mode == 'startup_failed' and os.getenv('PRIVATOOLS_IMAGE') != old_image: sys.exit(1)
elif name == 'cosign':
    sys.exit(1 if mode == 'bad_signature' else 0)
elif name == 'curl':
    active = (root / 'active').read_text() if (root / 'active').exists() else 'old'
    if active == 'new' and mode in ('unhealthy', 'startup_failed'): sys.exit(22)
    print(json.dumps({'build_sha': new if active == 'new' else old}))
elif name == 'rollout':
    # The zero-downtime replacement (rollout.sh) has its own tests; here it
    # only reports the outcome auto-deploy must act on.
    sys.exit({'rejected': 1, 'refused': 2, 'degraded': 3, 'critical': 4}.get(mode, 0))
'''


def run_deploy(tmp_path, mode='', with_cosign=True, deploy_mode=None, **extra_env):
    fake_bin = tmp_path / 'bin'
    (tmp_path / 'commands.jsonl').unlink(missing_ok=True)
    if not fake_bin.exists():
        fake_bin.mkdir()
        for name in ['git', 'docker', 'curl', 'flock', 'sleep', 'rollout', 'id'] + (['cosign'] if with_cosign else []):
            script = fake_bin / name
            script.write_text(f'#!{sys.executable}\n' + FAKE)
            script.chmod(0o755)
        for name in ['date', 'head', 'sed', 'tr', 'seq', 'rm', 'stat']:
            (fake_bin / name).symlink_to(shutil.which(name))
    env = {**os.environ, 'PATH': str(fake_bin), 'FAKE_ROOT': str(tmp_path), 'FAKE_MODE': mode,
           'REPO_DIR': str(tmp_path), 'LOCK_FILE': str(tmp_path / 'lock'), 'ROLLOUT': str(fake_bin / 'rollout'),
           'DEPLOY_PING_URL': '', 'DEPLOY_IMAGE_REPO_FALLBACK': ''}
    env.pop('DEPLOY_MODE', None)
    env.pop('DEPLOY_IMAGE_REPO', None)
    if deploy_mode is not None:
        env['DEPLOY_MODE'] = deploy_mode
    env.update(extra_env)
    result = subprocess.run(['/bin/bash', str(DEPLOY)], env=env, capture_output=True, text=True)
    calls = [json.loads(line) for line in (tmp_path / 'commands.jsonl').read_text().splitlines()]
    return result, calls


def rollouts(calls):
    return [c for c in calls if c['name'] == 'rollout']


def replacements(calls):
    """Anything that could replace the running container outside the rollout."""
    return [c for c in calls if c['name'] == 'docker' and c['args'][:1] == ['compose']
            and any(verb in c['args'] for verb in ('up', 'down', 'stop', 'restart'))]


def test_default_tag_gate_does_not_fall_back_to_branch(tmp_path):
    result, calls = run_deploy(tmp_path, 'no_tag')
    assert result.returncode == 0, result.stdout + result.stderr
    assert not rollouts(calls)
    assert not any(c['args'][:2] == ['reset', '--hard'] for c in calls)


def test_invalid_mode_does_not_deploy(tmp_path):
    result, calls = run_deploy(tmp_path, deploy_mode='typo')
    assert result.returncode == 1
    assert not rollouts(calls)


@pytest.mark.parametrize('mode,with_cosign', [('bad_signature', True), ('no_digest', True), ('', False)])
def test_missing_or_bad_signature_prerequisites_fail_closed(tmp_path, mode, with_cosign):
    result, calls = run_deploy(tmp_path, mode, with_cosign)
    assert result.returncode != 0
    assert not rollouts(calls)


def test_wrong_revision_waits_without_replacing_container(tmp_path):
    result, calls = run_deploy(tmp_path, 'wrong_revision')
    assert result.returncode == 0
    assert not rollouts(calls)
    assert 'not ready yet' in result.stdout


def test_verified_digest_is_exactly_the_image_rolled_out(tmp_path):
    result, calls = run_deploy(tmp_path)
    assert result.returncode == 0, result.stdout + result.stderr
    verify = next(c for c in calls if c['name'] == 'cosign')
    assert verify['args'][1] == DIGEST
    assert '@refs/tags/v' in verify['args'][3]
    # The signed digest and its revision go to the zero-downtime rollout; the
    # container is never replaced any other way.
    assert [c['args'] for c in rollouts(calls)] == [[DIGEST, NEW]]
    assert not replacements(calls)
    assert (tmp_path / '.privatools-auto-deploy.sha').read_text().strip() == NEW
    assert not any('prune' in c['args'] for c in calls if c['name'] == 'docker')


def test_the_rollout_is_told_which_image_repositories_are_privatools_own(tmp_path):
    # Its image retention looks only at these. auto-deploy.sh's defaults are
    # not exported, so it passes both on, the fallback namespace included.
    old_owner = 'ghcr.io/deadpoolrulesmarvel1-svg/privatools'
    result, calls = run_deploy(tmp_path, DEPLOY_IMAGE_REPO_FALLBACK=old_owner)
    assert result.returncode == 0, result.stdout + result.stderr
    assert [c['repos'] for c in rollouts(calls)] == [['ghcr.io/ethereaglehq/privatools', old_owner]]


def test_rejected_release_is_marked_failed_without_touching_the_running_one(tmp_path):
    # The new release never took traffic, so there is no rollback to run.
    result, calls = run_deploy(tmp_path, 'rejected')
    assert result.returncode == 1
    assert 'previous release kept serving' in result.stdout
    assert len(rollouts(calls)) == 1
    assert not replacements(calls)
    assert (tmp_path / '.privatools-auto-deploy.failed').read_text().strip() == NEW
    assert not (tmp_path / '.privatools-auto-deploy.sha').exists()


def test_degraded_rollout_is_retried_not_marked_failed(tmp_path):
    result, _ = run_deploy(tmp_path, 'degraded')
    assert result.returncode == 1
    assert 'DEGRADED' in result.stdout
    assert not (tmp_path / '.privatools-auto-deploy.failed').exists()
    assert not (tmp_path / '.privatools-auto-deploy.sha').exists()


def test_host_failure_backs_off_and_retries_instead_of_blaming_the_release(tmp_path):
    # Exit 2: nginx, Docker, memory or a job that would not finish, not the
    # release. It must not be marked failed until a newer tag, nor retried
    # every minute (each attempt boots a container on a shared VM).
    result, calls = run_deploy(tmp_path, 'refused')
    assert result.returncode == 1 and 'host problem' in result.stdout
    assert (tmp_path / '.privatools-auto-deploy.retry').read_text().strip() == NEW
    assert not (tmp_path / '.privatools-auto-deploy.failed').exists()

    again, calls = run_deploy(tmp_path, 'refused')
    assert again.returncode == 0 and 'backing off' in again.stdout
    assert not rollouts(calls)

    past = time.time() - 3600
    os.utime(tmp_path / '.privatools-auto-deploy.retry', (past, past))
    third, calls = run_deploy(tmp_path)
    assert third.returncode == 0, third.stdout + third.stderr
    assert len(rollouts(calls)) == 1
    assert not (tmp_path / '.privatools-auto-deploy.retry').exists()


@pytest.mark.parametrize('mode', ['degraded', 'critical'])
def test_a_degraded_or_critical_rollout_is_not_rerun_every_minute(tmp_path, mode):
    # Rerunning it each minute would pull, verify and start the rollout for
    # nothing: the degraded state has its own 10-minute backoff, and exit 4
    # needs a human.
    result, _ = run_deploy(tmp_path, mode)
    assert result.returncode == 1
    assert (tmp_path / '.privatools-auto-deploy.retry').read_text().strip() == NEW
    assert not (tmp_path / '.privatools-auto-deploy.failed').exists()

    again, calls = run_deploy(tmp_path, mode)
    assert again.returncode == 0 and 'backing off' in again.stdout
    assert not rollouts(calls)
    assert not [c for c in calls if c['name'] == 'cosign' or c['args'][:1] == ['pull']]


def test_manual_deploy_refuses_root_and_runs_the_rollout_as_the_deploy_user(tmp_path):
    fake_bin = tmp_path / 'bin'
    fake_bin.mkdir()
    (fake_bin / 'id').write_text('#!/bin/sh\necho 0\n')
    (fake_bin / 'id').chmod(0o755)
    env = {**os.environ, 'PATH': f"{fake_bin}{os.pathsep}{os.environ['PATH']}", 'REPO_DIR': str(tmp_path / 'repo'),
           'DEPLOY_LOG': str(tmp_path / 'deploy.log'), 'LOCK_FILE': str(tmp_path / 'lock')}
    result = subprocess.run(['/bin/bash', str(ROOT / 'deploy/oracle-vm/deploy.sh')], env=env,
                            capture_output=True, text=True, timeout=30)
    assert result.returncode == 1
    assert 'as root' in result.stdout + result.stderr
    assert not (tmp_path / 'lock').exists()
    script = (ROOT / 'deploy/oracle-vm/deploy.sh').read_text()
    assert 'runuser -u "$DEPLOY_USER" -g "$DEPLOY_USER" -G docker --' in script
    assert 'sudo env PRIVATOOLS_DEPLOY_LOCK_HELD' not in script


def test_refuses_to_run_as_root(tmp_path):
    # Root cannot open the timer's lock in sticky /tmp (fs.protected_regular)
    # or, before it exists, would create one the timer can no longer open.
    result, calls = run_deploy(tmp_path, 'root')
    assert result.returncode == 1
    assert 'as root' in result.stdout
    assert [c['name'] for c in calls] == ['id']
    assert not (tmp_path / 'lock').exists()


def test_release_calls_real_typecheck_and_has_no_nonblocking_test_jobs():
    workflow = (ROOT / '.github/workflows/test.yml').read_text()
    assert 'npx tsc --noEmit -p tsconfig.app.json' in workflow
    assert 'npm run lint -- --max-warnings 0' in workflow
    assert 'npm run test:content' in workflow
    assert 'continue-on-error' not in workflow
    ci = (ROOT / '.github/workflows/ci.yml').read_text()
    assert 'continue-on-error: true' not in ci
    assert 'npx playwright' not in ci
    release = (ROOT / '.github/workflows/release.yml').read_text()
    assert 'uses: ./.github/workflows/test.yml' in release
    assert 'needs: tests' in release


def test_release_gate_boots_the_built_image():
    # A build that compiles can still ship an image that never serves; the
    # gate runs it before the deploy's readiness check has to.
    workflow = (ROOT / '.github/workflows/test.yml').read_text()
    assert 'load: true' in workflow
    assert 'python3 scripts/ci/probe-image.py "$PROBE_IMAGE"' in workflow
    assert (ROOT / 'scripts/ci/probe-image.py').is_file()


def test_local_private_data_is_excluded_from_build_context():
    ignored = set((ROOT / '.dockerignore').read_text().splitlines())
    assert {'.venv/', 'data/', 'backups/', 'docs/', '**/.env*', '**/*.db', '**/*.db-wal', '**/*.db-shm',
            '.secrets/', '.claude/', '.codex/', '.agents/', 'frontend/.impeccable/'} <= ignored


def test_runtime_image_requires_actual_media_capabilities():
    docker = (ROOT / 'Dockerfile').read_text()
    for capability in [' subtitles[[:space:]]', ' libx264[[:space:]]', ' aac[[:space:]]']:
        assert capability in docker
    assert docker.index('ffmpeg -hide_banner -filters') < docker.index('USER appuser')


def test_release_provider_defaults_match_verified_google_and_github():
    docker = (ROOT / 'Dockerfile').read_text()
    compose = (ROOT / 'docker-compose.yml').read_text()
    workflow = (ROOT / '.github/workflows/release.yml').read_text()
    assert 'ARG VITE_CLERK_SOCIAL_PROVIDERS="google,github"' in docker
    assert 'VITE_CLERK_SOCIAL_PROVIDERS=$VITE_CLERK_SOCIAL_PROVIDERS' in docker
    assert 'VITE_CLERK_SOCIAL_PROVIDERS: ${VITE_CLERK_SOCIAL_PROVIDERS:-google,github}' in compose
    assert "VITE_CLERK_SOCIAL_PROVIDERS=${{ vars.CLERK_SOCIAL_PROVIDERS || 'google,github' }}" in workflow
    for template in ['frontend/.env.example', 'deploy/oracle-vm/.env.example']:
        assert 'VITE_CLERK_SOCIAL_PROVIDERS=google,github' in (ROOT / template).read_text()


@pytest.mark.parametrize('override,expected', [(None, 'google,github'), ('github', 'github'), ('google', 'google')])
def test_compose_provider_expression_preserves_configured_overrides(override, expected):
    # Execute the exact source parameter expression with the same POSIX default
    # semantics as Compose's :- interpolation; no Docker daemon or env files.
    compose = (ROOT / 'docker-compose.yml').read_text()
    line = next(line for line in compose.splitlines() if 'VITE_CLERK_SOCIAL_PROVIDERS:' in line)
    expression = line.split(': ', 1)[1].strip()
    env = {'VITE_CLERK_SOCIAL_PROVIDERS': override} if override is not None else {}
    result = subprocess.run(['/bin/bash', '-c', 'printf "%s" "' + expression + '"'], env=env, capture_output=True, text=True)
    assert result.returncode == 0
    assert result.stdout == expected
