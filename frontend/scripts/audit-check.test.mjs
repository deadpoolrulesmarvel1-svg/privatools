import test from 'node:test';
import assert from 'node:assert/strict';
import { blockingAdvisories } from './audit-check.mjs';

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
