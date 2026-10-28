const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseArgs } = require("node:util");
const OpenAI = require("openai");
const dotenv = require("dotenv");
const { AppConfig } = require("../const/AppConfig");
const statuses = require("../const/ArsMenuStatus");
const { MAX_ARS_ANSWER_LENGTH } = require("../const/ArsLimits");
const { parseJsonlToRows, hasJsonlParseIssues } = require("../utils/jsonl");
const { createMuseCaller } = require("../utils/arsMuseLlm");
const { generateMuseTree } = require("../utils/arsMuseGenerator");

const { values } = parseArgs({
  options: {
    engine: { type: "string", default: "both" },
    case: { type: "string" },
    input: { type: "string" },
    rescore: { type: "boolean", default: false },
    output: { type: "string", default: "../scripts/runReport_ars_quality.json" }
  }
});
const root = path.resolve(__dirname, "..");
const envFile = path.join(root, ".env");
const config = {
  ...(fs.existsSync(envFile) ? dotenv.parse(fs.readFileSync(envFile)) : {}),
  ...process.env
};
const engines = values.engine === "both" ? ["legacy", "muse"] : [values.engine];
if (engines.some((engine) => !["legacy", "muse"].includes(engine))) {
  throw new Error("--engine must be legacy, muse or both");
}
for (const engine of engines) {
  const key = engine === "muse" ? "MODEL_API_KEY" : "OPENAI_API_KEY";
  if (!values.rescore && !config[key]) throw new Error(`${key} is required for ${engine}`);
}

function load(relative, dependencies) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, relative), "utf8"), {
    module,
    exports: module.exports,
    require: (name) => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    }
  });
  return module.exports;
}

function leaves(tree, result = []) {
  if (tree.children?.length) tree.children.forEach((node) => leaves(node, result));
  else if (tree.action === "play") result.push(tree);
  return result;
}

// Check facts only in answers linked to the relevant source rows.
// A matching number in an unrelated answer must not count.
function evaluate(fixture, tree) {
  const nodes = leaves(tree);
  const ids = new Set(nodes.flatMap((node) => node.source_row_ids || []));
  const checks = [];
  const check = (name, pass) => checks.push({ name, pass: Boolean(pass) });
  check(
    "Every source row appears in a leaf",
    fixture.rows.every((row) => ids.has(row.rowId))
  );
  check(
    "Answers fit the TTS limit",
    nodes.every((node) => node.answer_text.length <= MAX_ARS_ANSWER_LENGTH)
  );
  function validMenu(node, depth = 0) {
    return (
      depth <= 3 &&
      (!node.children ||
        (node.children.length <= 9 && node.children.every((child) => validMenu(child, depth + 1))))
    );
  }
  check("At most three levels and nine siblings", validMenu(tree));
  for (const fact of fixture.facts || []) {
    const text = nodes
      .filter((node) => node.source_row_ids?.some((id) => fact.rowIds.includes(id)))
      .map((node) => node.answer_text)
      .join("\n");
    check(
      fact.name,
      fact.patterns.every((pattern) => new RegExp(pattern, "iu").test(text))
    );
  }
  for (const row of fixture.separateRows || []) {
    check(
      `${row} supports multiple menus`,
      nodes.filter((node) => node.source_row_ids?.includes(row)).length > 1
    );
  }
  for (const group of fixture.groups || []) {
    check(
      group.name,
      nodes.some((node) => group.rowIds.every((id) => node.source_row_ids?.includes(id)))
    );
  }
  if (fixture.conflictRows) {
    check(
      "Conflicting policies require joint review",
      nodes.some(
        (node) =>
          node.needs_review && fixture.conflictRows.every((id) => node.source_row_ids?.includes(id))
      )
    );
  }
  if (fixture.clearRows) {
    const clear = nodes.filter((node) =>
      node.source_row_ids?.some((id) => fixture.clearRows.includes(id))
    );
    check(
      "Compatible sources do not require conflict review",
      clear.length && clear.every((node) => !node.needs_review)
    );
  }
  if (fixture.spoken) {
    check(
      "Spoken answers contain no raw markup or URLs",
      nodes.every((node) => !/\||<\/?[a-z]|```|https?:\/\/|\[[^\]]+\]\(/iu.test(node.answer_text))
    );
  }
  return checks;
}

// Keep the legacy model, prompts and grouping unchanged; disable production usage writes.
async function runLegacy(rows, { signal, usage, requests }) {
  class RecordedOpenAI extends OpenAI {
    constructor(options) {
      super({ ...options, timeout: 90_000, maxRetries: 1 });
      const create = this.chat.completions.create.bind(this.chat.completions);
      this.chat.completions.create = async (params) => {
        const input = JSON.parse(params.messages[1].content);
        requests.push({
          stage: input.rows ? "labels" : "answer",
          row_ids: input.rows?.map((row) => row.row_id),
          text_lengths: input.rows?.map((row) => row.text.length),
          source_lengths: input.sources?.map((text) => text.length)
        });
        let response;
        try {
          response = await create(params, { signal });
        } catch (error) {
          usage.failed_calls += 1;
          throw new Error(`Legacy provider request failed (${error.status || error.name})`);
        }
        recordUsage(usage, response.usage);
        return response;
      };
    }
  }
  const grouping = load("utils/arsGrouping.js", { "@/const/ArsMenuStatus": statuses });
  const noop = () => {};
  const llm = load("utils/arsLlm.js", {
    openai: RecordedOpenAI,
    "@/env": { OPENAI_API_KEY: config.OPENAI_API_KEY },
    "@/const/AppConfig": { AppConfig },
    "@/utils/openAiNano": require("../utils/openAiNano"),
    "@/utils/updateTokenUsage": async () => {},
    "@/utils/auditMonthly": { recordAuditMonthly: async () => {} },
    "@/utils/logger": { logInfo: noop, logWarn: noop, logAndCaptureError: noop },
    "@/const/ArsMenuStatus": statuses,
    "@/utils/arsGrouping": grouping
  });
  const labeled = await llm.labelRowsBatch({ tenantId: "local-evaluation", rows });
  const { tree } = grouping.assembleArsTree(labeled);
  const textById = new Map(rows.map((row) => [row.rowId, row.text]));
  const pending = grouping.listLeaves(tree);
  // Match the existing core; billing and Firebase writes are the only disabled parts.
  for (let i = 0; i < pending.length; i += 3) {
    await Promise.all(
      pending.slice(i, i + 3).map(async (leaf) => {
        const answer = await llm.generateLeafAnswer({
          tenantId: "local-evaluation",
          label: leaf.label,
          candidateTexts: leaf.source_row_ids.map((id) => textById.get(id))
        });
        leaf.answer_text = answer.answer_text;
        leaf.needs_review = answer.needs_review || leaf.needs_review;
      })
    );
  }
  return tree;
}

function recordUsage(usage, value = {}) {
  usage.calls += 1;
  usage.input_tokens += Number(value.prompt_tokens || 0);
  usage.output_tokens += Number(value.completion_tokens || 0);
}

async function main() {
  let fixtures;
  if (values.input) {
    const parsed = parseJsonlToRows(fs.readFileSync(path.resolve(values.input), "utf8"));
    if (hasJsonlParseIssues(parsed.issues)) throw new Error("Input has invalid JSONL rows");
    fixtures = [{ id: "local-input", title: path.basename(values.input), rows: parsed.rows }];
  } else {
    fixtures = require("../test/fixtures/arsQualityCases.json");
    if (values.case) fixtures = fixtures.filter((fixture) => fixture.id === values.case);
  }
  if (!fixtures.length) throw new Error("No matching cases");
  if (fixtures.some((fixture) => !fixture.rows.length)) throw new Error("Dataset is empty");
  const output = path.resolve(root, values.output);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (values.rescore) {
    const previous = JSON.parse(fs.readFileSync(output, "utf8"));
    for (const result of previous.results) {
      const fixture = fixtures.find((item) => item.id === result.case);
      if (fixture && result.tree) result.checks = evaluate(fixture, result.tree);
    }
    previous.checks_updated_at = new Date().toISOString();
    fs.writeFileSync(output, JSON.stringify(previous, null, 2));
    console.log(`Rechecked saved answers without model calls: ${output}`);
    if (previous.results.some((result) => result.error || result.checks.some((check) => !check.pass))) {
      process.exitCode = 1;
    }
    return;
  }
  const report = {
    created_at: new Date().toISOString(),
    note: "One run of targeted regression fixtures, not an overall quality score. Firebase, Cloud Tasks and speech playback are not exercised.",
    results: []
  };
  for (const fixture of fixtures) {
    // Both engines see the same rows. Run them together to limit waiting.
    await Promise.all(
      engines.map(async (engine) => {
        console.log(
          JSON.stringify({ case: fixture.id, engine, status: "started", rows: fixture.rows.length })
        );
        const start = Date.now();
        const usage = { calls: 0, failed_calls: 0, input_tokens: 0, output_tokens: 0 };
        const requests = [];
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error("Case timed out")), 30 * 60_000);
        let result;
        try {
          let tree;
          let generation;
          if (engine === "legacy") {
            tree = await runLegacy(fixture.rows, { signal: controller.signal, usage, requests });
            if (usage.failed_calls)
              throw new Error("Legacy used fallback answers after provider failures");
          } else {
            const ask = createMuseCaller({
              apiKey: config.MODEL_API_KEY,
              model: config.MUSE_ARS_MODEL || "muse-spark-1.3",
              signal: controller.signal,
              onUsage: (value) => recordUsage(usage, value)
            });
            let stage;
            generation = await generateMuseTree(fixture.rows, {
              ask,
              onProgress: async (progress, nextStage) => {
                if (stage !== nextStage || nextStage === "answers")
                  console.log(
                    JSON.stringify({ case: fixture.id, engine, stage: nextStage, progress })
                  );
                stage = nextStage;
              }
            });
            tree = generation.tree;
          }
          result = {
            case: fixture.id,
            title: fixture.title,
            engine,
            model:
              engine === "muse"
                ? config.MUSE_ARS_MODEL || "muse-spark-1.3"
                : AppConfig.DEFAULT_OPENAI_LITE_MODEL,
            rows: fixture.rows.length,
            leaf_count: leaves(tree).length,
            review_count: leaves(tree).filter((leaf) => leaf.needs_review).length,
            checks: evaluate(fixture, tree),
            tree,
            ...(generation ? { mapping: generation.report } : { requests })
          };
        } catch (error) {
          result = { case: fixture.id, engine, error: error.message };
        } finally {
          clearTimeout(timer);
        }
        result.elapsed_ms = Date.now() - start;
        result.usage = usage;
        report.results.push(result);
        fs.writeFileSync(output, JSON.stringify(report, null, 2));
        console.log(
          JSON.stringify({
            case: fixture.id,
            engine,
            elapsed_ms: result.elapsed_ms,
            passed: result.checks?.filter((check) => check.pass).length,
            failed: result.checks?.filter((check) => !check.pass).map((check) => check.name),
            error: result.error,
            calls: usage.calls
          })
        );
      })
    );
  }
  console.log(`Report: ${output}`);
  if (report.results.some((result) => result.error || result.checks.some((check) => !check.pass)))
    process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
