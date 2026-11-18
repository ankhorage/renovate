/*** Reject incomplete composition before attempting an authenticated inventory snapshot. */
export function githubReleaseWaveConfiguration(input: {
  readonly apiBaseUrl: string;
  readonly token: string;
}): void {
  if (!input.apiBaseUrl || !input.token)
    throw new Error('Release-wave cohort adapter configuration is incomplete.');
}
