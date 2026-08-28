import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

interface Dependency {
  readonly datasource: string;
  readonly fileName: string;
  readonly manager: string;
  readonly packageName: string;
  readonly updateType: string;
}

interface PackageRule {
  readonly automerge?: boolean;
  readonly automergeType?: string;
  readonly description: string;
  readonly enabled?: boolean;
  readonly groupName?: string;
  readonly groupSlug?: string;
  readonly matchDatasources?: readonly string[];
  readonly matchFileNames?: readonly string[];
  readonly matchManagers?: readonly string[];
  readonly matchPackageNames?: readonly string[];
  readonly matchUpdateTypes?: readonly string[];
  readonly platformAutomerge?: boolean;
  readonly rangeStrategy?: string;
}

interface CustomManager {
  readonly autoReplaceStringTemplate: string;
  readonly currentValueTemplate: string;
  readonly customType: string;
  readonly datasourceTemplate: string;
  readonly depNameTemplate: string;
  readonly description: string;
  readonly managerFilePatterns: readonly string[];
  readonly matchStrings: readonly string[];
}

interface Preset {
  readonly customManagers?: readonly CustomManager[];
  readonly description: readonly string[];
  readonly extends: readonly string[];
  readonly gitIgnoredAuthors?: readonly string[];
  readonly labels?: readonly string[];
  readonly packageRules: readonly PackageRule[];
}

const consumerPreset = readPreset('../default.json');
const devtoolsOwnerPreset = readPreset('../devtools-owner.json');

describe('consumer preset', () => {
  test('publishes the canonical default-deny policy at the repository root', () => {
    expect(consumerPreset).toMatchObject({
      description: ['Canonical dependency update policy for Ankhorage consumer repositories.'],
      extends: ['config:recommended', ':dependencyDashboard'],
      gitIgnoredAuthors: ['41898282+github-actions[bot]@users.noreply.github.com'],
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

describe('consumer workflow bootstrap', () => {
  test('bootstraps only the legacy immutable consumer workflow pin', () => {
    const [bootstrapManager] = consumerPreset.customManagers ?? [];
    expect(bootstrapManager).toMatchObject({
      autoReplaceStringTemplate:
        'uses: ankhorage/renovate/.github/workflows/changeset.yml@{{{newDigest}}}',
      currentValueTemplate: 'main',
      customType: 'regex',
      datasourceTemplate: 'github-digest',
      depNameTemplate: 'ankhorage/renovate',
      managerFilePatterns: ['/^\\.github\\/workflows\\/renovate\\.yml$/'],
    });

    const [matchString] = bootstrapManager?.matchStrings ?? [];
    expect(matchString).toBeDefined();
    const legacyWorkflow =
      'uses: ankhorage/renovate/.github/workflows/changeset.yml@' +
      'b7305e8f17f9b07238f6b827bbc9f866fd498a0f';
    const releasedWorkflow =
      'uses: ankhorage/renovate/.github/workflows/changeset.yml@' +
      '7d4a5104b94e763ca5be34919f4fcfbb12efd526';
    const matcher = new RegExp(matchString ?? '');

    expect(matcher.test(legacyWorkflow)).toBe(true);
    expect(matcher.test(releasedWorkflow)).toBe(false);
    expect(matcher.test('uses: actions/checkout@b7305e8f17f9b07238f6b827bbc9f866fd498a0f')).toBe(
      false,
    );
  });
});

describe('consumer workflow bootstrap permissions', () => {
  test('enables only the one-time workflow bootstrap dependency', () => {
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
      groupName: 'Ankhorage Renovate workflow bootstrap',
      groupSlug: 'ankhorage-renovate-workflow-bootstrap',
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
    expect(resolveRules(consumerPreset.packageRules, dependency('eslint'))).toEqual({
      enabled: false,
    });
    expect(resolveRules(consumerPreset.packageRules, dependency('@types/bun'))).toEqual({
      enabled: false,
    });
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

function dependency(packageName: string, overrides: Partial<Dependency> = {}): Dependency {
  return {
    datasource: 'npm',
    fileName: 'package.json',
    manager: 'bun',
    packageName,
    updateType: 'minor',
    ...overrides,
  };
}

function branchName(rule: Partial<PackageRule>): string {
  if (typeof rule.groupSlug !== 'string') {
    throw new Error('Grouped policy rules must declare a stable branch identity.');
  }
  return 'renovate/' + rule.groupSlug;
}

function matchesRule(rule: PackageRule, candidate: Dependency): boolean {
  return (
    matches(rule.matchDatasources, candidate.datasource) &&
    matches(rule.matchFileNames, candidate.fileName) &&
    matches(rule.matchManagers, candidate.manager) &&
    matches(rule.matchPackageNames, candidate.packageName) &&
    matches(rule.matchUpdateTypes, candidate.updateType)
  );
}

function matches(patterns: readonly string[] | undefined, value: string): boolean {
  if (patterns === undefined) return true;
  return patterns.some(
    (pattern) =>
      pattern === '*' ||
      pattern === value ||
      (pattern.endsWith('/**') && value.startsWith(pattern.slice(0, -2))),
  );
}

function readPreset(relativePath: string): Preset {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as Preset;
}

function resolveRules(rules: readonly PackageRule[], candidate: Dependency): Partial<PackageRule> {
  return rules
    .filter((rule) => matchesRule(rule, candidate))
    .reduce<Partial<PackageRule>>(
      (resolved, rule) => ({
        ...resolved,
        ...(rule.automerge === undefined ? {} : { automerge: rule.automerge }),
        ...(rule.automergeType === undefined ? {} : { automergeType: rule.automergeType }),
        ...(rule.enabled === undefined ? {} : { enabled: rule.enabled }),
        ...(rule.groupName === undefined ? {} : { groupName: rule.groupName }),
        ...(rule.groupSlug === undefined ? {} : { groupSlug: rule.groupSlug }),
        ...(rule.platformAutomerge === undefined
          ? {}
          : { platformAutomerge: rule.platformAutomerge }),
        ...(rule.rangeStrategy === undefined ? {} : { rangeStrategy: rule.rangeStrategy }),
      }),
      {},
    );
}
