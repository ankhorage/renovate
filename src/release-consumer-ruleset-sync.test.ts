import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

const script = readFileSync(
  new URL('../.github/scripts/sync-release-consumer-rulesets.sh', import.meta.url),
  'utf8',
);

describe('release consumer ruleset sync', () => {
  test('uses the canonical release consumer registry without a second repository list', () => {
    expect(script).toContain('release-consumers.json');
    expect(script).toContain("jq -r '.repositories[]'");
    expect(script).not.toContain('ankhorage/apm');
    expect(script).not.toContain('ankhorage/zora-game');
  });

  test('is dry-run by default and requires explicit apply for GitHub mutations', () => {
    expect(script).toContain('MODE="dry-run"');
    expect(script).toContain('== "--apply"');
    expect(script).toContain('Dry-run only. Re-run with --apply to write changes.');
    expect(script).toContain('--method POST');
    expect(script).toContain('--method PUT');
  });

  test('asks GitHub which rulesets actually apply to the default branch', () => {
    expect(script).toContain('rules/branches/$encoded_branch?per_page=100');
    expect(script).toContain("[.[].ruleset_id] | unique[]");
    expect(script).not.toContain('ruleset_targets_default_branch');
    expect(script).toContain('includes_parents=true');
  });

  test('processes every applicable ruleset and refuses unsafe parent mutation', () => {
    expect(script).toContain('done <<<"$applicable_ruleset_ids"');
    expect(script).toContain('if [[ "$source_type" != "Repository" ]]');
    expect(script).toContain('this repository-scoped sync will not mutate organization-wide policy');
    expect(script).toContain('had_blocker=true');
  });

  test('creates canonical protections and preserves existing rules while adding the app bypass', () => {
    expect(script).toContain('type: "deletion"');
    expect(script).toContain('type: "non_fast_forward"');
    expect(script).toContain('type: "pull_request"');
    expect(script).toContain('required_approving_review_count: 1');
    expect(script).toContain('required_review_thread_resolution: true');
    expect(script).toContain('context: "validate"');
    expect(script).toContain('APP_ID=4785564');
    expect(script).toContain('bypass_actors');
    expect(script).toContain('rules');
  });
});
