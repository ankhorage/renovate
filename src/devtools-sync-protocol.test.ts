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
  test('declares one positive canonical protocol', () => {
    expect(protocolManifest.version).toBeInteger();
    expect(protocolManifest.version).toBe(2);
  });

  test('requires the exact published Devtools release to declare its protocol', () => {
    expect(workflow).toContain("if (packageName === '@ankhorage/devtools')");
    expect(workflow).toContain('encodeURIComponent(packageName)');
    expect(workflow).toContain('encodeURIComponent(version)');
    expect(workflow).toContain('releaseManifest?.ankhorage?.renovateSyncProtocol');
    expect(workflow).toContain(
      'The published Devtools release must declare ankhorage.renovateSyncProtocol as a positive integer.',
    );
    expect(workflow).toContain('canonicalProtocol < requiredProtocol');
    expect(workflow).toContain(
      'required_protocol: ${{ steps.registry.outputs.required_protocol }}',
    );
  });

  test('reads protocol from the exact immutable consumer workflow pin', () => {
    expect(workflow).toContain('const pin = /changeset\\.yml@([0-9a-f]{40})/');
    expect(workflow).toContain("path: 'sync-protocol.json'");
    expect(workflow).toContain('ref: pin');
    expect(workflow).toContain('let protocol = 0;');
    expect(workflow).toContain('if (error.status !== 404) throw error;');
  });
});

describe('Devtools sync protocol rollout orchestration', () => {
  test('updates, waits, and propagates inside each consumer matrix entry', () => {
    const rolloutStart = workflow.indexOf('\n  rollout:');
    const rollout = workflow.slice(rolloutStart);
    const updateStart = rollout.indexOf('- name: Update the immutable Renovate workflow first');
    const waitStart = rollout.indexOf(
      "- name: Wait for this repository's compatible immutable Renovate workflow",
    );
    const packageStart = rollout.indexOf(
      '- name: Run Renovate immediately for the released package',
    );

    expect(rolloutStart).toBeGreaterThan(0);
    expect(rollout).toContain('repository: ${{ fromJSON(needs.validate.outputs.repositories) }}');
    expect(updateStart).toBeGreaterThan(0);
    expect(waitStart).toBeGreaterThan(updateStart);
    expect(packageStart).toBeGreaterThan(waitStart);
    expect(rollout).toContain('bun x renovate --enabled-managers=custom.regex');
    expect(rollout).toContain('TARGET_REPOSITORY: ${{ matrix.repository }}');
    expect(rollout).toContain('while (Date.now() < timeoutAt)');
    expect(workflow.match(/while \(Date\.now\(\) < timeoutAt\)/gu)).toHaveLength(1);
    expect(rollout).toContain('const timeoutAt = Date.now() + 60 * 60 * 1000;');
  });

  test('isolates consumer failures instead of gating one global barrier', () => {
    const rolloutStart = workflow.indexOf('\n  rollout:');
    const rollout = workflow.slice(rolloutStart);

    expect(workflow).not.toContain('\n  protocol-barrier:');
    expect(workflow).not.toContain('\n  prepare-protocol:');
    expect(rollout).toContain('fail-fast: false');
    expect(rollout).toContain('RENOVATE_REPOSITORIES: ${{ matrix.repository }}');
    expect(rollout).toContain(
      '"matchPackageNames":["${{ needs.validate.outputs.package_name }}"]',
    );
    expect(workflow).not.toContain('for (const repository of repositories)');
  });

  test('keeps direct consumer writes out of the rollout', () => {
    expect(workflow).not.toContain('git push');
    expect(workflow).not.toContain('pulls.create');
    expect(workflow).not.toContain('git.updateRef');
  });
});
