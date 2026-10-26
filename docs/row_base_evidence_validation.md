# Row-Base Evidence Validation

## Goal

Validate the row-base evidence contract end to end:

- All sources produce the same canonical JSONL meaning.
- Only retrieved rows are allowed to support factual answers.
- Structured support is optional and only applies when explicit `fields` or `typed_fields` are provided.
- When evidence is insufficient, the system must clarify or abstain instead of guessing.

## Canonical JSONL Checks

Use the same logical dataset through all three source paths:

1. CSV upload
2. Excel upload
3. Google Sheets sync

Expected canonical row contract:

```json
{
  "row_id": "stable-id",
  "text": "header_a: value_a\nheader_b: value_b",
  "version": 1,
  "fields": [
    { "k": "header_a", "v": "value_a" }
  ],
  "typed_fields": []
}
```

Checks:

- `row_id` is present for every row.
- `text` is present for every row.
- `version` defaults to a positive integer.
- `fields` are preserved when the source adapter explicitly knows them.
- `typed_fields` stay empty unless upstream explicitly provided them.
- No source-specific typed enrichment appears during sync or worker processing.

## Ingestion Failure Cases

### Invalid JSONL line

Input:

- One malformed JSON line

Expected:

- `uploadDataset` fails with `JSONL_PARSING_ERROR`
- Dataset does not proceed as if ingestion succeeded

### Missing `row_id`

Input:

- A row missing `row_id`

Expected:

- `uploadDataset` fails with `JSONL_PARSING_ERROR`

### Missing `text`

Input:

- A row missing `text`

Expected:

- `uploadDataset` fails with `JSONL_PARSING_ERROR`

### Delete-only incremental upload

Input:

- New full JSONL removes rows but produces no `to_add` or `to_update`

Expected:

- Worker accepts empty work JSONL
- Deleted rows are removed from Qdrant
- Dataset finishes successfully

## Source Adapter Cases

### Google Sheets header-only sheet

Input:

- Sheet with a header row and no data rows

Expected:

- Sync produces zero rows
- No ghost row is created

### Google Sheets blank data rows

Input:

- Sheet with header row and blank rows between data rows

Expected:

- Blank rows are skipped
- Only non-empty rows become canonical JSONL rows

### Source consistency

Input:

- Same table content uploaded as CSV, Excel, and Google Sheets

Expected:

- Resulting `text` meaning matches across all three
- `fields` meaning matches across all three when available
- No source gets special typed behavior

## Answer Grounding Cases

### Direct lookup with evidence

Question:

- Ask for a value explicitly contained in one row

Expected:

- Answer is grounded in retrieved rows
- No external knowledge is added

### Ambiguous question

Question:

- A short or referent-missing follow-up such as "how much is it?" or "that one?"

Expected:

- System asks one short clarifying question
- System does not answer from conversation history alone

### Clear but unsupported question

Question:

- A clear request not supported by any retrieved row

Expected:

- System explicitly says the knowledge base evidence is insufficient
- System does not guess

### Verifier rejection

Setup:

- Force a generated answer that is not fully supported by the selected rows

Expected:

- Final answer is not passed through
- Result becomes clarify or abstain

### Selection empty

Setup:

- Retrieval returns related rows, but evidence selection finds no answerable row

Expected:

- Compose and extract do not continue as if selection succeeded
- Final result becomes clarify or abstain

## Structured Support Cases

### Plain text dataset

Input:

- Rows with only `row_id`, `text`, `version`

Expected:

- Retrieval and evidence answer still work
- Structured execution does not activate

### Dataset with explicit `fields`

Input:

- Rows containing `fields` but no `typed_fields`

Expected:

- Structured lookup and text-based filtering may assist
- Exact numeric/date/boolean operations do not depend on inferred typing

### Dataset with explicit `typed_fields`

Input:

- Rows containing trusted `typed_fields`

Expected:

- Structured count/rank/filter can activate when appropriate
- Exact execution still abstains if full support is unavailable

## Non-Regression Checks

- Locale changes do not change ingestion acceptance for the same row text.
- No answer path uses conversation state or customer profile as factual evidence.
- No answer path returns a "conversation history only" factual answer when KB evidence is absent.
- No worker path silently accepts malformed canonical JSONL.

## Exit Criteria

- All source adapters emit canonical JSONL without semantic drift.
- Worker preserves explicit structure and does not invent typed support.
- Final answers are row-grounded, clarified, or abstained.
- Unsupported exact questions never turn into guessed exact answers.