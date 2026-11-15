import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

const protocolManifest = JSON.parse(
  readFileSync(new URL('../sync-protocol.json', import.meta.url), 'utf8'),
) as { readonly version?: unknown };
const workflow = readFileSync(
  new URL('../.github/workflows/rollout-package-release.yml', import.meta.url),
  'utf8',
);

describe('Devtools sync protocol release contract', () => {
  test('retains the current positive protocol for immutable workflow bootstrap', () => {
    expect(protocolManifest.version).toBeInteger();
    expect(protocolManifest.version).toBe(2);
  });

  test('keeps bootstrap state visible to legacy package propagation', () => {
    expect(workflow).toContain("path: '.github/workflows/renovate.yml'");
    expect(workflow).toContain(
      "github.event.pull_request.user.login == 'ankhorage-renovate-sync[bot]'",
    );
    expect(workflow).toContain('waitingRepositories');
  });
});
