#!/bin/bash
# Push fix branches for ECC PRs #2497, #2501, #2495, #2498
# Run from the ECC repo root

set -e

# =============================================
# PR #2497 — transcript-context 1M window fix
# =============================================
echo "=== PR #2497 ==="
SOURCE_BLOB=$(gh api repos/nankingjing/ECC/git/blobs -F "content=@scripts/lib/transcript-context-pr2497.js" -f encoding=utf-8 --jq '.sha')
TEST_BLOB=$(gh api repos/nankingjing/ECC/git/blobs -F "content=@tests/lib/transcript-context-pr2497.test.js" -f encoding=utf-8 --jq '.sha')
echo "  Blobs: source=$SOURCE_BLOB test=$TEST_BLOB"

BASE_SHA=$(gh api repos/nankingjing/ECC/git/ref/heads/fix-2461-known-1m-window --jq '.object.sha')
BASE_TREE=$(gh api repos/nankingjing/ECC/git/commits/$BASE_SHA --jq '.tree.sha')

cat > /tmp/tree-2497.json << TREEJSON
{"base_tree":"$BASE_TREE","tree":[{"path":"scripts/lib/transcript-context.js","mode":"100644","type":"blob","sha":"$SOURCE_BLOB"},{"path":"tests/lib/transcript-context.test.js","mode":"100644","type":"blob","sha":"$TEST_BLOB"}]}
TREEJSON
TREE_SHA=$(gh api repos/nankingjing/ECC/git/trees --input /tmp/tree-2497.json --jq '.sha')

cat > /tmp/commit-2497.json << COMMITJSON
{"message":"fix(transcript-context): use exact last-segment match for 1M model detection (#2497)","tree":"$TREE_SHA","parents":["$BASE_SHA"]}
COMMITJSON
COMMIT_SHA=$(gh api repos/nankingjing/ECC/git/commits --input /tmp/commit-2497.json --jq '.sha')

gh api repos/nankingjing/ECC/git/refs -f ref=refs/heads/fix/transcript-context-1m-window -f sha=$COMMIT_SHA --silent 2>/dev/null || \
  echo "  Branch may already exist; skipping"
echo "  Done: $COMMIT_SHA"

# Post comment
gh api repos/affaan-m/ECC/issues/2497/comments -f body="Fixed the substring match to use exact last-segment comparison so future model variants like claude-fable-5-sonnet won't be misclassified. Also renamed the prefix/suffix test and added anti-pattern tests for variant names. Branch: nankingjing/ECC:fix/transcript-context-1m-window" --silent 2>/dev/null || echo "  Comment may already exist"

echo ""
# =============================================
# PR #2501 — plan-canvas markdown fix
# =============================================
echo "=== PR #2501 ==="
BLOB_SHA=$(gh api repos/nankingjing/ECC/git/blobs -F "content=@scripts/lib/plan-canvas/markdown-pr2501.js" -f encoding=utf-8 --jq '.sha')
echo "  Blob: $BLOB_SHA"

BASE_SHA=$(gh api repos/nankingjing/ECC/git/ref/heads/fix-plan-canvas-list-item-drop --jq '.object.sha')
BASE_TREE=$(gh api repos/nankingjing/ECC/git/commits/$BASE_SHA --jq '.tree.sha')

cat > /tmp/tree-2501.json << TREEJSON
{"base_tree":"$BASE_TREE","tree":[{"path":"scripts/lib/plan-canvas/markdown.js","mode":"100644","type":"blob","sha":"$BLOB_SHA"}]}
TREEJSON
TREE_SHA=$(gh api repos/nankingjing/ECC/git/trees --input /tmp/tree-2501.json --jq '.sha')

cat > /tmp/commit-2501.json << COMMITJSON
{"message":"fix(plan-canvas): detect list type from baseIndent-level marker, merge outdented runs (#2501)","tree":"$TREE_SHA","parents":["$BASE_SHA"]}
COMMITJSON
COMMIT_SHA=$(gh api repos/nankingjing/ECC/git/commits --input /tmp/commit-2501.json --jq '.sha')

gh api repos/nankingjing/ECC/git/refs -f ref=refs/heads/fix/plan-canvas-greptile-fixes -f sha=$COMMIT_SHA --silent 2>/dev/null || \
  echo "  Branch may already exist; skipping"
echo "  Done: $COMMIT_SHA"

gh api repos/affaan-m/ECC/issues/2501/comments -f body="Addressed the greptile findings — list-type detection now looks at the baseIndent-level marker instead of the first item, and outdent nesting merges consecutive deeper items into a single parent list instead of creating duplicate sibling blocks. Branch: nankingjing/ECC:fix/plan-canvas-greptile-fixes" --silent 2>/dev/null || echo "  Comment may already exist"

echo ""
# =============================================
# PR #2495 — shell-substitution test gaps
# =============================================
echo "=== PR #2495 ==="
TEST_BLOB=$(gh api repos/nankingjing/ECC/git/blobs -F "content=@tests/lib/shell-substitution-pr2495.test.js" -f encoding=utf-8 --jq '.sha')
echo "  Blob: $TEST_BLOB"

BASE_SHA=$(gh api repos/nankingjing/ECC/git/ref/heads/test-shell-parser --jq '.object.sha')
BASE_TREE=$(gh api repos/nankingjing/ECC/git/commits/$BASE_SHA --jq '.tree.sha')

cat > /tmp/tree-2495.json << TREEJSON
{"base_tree":"$BASE_TREE","tree":[{"path":"tests/lib/shell-substitution.test.js","mode":"100644","type":"blob","sha":"$TEST_BLOB"}]}
TREEJSON
TREE_SHA=$(gh api repos/nankingjing/ECC/git/trees --input /tmp/tree-2495.json --jq '.sha')

cat > /tmp/commit-2495.json << COMMITJSON
{"message":"test(shell-substitution): add null-guard and escaped-substitution tests (#2495)","tree":"$TREE_SHA","parents":["$BASE_SHA"]}
COMMITJSON
COMMIT_SHA=$(gh api repos/nankingjing/ECC/git/commits --input /tmp/commit-2495.json --jq '.sha')

gh api repos/nankingjing/ECC/git/refs -f ref=refs/heads/fix/shell-substitution-greptile-gaps -f sha=$COMMIT_SHA --silent 2>/dev/null || \
  echo "  Branch may already exist; skipping"
echo "  Done: $COMMIT_SHA"

gh api repos/affaan-m/ECC/issues/2495/comments -f body="Added null-guard tests for subshell/brace extractors, and escaped-substitution tests so the security-sensitive path is covered. Branch: nankingjing/ECC:fix/shell-substitution-greptile-gaps" --silent 2>/dev/null || echo "  Comment may already exist"

echo ""
# =============================================
# PR #2498 — project-detect Python direct-ref tests
# =============================================
echo "=== PR #2498 ==="
TEST_BLOB=$(gh api repos/nankingjing/ECC/git/blobs -F "content=@tests/lib/project-detect-pr2498.test.js" -f encoding=utf-8 --jq '.sha')
echo "  Blob: $TEST_BLOB"

BASE_SHA=$(gh api repos/nankingjing/ECC/git/ref/heads/fix/getPythonDeps-tilde-at --jq '.object.sha')
BASE_TREE=$(gh api repos/nankingjing/ECC/git/commits/$BASE_SHA --jq '.tree.sha')

cat > /tmp/tree-2498.json << TREEJSON
{"base_tree":"$BASE_TREE","tree":[{"path":"tests/lib/project-detect.test.js","mode":"100644","type":"blob","sha":"$TEST_BLOB"}]}
TREEJSON
TREE_SHA=$(gh api repos/nankingjing/ECC/git/trees --input /tmp/tree-2498.json --jq '.sha')

cat > /tmp/commit-2498.json << COMMITJSON
{"message":"test(project-detect): add direct-reference (@) and VCS (git+) dep form coverage (#2498)","tree":"$TREE_SHA","parents":["$BASE_SHA"]}
COMMITJSON
COMMIT_SHA=$(gh api repos/nankingjing/ECC/git/commits --input /tmp/commit-2498.json --jq '.sha')

gh api repos/nankingjing/ECC/git/refs -f ref=refs/heads/fix/project-detect-direct-ref-tests -f sha=$COMMIT_SHA --silent 2>/dev/null || \
  echo "  Branch may already exist; skipping"
echo "  Done: $COMMIT_SHA"

gh api repos/affaan-m/ECC/issues/2498/comments -f body="Added test fixtures for direct-reference (@) and VCS URL (git+) dependency forms — the code handles them correctly but they weren't exercised by tests. Branch: nankingjing/ECC:fix/project-detect-direct-ref-tests" --silent 2>/dev/null || echo "  Comment may already exist"

echo ""
echo "All done!"
echo "Branches:"
echo "  nankingjing/ECC:fix/transcript-context-1m-window"
echo "  nankingjing/ECC:fix/plan-canvas-greptile-fixes"
echo "  nankingjing/ECC:fix/shell-substitution-greptile-gaps"
echo "  nankingjing/ECC:fix/project-detect-direct-ref-tests"
