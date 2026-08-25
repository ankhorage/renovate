import { readFileSync } from 'node:fs';

import { expect, test } from 'bun:test';

const preset = JSON.parse(
  readFileSync(new URL('../default.json', import.meta.url), 'utf8'),
) as unknown;

test('publishes the canonical Ankhorage preset at the repository root', () => {
  expect(preset).toMatchObject({
    extends: ['config:recommended', ':dependencyDashboard'],
    gitIgnoredAuthors: ['41898282+github-actions[bot]@users.noreply.github.com'],
    labels: ['dependencies'],
    packageRules: [
      {
        automerge: true,
        automergeType: 'pr',
        groupName: 'Ankhorage packages',
        matchDatasources: ['npm'],
        matchPackageNames: ['@ankhorage/**'],
        platformAutomerge: false,
        rangeStrategy: 'bump',
      },
    ],
  });
});
