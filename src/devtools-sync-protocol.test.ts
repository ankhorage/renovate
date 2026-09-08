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
    expect(workflow).toContain('releaseManifest?.ankh?.renovateSyncProtocol');
    expect(workflow).toContain(
      'The published Devtools release must declare ankh.renovateSyncProtocol as a positive integer.',
    );
    expect(workflow).toContain('canonicalProtocol < requiredProtocol');
    expect(workflow).toContain('required-protocol: ${{ steps.registry.outputs.required-protocol }}');
  });

  test('reads protocol from the exact immutable consumer workflow pin', () => {
    expect(workflow).toContain("const pin = /changeset\\.yml@([0-9a-f]{40})/");
    expect(workflow).toContain("path: 'sync-protocol.json'");
    expect(workflow).toContain('ref: pin');
    expect(workflow).toContain('let protocol = 0;');
    expect(workflow).toContain("if (error.status === 404) return 0;");
  });

  test('updates the workflow digest before starting an incompatible Devtools rollout', () => {
    const updateWorkflow = workflow.indexOf('- name: Update the immutable Renovate workflow first');
    const waitForProtocol = workflow.indexOf(
      '- name: Wait for a compatible immutable Renovate workflow',
    );
    const updateDevtools = workflow.indexOf(
      '- name: Run Renovate immediately for the released Devtools version',
    );

    expect(updateWorkflow).toBeGreaterThan(0);
    expect(waitForProtocol).toBeGreaterThan(updateWorkflow);
    expect(updateDevtools).toBeGreaterThan(waitForProtocol);
    expect(workflow).toContain('bun x renovate --enabled-managers=custom.regex');
    expect(workflow).toContain('"matchDatasources":["github-digest"]');
    expect(workflow).toContain('"matchPackageNames":["ankhorage/renovate"]');
    expect(workflow).toContain('Timed out waiting for a compatible immutable Renovate workflow.');
  });

  test('keeps direct consumer writes out of the rollout', () => {
    expect(workflow).not.toContain('git push');
    expect(workflow).not.toContain('pulls.create');
    expect(workflow).not.toContain('git.updateRef');
  });
});
