const {
  INTENT,
  INTENT_GUIDANCE,
  factCatalogFor,
  contractsFor,
  inspectDraft,
  applyPlanPatch
} = require("./arsMuseQuality");
const { MAX_ARS_ANSWER_LENGTH } = require("../const/ArsLimits");

const string = { type: "string" };
const array = (items) => ({ type: "array", items });
const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false
});

const TOPICS = object({ rows: array(object({ row_id: string, topics: array(INTENT) })) });
const PLAN = object({
  nodes: array(object({ id: string, parent_id: string, label: string, scope: string }))
});
const PLAN_REVIEW = object({
  issues: array(object({ menu_ids: array(string), reason: string, correction: string })),
  nodes: PLAN.properties.nodes
});
const MAPPING = object({
  rows: array(
    object({
      row_id: string,
      targets: array(
        object({
          menu_id: string,
          topic_indices: array({ type: "integer" }),
          quotes: array(string),
          supporting_fact_ids: array(string)
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
      for (const index of target.topic_indices) {
        if (coveredTopics.has(index))
          throw new Error(`Each topic needs exactly one primary menu: ${row.row_id}#${index}`);
        coveredTopics.add(index);
      }
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

function validateTopics(value, batch) {
  assertCoverage(
    value.rows.map((r) => r.row_id),
    batch.map((r) => r.row_id),
    "Topics"
  );
  if (
    value.rows.some(
      (r) =>
        !r.topics.length ||
        r.topics.some((t) => !t.goal.trim() || !t.situation.trim() || !t.next_action.trim())
    )
  )
    throw new Error("Every row needs a topic");
  for (const row of value.rows) {
    const text = batch.find((r) => r.row_id === row.row_id).text;
    if (
      row.topics.some((t) =>
        t.requirements.some(
          (f) => !f.statement.trim() || !f.quote.trim() || !text.includes(f.quote)
        )
      )
    )
      throw new Error("Intent requirement must quote the source exactly");
  }
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
      reasoningEffort: "medium",
      maxCompletionTokens: 32_768,
      timeoutMs: 180_000,
      maxRetries: 1,
      schema: TOPICS,
      data: { rows: batch },
      instruction:
        INTENT_GUIDANCE +
        "Read every complete source row. Extract structured customer intents, not policy summaries. Where an explicit customer question exists, anchor the primary goal and customer state in that question. Do not replace an informational question with a procedural step merely mentioned in the answer. For informational requests, next_action may be understanding, checking, comparing or deciding; do not invent a transaction, require acceptance of a result, or move the customer into a later journey stage to force an action-shaped goal. Each goal must be one requested outcome from a customer starting state. Split independently requested outcomes, even if the question joins them with or/and, but never split sequential steps or answer-only fallback options that resolve one request. Keep prerequisite policies with the procedure they qualify, not as separate goals. Each intent has goal (one requested outcome), situation (customer starting state), next_action (resolution procedure or decision), and requirements (all qualifying conditions, fees, time anchors and exceptions, each with a statement and exact verbatim source quote). Requirements for executing the same procedure stay with that intent, even if this row is only a supporting policy. Do not invent separate intents for individual conditions. Retain request deadlines and later completion deadlines as distinct requirements. Preserve all independently requested customer outcomes. Do not omit rows or invent policy. One row may contain several independently requested customer outcomes. Keep qualifications, safety warnings, definitions and fallback steps attached to the intent they qualify; do not turn each supporting detail into a separate topic.",
      validate: (value) => validateTopics(value, batch)
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
      INTENT_GUIDANCE +
      `Design a telephone support menu from all supplied topics. Return nodes with unique IDs, parent_id empty for root choices, concise labels in the source language, and scopes. Maximum three levels and nine siblings. Infer the structure from these sources; do not use a fixed industry taxonomy.
Optimize for a caller finding ONE relevant answer, not for a small number of buttons. Internal folders may group related subjects. Leaves must each have one customer goal and one coherent resolution. A shared account page, contact channel or vocabulary is not sufficient reason to merge goals. Merge only if intended outcome, customer starting state and end-to-end resolution procedure all match. Broad goals such as understanding a result or getting help do not establish that match. Independently useful questions that do not need each other to resolve the request should remain distinct. Every scope must state the goal, relevant situation, required next action, and exclusions distinguishing nearby leaves.
Merge paraphrases and supporting conditions, fees, deadlines and steps needed to complete the SAME job. Separate goals requiring different procedures or outcomes. Do not bundle several independent procedures into a leaf joined with 'and', 'or', commas or slashes; create a folder with distinct leaves instead. Do not make one leaf per source row either: different questions can still resolve the same job.
Keep spoken labels brief, ideally two to seven words. Put dates, explanations and alternative procedures in scope or answers, not long menu titles. Use familiar folder names rather than artificial action slogans. A folder must genuinely contain its descendants and not imply the wrong journey stage. Leaf labels should describe the question answered, not promise an action that policy prohibits. If the answer explains whether something is possible, label the eligibility question, not the unavailable action.
An independently requested informational decision still needs a recognizable spoken route even when its facts are also prerequisites of another procedure. Keeping the facts only inside another answer is not a findable route. Keep essential prerequisites in the main how-to as well. Walk every topic through the tree as a caller hearing labels only. Eliminate ambiguous routes, missing destinations and redundant one-child folders. Each answer should normally fit within about 150 spoken words; separate independent jobs that would make it much longer, while keeping essential conditions and exceptions with their rule. Never split eligibility from the ordinary steps of the same request just to reduce length. Preserve all topics.`
  });
  await onProgress(28, "reviewing_plan");
  let plan = await ask({
    name: "ars_plan_review",
    reasoningEffort: "high",
    timeoutMs: 300_000,
    maxRetries: 0,
    maxCompletionTokens: 32_768,
    schema: PLAN_REVIEW,
    // Include full source for compact datasets; larger datasets retain topic-level global review.
    data: {
      topics,
      proposed_plan: proposedPlan.nodes,
      ...(Buffer.byteLength(JSON.stringify(sourceRows), "utf8") <= 96_000
        ? { source_rows: sourceRows }
        : {})
    },
    validate: validatePlan,
    instruction:
      INTENT_GUIDANCE +
      `Review the proposed telephone menu as a customer trying to solve a specific problem. First list concrete defects in issues with affected menu IDs, reason and required correction, then return a complete corrected plan with unique IDs, valid parents, at most three levels and nine siblings. Keep the source language. Where source_rows are present, verify against their full text, not just the topic summaries.
For each proposed merge, explicitly justify why intended outcome, customer starting state and end-to-end resolution procedure ALL match. Reject your own merge if it only shares a broad umbrella such as understanding a result, managing a purchase, or contacting support. A prerequisite needed to execute a procedure belongs with it; an independently actionable question is not a prerequisite merely because the facts are related. Different customer starting states must remain separate even if they share the same object; intermediate stages within one resolution are not additional intents. A new request and a follow-up on an existing request have different starting states. An informational calculation and locating its result have different questions and resolutions. Do not undo sensible separation simply to reduce menu count or fill the word budget.
Start by detecting both extremes: mixed independent jobs and one-button-per-FAQ fragmentation. A FAQ headline or policy fact is not automatically a separate customer goal. Eligibility, fees, labels, fallback tools and deadlines that a caller needs to complete a single procedure belong with that procedure, even when separate FAQs describe them. Do not make callers traverse several siblings to assemble one complete set of instructions. A separately requested informational decision needs a recognizable spoken route even if its facts are also prerequisites of another procedure. Keep the main procedure self-contained with those facts too. A separate eligibility destination is justified only by a genuinely different customer decision, not because it has its own source row. Retain essential prerequisite summaries within the how-to destination regardless.
For EVERY proposed leaf, identify its customer goal and next action in its scope. Ask: would customers with different goals have to listen to separate unrelated procedures here? If yes, make an internal folder and distinct leaf destinations. Do not justify a merge just because the tasks share a page, contact support, a broad topic or a payment method. A short overall menu is not a quality objective. Retain sensible merges of paraphrases and conditions, fees, deadlines and steps supporting the same job.
Test each supplied customer question against the labels without relying on answer text. A choice is defective if the caller cannot recognize it, must guess between siblings, or expects an action the policy prohibits. An action-style label offering an explicitly prohibited operation is misleading even if the answer later refuses it; use neutral policy or eligibility wording or a question instead. Correct these defects. A parent must cover every child's journey stage and actual subject; move misplaced children rather than inventing a broad catch-all slogan.
Keep important exception summaries with their general restriction even if exception procedures have their own destinations. Separate process tracking from incident investigation where the caller must take a different action. Avoid duplicate general and specific leaves for the same resolution. Use a third level to separate truly distinct jobs when a branch exceeds nine choices, rather than collapsing them into an omnibus answer. A leaf must support a focused spoken answer, normally at most about 150 words including its relevant conditions. Do not discard qualifications to reach that length.
Shorten long labels without changing the boundaries established by their scopes. Keep a concise customer-recognizable question or goal, not the whole policy or workaround in the title. Do not return a plan until every source topic has an obvious destination. Scope must include the goal, next action and boundaries. Return issues followed by corrected nodes, with no predefined categories. Every listed correction must be reflected in the final nodes and scopes. Scopes for how-to destinations must explicitly include their prerequisite conditions and distinct time anchors, not merely the action itself.`
  });
  const planReview = plan.issues || [];
  const factOverrides = new Map();
  async function materialize(plan, previous = null, affected = new Set(), qualityFindings = []) {
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
    const frozenRows = new Map((previous?.mappings || []).map((r) => [r.row_id, r]));
    const topicsByRow = new Map(topics.map((row) => [row.row_id, row.topics]));
    const factCatalog = factCatalogFor(topics);
    await onProgress(previous ? 95 : 30, previous ? "repairing" : "mapping");
    for (let i = 0; i < rowBatches.length; i += 1) {
      const batch = [];
      for (const row of rowBatches[i]) {
        const old = frozenRows.get(row.row_id);
        if (old && !old.targets.some((t) => affected.has(t.menu_id))) mappings.push(old);
        else batch.push({ ...row, topics: topicsByRow.get(row.row_id) });
      }
      if (!batch.length) continue;
      const frozen = new Map(
        batch.map((row) => [
          row.row_id,
          (frozenRows.get(row.row_id)?.targets || []).filter((t) => !affected.has(t.menu_id))
        ])
      );
      const candidateMenus = previous ? menus.filter((m) => affected.has(m.id)) : menus;
      const combine = (value) => ({
        rows: value.rows.map((r) => ({ ...r, targets: [...frozen.get(r.row_id), ...r.targets] }))
      });
      const result = await ask({
        name: "ars_mapping",
        reasoningEffort: "medium",
        maxCompletionTokens: 32_768,
        timeoutMs: 180_000,
        maxRetries: 1,
        schema: MAPPING,
        data: {
          menus: candidateMenus,
          rows: batch,
          frozen_targets: Object.fromEntries(frozen),
          ...(previous ? { quality_findings: qualityFindings } : {}),
          fact_catalog: [...factCatalog.values()].map(
            ({ requirement_id, row_id, statement, applies_when }) => ({
              requirement_id,
              row_id,
              statement,
              applies_when
            })
          )
        },
        instruction:
          (previous
            ? "Repair the supplied quality_findings when binding intents and selecting the needed source facts. "
            : "") +
          "Assign every source row to one or more candidate leaf menu IDs. frozen_targets already cover some intents and are immutable; return only NEW targets for remaining intents. An empty targets array is allowed only when frozen targets cover every intent. Select supporting_fact_ids from fact_catalog when a procedure needs prerequisites or exceptions in OTHER source rows. Resolve references such as the same window or usual conditions by selecting their concrete definitions from fact_catalog, including the exact time anchor and eligibility conditions for this procedure. Do not leave the reference itself as the only required fact. If the referenced definition is absent or ambiguous, set review_reason rather than guessing. These are supporting facts, not extra customer goals; do not turn each fact into its own destination. Keep primary topic_indices for the actual customer goal. Do not duplicate a whole primary intent merely to reuse one of its facts in another menu; select the particular supporting_fact_ids there instead. Requirements attached to an intent must accompany it; collect prerequisite eligibility, fee and deadline facts needed by a procedure rather than isolating them in policy-only leaves. Each target must list topic_indices: the zero-based indices of the row's topics it covers. Every topic index must have exactly ONE primary destination across frozen and new targets, including secondary topics. Use supporting_fact_ids to reuse a fact in another menu, not a duplicate primary topic assignment. For each target include exact verbatim source quotes supporting those topics, including relevant conditions and exceptions. If a restriction has exceptions assigned to a different destination, retain those qualifying exception quotes in the restriction destination too; splitting intents must not make a general rule misleading. Multi-topic rows belong to multiple menus with different supporting passages when their intents differ. Never target a folder, invent IDs, drop a topic or row, or quote text absent from the source. Use review_reason only for unresolved ambiguity, unsupported assignments or conflicting evidence that needs human action. A supported multi-menu assignment, a supporting detail retained with its main intent, or an explanation of a clear mapping is not a review reason; use an empty reason for those.",
        validate: (value) => {
          const candidates = new Set(candidateMenus.map((m) => m.id));
          if (value.rows.some((r) => r.targets.some((t) => !candidates.has(t.menu_id))))
            throw new Error("Mapping changed a frozen destination");
          if (
            value.rows.some((r) =>
              r.targets.some((t) =>
                (t.supporting_fact_ids || []).some((id) => !factCatalog.has(id))
              )
            )
          )
            throw new Error("Unknown supporting fact ID");
          validateMapping(combine(value), batch, leafIds);
        }
      });
      mappings.push(...combine(result).rows);
      await onProgress(
        previous ? 95 : 30 + Math.round((25 * (i + 1)) / rowBatches.length),
        previous ? "repairing" : "mapping"
      );
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
    if (previous)
      for (const [id, facts] of factOverrides) {
        if (!affected.has(id)) continue;
        const additions = mappings.flatMap((row) =>
          row.targets
            .filter((target) => target.menu_id === id)
            .flatMap((target) => target.supporting_fact_ids || [])
        );
        factOverrides.set(id, [...new Set([...facts, ...additions])]);
      }
    const contracts = contractsFor(topics, mappings, factOverrides);
    const rowReviews = new Map(mappings.map((row) => [row.row_id, row.review_reason]));
    function refreshEvidence(id) {
      const rows = new Map((evidenceByMenu.get(id) || []).map((r) => [r.row_id, r]));
      for (const fact of contracts.get(id)?.requirements || []) {
        const row = rows.get(fact.row_id) || {
          row_id: fact.row_id,
          text: textById.get(fact.row_id),
          quotes: [],
          review_reason: rowReviews.get(fact.row_id) || ""
        };
        row.quotes = [...new Set([...row.quotes, fact.quote])];
        rows.set(fact.row_id, row);
      }
      evidenceByMenu.set(id, [...rows.values()]);
    }
    for (const id of contracts.keys()) refreshEvidence(id);
    function setSupportingFacts(id, facts) {
      factOverrides.set(id, facts);
      contracts.set(id, contractsFor(topics, mappings, factOverrides).get(id));
      // Rebuild from primary assignments so removed optional facts do not linger.
      evidenceByMenu.set(
        id,
        mappings.flatMap((row) =>
          row.targets
            .filter((t) => t.menu_id === id)
            .map((t) => ({
              row_id: row.row_id,
              text: textById.get(row.row_id),
              quotes: t.quotes,
              review_reason: row.review_reason
            }))
        )
      );
      refreshEvidence(id);
    }
    const answers = new Map(
      previous ? [...previous.answers].filter(([id]) => leafIds.has(id) && !affected.has(id)) : []
    );
    const usedLeaves = leaves.filter((n) => evidenceByMenu.has(n.id) && !answers.has(n.id));
    async function writeAnswer(leaf, repairFindings = []) {
      const repairing = Boolean(previous) || repairFindings.length > 0;
      const evidence = evidenceByMenu.get(leaf.id);
      const parts = [];
      for (const batch of batches(evidence, 64_000)) {
        const result = await ask({
          name: repairing ? "ars_answer_repair" : "ars_answer",
          ...(repairing
            ? {
                reasoningEffort: "medium",
                maxCompletionTokens: 32_768,
                timeoutMs: 180_000,
                maxRetries: 0
              }
            : {}),
          schema: ANSWER,
          data: {
            menu: menus.find((n) => n.id === leaf.id),
            evidence: batch,
            contract: contracts.get(leaf.id),
            quality_findings: repairFindings,
            ...(repairing
              ? {
                  current_answer:
                    answers.get(leaf.id)?.answer_text ||
                    previous?.answers.get(leaf.id)?.answer_text ||
                    ""
                }
              : {})
          },
          instruction: `${repairing ? "Repair current_answer only where the findings or changed contract require it; retain its correct conditions and qualifications. " : ""}Write a concise, useful spoken answer of at most ${MAX_ARS_ANSWER_LENGTH} characters for this menu using ONLY supported facts. Resolve the supplied quality findings when repairing. The contract lists the assigned intents and mandatory facts, including exact source quotes. Each fact's applies_when retains the customer state that qualifies it. Preserve meaningful conditions such as a missing tool or a fallback state; do not turn a conditional option into a mandatory universal step. Informational question wording is not itself a policy condition. Keep the supported choices of every assigned primary intent; do not silently narrow them because a proposed scope prefers only one. Preserve every scope-relevant requirement with its time anchor and exceptions. The menu label and scope identify routing intent only, not factual evidence. Every stated policy must be supported by the supplied source rows and quotes. Never import specific deadlines, conditions or guarantees from scope alone. If a help-menu source says the usual conditions apply without listing them, retain that general statement rather than inventing or borrowing detailed conditions from scope. For a concrete how-to, do not leave referenced deadlines or eligibility as only the same window or usual conditions when their definitions are supplied. If the necessary concrete definition is absent from the evidence, flag needs_review rather than inventing it. If essential facts lack evidence, flag needs_review. The quotes identify the relevant intent. Read full rows to retain its conditions, exceptions, dates, safety warnings and limits, but exclude unrelated intents in those rows. For example, a return answer must not repeat pre-dispatch cancellation steps, and a refund-method answer must not explain how to claim a shipping-delay refund. When a general restriction has exceptions, briefly retain their qualifying conditions even when their full procedure belongs to another menu. Do not turn a conditional rule into an absolute prohibition. Distinguish an exception summary from an unrelated procedure. Do not invent keypad numbers or cross-menu directions absent from the supplied menu.
Cover every supplied row's scope-relevant information, not just the first examples. State repeated policies once. Begin with the action or policy rather than restating the customer's question. Prefer a short answer, normally at most about 150 words when the language uses word spacing. This is a soft ceiling, not a minimum: never pad, repeat or invent advice to reach a word count. Preserve all relevant conditions and exceptions even if more words are required. For a how-to answer, state its prerequisite eligibility and request deadline explicitly before steps, even if a separate eligibility menu exists. A deadline for starting a request and a later deadline for completing or shipping it are distinct: retain both time anchors, not only an indirect reference to an earlier window. Never convert a usual response-time estimate into a guaranteed reply date. Retain explicit fee waivers and policy exceptions; do not replace them with vague language such as covered differently. Do not assume a conditional outcome is certain before the source verification step. If the assigned scope combines unrelated procedures, set needs_review and explain the menu-scope problem instead of hiding it in a long list of instructions. No greeting or markdown. Do not blend incompatible policies or resolve a conflict by guessing. If all relevant facts cannot fit safely, give a short supported answer and set needs_review with an explanation. Also flag conflicts, missing facts or unsafe ambiguity. covered_row_ids must include every supplied row ID exactly once.`,
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
    }
    const answersStartedAt = Date.now();
    for (let i = 0; i < usedLeaves.length; i += answerConcurrency) {
      const group = usedLeaves.slice(i, i + answerConcurrency);
      // Finish both in-flight calls before propagating failure; never leave billable work detached.
      const results = await Promise.allSettled(
        group.map(async (leaf) => {
          const rowIds = new Set(
            (contracts.get(leaf.id)?.intents || []).map((intent) => intent.row_id)
          );
          await writeAnswer(
            leaf,
            qualityFindings.filter(
              (finding) =>
                finding.menu_ids.includes(leaf.id) || finding.row_ids.some((id) => rowIds.has(id))
            )
          );
        })
      );
      const failure = results.find((result) => result.status === "rejected");
      if (failure) throw failure.reason;
      const completed = i + group.length;
      await onProgress(
        previous ? 95 : 55 + Math.round((40 * completed) / usedLeaves.length),
        previous ? "repairing" : "answers",
        {
          completed_answers: completed,
          total_answers: usedLeaves.length,
          estimated_remaining_seconds:
            completed < usedLeaves.length
              ? Math.ceil(
                  (((Date.now() - answersStartedAt) / completed) *
                    (usedLeaves.length - completed)) /
                    1000
                )
              : null
        }
      );
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

    return {
      plan,
      mappings,
      evidence: evidenceByMenu,
      contracts,
      answers,
      writeAnswer,
      setSupportingFacts
    };
  }
  let draft = await materialize(plan);
  const qualityHistory = [];
  const answerAuditCache = new Map();
  let audit;
  for (let round = 0; round <= 2; round += 1) {
    await onProgress(95, "quality_review", { estimated_remaining_seconds: null });
    audit = await inspectDraft({ ...draft, topics, ask, batches, sourceRows, answerAuditCache });
    qualityHistory.push({ round, ...audit });
    await onProgress(95, "quality_review", {
      quality_round: round,
      quality_findings: audit.findings.length,
      routing_checks: audit.routes.length,
      answer_checks: audit.answers.length,
      estimated_remaining_seconds: null
    });
    if (!audit.findings.length || round === 2) break;
    await onProgress(95, "repairing", { estimated_remaining_seconds: null });
    const repairFindings = audit.findings.filter((f) => f.kind !== "verification");
    if (!repairFindings.length) continue;
    const structural = repairFindings.filter((f) => f.kind === "structure" || f.kind === "intent");
    if (structural.length) {
      const allowed = new Set(repairFindings.flatMap((f) => f.menu_ids));
      const badRows = new Set(
        repairFindings.filter((f) => f.kind === "intent").flatMap((f) => f.row_ids)
      );
      if (badRows.size) {
        for (const batch of batches(sourceRows.filter((r) => badRows.has(r.row_id)))) {
          const repaired = await ask({
            name: "ars_intent_repair",
            reasoningEffort: "medium",
            maxCompletionTokens: 32_768,
            timeoutMs: 180_000,
            maxRetries: 0,
            schema: TOPICS,
            data: { rows: batch, findings: repairFindings.filter((f) => f.kind === "intent") },
            instruction:
              INTENT_GUIDANCE +
              "Re-extract ONLY these defective source rows. Anchor each goal and state in the original question; informational requests must remain informational rather than adopting a step mentioned in the answer. next_action may be understanding, checking or deciding without inventing a transaction. One intent must have one requested outcome, a customer starting state and one resolution procedure or decision. Keep the necessary steps of that resolution together; do not create extra intents for answer-only fallback procedures. Preserve all source intents, qualifying requirements and exceptions, each requirement with exact source quote. Do not force a menu merge to compensate for a combined intent. Keep a procedure's prerequisites attached to it. Return every supplied row once.",
            validate: (value) => validateTopics(value, batch)
          });
          for (const row of repaired.rows)
            topics[topics.findIndex((r) => r.row_id === row.row_id)] = row;
          qualityHistory[qualityHistory.length - 1].intent_repairs = repaired.rows;
        }
        for (const row of draft.mappings)
          if (badRows.has(row.row_id)) row.targets.forEach((t) => allowed.add(t.menu_id));
        for (const [id, answer] of draft.answers)
          if (!answer.source_row_ids.length) allowed.add(id);
        // Re-extraction changes fact indices as well as primary intent indices.
        for (const [id, contract] of draft.contracts) {
          if (contract.requirements.some((fact) => badRows.has(fact.row_id))) allowed.add(id);
        }
        for (const id of allowed) factOverrides.delete(id);
      }
      // A folder is editable only when every descendant leaf is already affected.
      const all = validatePlan(draft.plan);
      const descendantLeaves = (id) => {
        const kids = all.siblings.get(id);
        return kids ? kids.flatMap((n) => descendantLeaves(n.id)) : [id];
      };
      for (const node of draft.plan.nodes)
        if (descendantLeaves(node.id).every((id) => allowed.has(id))) allowed.add(node.id);
      const patchSchema = object({
        remove_ids: array(string),
        upsert_nodes: PLAN.properties.nodes
      });
      const patch = await ask({
        name: "ars_plan_patch",
        reasoningEffort: "high",
        timeoutMs: 300_000,
        maxRetries: 0,
        maxCompletionTokens: 32_768,
        schema: patchSchema,
        data: {
          plan: draft.plan.nodes,
          editable_ids: [...allowed],
          findings: repairFindings,
          topics
        },
        instruction:
          INTENT_GUIDANCE +
          "Repair ONLY the reported defective destinations and their assigned goals/requirements. Return remove_ids and upsert_nodes, not a rewritten tree. A requires_spoken_change finding cannot be fixed by scope text alone: change the affected spoken label/path or add a recognizable destination. When a prerequisite or special case has its own requested goal, give it a recognizable route while retaining its essential facts in the main procedure; a complete how-to need not be fragmented. Existing IDs outside editable_ids are immutable. You may create new IDs and attach to existing folders; deleting a folder must not orphan children. Keep accepted destinations, names, scopes and positions untouched. Maximum three levels, nine siblings. Merge supporting conditions/fees/deadlines into the procedure they qualify; separate independent goals with different customer states or next actions. Make scopes explicitly carry the required source conditions. Never move a correct task merely for style. Use findings as evidence of a defect, not a fixed industry taxonomy.",
        validate: (value) =>
          applyPlanPatch(draft.plan, value, allowed, validatePlan, repairFindings)
      });
      qualityHistory[qualityHistory.length - 1].patch = patch;
      const updated = applyPlanPatch(draft.plan, patch, allowed, validatePlan, repairFindings);
      const affected = new Set([...allowed, ...updated.changed]);
      plan = updated.plan;
      draft = await materialize(plan, draft, affected, repairFindings);
    } else {
      const ids = new Set(repairFindings.flatMap((f) => f.menu_ids));
      const catalog = factCatalogFor(topics);
      const removableFacts = new Map(
        [...ids].map((id) => [
          id,
          new Set(
            audit.answers
              .filter((entry) => entry.menu_id === id)
              .flatMap((entry) =>
                entry.checks
                  .filter((check) => check.verdict === "not_applicable")
                  .map((check) => check.requirement_id)
              )
          )
        ])
      );
      const factPatch = await ask({
        name: "ars_fact_patch",
        schema: object({
          bindings: array(object({ menu_id: string, supporting_fact_ids: array(string) }))
        }),
        data: {
          menus: [...ids].map((id) => ({
            menu: draft.plan.nodes.find((n) => n.id === id),
            contract: draft.contracts.get(id),
            answer: draft.answers.get(id).answer_text,
            removable_fact_ids: [...removableFacts.get(id)]
          })),
          findings: repairFindings,
          facts: [...catalog.values()]
        },
        instruction:
          "Repair supporting evidence bindings ONLY for these menus. Resolve referenced windows and conditions to their concrete source definitions, retaining the applicable time anchors and eligibility. Select exact supporting_fact_ids from facts for necessary prerequisites, deadlines, fees and exceptions missing from the local contract; omit unrelated optional facts. Primary intent facts are immutable and remain included automatically. Preserve all existing supporting facts unless their IDs appear in removable_fact_ids. A missing condition must be repaired, never removed from the contract to pass the check. Return every menu once, with its complete desired supporting fact list, possibly empty. Do not rewrite menus or answers.",
        validate: (value) => {
          const found = value.bindings.map((b) => b.menu_id);
          if (
            found.length !== ids.size ||
            new Set(found).size !== found.length ||
            found.some((id) => !ids.has(id))
          )
            throw new Error("Fact patch changed an unaffected menu");
          if (value.bindings.some((b) => b.supporting_fact_ids.some((id) => !catalog.has(id))))
            throw new Error("Fact patch invented an ID");
          for (const binding of value.bindings) {
            const selected = new Set(binding.supporting_fact_ids);
            if (
              (draft.contracts.get(binding.menu_id)?.requirements || []).some(
                (fact) =>
                  fact.role === "supporting" &&
                  !removableFacts.get(binding.menu_id).has(fact.requirement_id) &&
                  !selected.has(fact.requirement_id)
              )
            )
              throw new Error("Cannot discard an accepted supporting fact during answer repair");
          }
        }
      });
      for (const binding of factPatch.bindings)
        draft.setSupportingFacts(binding.menu_id, binding.supporting_fact_ids);
      for (const id of ids)
        await draft.writeAnswer(
          draft.plan.nodes.find((n) => n.id === id),
          repairFindings.filter((f) => f.menu_ids.includes(id))
        );
    }
  }
  for (const finding of audit.findings)
    for (const id of finding.menu_ids) {
      const answer = draft.answers.get(id);
      if (answer) {
        answer.needs_review = true;
        if (finding.kind === "structure" || finding.kind === "intent") {
          answer.quality_blockers = [
            ...new Set([...(answer.quality_blockers || []), finding.reason])
          ];
        }
        answer.review_reasons = [
          ...new Set([...answer.review_reasons, `Quality: ${finding.reason}`])
        ];
      }
    }
  const { siblings } = validatePlan(draft.plan);
  const { answers, mappings, contracts } = draft;

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
    report: {
      topics,
      plan: draft.plan.nodes,
      plan_review: planReview,
      mappings,
      contracts: Object.fromEntries(contracts),
      quality: {
        passed: !audit.findings.length && ![...answers.values()].some((a) => a.needs_review),
        history: qualityHistory
      }
    },
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
