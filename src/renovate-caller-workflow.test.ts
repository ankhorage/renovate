import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

const workflow = readFileSync(
  new URL('../.github/workflows/renovate.yml', import.meta.url),
  'utf8',
);

describe('Renovate caller workflow trust', () => {
  test('recognizes both Renovate bot authors', () => {
    expect(workflow).toContain("github.event.pull_request.user.login == 'renovate[bot]'");
    expect(workflow).toContain(
      "github.event.pull_request.user.login == 'ankhorage-renovate-sync[bot]'",
    );
    expect(workflow).not.toContain('app/ankhorage-renovate-sync');
  });
});
