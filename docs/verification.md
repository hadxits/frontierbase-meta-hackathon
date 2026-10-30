# Verification and submission notes

This document separates inspected implementation, recorded model output and measurements that are still missing. No product model API calls were made to author this README; its illustrated hero uses the built-in image tool.

## Recorded apparel evaluation

- Input: [online_apparel_store_cs_en.csv](../samples/online_apparel_store_cs_en.csv), 60 synthetic English apparel-store FAQs.
- Output: [apparel-evaluation.json](assets/apparel-evaluation.json), a preserved copy of the final recorded development report. It includes the actual tree, extracted topics, final plan, source quotes, mappings and usage.
- Policy checks: [apparel-policy-checks.json](assets/apparel-policy-checks.json), 14 recorded row-scoped phrase checks. These check selected conditions in answers linked to the relevant source IDs; they are not an exhaustive factual or semantic audit.
- Final run: Muse Spark 1.3; 60 source rows linked; eight root choices; 46 answer leaves; 270.147 seconds; 54 model responses reported by the evaluation runner.
- Eight iterative attempts used changing prompts/settings. Seven completed; one stopped at a completion-token limit. Do not interpret these as eight repeated trials of the final configuration.

Examples checked include the 30-minute cancellation window and packing restriction; shipping fees and the $75 threshold; dispatch versus transit; the 30-day return request window and 14-day label period; free eligible exchanges; 7-day damage and 90-day defect reporting including final-sale exceptions; separate warehouse/bank refund periods; gift-card-first refund allocation; and password reset safety.

A source row can support several leaves. A source ID appearing in a leaf does not prove all its facts survived. Zero review flags in a non-conflicting sample does not establish conflict-detection sensitivity.

### Inspect the artifact without API calls

From the repository root, this standard-library-only check recomputes source-row coverage and structural limits on the recorded output:

```sh
python3 - <<'PY'
import csv, json
from pathlib import Path

report = json.loads(Path('docs/assets/apparel-evaluation.json').read_text())
result = report['results'][0]
with Path('samples/online_apparel_store_cs_en.csv').open(newline='') as f:
    expected = {f'CS-{i:03}' for i, _ in enumerate(csv.DictReader(f), 1)}

def visit(node, depth=0):
    children = node.get('children', [])
    assert depth <= 3 and len(children) <= 9
    if children:
        return set().union(*(visit(child, depth + 1) for child in children))
    assert len(node['answer_text']) <= 2500
    return set(node['source_row_ids'])

assert visit(result['tree']) == expected
print('All 60 rows linked; menu and speech-length limits satisfied.')
PY
```

Read the generated answers alongside the CSV to evaluate meaning and menu usability. The saved policy-check statuses are observations from the earlier inspection, not a newly computed model-accuracy score.

## Earlier ARS comparison

[ars-comparison.json](assets/ars-comparison.json) preserves the earlier live comparison used in the README’s “What Changed” section. Both engines received the same five synthetic test cases, totaling 62 rows. These runs preceded the final apparel menu-planning refinements; they are development evidence for the compared versions, not a fresh benchmark of the latest configuration or a general model ranking.

The public summary uses three observed examples: the legacy output omitted the bonus-credit refund exception at the end of a long source, retained email-change and receipt instructions under one menu, and did not flag conflicting return deadlines. The Muse output retained the exception, separated the tasks and flagged the disagreement. Other cases had facts that both engines preserved.

The comparison changed the generation pipeline as well as the model, so it does not isolate model capability. Legacy answer calls used different concurrency, so elapsed times are not a fair latency comparison. Saved answers were rescored for both engines after equivalent spoken-number expressions were recognized; this did not regenerate model responses.

## Local regression evidence

[local-regression.txt](assets/local-regression.txt) contains a local rerun of `npm run test:ars-muse` on Node.js 22.14.0 during this documentation update: 35 tests, 35 passed, zero failed. The tests use mocked services and do not call paid model APIs. Installed dependencies from the adjacent development checkout were supplied through `NODE_PATH`; this was not a clean-clone installation test.

The local suite covers topic omissions and correction, invalid outputs, source preservation, TTS limits, review propagation, job locks, access control, retries and concurrent review/publication. The report is local evidence, not a public CI badge or deployed service certification.

### Public snapshot limitations

Current ignore rules exclude `cloud functions/test/*`, `cloud functions/ARS_MUSE.md`, and sample review Markdown. Those files are not tracked in the inspected commit. The tracked evaluation runner depends on locally excluded fixtures for its default cases; custom normalized JSONL input can be supplied with `--input`. The public test script requires the omitted local test files. This documentation does not change `.gitignore` or silently publish the excluded implementation/tests.

The tracked runner can generate directly with a Meta key, without a deployed mapping worker URL. From `cloud functions`, an explicit Muse-only invocation is:

```sh
npm run eval:ars -- --engine=muse --input=/absolute/path/dataset.jsonl --output=/absolute/path/report.json
```

This is a separately billed live API call, not part of the offline check above. The input must contain JSONL objects with `row_id`, `text` and positive integer `version`; source normalization is upstream of the upload endpoint. The default engine is `both`, so explicitly selecting `muse` avoids invoking the legacy OpenAI comparison. Custom input receives structural checks, not the fixture-specific policy assertions.

The published snapshot also lacks root Firebase deployment configuration. `npm run serve` exists in the package, but a functioning emulator or deployment needs that configuration, credentials and infrastructure. No frontend source is included. This backend snapshot is not advertised as a complete one-command demo.

Recorded JSON, the CSV and this verification document provide inspectable evidence while these reproduction gaps remain open.

## Chat behavior: code-inspected, not benchmarked here

The existing [streamChatRag.js](../cloud%20functions/endpoints/ai/streamChatRag.js) contains semantic question analysis, `clarification_needed`, `shouldClarifyForMissingEvidence`, localized generic clarification fallback, bounded recent history, stored conversation state and answer verification. Its main chat routing references existing OpenAI/Google providers; this is not the new Muse path.

- Recent conversation can supply a missing referent.
- Conditional instructions can request a context-appropriate follow-up.
- A generic fallback asks which item, entity or condition to look up.
- No-evidence instructions prohibit treating conversation state/history as factual knowledge-base evidence.
- [ragHandlers.js](../cloud%20functions/utils/ragHandlers.js) offers escalation only when enabled and excludes clarification turns; [escalateSupportIssue.js](../cloud%20functions/endpoints/support/escalateSupportIssue.js) creates an Issue Track record and retains conversation context.

No labeled chat-intent accuracy, clarification success rate, human-resolution rate, real-world latency or production throughput benchmark is available in this documentation.

## Development provenance

The inspected Git history includes:

- [77c2d10](https://github.com/hadxits/frontierbase-meta-hackathon/commit/77c2d100a5d91dcbbb7816aa923b88f2375b3091), titled `chore: publish pre-existing Frontierbase baseline for Meta hackathon`. This baseline already contains chat clarification, Sheets sync, support escalation and the original ARS grouping implementation.
- [ccbcb3a](https://github.com/hadxits/frontierbase-meta-hackathon/commit/ccbcb3a86fe5f9e44a2b55b4686bc1dcbb631c31), titled `feat: initial draft version of FrontierBase hackathon project`. It introduces the Muse files and other changes. `origin/main` contained this commit at inspection.

This establishes the repository's declared baseline and subsequent implementation, not proof of when every historical line was originally authored. File modification timestamps were not used to claim hackathon provenance. Existing speech, review and publication are presented as reused foundations.

## Visual and link checks

The README uses local static PNG and SVG assets. The FrontierBase logo is copied unchanged from the existing web frontend. The illustrated hero was generated with the built-in image tool; no project model API key was used. SVG diagrams have XML-valid markup and system-font fallbacks; assets contain no scripts, external images or remote font dependencies. The architecture is an SVG, so there are no Mermaid blocks requiring parsing. Images were rendered locally and visually inspected. Markdown/HTML was limited to GitHub-supported images, headings, tables and navigation; no custom CSS was added to the README. Actual GitHub-hosted rendering was not exercised by a publication step.

The README links the product website and displays recorded generation evidence. It does not present fictional dialogue or unfilled demo links as working demos. A deployed screen recording and queue-to-audio validation remain outstanding.
