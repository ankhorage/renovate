import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

const workflow = readFileSync(
  new URL('../.github/workflows/reconcile.yml', import.meta.url),
  'utf8',
);

describe('Renovate reconciliation workflow', () => {
  test('runs on policy changes, daily, and manually', () => {
    expect(workflow).toContain('schedule:');
    expect(workflow).toContain("cron: '17 3 * * *'");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('- default.json');
    expect(workflow).toContain('- release-consumers.json');
  });

  test('sweeps the complete managed repository registry', () => {
    expect(workflow).toContain("fs.readFileSync('release-consumers.json', 'utf8')");
    expect(workflow).toContain('repository: ${{ fromJSON(needs.prepare.outputs.repositories) }}');
    expect(workflow).toContain('RENOVATE_REPOSITORIES: ${{ matrix.repository }}');
    expect(workflow).toContain("RENOVATE_AUTODISCOVER: 'false'");
    expect(workflow).toContain("RENOVATE_ONBOARDING: 'false'");
  });

  test('keeps the runner reproducible without throttling Renovate branches', () => {
    expect(workflow).toContain('bun install --frozen-lockfile --ignore-scripts');
    expect(workflow).toContain('max-parallel: 4');
    expect(workflow).toContain('group: renovate-reconciliation');
  });
});
