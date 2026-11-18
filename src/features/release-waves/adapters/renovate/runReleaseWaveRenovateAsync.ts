/*** Run one selected repository through the controlled non-automerge release-wave Renovate policy. */
export async function runReleaseWaveRenovateAsync(
  repository: string,
  token: string,
): Promise<void> {
  const subprocess = Bun.spawn(['bun', 'x', 'renovate'], {
    env: {
      ...process.env,
      RENOVATE_AUTODISCOVER: 'false',
      RENOVATE_ONBOARDING: 'false',
      RENOVATE_PACKAGE_RULES: releaseWavePackageRules(),
      RENOVATE_PLATFORM: 'github',
      RENOVATE_REPOSITORIES: repository,
      RENOVATE_REQUIRE_CONFIG: 'required',
      RENOVATE_TOKEN: token,
    },
    stderr: 'pipe',
    stdout: 'inherit',
  });
  if ((await subprocess.exited) !== 0)
    throw new Error(
      'Release-wave Renovate execution failed: ' + (await new Response(subprocess.stderr).text()),
    );
}

/*** Preserve the one controlled Ankhorage-only candidate policy for a release wave. */
function releaseWavePackageRules(): string {
  return '[{"matchDatasources":["npm"],"matchPackageNames":["*"],"enabled":false},{"matchDatasources":["npm"],"matchPackageNames":["@ankhorage/**"],"matchUpdateTypes":["major","minor","patch"],"enabled":true,"rangeStrategy":"bump","groupName":"Ankhorage release wave","groupSlug":"ankhorage-release-wave","automerge":false,"platformAutomerge":false,"recreateWhen":"always"}]';
}
