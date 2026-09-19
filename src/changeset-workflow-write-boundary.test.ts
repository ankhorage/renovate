import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

const workflow = readFileSync(
  new URL('../.github/workflows/changeset.yml', import.meta.url),
  'utf8',
);
const [prepareJob = '', afterPrepare = ''] = workflow.split('\n  commit:');
const [commitJob = ''] = afterPrepare.split('\n  merge:');

describe('trusted Renovate write boundary', () => {
  test('limits derived writes to the Devtools-managed inventory', () => {
    for (const path of [
      '.github/workflows/ci.yml',
      '.github/workflows/release.yml',
      '.github/workflows/renovate.yml',
      '.agents/.devtools-manifest.json',
      '.gitignore',
      '.prettierignore',
      '.prettierrc.js',
      '.vscode/extensions.json',
      '.vscode/settings.json',
      'AGENTS.md',
      'bun.lock',
      'eslint.config.mjs',
      'eslint.examples.config.mjs',
      'eslint.local.config.mjs',
      'knip.config.ts',
      'package.json',
      'prettier.local.config.js',
      'renovate.json5',
    ]) {
      expect(workflow).toContain(`    ${path}\n`);
    }
    expect(workflow).not.toContain("'.github/workflows/studio-acceptance.yml'");
    expect(workflow).toContain('Devtools sync changed an unexpected path:');
    expect(workflow).toContain('Devtools sync created an unexpected path:');
    expect(workflow).not.toContain('DEVTOOLS_MANAGED_SKILL_NAMES');
    expect(workflow).toContain("segments[1] === 'skills'");
    for (const job of [prepareJob, commitJob]) {
      expect(job).toContain('const isExactManagedSkillPath = (relativePath) =>');
      expect(job).toContain('declaredManagedSkillFiles.has(relativePath)');
      expect(job).toContain('baseManagedSkillFiles.has(relativePath)');
      expect(job).toContain('Managed skill content does not match its ownership manifest:');
    }
    expect(prepareJob).toContain('Devtools ownership manifest must be a regular file.');
    expect(workflow).toContain('segments[2]) &&');
  });
});

describe('trusted Renovate path inventory', () => {
  test('shares the same trusted path inventories between prepare and commit', () => {
    expect(workflow.match(/^ {2}ANKHORAGE_RENOVATE_CONSUMER_MANAGED_PATHS:/gm)).toHaveLength(1);
    expect(
      workflow.match(/^ {2}ANKHORAGE_RENOVATE_DEVTOOLS_OWNER_MANAGED_PATHS:/gm),
    ).toHaveLength(1);

    for (const job of [prepareJob, commitJob]) {
      expect(job).toContain("'ANKHORAGE_RENOVATE_CONSUMER_MANAGED_PATHS'");
      expect(job).toContain("'ANKHORAGE_RENOVATE_DEVTOOLS_OWNER_MANAGED_PATHS'");
      expect(job).not.toContain('const consumerAllowed = [');
      expect(job).not.toContain('const ownerAllowed = [');
    }
  });
});
