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

export interface TrustedToolchainFixtureManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly name: string;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly packageManager: string;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

export const surfaceToolchainFixtureManifest: TrustedToolchainFixtureManifest = {
  name: '@ankhorage/surface',
  packageManager: 'bun@1.3.14',
  devDependencies: {
    '@ankhorage/devtools': '^1.7.0',
  },
};

export const surfaceToolchainFixtureLock = `
  workspaces: {
    "": {
      devDependencies: {
        "@ankhorage/devtools": "^1.7.0",
      },
    },
  },
  packages: {
    "@ankhorage/devtools": ["@ankhorage/devtools@1.7.0", "", {}],
  },
`;

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

export function resolveTrustedToolchainFixtureVersion(
  manifest: TrustedToolchainFixtureManifest,
  lock: string,
  name: string,
  fallbackVersion?: string,
): string {
  const sections = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ];
  const declarations = sections
    .map((section) => Object.entries(section ?? {}).find(([candidate]) => candidate === name)?.[1])
    .filter((value): value is string => typeof value === 'string');
  if (declarations.length === 0 && fallbackVersion) {
    if (parseVersion(fallbackVersion) === null) {
      throw new Error('The fixture fallback must be an exact version.');
    }
    return fallbackVersion;
  }

  const escaped = name.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  const matches = [
    ...lock.matchAll(new RegExp('^    "' + escaped + '": \\["' + escaped + '@([^"]+)"', 'gm')),
  ];
  const [selectedMatch] = matches;
  const declaration = declarations.length === 1 ? declarations.at(0) : undefined;
  const selectedVersion = matches.length === 1 ? selectedMatch?.at(1) : undefined;
  if (typeof selectedVersion !== 'string' || parseVersion(selectedVersion) === null) {
    throw new Error('The fixture does not select one exact root ' + name + ' version.');
  }
  if (typeof declaration !== 'string' || !isCompatibleSelection(declaration, selectedVersion)) {
    throw new Error('The fixture does not declare a compatible root ' + name + ' version range.');
  }
  return selectedVersion;
}

interface ParsedVersion {
  readonly major: string;
  readonly minor: string;
  readonly patch: string;
  readonly prerelease?: string;
  readonly value: string;
}

function isCompatibleSelection(declaration: string, selected: string): boolean {
  const match = /^(?<operator>[~^]?)(?<version>.+)$/u.exec(declaration);
  const operator = match?.groups?.operator;
  const declaredValue = match?.groups?.version;
  if (operator === undefined || declaredValue === undefined) {
    return false;
  }
  const declared = parseVersion(declaredValue);
  const selectedVersion = parseVersion(selected);
  if (declared === null || selectedVersion === null) return false;
  if (operator === '') return declared.value === selectedVersion.value;
  if (!isStableAtOrAfter(declared, selectedVersion)) {
    return false;
  }
  if (operator === '~') {
    return selectedVersion.major === declared.major && selectedVersion.minor === declared.minor;
  }
  return operator === '^' && isCaretCompatibleSelection(declared, selectedVersion);
}

function isStableAtOrAfter(declared: ParsedVersion, selected: ParsedVersion): boolean {
  return (
    declared.prerelease === undefined &&
    selected.prerelease === undefined &&
    compareCoreVersions(selected, declared) >= 0
  );
}

function isCaretCompatibleSelection(declared: ParsedVersion, selected: ParsedVersion): boolean {
  if (declared.major !== '0') return selected.major === declared.major;
  if (declared.minor !== '0') {
    return selected.major === declared.major && selected.minor === declared.minor;
  }
  return compareCoreVersions(selected, declared) === 0;
}

function parseVersion(value: string): ParsedVersion | null {
  const match =
    /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u.exec(
      value,
    );
  const major = match?.groups?.major;
  const minor = match?.groups?.minor;
  const patch = match?.groups?.patch;
  const prerelease = match?.groups?.prerelease;
  if (major === undefined || minor === undefined || patch === undefined) {
    return null;
  }
  return {
    major,
    minor,
    patch,
    ...(prerelease === undefined ? {} : { prerelease }),
    value,
  };
}

function compareCoreVersions(left: ParsedVersion, right: ParsedVersion): number {
  const major = compareNumber(left.major, right.major);
  if (major !== 0) return major;
  const minor = compareNumber(left.minor, right.minor);
  return minor === 0 ? compareNumber(left.patch, right.patch) : minor;
}

function compareNumber(left: string, right: string): number {
  return left.length === right.length ? left.localeCompare(right) : left.length - right.length;
}
