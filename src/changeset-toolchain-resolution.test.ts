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

test('installs consumer dependencies without scripts before bundling capability catalogs', () => {
  const install = workflow.indexOf(
    '      - name: Install consumer dependencies without lifecycle scripts',
  );
  const synchronize = workflow.indexOf(
    '      - name: Synchronize the consumer and prove byte stability',
  );
  const consumerInstall = workflow.slice(install, synchronize);

  expect(install).toBeGreaterThan(
    workflow.indexOf('      - name: Install the exact released toolchain'),
  );
  expect(synchronize).toBeGreaterThan(install);
  expect(consumerInstall).toContain(
    'bun install --cwd repository --ignore-scripts --registry=https://registry.npmjs.org',
  );
  expect(consumerInstall).toContain('test "$before_lock_hash" = "$after_lock_hash"');
  expect(workflow).not.toContain('ln -s "$RUNNER_TEMP/toolchain/node_modules"');
});

test('keeps installed consumer dependencies for both deterministic sync passes', () => {
  const section = workflow.split('      - name: Synchronize the consumer and prove byte stability')[1];
  const [consumerSync = '', ownerSync = ''] = section?.split(
    '      - name: Synchronize the Devtools owner and prove byte stability',
  ) ?? [];
  expect(consumerSync).toContain('mv node_modules "$RUNNER_TEMP/consumer-node-modules"');
  expect(consumerSync).toContain('mv "$RUNNER_TEMP/consumer-node-modules" node_modules');
  expect(consumerSync).toContain(
    'bun "$RUNNER_TEMP/toolchain/run-devtools-command.mjs" status',
  );
  expect(consumerSync).toContain('"$SAFE_REAL_BUN" build src/capabilities/index.ts');
  expect(consumerSync).toContain('exit 1');
  expect(ownerSync).not.toContain('"$RUNNER_TEMP/consumer-node-modules"');
});
