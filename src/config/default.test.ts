import { readFileSync } from 'node:fs';

import { expect, test } from 'bun:test';

const preset = JSON.parse(
  readFileSync(new URL('../../default.json', import.meta.url), 'utf8'),
) as unknown;

test('publishes the canonical Ankhorage preset at the repository root', () => {
  expect(preset).toMatchObject({
    extends: ['config:recommended', ':dependencyDashboard'],
    labels: ['dependencies'],
    packageRules: [
      {
        groupName: 'Ankhorage packages',
        matchDatasources: ['npm'],
        matchPackageNames: ['@ankhorage/**'],
        rangeStrategy: 'update-lockfile',
      },
    ],
  });
});
