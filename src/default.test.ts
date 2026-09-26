import { describe, expect, test } from 'bun:test';

import { branchName, dependency, readPreset, resolveRules } from './renovatePreset.testSupport';

const consumerPreset = readPreset('../default.json');
const devtoolsOwnerPreset = readPreset('../devtools-owner.json');

describe('consumer preset', () => {
  test('publishes the canonical default-deny policy at the repository root', () => {
    expect(consumerPreset).toMatchObject({
      description: ['Canonical dependency update policy for Ankhorage consumer repositories.'],
      extends: ['config:recommended', ':dependencyDashboard'],
      gitIgnoredAuthors: ['323340348+ankhorage-renovate-sync[bot]@users.noreply.github.com'],
      labels: ['dependencies'],
    });
    expect(consumerPreset.packageRules[0]).toMatchObject({
      enabled: false,
      matchPackageNames: ['*'],
    });
  });

  test('owns the managers required for package and workflow propagation', () => {
    expect(consumerPreset.enabledManagers).toEqual(['bun', 'custom.regex']);
  });

  test('keeps ordinary Ankhorage packages eligible', () => {
    expect(
      resolveRules(consumerPreset.packageRules, dependency('@ankhorage/contracts')),
    ).toMatchObject({
      automerge: true,
      enabled: true,
      groupName: 'Ankhorage libraries',
      groupSlug: 'ankhorage-libraries',
      labels: ['dependencies', 'renovate:automerge'],
      rangeStrategy: 'bump',
      separateMajorMinor: false,
    });
  });

  test('groups the compatible CLI and provider pair', () => {
    for (const packageName of ['@ankhorage/ankh', '@ankhorage/devtools']) {
      expect(resolveRules(consumerPreset.packageRules, dependency(packageName))).toMatchObject({
        automerge: true,
        automergeType: 'pr',
        enabled: true,
        groupName: 'Ankhorage CLI and Devtools toolchain',
        groupSlug: 'ankhorage-cli-and-devtools-toolchain',
        labels: ['dependencies', 'renovate:automerge'],
        platformAutomerge: false,
        rangeStrategy: 'bump',
        separateMajorMinor: false,
      });
    }
  });
});

describe('consumer path discovery', () => {
  test('keeps public examples discoverable while retaining standard ignored paths', () => {
    expect(consumerPreset.ignorePaths).toEqual([
      '**/node_modules/**',
      '**/bower_components/**',
      '**/vendor/**',
      '**/__tests__/**',
      '**/test/**',
      '**/tests/**',
      '**/__fixtures__/**',
    ]);
    expect(consumerPreset.ignorePaths).not.toContain('**/examples/**');
  });
});

describe('consumer update policy', () => {
  test('automerges every validated npm release across patch, minor, and major updates', () => {
    for (const packageName of ['expo', 'react', 'vitest']) {
      for (const updateType of ['patch', 'minor', 'major'] as const) {
        expect(
          resolveRules(
            consumerPreset.packageRules,
            dependency(packageName, {
              fileName: 'examples/expo-showcase/package.json',
              updateType,
            }),
          ),
        ).toMatchObject({
          automerge: true,
          automergeType: 'pr',
          enabled: true,
          labels: ['dependencies', 'renovate:automerge'],
          platformAutomerge: false,
          rangeStrategy: 'bump',
          separateMajorMinor: false,
        });
      }
    }
  });
});

describe('consumer policy migration', () => {
  test('replaces the closed pre-split group with distinct clean branch identities', () => {
    const closedPreSplitBranch = 'renovate/ankhorage-packages';
    const replacementBranches = [
      branchName(resolveRules(consumerPreset.packageRules, dependency('@ankhorage/paradox'))),
      branchName(resolveRules(consumerPreset.packageRules, dependency('@ankhorage/devtools'))),
    ];

    expect(replacementBranches).toEqual([
      'renovate/ankhorage-libraries',
      'renovate/ankhorage-cli-and-devtools-toolchain',
    ]);
    expect(replacementBranches).not.toContain(closedPreSplitBranch);
    expect(new Set(replacementBranches).size).toBe(replacementBranches.length);
  });
});

describe('consumer workflow updates', () => {
  test('tracks every current immutable consumer workflow pin', () => {
    const [workflowManager] = consumerPreset.customManagers ?? [];
    expect(workflowManager).toMatchObject({
      autoReplaceStringTemplate:
        'uses: ankhorage/renovate/.github/workflows/changeset.yml@{{{newDigest}}}',
      currentValueTemplate: 'main',
      customType: 'regex',
      datasourceTemplate: 'github-digest',
      depNameTemplate: 'ankhorage/renovate',
      managerFilePatterns: ['/^\\.github\\/workflows\\/renovate\\.yml$/'],
    });

    const [matchString] = workflowManager?.matchStrings ?? [];
    expect(matchString).toBeDefined();
    const currentWorkflow =
      'uses: ankhorage/renovate/.github/workflows/changeset.yml@' +
      '1721d245371e879301d7a2e5299d1c5790d97459';
    const nextWorkflow =
      'uses: ankhorage/renovate/.github/workflows/changeset.yml@' +
      '7d4a5104b94e763ca5be34919f4fcfbb12efd526';
    const matcher = new RegExp(matchString ?? '');

    expect(matcher.test(currentWorkflow)).toBe(true);
    expect(matcher.test(nextWorkflow)).toBe(true);
    expect(matcher.test('uses: actions/checkout@b7305e8f17f9b07238f6b827bbc9f866fd498a0f')).toBe(
      false,
    );
    expect(matcher.test('uses: ankhorage/renovate/.github/workflows/changeset.yml@main')).toBe(
      false,
    );
  });
});

describe('consumer workflow update permissions', () => {
  test('enables only the canonical workflow digest dependency', () => {
    expect(
      resolveRules(
        consumerPreset.packageRules,
        dependency('ankhorage/renovate', {
          datasource: 'github-digest',
          fileName: '.github/workflows/renovate.yml',
          manager: 'custom.regex',
          updateType: 'digest',
        }),
      ),
    ).toMatchObject({
      automerge: true,
      automergeType: 'pr',
      enabled: true,
      groupName: 'Ankhorage Renovate workflow',
      groupSlug: 'ankhorage-renovate-workflow',
      labels: ['dependencies', 'renovate:automerge'],
      platformAutomerge: false,
    });

    expect(
      resolveRules(
        consumerPreset.packageRules,
        dependency('ankhorage/renovate', {
          datasource: 'github-digest',
          fileName: '.github/workflows/renovate.yml',
          manager: 'github-actions',
          updateType: 'digest',
        }),
      ),
    ).toEqual({ enabled: false });
  });
});

describe('consumer toolchain safeguards', () => {
  test('keeps major CLI and provider upgrades on the latest validated automerge path', () => {
    expect(
      resolveRules(
        consumerPreset.packageRules,
        dependency('@ankhorage/devtools', { updateType: 'major' }),
      ),
    ).toMatchObject({
      automerge: true,
      enabled: true,
      groupName: 'Ankhorage CLI and Devtools toolchain',
      labels: ['dependencies', 'renovate:automerge'],
      separateMajorMinor: false,
    });
  });
});

describe('consumer unrestricted dependency policy', () => {
  test('updates former Devtools-owned consumer dependencies without a special holdback', () => {
    for (const packageName of [
      'bun',
      '@types/bun',
      '@types/node',
      '@eslint/js',
      'eslint',
      'eslint-plugin-react',
      'knip',
      'prettier',
      'prettier-plugin-example',
      'typescript',
      'typescript-eslint',
      '@typescript-eslint/parser',
    ]) {
      expect(
        resolveRules(consumerPreset.packageRules, dependency(packageName, { updateType: 'major' })),
      ).toMatchObject({
        automerge: true,
        enabled: true,
        labels: ['dependencies', 'renovate:automerge'],
        separateMajorMinor: false,
      });
    }
  });

  test('names only the canonical workflow inventory as Devtools-owned', () => {
    const canonicalRule = consumerPreset.packageRules.find((rule) =>
      rule.description.includes('canonical Devtools workflows'),
    );
    expect(canonicalRule).toMatchObject({
      enabled: false,
      matchFileNames: [
        '.github/workflows/ci.yml',
        '.github/workflows/renovate.yml',
        '.github/workflows/release.yml',
      ],
      matchManagers: ['github-actions'],
    });
    expect(canonicalRule?.matchFileNames).not.toContain('.github/workflows/studio-acceptance.yml');
  });
});

describe('Devtools-owner preset', () => {
  const effectiveRules = [...consumerPreset.packageRules, ...devtoolsOwnerPreset.packageRules];

  test('composes with the consumer default-deny boundary', () => {
    expect(devtoolsOwnerPreset.extends).toEqual(['./default']);
  });

  test('enables and groups the complete root Bun package toolchain', () => {
    for (const packageName of ['bun', '@types/bun', 'eslint', 'knip', 'prettier', 'typescript']) {
      expect(resolveRules(effectiveRules, dependency(packageName))).toMatchObject({
        automerge: true,
        automergeType: 'pr',
        enabled: true,
        groupName: 'Devtools-owned toolchain',
        labels: ['dependencies', 'renovate:automerge'],
        platformAutomerge: false,
        rangeStrategy: 'bump',
      });
    }
  });

  test('automerges major owner toolchain upgrades on the latest line', () => {
    expect(
      resolveRules(effectiveRules, dependency('typescript', { updateType: 'major' })),
    ).toMatchObject({
      automerge: true,
      enabled: true,
      groupName: 'Devtools-owned toolchain',
      labels: ['dependencies', 'renovate:automerge'],
      separateMajorMinor: false,
    });
  });

  test('keeps non-owner manifests on the generic all-update policy', () => {
    expect(
      resolveRules(effectiveRules, dependency('eslint', { fileName: 'examples/package.json' })),
    ).toMatchObject({
      automerge: true,
      enabled: true,
      labels: ['dependencies', 'renovate:automerge'],
      separateMajorMinor: false,
    });
  });
});
