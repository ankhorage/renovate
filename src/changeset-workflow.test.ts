import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

import {
  resolveTrustedToolchainFixtureVersion,
  surfaceToolchainFixtureLock,
  surfaceToolchainFixtureManifest,
} from './renovatePreset.testSupport';

const workflow = readFileSync(
  new URL('../.github/workflows/changeset.yml', import.meta.url),
  'utf8',
);
const [prepareJob = '', commitJob = ''] = workflow.split('\n  commit:');
const managedSkillNames =
  /^ {2}DEVTOOLS_MANAGED_SKILL_NAMES: (.+)$/m.exec(workflow)?.[1]?.split(',') ?? [];
describe('trusted Renovate integration', () => {
  test('accepts only same-repository Renovate branches', () => {
    expect(workflow).toContain("context.actor !== 'renovate[bot]'");
    expect(workflow).toContain("pull.head.ref.startsWith('renovate/')");
    expect(workflow).toContain("pull.head.repo?.full_name !== owner + '/' + repo");
    expect(workflow).toContain('artifact.headSha !== pull.head.sha');
  });

  test('isolates untrusted branch preparation from write credentials', () => {
    expect(prepareJob).toContain('contents: read');
    expect(prepareJob).toContain('persist-credentials: false');
    expect(prepareJob).toContain('actions/checkout@11d5960a326750d5838078e36cf38b85af677262');
    expect(commitJob).toContain('contents: read');
    expect(commitJob).not.toContain('actions/checkout');
    expect(commitJob).not.toContain('\n        run: |');
  });
});

describe('trusted Renovate toolchain policy', () => {
  test('uses the exact lock-selected provider without package scripts', () => {
    expect(workflow).toContain("resolveVersion('@ankhorage/devtools')");
    expect(workflow).toContain('"@ankhorage/ankh": process.env.ANKH_VERSION');
    expect(workflow).toContain('"@ankhorage/devtools": process.env.DEVTOOLS_VERSION');
    expect(workflow).toContain('package.json must declare a compatible root');
    expect(workflow).toContain('--ignore-scripts --lockfile-only');
    expect(workflow).toContain('--registry=https://registry.npmjs.org');
    expect(workflow).not.toContain('@latest');
  });

  test('supports the real Surface shape with a canonical exact CLI fallback', () => {
    expect(
      resolveTrustedToolchainFixtureVersion(
        surfaceToolchainFixtureManifest,
        surfaceToolchainFixtureLock,
        '@ankhorage/ankh',
        '0.4.0',
      ),
    ).toBe('0.4.0');
    expect(
      resolveTrustedToolchainFixtureVersion(
        surfaceToolchainFixtureManifest,
        surfaceToolchainFixtureLock,
        '@ankhorage/devtools',
      ),
    ).toBe('1.7.0');
    expect(workflow).toContain("CANONICAL_ANKH_VERSION: '0.4.0'");
    expect(workflow).toContain('if (declarations.length === 0 && fallbackVersion)');
    expect(workflow).toContain(
      "resolveVersion('@ankhorage/ankh', process.env.CANONICAL_ANKH_VERSION)",
    );
  });
});

describe('trusted Renovate toolchain selection', () => {
  test('uses Bun’s exact newer patch selection for a compatible declared range', () => {
    expect(
      resolveTrustedToolchainFixtureVersion(
        {
          name: '@ankhorage/templates',
          packageManager: 'bun@1.4.0',
          dependencies: { '@ankhorage/devtools': '^1.10.1' },
        },
        `
  workspaces: {
    "": {
      dependencies: {
        "@ankhorage/devtools": "^1.10.1",
      },
    },
  },
  packages: {
    "@ankhorage/devtools": ["@ankhorage/devtools@1.10.2", "", {}],
  },
`,
        '@ankhorage/devtools',
      ),
    ).toBe('1.10.2');
  });
});

describe('trusted Renovate invalid toolchain selection', () => {
  test('rejects incompatible ranges and malformed or missing exact lock selections', () => {
    expect(() =>
      resolveTrustedToolchainFixtureVersion(
        {
          ...surfaceToolchainFixtureManifest,
          devDependencies: { '@ankhorage/devtools': '^2.0.0' },
        },
        surfaceToolchainFixtureLock,
        '@ankhorage/devtools',
      ),
    ).toThrow('compatible root');
    expect(() =>
      resolveTrustedToolchainFixtureVersion(
        {
          ...surfaceToolchainFixtureManifest,
          devDependencies: { '@ankhorage/devtools': 'latest' },
        },
        surfaceToolchainFixtureLock,
        '@ankhorage/devtools',
      ),
    ).toThrow('compatible root');
    expect(() =>
      resolveTrustedToolchainFixtureVersion(
        surfaceToolchainFixtureManifest,
        surfaceToolchainFixtureLock.replace(
          '@ankhorage/devtools@1.7.0',
          '@ankhorage/devtools@not-a-version',
        ),
        '@ankhorage/devtools',
      ),
    ).toThrow('exact root');
    expect(() =>
      resolveTrustedToolchainFixtureVersion(
        surfaceToolchainFixtureManifest,
        `${surfaceToolchainFixtureLock}\n    "@ankhorage/devtools": ["@ankhorage/devtools@1.7.0", "", {}],`,
        '@ankhorage/devtools',
      ),
    ).toThrow('exact root');
  });
});

describe('trusted Renovate synchronization', () => {
  test('requires a byte-stable second sync and current status', () => {
    const syncCommand = '"$RUNNER_TEMP/toolchain/node_modules/.bin/ankh" devtools sync .';
    expect(workflow.split(syncCommand)).toHaveLength(3);
    expect(workflow).toContain('test "$first_hash" = "$second_hash"');
    expect(workflow).toContain('"$RUNNER_TEMP/toolchain/node_modules/.bin/ankh" devtools status .');
    expect(prepareJob.split('git add -N -f -- .')).toHaveLength(3);
  });
});

describe('trusted Renovate App authentication', () => {
  test('uses a repository-scoped token for writes and ordinary CI triggers', () => {
    expect(workflow).toContain('renovate_sync_client_id:');
    expect(workflow).toContain('renovate_sync_private_key:');
    expect(commitJob).toContain(
      'actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1',
    );
    expect(commitJob).toContain('owner: ${{ github.repository_owner }}');
    expect(commitJob).toContain('repositories: ${{ github.event.repository.name }}');
    expect(commitJob).toContain('permission-contents: write');
    expect(commitJob).toContain('permission-pull-requests: read');
    expect(commitJob).toContain('permission-workflows: write');
    expect(commitJob).toContain('github-token: ${{ steps.renovate-sync-token.outputs.token }}');
    expect(workflow).not.toContain('createWorkflowDispatch');
  });
});

describe('trusted Devtools owner preparation', () => {
  test('runs Devtools owner synchronization only from the trusted base commit', () => {
    const ownerSyncCommand = 'bun trusted-owner/scripts/sync-renovate-owner.ts sync repository';

    expect(workflow).toContain("owner + '/' + repo === 'ankhorage/devtools'");
    expect(workflow).toContain("filename === 'src/policy/bunRuntimePolicy.ts'");
    expect(workflow).toContain("core.setOutput('base-sha', pull.base.sha)");
    expect(workflow).toContain('ref: ${{ steps.metadata.outputs.base-sha }}');
    expect(workflow).toContain('path: trusted-owner');
    expect(workflow).toContain(
      'bun install --cwd trusted-owner --frozen-lockfile --ignore-scripts',
    );
    expect(workflow.split(ownerSyncCommand)).toHaveLength(3);
    expect(workflow).toContain(
      'bun trusted-owner/scripts/sync-renovate-owner.ts status repository',
    );
    expect(workflow).not.toContain('bun repository/scripts/sync-renovate-owner.ts');
    expect(workflow).not.toContain('bun run --cwd repository');
  });
});

describe('trusted Renovate write boundary', () => {
  test('limits derived writes to the Devtools-managed inventory', () => {
    for (const path of [
      '.github/workflows/ci.yml',
      '.github/workflows/release.yml',
      '.github/workflows/renovate.yml',
      '.agents/.devtools-manifest.json',
      '.prettierrc.js',
      '.vscode/extensions.json',
      '.vscode/settings.json',
      'AGENTS.md',
      'bun.lock',
      'eslint.config.mjs',
      'eslint.local.config.mjs',
      'knip.config.ts',
      'package.json',
      'prettier.local.config.js',
    ]) {
      expect(workflow).toContain("'" + path + "'");
    }
    expect(workflow).not.toContain("'.github/workflows/studio-acceptance.yml'");
    expect(workflow).toContain('Devtools sync changed an unexpected path:');
    expect(workflow).toContain('Devtools sync created an unexpected path:');
    expect(managedSkillNames).toEqual([
      'ankhorage-coding-rules',
      'ankhorage-project-structure',
      'zora-designer',
    ]);
    for (const job of [prepareJob, commitJob]) {
      expect(job).toContain('process.env.DEVTOOLS_MANAGED_SKILL_NAMES');
      expect(job).toContain('declaredManagedSkillFiles.has(relativePath)');
      expect(job).toContain('baseManagedSkillFiles.has(relativePath)');
      expect(job).toContain('Managed skill content does not match its ownership manifest:');
    }
    expect(prepareJob).toContain('Devtools ownership manifest must be a regular file.');
    expect(workflow).toContain('managedSkillRoots.find((root) => relativePath.startsWith(root))');
  });
});

describe('trusted Renovate deletion boundary', () => {
  test('allows deletions only inside exact managed skill roots', () => {
    expect(workflow).toContain('Devtools sync deleted an unexpected path:');
    expect(workflow).toContain("syncMode === 'consumer' && isManagedSkillDeletion(relativePath)");
    expect(workflow).toContain(
      "artifact.syncMode === 'consumer' && isManagedSkillDeletion(relativePath)",
    );
    expect(workflow).toContain("segment !== '' && segment !== '.' && segment !== '..'");
    expect(workflow).not.toContain("relativePath.startsWith('.agents/skills/')");
    expect(workflow).toContain('Managed artifact deletions are invalid.');
    expect(workflow).toContain('Managed artifact contains an invalid deletion.');
    expect(workflow).toContain('Managed artifact exceeds the file-count limit.');
    expect(workflow).toContain('for (const path of managedDeletions)');
    expect(workflow).toContain('sha: null');
    expect(workflow).toContain('managedFiles.size === 0 && managedDeletions.size === 0');
    expect(workflow).toContain('artifact.files.length > 0 || artifact.deletions.length > 0');
    expect(workflow).not.toContain('Devtools sync must not delete managed files.');
  });
});

describe('trusted managed skill ownership', () => {
  test('requires exact manifest ownership for every skill fixture', () => {
    const manifestFiles = new Set([
      '.agents/skills/zora-designer/SKILL.md',
      '.agents/skills/zora-designer/scripts/entry',
    ]);
    const isOwned = (relativePath: string) => {
      const root = managedSkillNames
        .map((name) => `.agents/skills/${name}/`)
        .find((candidate) => relativePath.startsWith(candidate));
      if (root === undefined || !manifestFiles.has(relativePath)) return false;
      return relativePath
        .slice(root.length)
        .split('/')
        .every((segment) => segment !== '' && segment !== '.' && segment !== '..');
    };

    expect(isOwned('.agents/skills/zora-designer/SKILL.md')).toBe(true);
    expect(isOwned('.agents/skills/zora-designer/unowned.md')).toBe(false);
    expect(isOwned('.agents/skills/arbitrary/SKILL.md')).toBe(false);
    expect(isOwned('.agents/skills/zora-designer/../secret.md')).toBe(false);
    expect(workflow).toContain('Managed output must be a regular file:');
    expect(workflow).not.toContain("relativePath.startsWith('.agents/skills/')");
  });
});

describe('trusted Renovate commit boundary', () => {
  test('commits through the Git API and revalidates the exact commit', () => {
    expect(workflow).toContain('github.rest.git.createBlob');
    expect(workflow).toContain('github.rest.git.getCommit');
    expect(workflow).toContain('github.rest.git.createTree');
    expect(workflow).toContain('github.rest.git.createCommit');
    expect(workflow).toContain('github.rest.git.updateRef');
    expect(workflow).toContain('if (currentContent !== content)');
  });

  test('pins every third-party action by immutable commit', () => {
    const uses = [...workflow.matchAll(/^\s*uses: ([^\s#]+)/gm)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) {
      expect(action).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});

describe('trusted Devtools owner write boundary', () => {
  test('creates release metadata for Devtools-owned dependency updates', () => {
    expect(workflow).toContain(
      "const isDevtoolsOwner = owner + '/' + repo === 'ankhorage/devtools';",
    );
    expect(workflow).toContain('Update Devtools-owned dependencies:');
    expect(workflow).toContain('base.packageManager !== effectiveHead.packageManager');
    expect(workflow).toContain("changed.push({ name: 'bun', section: 'packageManager' })");
    expect(workflow).toContain("managedFiles.has('package.json')");
  });

  test('revalidates the sync mode and uses separate owner output permissions', () => {
    expect(workflow).toContain('Managed artifact sync mode no longer matches the pull request.');
    expect(workflow).toContain("'devtools-owner': new Set(ownerAllowed)");
    expect(workflow).toContain("'README.md'");
    expect(workflow).toContain('Managed artifact contains an invalid sync mode.');
  });
});
