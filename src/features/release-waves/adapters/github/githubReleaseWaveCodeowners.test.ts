import { expect, test } from 'bun:test';

import { githubReleaseWaveClient } from './githubReleaseWaveClient.js';
import {
  githubReleaseWaveCodeownerApprovalPassed,
  githubReleaseWaveCodeownersAsync,
} from './githubReleaseWaveCodeowners.js';

/*** Prove bounded CODEOWNERS matching never promotes unrelated or unverifiable ownership. */
test('matches ordered rooted, directory, and renamed paths only to their individual owners', () => {
  const codeowners = [
    '* @fallback',
    '/src/* @source',
    'docs/ @docs',
    '/src/critical.ts @critical',
  ].join('\n');
  expect(
    githubReleaseWaveCodeownerApprovalPassed(
      [
        { filename: 'src/critical.ts' },
        { filename: 'docs/guide.md' },
        { filename: 'src/renamed.ts', previous_filename: 'docs/old.md' },
      ],
      codeowners,
      new Set(['critical', 'docs', 'source']),
    ),
  ).toBe(true);
  expect(
    githubReleaseWaveCodeownerApprovalPassed(
      [{ filename: 'src/critical.ts' }],
      codeowners,
      new Set(['fallback']),
    ),
  ).toBe(false);
});

test('fails closed for team and unsupported owner patterns', () => {
  expect(
    githubReleaseWaveCodeownerApprovalPassed(
      [{ filename: 'src/critical.ts' }],
      '/src/* @ankhorage/maintainers',
      new Set(['unrelated']),
    ),
  ).toBe(false);
  expect(
    githubReleaseWaveCodeownerApprovalPassed(
      [{ filename: 'src/critical.ts' }],
      '/src/[critical].ts @owner',
      new Set(['owner']),
    ),
  ).toBe(false);
});

test('honors last-match priority and fails closed when any effective grammar is unsupported', () => {
  expect(
    githubReleaseWaveCodeownerApprovalPassed(
      [{ filename: 'src/critical.ts' }],
      ['* @fallback', '/src/* @source', '/src/critical.ts @critical'].join('\n'),
      new Set(['critical']),
    ),
  ).toBe(true);
  expect(
    githubReleaseWaveCodeownerApprovalPassed(
      [{ filename: 'src/critical.ts' }],
      ['* @fallback', '/docs/[a-z].md @docs'].join('\n'),
      new Set(['fallback']),
    ),
  ).toBe(false);
});

test('refuses a truncated tree instead of accepting incomplete CODEOWNERS discovery', async () => {
  const requests: string[] = [];
  const client = githubReleaseWaveClient({
    apiBaseUrl: 'https://api.github.test',
    npmRegistryUrl: 'https://registry.npm.test',
    owner: 'ankhorage',
    releaseWorkflowFile: 'release.yml',
    renovateAsync: () => Promise.resolve(),
    requestAsync: (url) => {
      requests.push(String(url));
      return Promise.resolve(new Response(JSON.stringify({ tree: [], truncated: true })));
    },
    token: 'test-token',
  });

  expect(await githubReleaseWaveCodeownersAsync(client, 'ankhorage/example', 'base-sha')).toBe(
    undefined,
  );
  expect(requests).toEqual([
    'https://api.github.test/repos/ankhorage/example/git/trees/base-sha?recursive=1',
  ]);
});
