const { MAX_ARS_ANSWER_LENGTH } = require("../const/ArsLimits");

const string = { type: "string" };
const array = (items) => ({ type: "array", items });
const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false
});

const TOPICS = object({ rows: array(object({ row_id: string, topics: array(string) })) });
const PLAN = object({
  nodes: array(object({ id: string, parent_id: string, label: string, scope: string }))
});
const MAPPING = object({
  rows: array(
    object({
      row_id: string,
      targets: array(
        object({
          menu_id: string,
          topic_indices: array({ type: "integer" }),
          quotes: array(string)
        })
      ),
      review_reason: string
    })
  )
});
const ANSWER = object({
  answer_text: string,
  covered_row_ids: array(string),
  needs_review: { type: "boolean" },
  review_reason: string
});

// Batch by UTF-8 bytes, not character count.
// Oversized rows fail rather than being truncated.
function batches(items, maxBytes = 24_000) {
  const result = [];
  let batch = [];
  let bytes = 2;
  for (const item of items) {
    const size = Buffer.byteLength(JSON.stringify(item), "utf8") + 1;
    if (size > maxBytes)
      throw new Error(`Source item exceeds ${maxBytes} bytes; split the row before generating ARS`);
    if (batch.length && (bytes + size > maxBytes || batch.length >= 20)) {
      result.push(batch);
      batch = [];
      bytes = 2;
    }
    batch.push(item);
    bytes += size;
  }
  if (batch.length) result.push(batch);
  return result;
}

function assertCoverage(actual, expected, label) {
  const ids = new Set(actual);
  const wanted = new Set(expected);
  if (
    ids.size !== actual.length ||
    ids.size !== wanted.size ||
    actual.some((id) => !wanted.has(id))
  ) {
    throw new Error(`${label}: every source ID must appear exactly once`);
  }
}

// Check parent links and the three-level, nine-option limit before building the tree.
function validatePlan({ nodes }) {
  if (!nodes.length || nodes.length > 819) throw new Error("Plan must have 1 to 819 nodes");
  const byId = new Map();
  const siblings = new Map();
  for (const node of nodes) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(node.id) || byId.has(node.id)) {
      throw new Error(`Invalid or duplicate menu ID: ${node.id}`);
    }
    if (!node.label.trim() || !node.scope.trim() || node.label === "__ars_other__") {
      throw new Error(`Menu ${node.id} needs a meaningful label and scope`);
    }
    byId.set(node.id, node);
    const group = siblings.get(node.parent_id) || [];
    group.push(node);
    siblings.set(node.parent_id, group);
  }
  for (const [parent, group] of siblings) {
    if (group.length > 9) throw new Error(`Menu ${parent || "root"} has more than 9 children`);
    const labels = group.map((n) =>
      n.label.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()
    );
    if (new Set(labels).size !== labels.length)
      throw new Error(`Duplicate sibling labels under ${parent || "root"}`);
  }
  for (const node of nodes) {
    const visited = new Set();
    let current = node;
    while (current) {
      if (visited.has(current.id)) throw new Error(`Menu cycle at ${current.id}`);
      visited.add(current.id);
      if (visited.size > 3) throw new Error(`Menu ${node.id} exceeds depth 3`);
      if (!current.parent_id) break;
      current = byId.get(current.parent_id);
      if (!current) throw new Error(`Unknown parent for ${node.id}`);
    }
  }
  return { byId, siblings };
}

// A row can cover multiple topics, so row ID coverage alone can hide omissions.
// Check topic assignments and require exact quotes from the source.
function validateMapping(result, rows, leafIds) {
  assertCoverage(
    result.rows.map((r) => r.row_id),
    rows.map((r) => r.row_id),
    "Mapping"
  );
  const source = new Map(rows.map((r) => [r.row_id, r]));
  for (const row of result.rows) {
    if (!row.targets.length) throw new Error(`Unresolved source row: ${row.row_id}`);
    const original = source.get(row.row_id);
    const coveredTopics = new Set();
    const seen = new Set();
    for (const target of row.targets) {
      if (!leafIds.has(target.menu_id) || seen.has(target.menu_id)) {
        throw new Error(`Invalid or duplicate target ${target.menu_id} for ${row.row_id}`);
      }
      seen.add(target.menu_id);
      if (
        !target.topic_indices.length ||
        new Set(target.topic_indices).size !== target.topic_indices.length ||
        target.topic_indices.some(
          (index) => !Number.isInteger(index) || index < 0 || index >= original.topics.length
        )
      ) {
        throw new Error(`Invalid topic indices for ${row.row_id}`);
      }
      target.topic_indices.forEach((index) => coveredTopics.add(index));
      if (
        !target.quotes.length ||
        target.quotes.some((q) => !q.trim() || !original.text.includes(q))
      ) {
        throw new Error(`Evidence for ${row.row_id} must quote the source exactly`);
      }
    }
    if (coveredTopics.size !== original.topics.length) {
      throw new Error(`Every topic must be mapped for source row: ${row.row_id}`);
    }
  }
}

function validateAnswer(answer, rowIds) {
  assertCoverage(answer.covered_row_ids, rowIds, "Answer evidence");
  if (answer.answer_text.trim().length > MAX_ARS_ANSWER_LENGTH)
    throw new Error(
      `Spoken answer exceeds ${MAX_ARS_ANSWER_LENGTH} characters; shorten without losing conditions, or return a short supported answer requiring review`
    );
  if (!answer.answer_text.trim() && !answer.needs_review)
    throw new Error("Empty answer must require review");
  if (answer.needs_review && !answer.review_reason.trim())
    throw new Error("A review reason is required");
  if (!answer.needs_review && answer.review_reason.trim())
    throw new Error("A review reason must set needs_review");
}

// Creating menus per batch can split the same topic into multiple branches.
// Plan the whole menu first, then assign each row's evidence to those menu IDs.
async function generateMuseTree(rows, { ask, onProgress = async () => {}, answerConcurrency = 1 }) {
  if (![1, 2].includes(answerConcurrency)) throw new Error("Answer concurrency must be 1 or 2");
  if (!rows.length) throw new Error("Dataset is empty");
  const ids = rows.map((r) => r.rowId);
  if (
    ids.some((id) => !id) ||
    new Set(ids).size !== ids.length ||
    rows.some((r) => !r.text?.trim())
  ) {
    throw new Error("Source rows must have unique IDs and non-empty text");
  }
  if (Buffer.byteLength(JSON.stringify(rows), "utf8") > 2 * 1024 * 1024) {
    throw new Error("ARS source exceeds the 2 MiB generation limit");
  }
  const sourceRows = rows.map((r) => ({ row_id: r.rowId, text: r.text }));
  const rowBatches = batches(sourceRows);
  const topics = [];
  await onProgress(5, "topics");
  for (let i = 0; i < rowBatches.length; i += 1) {
    const batch = rowBatches[i];
    const result = await ask({
      name: "ars_topics",
      schema: TOPICS,
      data: { rows: batch },
      instruction:
        "Read every complete source row. List its distinct customer-support topics, retaining distinguishing conditions and exceptions in concise topic descriptions. Do not omit rows or invent policy. One row may contain several independently actionable customer intents. Keep qualifications, safety warnings, definitions and fallback steps attached to the intent they qualify; do not turn each supporting detail into a separate topic.",
      validate: (value) => {
        assertCoverage(
          value.rows.map((r) => r.row_id),
          batch.map((r) => r.row_id),
          "Topics"
        );
        if (value.rows.some((r) => !r.topics.length || r.topics.some((t) => !t.trim())))
          throw new Error("Every row needs a topic");
      }
    });
    topics.push(...result.rows);
    await onProgress(5 + Math.round((20 * (i + 1)) / rowBatches.length), "topics");
  }

  await onProgress(26, "planning");
  const proposedPlan = await ask({
    name: "ars_plan",
    schema: PLAN,
    data: { topics },
    validate: validatePlan,
    instruction:
      `Design a telephone self-service menu from ALL supplied customer intents, not a table of contents for the source documents. Return a flat list of nodes with unique IDs, parent_id empty for root children, short labels in the source language, and explicit scopes. At most 3 levels and 9 siblings. Derive the destinations from the supplied intents; no predefined industry taxonomy.
A caller must recognize the choice that solves their current problem without knowing the company's departments or reading the source. Use natural, brief customer-goal labels, preferably an action or a recognizable problem. Avoid umbrella nouns, redundant category-plus-subcategory wording, and labels listing separate goals with 'and', slashes or commas. This applies to EVERY level, especially root children: a bare subject or department name is not an acceptable label. Each label should naturally complete the caller thought "I want to ..." or "I have a problem with ..." without needing to say that whole sentence. Parent labels may summarize genuinely related goals, but must not collect unrelated leftovers. Do not use an artificial verb to disguise a category; the action must make sense to the caller. Labels must cover ALL intents routed underneath them, not substitute a narrower or different task simply because the same website tool is used.
Give each independently actionable intent one clear primary destination. Siblings must have distinguishable selection criteria; define their included intents and boundaries in scope. Group paraphrases and the steps, conditions or exceptions needed for the SAME resolution. Keep different problems separate when they require different next actions, even if they share vocabulary or a policy. In particular, do not merge an investigation into a missing item with an eligibility or inspection decision. A request to start an action and a request to check its outcome need separate destinations when their next steps substantially differ. Questions about timing and status of the same process should normally share one destination when the same short answer and next action resolve both. Do not create sibling destinations for near-synonyms, a general question and its routine clarification, or the same resolution expressed differently.
When similar wording occurs at different journey stages, include enough context in the labels to distinguish them. Labels must describe the actual answer scope, including whether it starts a request or only describes mailing an already-approved parcel.
Do not minimize menu count as a goal. Use a deeper branch when needed to separate choices within the limits, but avoid redundant one-child folders. Each leaf should complete one customer job, not reproduce an individual FAQ headline. Preconditions, how-to steps, fees and deadlines for doing the same job normally belong in ONE leaf answer. Different facts or question wording do not imply different resolutions. Split only when the customer wants a genuinely different outcome, needs a different procedure, or the combined answer would be too long to use. Do not turn every source row into its own button. Each leaf should support a focused spoken answer, not a long omnibus FAQ. Before returning, walk a caller with each supplied intent through the labels: remove noun-only root headings, awkward or misleading action labels, ambiguous sibling choices, unsupported destinations, duplicate destinations and catch-all bundles. Ask whether someone hearing ONLY the labels would know which number to press. Do not use specialist terms that change the source meaning, such as replacing an ordinary merchant refund with a bank dispute. Preserve every supplied intent and its qualifying conditions.`
  });
  await onProgress(28, "reviewing_plan");
  const plan = await ask({
    name: "ars_plan_review",
    reasoningEffort: "high",
    maxCompletionTokens: 32_768,
    schema: PLAN,
    data: { topics, proposed_plan: proposedPlan.nodes },
    validate: validatePlan,
    instruction:
      `Audit this telephone menu against every supplied customer intent and return a corrected complete plan. Keep the source language, unique IDs, valid parent IDs, at most three levels and nine siblings.
Use short, natural customer-goal labels. A root must describe ONE meaningful goal shared by all descendants, not a list of leftover subjects. Every leaf label must accurately describe the source question and the help available; do not imply an action or entitlement the evidence does not support. Every intent must have an obvious route when a caller hears only the labels.
Check parent scope carefully: a child that occurs at a different stage of the customer journey must not be hidden under a stage-specific parent. Broaden the parent to a genuinely shared goal or move the child. Do not narrow a label to one tool or mechanism if it serves other intents.
A leaf completes one customer job. Combine prerequisites, steps, fees, deadlines and ordinary status for that same job when a concise answer can handle them. Keep distinct requested outcomes and exception procedures separate. Do not copy one button per FAQ or merge merely to reduce the count. Remove duplicate routes and single-child folders.
Audit potentially confusing labels against the timing of the source request: distinguish changing an order before dispatch from reporting a wrong item after delivery, using source-derived wording rather than generic wrong-item labels. This is a general journey-stage distinction, not a fixed menu taxonomy. Where eligibility and the steps to start the same request fit one focused answer, prefer one destination; otherwise give the choices clearly distinct purposes. A caller must not need to open two siblings to discover which applies.
Check all branches, not just their wording. Preserve every intent and relevant exception. Return the corrected plan only. Derive the structure from this data; no predefined industry categories.`
  });
  const { byId, siblings } = validatePlan(plan);
  const leaves = plan.nodes.filter((n) => !siblings.has(n.id));
  const leafIds = new Set(leaves.map((n) => n.id));
  const pathFor = (node) => {
    const path = [node];
    while (path[0].parent_id) path.unshift(byId.get(path[0].parent_id));
    return path;
  };
  const menus = leaves.map((n) => ({
    id: n.id,
    path: pathFor(n).map((p) => p.label),
    scope: n.scope
  }));
  const mappings = [];
  const topicsByRow = new Map(topics.map((row) => [row.row_id, row.topics]));
  await onProgress(30, "mapping");
  for (let i = 0; i < rowBatches.length; i += 1) {
    const batch = rowBatches[i].map((row) => ({ ...row, topics: topicsByRow.get(row.row_id) }));
    const result = await ask({
      name: "ars_mapping",
      schema: MAPPING,
      data: { menus, rows: batch },
      instruction:
        "Assign every source row to one or more existing leaf menu IDs. Each target must list topic_indices: the zero-based indices of the row's topics it covers. Every topic index must be covered, including secondary topics. For each target include exact verbatim source quotes supporting those topics, including relevant conditions and exceptions. If a restriction has exceptions assigned to a different destination, retain those qualifying exception quotes in the restriction destination too; splitting intents must not make a general rule misleading. Multi-topic rows belong to multiple menus with different supporting passages when their intents differ. Never target a folder, invent IDs, drop a topic or row, or quote text absent from the source. Use review_reason only for unresolved ambiguity, unsupported assignments or conflicting evidence that needs human action. A supported multi-menu assignment, a supporting detail retained with its main intent, or an explanation of a clear mapping is not a review reason; use an empty reason for those.",
      validate: (value) => validateMapping(value, batch, leafIds)
    });
    mappings.push(...result.rows);
    await onProgress(30 + Math.round((25 * (i + 1)) / rowBatches.length), "mapping");
  }

  const textById = new Map(sourceRows.map((r) => [r.row_id, r.text]));
  const evidenceByMenu = new Map();
  for (const row of mappings) {
    for (const target of row.targets) {
      const list = evidenceByMenu.get(target.menu_id) || [];
      list.push({
        row_id: row.row_id,
        text: textById.get(row.row_id),
        quotes: target.quotes,
        review_reason: row.review_reason
      });
      evidenceByMenu.set(target.menu_id, list);
    }
  }
  const answers = new Map();
  const usedLeaves = leaves.filter((n) => evidenceByMenu.has(n.id));
  const answersStartedAt = Date.now();
  for (let i = 0; i < usedLeaves.length; i += answerConcurrency) {
    const group = usedLeaves.slice(i, i + answerConcurrency);
    // Finish both in-flight calls before propagating failure; never leave billable work detached.
    const results = await Promise.allSettled(group.map(async (leaf) => {
    const evidence = evidenceByMenu.get(leaf.id);
    const parts = [];
    for (const batch of batches(evidence, 64_000)) {
      const result = await ask({
        name: "ars_answer",
        schema: ANSWER,
        data: { menu: menus.find((n) => n.id === leaf.id), evidence: batch },
        instruction: `Write a concise, useful spoken answer of at most ${MAX_ARS_ANSWER_LENGTH} characters for this menu using ONLY supported facts. The menu scope and quotes identify the relevant intent. Read full rows to retain its conditions, exceptions, dates, safety warnings and limits, but exclude unrelated intents in those rows. For example, a return answer must not repeat pre-dispatch cancellation steps, and a refund-method answer must not explain how to claim a shipping-delay refund. When a general restriction has exceptions, briefly retain their qualifying conditions even when their full procedure belongs to another menu. Do not turn a conditional rule into an absolute prohibition. Distinguish an exception summary from an unrelated procedure. Do not invent keypad numbers or cross-menu directions absent from the supplied menu.
Cover every supplied row's scope-relevant information, not just the first examples. State repeated policies once. Begin with the action or policy rather than restating the customer's question. No greeting or markdown. Do not blend incompatible policies or resolve a conflict by guessing. If all relevant facts cannot fit safely, give a short supported answer and set needs_review with an explanation. Also flag conflicts, missing facts or unsafe ambiguity. covered_row_ids must include every supplied row ID exactly once.`,
        validate: (value) =>
          validateAnswer(
            value,
            batch.map((r) => r.row_id)
          )
      });
      parts.push(result);
    }
    let answer = parts[0];
    if (parts.length > 1) {
      answer = await ask({
        name: "ars_answer_merge",
        schema: ANSWER,
        data: { menu: leaf, parts },
        instruction: `Combine ALL evidence-backed partial answers into one spoken answer of at most ${MAX_ARS_ANSWER_LENGTH} characters. Preserve distinct scope-relevant conditions, exceptions, dates, safety warnings and limits. Exclude unrelated intents and state repeated policies once. No greeting or markdown. Do not resolve contradictions by guessing. If the information cannot fit safely, give a short supported answer and set needs_review with an explanation. covered_row_ids is the union of all partial IDs, each once. Any partial needs_review must remain needs_review; report its reason and any new conflicts.`,
        validate: (value) => {
          validateAnswer(
            value,
            evidence.map((r) => r.row_id)
          );
          if (parts.some((p) => p.needs_review) && !value.needs_review)
            throw new Error("Cannot discard a partial review flag");
        }
      });
    }
    const reasons = [
      ...new Set([
        ...parts.filter((p) => p.needs_review).map((p) => p.review_reason),
        ...(answer.needs_review ? [answer.review_reason] : []),
        ...evidence.map((e) => e.review_reason).filter(Boolean)
      ])
    ];
    answers.set(leaf.id, {
      action: "play",
      source_row_ids: evidence.map((r) => r.row_id),
      answer_text: answer.answer_text.trim(),
      needs_review: reasons.length > 0,
      review_reasons: reasons
    });
    }));
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
    const completed = i + group.length;
    await onProgress(55 + Math.round((40 * completed) / usedLeaves.length), "answers", {
      completed_answers: completed,
      total_answers: usedLeaves.length,
      estimated_remaining_seconds: completed < usedLeaves.length
        ? Math.ceil(((Date.now() - answersStartedAt) / completed) * (usedLeaves.length - completed) / 1000)
        : null
    });
  }

  // Keep unmapped menus flagged for review so missing evidence cannot silently disappear.
  for (const leaf of leaves) {
    if (!answers.has(leaf.id)) {
      answers.set(leaf.id, {
        action: "play",
        source_row_ids: [],
        answer_text: "",
        needs_review: true,
        review_reasons: [
          "No source evidence was assigned to this planned menu. Review the mapping before publishing."
        ]
      });
    }
  }

  function children(parentId) {
    const result = [];
    for (const node of siblings.get(parentId) || []) {
      const nested = children(node.id);
      const answer = answers.get(node.id);
      result.push({
        key: String(result.length + 1),
        label: node.label.trim(),
        menu_id: node.id,
        ...(nested.length ? { children: nested } : answer)
      });
    }
    return result;
  }
  const tree = { key: "0", label: "ARS", children: children("") };
  return {
    tree,
    report: { topics, plan: plan.nodes, mappings },
    grouping_meta: {
      engine: "muse",
      row_count: rows.length,
      leaf_count: answers.size,
      needs_review_count: [...answers.values()].filter((a) => a.needs_review).length,
      multi_topic_row_count: mappings.filter((r) => r.targets.length > 1).length,
      force_full: true,
      incremental: false
    }
  };
}

module.exports = { generateMuseTree, validatePlan, validateMapping, batches };
