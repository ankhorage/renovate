import { readFileSync } from 'node:fs';

import { expect, test } from 'bun:test';

import { resolveTrustedToolchainFixtureVersion } from './renovatePreset.testSupport';

const workflow = readFileSync(
  new URL('../.github/workflows/changeset.yml', import.meta.url),
  'utf8',
);

test('reconciles stale Renovate lockfiles before selecting the exact released toolchain', () => {
  const setup = workflow.indexOf('      - name: Set up the trusted Bun runtime');
  const reconcile = workflow.indexOf(
    '      - name: Reconcile the Renovate lockfile without scripts',
  );
  const resolve = workflow.indexOf('      - name: Resolve the exact selected toolchain');

  expect(setup).toBeGreaterThan(-1);
  expect(reconcile).toBeGreaterThan(setup);
  expect(resolve).toBeGreaterThan(reconcile);
  expect(workflow).toContain(
    'run: bun install --cwd repository --ignore-scripts --lockfile-only --registry=https://registry.npmjs.org',
  );
});

test('trusted toolchain accepts compatible declarations across dependency sections', () => {
  const selected = resolveTrustedToolchainFixtureVersion(
    {
      name: '@ankhorage/apm',
      packageManager: 'bun@1.4.2',
      devDependencies: { '@ankhorage/ankh': '^0.10.4' },
      peerDependencies: { '@ankhorage/ankh': '^0.10.4' },
    },
    `
  workspaces: {
    "": {
      devDependencies: {
        "@ankhorage/ankh": "^0.10.4",
      },
      peerDependencies: {
        "@ankhorage/ankh": "^0.10.4",
      },
    },
  },
  packages: {
    "@ankhorage/ankh": ["@ankhorage/ankh@0.10.4", "", {}],
  },
`,
    '@ankhorage/ankh',
  );

  expect(selected).toBe('0.10.4');
  expect(workflow).toContain('declarations.every((declaration) =>');
});
