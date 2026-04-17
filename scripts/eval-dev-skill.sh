#!/usr/bin/env bash
# Evaluates a dev skill description against trigger-eval.json
# Usage: ./scripts/eval-dev-skill.sh [description_override]
# If no override, reads description from .claude/skills/dev/SKILL.md frontmatter
# Outputs: accuracy %, false negative count, false positive count

set -euo pipefail

EVAL_FILE="$(dirname "$0")/../.claude/skills/dev-workspace/trigger-eval.json"
SKILL_FILE="$(dirname "$0")/../.claude/skills/dev/SKILL.md"
RESULTS_DIR="$(dirname "$0")/../.claude/skills/dev-workspace"

# Get description: from argument or from SKILL.md frontmatter
if [[ $# -ge 1 ]]; then
  DESCRIPTION="$1"
else
  # Extract description from SKILL.md frontmatter (between --- markers)
  DESCRIPTION=$(sed -n '/^---$/,/^---$/{ /^description:/{ s/^description: *"//; s/"$//; p; } }' "$SKILL_FILE")
fi

if [[ -z "$DESCRIPTION" ]]; then
  echo "ERROR: Could not extract description" >&2
  exit 1
fi

TOTAL=$(jq length "$EVAL_FILE")
CORRECT=0
FALSE_NEG=0
FALSE_POS=0
DETAILS=""

for i in $(seq 0 $((TOTAL - 1))); do
  QUERY=$(jq -r ".[$i].query" "$EVAL_FILE")
  EXPECTED=$(jq -r ".[$i].should_trigger" "$EVAL_FILE")

  # Build the evaluation prompt
  EVAL_PROMPT="You are a skill-matching system for Claude Code. You must decide if a user's message should trigger a specific skill.

SKILL DESCRIPTION:
${DESCRIPTION}

OTHER AVAILABLE SKILLS (the user has these too — only trigger dev if it's the BEST match):
- image-selector: Curate the best photos from a session folder for a client portfolio gallery
- cover-selector: Pick cover image candidates for a portfolio gallery
- blog-writer: Write a blog post for a portfolio session
- cover-ab-tracker: Track portfolio cover image A/B test performance
- image-compressor: Compress and resize images for web
- story-generator: Generate editorial story copy for a portfolio gallery
- auto-tagger: Generate portfolio tags from visual analysis of gallery images
- instagram-curator: Select images for homepage Instagram grid
- commit-commands:commit: Create a git commit
- claude-api: Build Claude API / Anthropic SDK apps

USER MESSAGE:
${QUERY}

Should the 'dev' skill trigger for this message? Consider:
1. Is this a development/engineering task (building, fixing, designing site features)?
2. Or is this a content/curation task better handled by another skill?

Answer ONLY 'YES' or 'NO'. Nothing else."

  # Call claude with sonnet
  RESPONSE=$(claude -p --bare --model sonnet --no-session-persistence "$EVAL_PROMPT" 2>/dev/null | tr '[:lower:]' '[:upper:]' | tr -d '[:space:]')

  # Normalize response
  if [[ "$RESPONSE" == *"YES"* ]]; then
    PREDICTED="true"
  else
    PREDICTED="false"
  fi

  # Score
  if [[ "$PREDICTED" == "$EXPECTED" ]]; then
    CORRECT=$((CORRECT + 1))
    RESULT="CORRECT"
  elif [[ "$EXPECTED" == "true" && "$PREDICTED" == "false" ]]; then
    FALSE_NEG=$((FALSE_NEG + 1))
    RESULT="FALSE_NEG"
  else
    FALSE_POS=$((FALSE_POS + 1))
    RESULT="FALSE_POS"
  fi

  # Short query preview for details
  SHORT_QUERY="${QUERY:0:60}"
  DETAILS="${DETAILS}\n  ${RESULT}: [expected=${EXPECTED}] ${SHORT_QUERY}..."
done

ACCURACY=$((CORRECT * 100 / TOTAL))

# Output the metric (accuracy %) as the FIRST line for autoresearch parsing
echo "${ACCURACY}"

# Additional details to stderr for debugging
echo "--- Eval Results ---" >&2
echo "Accuracy: ${ACCURACY}% (${CORRECT}/${TOTAL})" >&2
echo "False negatives: ${FALSE_NEG}" >&2
echo "False positives: ${FALSE_POS}" >&2
echo -e "Details:${DETAILS}" >&2
