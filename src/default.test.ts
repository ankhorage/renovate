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

  test('keeps ordinary Ankhorage packages eligible', () => {
    expect(
      resolveRules(consumerPreset.packageRules, dependency('@ankhorage/contracts')),
    ).toMatchObject({
      automerge: true,
      enabled: true,
      groupName: 'Ankhorage libraries',
      groupSlug: 'ankhorage-libraries',
      rangeStrategy: 'bump',
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
        platformAutomerge: false,
        rangeStrategy: 'bump',
      });
    }
  });
});

describe('consumer patch policy', () => {
  test('automerges every validated npm patch without enabling broader upgrades', () => {
    for (const packageName of ['expo', 'react', 'vitest']) {
      expect(
        resolveRules(
          consumerPreset.packageRules,
          dependency(packageName, {
            fileName: 'examples/expo-showcase/package.json',
            updateType: 'patch',
          }),
        ),
      ).toMatchObject({
        automerge: true,
        automergeType: 'pr',
        enabled: true,
        platformAutomerge: false,
      });
    }

    expect(
      resolveRules(
        consumerPreset.packageRules,
        dependency('expo', {
          fileName: 'examples/expo-showcase/package.json',
          updateType: 'minor',
        }),
      ),
    ).toEqual({ enabled: false });
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
  test('requires review for major CLI and provider upgrades', () => {
    expect(
      resolveRules(
        consumerPreset.packageRules,
        dependency('@ankhorage/devtools', { updateType: 'major' }),
      ),
    ).toMatchObject({
      automerge: false,
      enabled: true,
      groupName: 'Ankhorage CLI and Devtools toolchain',
    });
  });

  test('does not independently update consumer-owned Devtools packages', () => {
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
        resolveRules(consumerPreset.packageRules, dependency(packageName, { updateType: 'patch' })),
      ).toMatchObject({ enabled: false });
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
        platformAutomerge: false,
        rangeStrategy: 'bump',
      });
    }
  });

  test('requires review for major owner toolchain upgrades', () => {
    expect(
      resolveRules(effectiveRules, dependency('typescript', { updateType: 'major' })),
    ).toMatchObject({
      automerge: false,
      enabled: true,
      groupName: 'Devtools-owned toolchain',
    });
  });

  test('does not broaden owner permissions beyond the root package manifest', () => {
    expect(
      resolveRules(effectiveRules, dependency('eslint', { fileName: 'examples/package.json' })),
    ).toEqual({ enabled: false });
  });
});
