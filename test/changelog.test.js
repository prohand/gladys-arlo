import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const REPO = 'https://github.com/prohand/gladys-arlo';

test('the Unreleased section moves under the released version', () => {
  const before = `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Arlo.\n\n[Unreleased]: ${REPO}/commits/main\n`;
  const after = rollChangelog(before, '1.0.1', '2026-11-12');
  assert.match(after, /## \[Unreleased\]\n\n## \[1\.0\.1\] - 2026-11-12\n\n### Added\n\n- Arlo\./);
  assert.match(after, /\[Unreleased\]: .*\/compare\/v1\.0\.1\.\.\.HEAD/);
  assert.match(after, /\[1\.0\.1\]: .*\/releases\/tag\/v1\.0\.1/);
});

test('an already released version is left untouched', () => {
  const text = '## [Unreleased]\n\n## [1.0.1] - 2026-11-12\n';
  assert.equal(rollChangelog(text, '1.0.1', '2026-11-13'), text);
});
