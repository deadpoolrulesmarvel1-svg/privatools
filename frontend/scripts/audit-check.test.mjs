import test from 'node:test';
import assert from 'node:assert/strict';
import { blockingAdvisories, reportProblem } from './audit-check.mjs';

const GHSA = 'GHSA-vfj7-8cjw-p6xm';
const advisory = (name, ghsa, severity = 'high') => ({
  source: 1, name, dependency: name, title: `${name} problem`, url: `https://github.com/advisories/${ghsa}`, severity, range: '<=3.0.3',
});
const audit = (entries) => ({ vulnerabilities: Object.fromEntries(entries.map(e => [e.name, e])) });
const braces = (fixAvailable = { name: 'tailwindcss', version: '4.3.3', isSemVerMajor: true }) => ({
  name: 'braces', severity: 'high', via: [advisory('braces', GHSA)], fixAvailable,
});
// A package that is only vulnerable through braces: its advisory is braces's.
const micromatch = { name: 'micromatch', severity: 'high', via: ['braces'], fixAvailable: { name: 'tailwindcss', version: '4.3.3', isSemVerMajor: true } };
const exceptions = { [GHSA]: { packages: ['braces'], reason: 'build-time only', expires: '2026-11-15' } };
const today = new Date('2026-10-03T00:00:00Z');

test('a listed advisory with no non-breaking fix does not block, nor do packages vulnerable only through it', () => {
  assert.deepEqual(blockingAdvisories(audit([braces(), micromatch]), exceptions, today), []);
});

test('any other high or critical advisory blocks', () => {
  const other = { name: 'lodash', severity: 'critical', via: [advisory('lodash', 'GHSA-aaaa-bbbb-cccc', 'critical')], fixAvailable: true };
  const blocked = blockingAdvisories(audit([braces(), other]), exceptions, today);
  assert.equal(blocked.length, 1);
  assert.match(blocked[0], /GHSA-aaaa-bbbb-cccc/);
});

test('moderate and low advisories are left to npm audit fix, as --audit-level=high did', () => {
  const moderate = { name: 'semver', severity: 'moderate', via: [advisory('semver', 'GHSA-dddd-eeee-ffff', 'moderate')], fixAvailable: true };
  assert.deepEqual(blockingAdvisories(audit([moderate]), {}, today), []);
});

test('an exception stops covering its advisory once it expires', () => {
  const blocked = blockingAdvisories(audit([braces()]), exceptions, new Date('2026-11-16T00:00:00Z'));
  assert.equal(blocked.length, 1);
  assert.match(blocked[0], /expired on 2026-11-15/);
});

test('an exception stops covering its advisory once a non-breaking fix exists', () => {
  for (const fix of [true, { name: 'braces', version: '3.0.4', isSemVerMajor: false }]) {
    const blocked = blockingAdvisories(audit([braces(fix)]), exceptions, today);
    assert.equal(blocked.length, 1);
    assert.match(blocked[0], /fix is available/);
  }
});

test('an exception covers only the packages it names', () => {
  const elsewhere = { name: 'other-pkg', severity: 'high', via: [advisory('other-pkg', GHSA)], fixAvailable: false };
  const blocked = blockingAdvisories(audit([elsewhere]), exceptions, today);
  assert.equal(blocked.length, 1);
  assert.match(blocked[0], /other-pkg/);
});

test('an expiry that is not a real YYYY-MM-DD date covers nothing', () => {
  for (const expires of ['2026-13-45', '15/11/2026', 'never', '2026-11-15T00:00:00Z', 20261115, '', undefined]) {
    const blocked = blockingAdvisories(audit([braces()]), { [GHSA]: { ...exceptions[GHSA], expires } }, today);
    assert.equal(blocked.length, 1, `expires ${JSON.stringify(expires)} should not cover`);
    assert.match(blocked[0], /no valid expiry/);
  }
});

test('an expiry more than 90 days out covers nothing', () => {
  const blocked = blockingAdvisories(audit([braces()]), { [GHSA]: { ...exceptions[GHSA], expires: '2027-01-15' } }, today);
  assert.equal(blocked.length, 1);
  assert.match(blocked[0], /more than 90 days/);
});

test('an exception with no packages covers nothing, without throwing', () => {
  const blocked = blockingAdvisories(audit([braces()]), { [GHSA]: { reason: 'x', expires: '2026-11-15' } }, today);
  assert.equal(blocked.length, 1);
  assert.match(blocked[0], /covers only no package/);
});

test('a report this check does not recognise is refused, so the gate fails closed', () => {
  const good = { auditReportVersion: 2, vulnerabilities: audit([braces(), micromatch]).vulnerabilities, metadata: { vulnerabilities: { high: 2, critical: 0 } } };
  assert.equal(reportProblem(good), null);
  // npm 6 shape: advisories, no vulnerabilities map.
  assert.match(reportProblem({ advisories: { 1: { severity: 'critical' } }, metadata: { vulnerabilities: { critical: 1 } } }), /not an npm audit v2 report/);
  // A message with no error field.
  assert.match(reportProblem({ message: 'request to registry failed' }), /not an npm audit v2 report/);
  // Counts that don't match the packages listed.
  assert.match(reportProblem({ ...good, metadata: { vulnerabilities: { high: 3, critical: 1 } } }), /counts 4 high or critical/);
});
