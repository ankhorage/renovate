import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

const protocolManifest = JSON.parse(
  readFileSync(new URL('../sync-protocol.json', import.meta.url), 'utf8'),
) as { readonly version?: unknown };
const workflow = readFileSync(
  new URL('../.github/workflows/rollout-devtools-release.yml', import.meta.url),
  'utf8',
);

describe('Devtools sync protocol contract', () => {
  test('declares one positive canonical protocol', () => {
    expect(protocolManifest.version).toBeInteger();
    expect(protocolManifest.version).toBeGreaterThan(0);
  });

  test('requires the exact published Devtools release to declare its protocol', () => {
    expect(workflow).toContain('registry.npmjs.org/%40ankhorage%2Fdevtools/');
    expect(workflow).toContain('releaseManifest?.ankhorage?.renovateSyncProtocol');
    expect(workflow).toContain(
      'The published Devtools release must declare ankhorage.renovateSyncProtocol as a positive integer.',
    );
    expect(workflow).toContain('canonicalProtocol < requiredProtocol');
    expect(workflow).toContain(
      'required-protocol: ${{ steps.registry.outputs.required-protocol }}',
    );
  });

  test('reads protocol from the exact immutable consumer workflow pin', () => {
    expect(workflow).toContain('const pin = /changeset\\.yml@([0-9a-f]{40})/');
    expect(workflow).toContain("path: 'sync-protocol.json'");
    expect(workflow).toContain('ref: pin');
    expect(workflow).toContain('let protocol = 0;');
    expect(workflow).toContain('if (error.status === 404) return 0;');
  });

  test('prepares digest updates without holding matrix runners while PR CI executes', () => {
    const prepareStart = workflow.indexOf('\n  prepare-protocol:');
    const barrierStart = workflow.indexOf('\n  protocol-barrier:');
    const devtoolsStart = workflow.indexOf('\n  renovate:', barrierStart);
    const prepare = workflow.slice(prepareStart, barrierStart);
    const barrier = workflow.slice(barrierStart, devtoolsStart);

    expect(prepareStart).toBeGreaterThan(0);
    expect(barrierStart).toBeGreaterThan(prepareStart);
    expect(devtoolsStart).toBeGreaterThan(barrierStart);
    expect(prepare).toContain('- name: Update the immutable Renovate workflow first');
    expect(prepare).toContain('bun x renovate --enabled-managers=custom.regex');
    expect(prepare).not.toContain('while (Date.now() < timeoutAt)');
    expect(barrier).toContain('- name: Wait for compatible immutable Renovate workflows');
    expect(barrier).toContain('while (Date.now() < timeoutAt)');
    expect(barrier).toContain('Every Devtools consumer now pins a compatible Renovate sync protocol.');
    expect(workflow.match(/while \(Date\.now\(\) < timeoutAt\)/gu)).toHaveLength(1);
  });

  test('gates the Devtools matrix on the single protocol barrier', () => {
    const barrierStart = workflow.indexOf('\n  protocol-barrier:');
    const devtoolsStart = workflow.indexOf('\n  renovate:', barrierStart);
    const devtools = workflow.slice(devtoolsStart);

    expect(workflow).toContain('  protocol-barrier:\n    needs:\n      - validate\n      - prepare-protocol');
    expect(devtools).toContain('needs:\n      - validate\n      - protocol-barrier');
    expect(devtools).toContain('- name: Run Renovate immediately for the released Devtools version');
    expect(devtools).toContain('"matchPackageNames":["@ankhorage/devtools"]');
    expect(workflow.indexOf('- name: Update the immutable Renovate workflow first')).toBeLessThan(
      devtools.indexOf('- name: Run Renovate immediately for the released Devtools version') +
        devtoolsStart,
    );
  });

  test('keeps direct consumer writes out of the rollout', () => {
    expect(workflow).not.toContain('git push');
    expect(workflow).not.toContain('pulls.create');
    expect(workflow).not.toContain('git.updateRef');
  });
});
