import { createHash } from 'node:crypto';

const artifact = 'published package artifact';
const artifactIntegrity = 'sha512-' + createHash('sha512').update(artifact).digest('base64');

/*** Produce deterministic GitHub/npm provider fixtures without a live mutation target. */
export function githubReleaseWaveResponseFor(url: string): Response {
  const direct = directResponse(url);
  if (direct !== undefined) return direct;
  const content = candidateContentResponse(url);
  if (content !== undefined) return content;
  const release = releaseEvidenceResponse(url);
  if (release !== undefined) return release;
  return new Response(null, { status: 404 });
}

/*** Resolve fixed provider endpoints before content, tag, and registry response families. */
function directResponse(url: string): Response | undefined {
  if (url.includes('/issues?')) return json([{ number: 42 }]);
  if (url.includes('/branches/main/protection'))
    return json({
      enforce_admins: { enabled: true },
      required_pull_request_reviews: { required_approving_review_count: 1 },
      required_status_checks: { contexts: ['validate'] },
    });
  if (url.includes('/pulls/42/reviews'))
    return json([
      { commit_id: 'candidate-sha', state: 'APPROVED', user: { login: 'reviewer', type: 'User' } },
    ]);
  if (url.includes('/pulls/42/files'))
    return json([
      { filename: 'bun.lock' },
      { filename: 'package.json' },
      { filename: '.changeset/example.md' },
    ]);
  if (url.includes('/pulls/42'))
    return json({
      base: { ref: 'main', sha: 'base-sha' },
      head: { ref: 'renovate/ankhorage-release-wave', sha: 'candidate-sha' },
      mergeable: true,
      merge_commit_sha: 'merge-sha',
      mergeable_state: 'clean',
      merged: true,
      merged_at: '2026-11-16T00:00:00Z',
      number: 42,
      state: 'closed',
      user: { login: 'author', type: 'User' },
    });
  if (url.includes('/commits/merge-sha')) return json({ parents: [{ sha: 'candidate-sha' }] });
  if (url.includes('/check-runs'))
    return json({ check_runs: [{ conclusion: 'success', name: 'validate', status: 'completed' }] });
  if (url.includes('/status')) return json({ statuses: [] });
  if (url.includes('/actions/workflows/release.yml/runs'))
    return json({ workflow_runs: [{ conclusion: 'success', head_sha: 'e'.repeat(40) }] });
  if (url.includes('/contents/README.md') || url.includes('/contents/paradox')) return json({});
  if (url === 'https://registry.npm.test/%40ankhorage%2Fexample')
    return json({
      versions: {
        '1.2.4': {
          dist: { integrity: artifactIntegrity, tarball: 'https://registry.npm.test/example.tgz' },
        },
      },
    });
  if (url === 'https://registry.npm.test/example.tgz')
    return new Response(artifact, { status: 200 });
  return undefined;
}

/*** Serve immutable base and candidate content exactly as the GitHub Contents API encodes it. */
function candidateContentResponse(url: string): Response | undefined {
  if (
    url.includes('/contents/package.json?ref=base-sha') ||
    url.includes('/contents/package.json?ref=candidate-sha')
  )
    return content({});
  if (url.includes('/contents/.changeset/example.md?ref=candidate-sha'))
    return content("---\n'@ankhorage/example': patch\n---\n\nRelease wave.\n");
  if (url.includes('/contents/bun.lock?ref=candidate-sha'))
    return content(lockfileFor('@ankhorage/example', '1.2.4'));
  return undefined;
}

/*** Represent immutable tag and ancestry evidence without coupling it to generic fixture routing. */
function releaseEvidenceResponse(url: string): Response | undefined {
  if (url.includes('/git/ref/tags/v1.2.4'))
    return json({ object: { sha: 'tag-object', type: 'tag' } });
  if (url.includes('/git/tags/tag-object'))
    return json({ object: { sha: 'e'.repeat(40), type: 'commit' } });
  return url.includes('/compare/merge-sha...') ? json({ status: 'ahead' }) : undefined;
}

/*** Serialize one fixture response as GitHub/npm JSON. */
function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

/*** Encode a file response in GitHub's documented base64 Contents envelope. */
function content(value: unknown): Response {
  return json({
    content: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString(
      'base64',
    ),
    encoding: 'base64',
  });
}

/*** Build the minimal Bun lockfile graph that binds a root direct declaration to its locator. */
function lockfileFor(packageName: string, version: string): string {
  return JSON.stringify({
    packages: { [packageName]: [packageName + '@' + version] },
    workspaces: { '': { dependencies: { [packageName]: '^' + version } } },
  });
}
