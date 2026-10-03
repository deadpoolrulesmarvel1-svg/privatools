#!/usr/bin/env node
/**
 * npm audit, failing on any high or critical advisory except the ones
 * audit-exceptions.json lists.
 *
 * This replaces `npm audit --audit-level=high` for the rare advisory with no
 * fix but a breaking upgrade, when the vulnerable code cannot be reached from
 * here. Each exception names its advisory, the packages it may cover, why it
 * is safe, and a date it expires on. It stops covering its advisory on that
 * date, or as soon as npm reports a fix that isn't a major upgrade, so it
 * can't quietly outlive its reason. Anything else high or critical still
 * fails the build, as before.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BLOCKING = new Set(['high', 'critical']);

/** The GHSA id an advisory's URL names, or its URL when it names none. */
function advisoryId(via) {
  const match = /GHSA(?:-[0-9a-z]{4}){3}/i.exec(via.url || '');
  return match ? match[0] : (via.url || `npm advisory ${via.source}`);
}

/** A fix that isn't a major upgrade: `true`, or a fix object not marked major. */
function nonBreakingFix(fixAvailable) {
  return fixAvailable === true || (typeof fixAvailable === 'object' && fixAvailable !== null && !fixAvailable.isSemVerMajor);
}

/**
 * The reasons this `npm audit --json` report should fail the build: one line
 * per high or critical advisory that no current exception covers. Packages
 * vulnerable only through another package (a `via` that is a name) are
 * judged by that package's own advisories.
 */
export function blockingAdvisories(report, exceptions, today = new Date()) {
  const reasons = [];
  for (const [name, entry] of Object.entries(report.vulnerabilities || {})) {
    for (const via of entry.via || []) {
      if (typeof via !== 'object' || !BLOCKING.has(via.severity)) continue;
      const id = advisoryId(via);
      const exception = exceptions[id];
      const where = `${id} in ${name} (${via.severity}): ${via.title}`;
      if (!exception) { reasons.push(where); continue; }
      if (!(exception.packages || []).includes(name)) { reasons.push(`${where}; its exception covers only ${(exception.packages || []).join(', ') || 'no package'}`); continue; }
      if (!exception.expires || new Date(`${exception.expires}T23:59:59Z`) < today) { reasons.push(`${where}; its exception expired on ${exception.expires}`); continue; }
      if (nonBreakingFix(entry.fixAvailable)) reasons.push(`${where}; a fix is available that isn't a major upgrade, so apply it and remove the exception`);
    }
  }
  return reasons;
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const exceptions = JSON.parse(readFileSync(join(here, '..', 'audit-exceptions.json'), 'utf8'));
  // npm audit exits non-zero whenever it finds anything; the JSON is what counts.
  const run = spawnSync('npm', ['audit', '--json'], { cwd: join(here, '..'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let report;
  try { report = JSON.parse(run.stdout); } catch {
    console.error(`npm audit gave no report (exit ${run.status}):\n${run.stderr}`);
    process.exit(2);
  }
  if (report.error) { console.error(`npm audit failed: ${JSON.stringify(report.error)}`); process.exit(2); }
  const blocked = blockingAdvisories(report, exceptions);
  const counts = report.metadata?.vulnerabilities || {};
  console.log(`npm audit: ${JSON.stringify(counts)}`);
  for (const [id, exception] of Object.entries(exceptions)) console.log(`Excepted until ${exception.expires}: ${id} (${exception.packages.join(', ')}). ${exception.reason}`);
  if (blocked.length) {
    console.error(`\n${blocked.length} high or critical advisor${blocked.length === 1 ? 'y blocks' : 'ies block'} the build:\n- ${blocked.join('\n- ')}`);
    process.exit(1);
  }
  console.log('No high or critical advisory without a current exception.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
