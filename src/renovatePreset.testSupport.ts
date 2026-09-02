import { readFileSync } from 'node:fs';

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

export interface Preset {
  readonly customManagers?: readonly CustomManager[];
  readonly description: readonly string[];
  readonly extends: readonly string[];
  readonly gitIgnoredAuthors?: readonly string[];
  readonly labels?: readonly string[];
  readonly packageRules: readonly PackageRule[];
}

export function dependency(packageName: string, overrides: Partial<Dependency> = {}): Dependency {
  return {
    datasource: 'npm',
    fileName: 'package.json',
    manager: 'bun',
    packageName,
    updateType: 'minor',
    ...overrides,
  };
}

export function branchName(rule: Partial<PackageRule>): string {
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
      (pattern.endsWith('/**') && value.startsWith(pattern.slice(0, -2))) ||
      (pattern.endsWith('*') && value.startsWith(pattern.slice(0, -1))),
  );
}

export function readPreset(relativePath: string): Preset {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as Preset;
}

export function resolveRules(
  rules: readonly PackageRule[],
  candidate: Dependency,
): Partial<PackageRule> {
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
