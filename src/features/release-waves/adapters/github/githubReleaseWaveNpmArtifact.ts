import { createHash } from 'node:crypto';

import type { ReleaseWaveNode } from '../../../../types/releaseWave.js';
import type { GitHubNpmReleaseWaveExecutionAdapterInput } from './GitHubNpmReleaseWaveExecutionAdapter.js';

/*** Download the exact planned artifact and compare its SHA-512 SRI with registry evidence. */
export async function githubReleaseWaveNpmArtifactAsync(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
  node: ReleaseWaveNode,
): Promise<boolean> {
  const expected = node.expectedPublication;
  if (expected === undefined) return false;
  const manifestResponse = await input.requestAsync(
    input.npmRegistryUrl + '/' + encodeURIComponent(node.packageName),
    { headers: { accept: 'application/json' } },
  );
  if (!manifestResponse.ok) return false;
  const manifest = (await manifestResponse.json()) as {
    readonly versions?: Readonly<Record<string, { readonly dist?: NpmDistribution }>>;
  };
  const distribution = manifest.versions?.[expected.version]?.dist;
  if (!validDistribution(input.npmRegistryUrl, distribution)) return false;
  const artifact = await input.requestAsync(distribution.tarball);
  if (!artifact.ok) return false;
  return sha512Artifact(await artifact.arrayBuffer()) === distribution.integrity;
}

interface NpmDistribution {
  readonly integrity?: string;
  readonly tarball?: string;
}

/*** Validate that artifact bytes can only be read from the configured registry origin. */
function validDistribution(
  registry: string,
  distribution: NpmDistribution | undefined,
): distribution is Required<NpmDistribution> {
  return (
    distribution?.integrity !== undefined &&
    distribution.tarball !== undefined &&
    trustedTarball(registry, distribution.tarball)
  );
}

/*** Calculate the npm-compatible SRI digest for the fetched immutable tarball bytes. */
function sha512Artifact(artifact: ArrayBuffer): string {
  return 'sha512-' + createHash('sha512').update(Buffer.from(artifact)).digest('base64');
}

/*** Permit registry artifacts only from the configured registry origin. */
function trustedTarball(registry: string, tarball: string): boolean {
  try {
    return new URL(registry).origin === new URL(tarball).origin;
  } catch {
    return false;
  }
}
