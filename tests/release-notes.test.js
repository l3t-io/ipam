'use strict';

// Release notes from the changelog, and the tag check the release workflow runs first.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { abschnitt, entfalten, notes, check, appVersion } = require('../scripts/release-notes');

describe('Release notes', () => {
  test('the current version has a changelog entry, and its tag passes the check', () => {
    const v = appVersion();
    assert.equal(check(`v${v}`), v);
    const n = notes(v);
    assert.ok(n.includes(`docker pull ghcr.io/l3t-io/ipam:${v}\``), 'pull line with the exact version');
    assert.doesNotMatch(n, /^## /m, 'only the one section, without the next heading');
  });

  test('a tag that does not match APP_VERSION is refused', () => {
    assert.throws(() => check('v0.0.1'), /does not match APP_VERSION/);
  });

  test('section ends at the next heading; unknown versions give null', () => {
    const log = '# Changelog\n\n## 1.1.0 — x\n\n- a\n\n## 1.0.0\n\n- b\n';
    assert.equal(abschnitt(log, '1.1.0'), '- a');
    assert.equal(abschnitt(log, '1.0.0'), '- b');
    assert.equal(abschnitt(log, '1.0'), null);
  });

  test('hard-wrapped lines are joined, lists, headings and code blocks stay', () => {
    const roh = '### New\n\n- first line\n  continued\n- second\n\nA paragraph\nwrapped.\n\n```yaml\na: 1\nb: 2\n```';
    assert.equal(entfalten(roh), '### New\n\n- first line continued\n- second\n\nA paragraph wrapped.\n\n```yaml\na: 1\nb: 2\n```');
  });
});
