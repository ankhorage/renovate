import { satisfies, validRange } from 'semver';

import type { ReleaseWaveNode } from '../../../../types/releaseWave.js';
import type { githubReleaseWaveClient } from './githubReleaseWaveClient.js';

interface PullRequestContent {
  readonly base: { readonly sha: string };
  readonly head: { readonly sha: string };
}

interface GitHubContent {
  readonly content?: string;
  readonly encoding?: string;
}

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
}

/** Verify the grouped candidate's actual manifest, lockfile and sole patch Changeset content. */
export async function githubReleaseWaveConsumerEvidenceAsync(
  client: ReturnType<typeof githubReleaseWaveClient>,
  node: ReleaseWaveNode,
  pull: PullRequestContent,
  files: readonly { readonly filename: string }[],
): Promise<boolean> {
  const changesets = files.filter((file) => isChangeset(file.filename));
  const lockfile = files.find((file) => isLockfile(file.filename));
  if (changesets.length !== 1 || lockfile === undefined || !files.some(isPackageManifest))
    return false;
  try {
    const [baseManifest, headManifest, changeset, lock] = await Promise.all([
      manifestAsync(client, node.repository, pull.base.sha),
      manifestAsync(client, node.repository, pull.head.sha),
      contentAsync(client, node.repository, changesets[0]?.filename, pull.head.sha),
      contentAsync(client, node.repository, lockfile.filename, pull.head.sha),
    ]);
    return (
      hasOnePatchChangeset(changeset, node.packageName) &&
      dependenciesUpdated(baseManifest, headManifest, node) &&
      lockfileRecordsExpectedDependencies(lock, node)
    );
  } catch {
    return false;
  }
}

/** Read one candidate manifest at its immutable Git revision. */
async function manifestAsync(
  client: ReturnType<typeof githubReleaseWaveClient>,
  repository: string,
  revision: string,
): Promise<PackageManifest> {
  return JSON.parse(
    await contentAsync(client, repository, 'package.json', revision),
  ) as PackageManifest;
}

/** Decode the GitHub Contents response only when it is a base64 file payload. */
async function contentAsync(
  client: ReturnType<typeof githubReleaseWaveClient>,
  repository: string,
  path: string | undefined,
  revision: string,
): Promise<string> {
  if (path === undefined) throw new Error('content-path-missing');
  const value = await client.jsonAsync<GitHubContent>(
    '/repos/' + repository + '/contents/' + path + '?ref=' + encodeURIComponent(revision),
  );
  if (value.encoding !== 'base64' || value.content === undefined)
    throw new Error('content-missing');
  return Buffer.from(value.content, 'base64').toString('utf8');
}

/** Require one exact patch declaration for the consumer package, without an intermediate release. */
function hasOnePatchChangeset(content: string, packageName: string): boolean {
  const entries = [...content.matchAll(/^['"]?([^'"\n:]+)['"]?\s*:\s*(major|minor|patch)$/gm)];
  const [entry] = entries;
  return entries.length === 1 && entry?.[1] === packageName && entry[2] === 'patch';
}

/** Require every planned direct update to move forward to the exact verified target range. */
function dependenciesUpdated(
  base: PackageManifest,
  head: PackageManifest,
  node: ReleaseWaveNode,
): boolean {
  return node.expectedDependencies.every((dependency) => {
    const before = dependencyRange(base, dependency.packageName);
    const after = dependencyRange(head, dependency.packageName);
    return (
      before !== undefined &&
      after !== undefined &&
      validRange(after) !== null &&
      satisfies(dependency.version, after) &&
      !satisfies(dependency.version, before)
    );
  });
}

/** Locate a package declaration across direct update sections. */
function dependencyRange(manifest: PackageManifest, packageName: string): string | undefined {
  return (
    findDependency(manifest.dependencies, packageName) ??
    findDependency(manifest.devDependencies, packageName) ??
    findDependency(manifest.optionalDependencies, packageName)
  );
}

/** Read one manifest dependency without indexing untrusted JSON keys. */
function findDependency(
  dependencies: Readonly<Record<string, string>> | undefined,
  packageName: string,
): string | undefined {
  return Object.entries(dependencies ?? {}).find(([name]) => name === packageName)?.[1];
}

/** Ensure Bun's root workspace resolves every direct declaration to its exact planned package. */
function lockfileRecordsExpectedDependencies(lockfile: string, node: ReleaseWaveNode): boolean {
  try {
    const parsed = JSON.parse(lockfile) as {
      readonly packages?: Readonly<Record<string, readonly unknown[]>>;
      readonly workspaces?: Readonly<
        Record<
          string,
          Pick<PackageManifest, 'dependencies' | 'devDependencies' | 'optionalDependencies'>
        >
      >;
    };
    const workspace = parsed.workspaces?.[''];
    return (
      workspace !== undefined &&
      node.expectedDependencies.every((dependency) => {
        const declaration = dependencyRange(workspace, dependency.packageName);
        const packageRecord = parsed.packages?.[dependency.packageName];
        const resolved = packageRecord?.[0];
        return (
          declaration !== undefined &&
          validRange(declaration) !== null &&
          satisfies(dependency.version, declaration) &&
          typeof resolved === 'string' &&
          resolved === dependency.packageName + '@' + dependency.version
        );
      })
    );
  } catch {
    return false;
  }
}

/** Identify the only supported Changeset files; config and README files never qualify. */
function isChangeset(path: string): boolean {
  return /^\.changeset\/[^/]+\.md$/.test(path) && path !== '.changeset/README.md';
}

/** Identify the candidate manifest file. */
function isPackageManifest(file: { readonly filename: string }): boolean {
  return file.filename === 'package.json';
}

/** Keep supported lockfile formats explicit. */
function isLockfile(path: string): boolean {
  return ['bun.lock', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].includes(path);
}
