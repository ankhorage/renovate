#!/usr/bin/env bash
set -euo pipefail

MODE="dry-run"
if [[ "${1:-}" == "--apply" ]]; then
  MODE="apply"
elif [[ -n "${1:-}" ]]; then
  echo "Usage: $0 [--apply]" >&2
  exit 2
fi

APP_ID=4785564
USER_ID=137318798
API_VERSION=2026-03-10

repo_root="$(git rev-parse --show-toplevel)"
registry="$repo_root/release-consumers.json"
had_blocker=false

if ! command -v gh >/dev/null 2>&1; then
  echo "gh is required." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required." >&2
  exit 1
fi

if [[ ! -f "$registry" ]]; then
  echo "Missing release-consumers.json at $registry" >&2
  exit 1
fi

create_ruleset_payload() {
  jq -n \
    --argjson app "$APP_ID" \
    --argjson user "$USER_ID" '
    {
      name: "main",
      target: "branch",
      enforcement: "active",
      bypass_actors: [
        {
          actor_id: $app,
          actor_type: "Integration",
          bypass_mode: "always"
        },
        {
          actor_id: $user,
          actor_type: "User",
          bypass_mode: "always"
        }
      ],
      conditions: {
        ref_name: {
          include: ["~DEFAULT_BRANCH"],
          exclude: []
        }
      },
      rules: [
        { type: "deletion" },
        { type: "non_fast_forward" },
        {
          type: "pull_request",
          parameters: {
            required_approving_review_count: 1,
            dismiss_stale_reviews_on_push: true,
            required_reviewers: [],
            require_code_owner_review: true,
            dismissal_restriction: {
              enabled: false,
              allowed_actors: []
            },
            require_last_push_approval: true,
            required_review_thread_resolution: true,
            require_extra_approval_for_unattributed_changes: true,
            allowed_merge_methods: ["merge", "squash", "rebase"]
          }
        },
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: false,
            do_not_enforce_on_create: true,
            required_status_checks: [
              { context: "validate" }
            ]
          }
        }
      ]
    }'
}

update_ruleset_payload() {
  local ruleset="$1"
  jq --argjson app "$APP_ID" '
    .bypass_actors =
      (
        [
          (.bypass_actors // [])[]
          | select(
              .actor_type != "Integration"
              or .actor_id != $app
            )
        ]
        +
        [{
          actor_id: $app,
          actor_type: "Integration",
          bypass_mode: "always"
        }]
      )
    |
    {
      name,
      target,
      enforcement,
      bypass_actors,
      conditions,
      rules
    }
  ' <<<"$ruleset"
}

has_renovate_sync_bypass() {
  local ruleset="$1"

  jq -e --argjson app "$APP_ID" '
    any(
      (.bypass_actors // [])[];
      .actor_type == "Integration"
      and .actor_id == $app
      and .bypass_mode == "always"
    )
  ' <<<"$ruleset" >/dev/null
}

while IFS= read -r full_repo; do
  [[ -z "$full_repo" ]] && continue

  echo
  echo "=== $full_repo ==="

  default_branch="$(
    gh api \
      -H "X-GitHub-Api-Version: $API_VERSION" \
      "repos/$full_repo" \
      --jq '.default_branch'
  )"
  encoded_branch="$(jq -rn --arg value "$default_branch" '$value | @uri')"

  # Ask GitHub which active rules actually apply to the default branch. This
  # handles ~ALL, ~DEFAULT_BRANCH, fnmatch includes/excludes, and parent
  # rulesets using GitHub's own matching semantics.
  branch_rules="$(
    gh api \
      -H "X-GitHub-Api-Version: $API_VERSION" \
      "repos/$full_repo/rules/branches/$encoded_branch?per_page=100"
  )"
  applicable_ruleset_ids="$(
    jq -r '[.[].ruleset_id] | unique[]' <<<"$branch_rules"
  )"

  if [[ -z "$applicable_ruleset_ids" ]]; then
    echo "CREATE canonical main ruleset"

    if [[ "$MODE" == "apply" ]]; then
      gh api \
        --method POST \
        -H "Accept: application/vnd.github+json" \
        -H "X-GitHub-Api-Version: $API_VERSION" \
        "repos/$full_repo/rulesets" \
        --input - <<<"$(create_ruleset_payload)" \
        >/dev/null
      echo "✓ created"
    fi

    continue
  fi

  while IFS= read -r ruleset_id; do
    [[ -z "$ruleset_id" ]] && continue

    ruleset="$(
      gh api \
        -H "X-GitHub-Api-Version: $API_VERSION" \
        "repos/$full_repo/rulesets/$ruleset_id?includes_parents=true"
    )"
    source_type="$(jq -r '.source_type' <<<"$ruleset")"
    source="$(jq -r '.source' <<<"$ruleset")"

    if has_renovate_sync_bypass "$ruleset"; then
      echo "OK ruleset $ruleset_id ($source_type: $source) already has Renovate Sync bypass"
      continue
    fi

    if [[ "$source_type" != "Repository" ]]; then
      echo "BLOCKED ruleset $ruleset_id ($source_type: $source) applies to $default_branch but lacks the Renovate Sync bypass." >&2
      echo "Update that parent ruleset explicitly; this repository-scoped sync will not mutate organization-wide policy." >&2
      had_blocker=true
      continue
    fi

    echo "UPDATE ruleset $ruleset_id with Renovate Sync bypass"

    if [[ "$MODE" == "apply" ]]; then
      gh api \
        --method PUT \
        -H "Accept: application/vnd.github+json" \
        -H "X-GitHub-Api-Version: $API_VERSION" \
        "repos/$full_repo/rulesets/$ruleset_id" \
        --input - <<<"$(update_ruleset_payload "$ruleset")" \
        >/dev/null
      echo "✓ updated"
    fi
  done <<<"$applicable_ruleset_ids"
done < <(jq -r '.repositories[]' "$registry")

if [[ "$MODE" == "dry-run" ]]; then
  echo
  echo "Dry-run only. Re-run with --apply to write changes."
fi

if [[ "$had_blocker" == "true" ]]; then
  exit 1
fi
