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

repo_root="$(git rev-parse --show-toplevel)"
registry="$repo_root/release-consumers.json"

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

ruleset_targets_default_branch() {
  local ruleset="$1"
  local default_branch="$2"

  jq -e --arg branch "$default_branch" '
    (.conditions.ref_name.include // []) as $include
    |
    (
      ($include | index("~DEFAULT_BRANCH")) != null
      or
      ($include | index("refs/heads/" + $branch)) != null
    )
  ' <<<"$ruleset" >/dev/null
}

while IFS= read -r full_repo; do
  [[ -z "$full_repo" ]] && continue

  echo
  echo "=== $full_repo ==="

  default_branch="$(gh api "repos/$full_repo" --jq '.default_branch')"
  ruleset_id=""

  while IFS= read -r candidate_id; do
    [[ -z "$candidate_id" ]] && continue
    candidate="$(gh api "repos/$full_repo/rulesets/$candidate_id")"
    if ruleset_targets_default_branch "$candidate" "$default_branch"; then
      ruleset_id="$candidate_id"
      ruleset="$candidate"
      break
    fi
  done < <(
    gh api "repos/$full_repo/rulesets" --paginate \
      --jq '.[] | select(.target == "branch" and .enforcement == "active") | .id'
  )

  if [[ -z "$ruleset_id" ]]; then
    echo "CREATE main ruleset"

    if [[ "$MODE" == "apply" ]]; then
      gh api \
        --method POST \
        -H "Accept: application/vnd.github+json" \
        "repos/$full_repo/rulesets" \
        --input - <<<"$(create_ruleset_payload)" \
        >/dev/null
      echo "✓ created"
    fi

    continue
  fi

  has_app="$(
    jq -r --argjson app "$APP_ID" '
      any(
        (.bypass_actors // [])[];
        .actor_type == "Integration"
        and .actor_id == $app
        and .bypass_mode == "always"
      )
    ' <<<"$ruleset"
  )"

  if [[ "$has_app" == "true" ]]; then
    echo "OK ruleset $ruleset_id already has Renovate Sync bypass"
    continue
  fi

  echo "UPDATE ruleset $ruleset_id with Renovate Sync bypass"

  if [[ "$MODE" == "apply" ]]; then
    gh api \
      --method PUT \
      -H "Accept: application/vnd.github+json" \
      "repos/$full_repo/rulesets/$ruleset_id" \
      --input - <<<"$(update_ruleset_payload "$ruleset")" \
      >/dev/null
    echo "✓ updated"
  fi
done < <(jq -r '.repositories[]' "$registry")

if [[ "$MODE" == "dry-run" ]]; then
  echo
  echo "Dry-run only. Re-run with --apply to write changes."
fi
