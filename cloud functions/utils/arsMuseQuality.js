const { createHash } = require("node:crypto");
const string = { type: "string" };
const array = (items) => ({ type: "array", items });
const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false
});
const INTENT_GUIDANCE =
  "An intent is an independently requested customer outcome or decision, not an individual procedural step. Where an explicit customer question exists, anchor intents in its requested outcomes. Workarounds, exceptions and fallback procedures mentioned only in its answer remain facts of that request, not additional customer intents. Without an explicit question, use the independently described customer goals in the source. One outcome may require several sequential actions across stages; keep those necessary steps together. situation is the customer's STARTING state; next_action may describe an end-to-end resolution or decision, not just a single step. Separate independently requested outcomes or different starting states, not each step of one resolution. Variations resolved by the same procedure need not become separate goals. ";
const INTENT = object({
  goal: string,
  situation: string,
  next_action: string,
  requirements: array(object({ statement: string, quote: string }))
});
const ROUTES = object({
  routes: array(
    object({
      intent_id: string,
      menu_id: string,
      ambiguous: { type: "boolean" },
      extraction_issue: string,
      reason: string
    })
  )
});
const AUDIT = object({
  menus: array(
    object({
      audit_id: string,
      menu_id: string,
      scope_issue: string,
      answer_issue: string,
      checks: array(
        object({
          requirement_id: string,
          verdict: {
            type: "string",
            enum: ["present", "missing", "contradicted", "not_applicable", "unverified"]
          },
          answer_excerpt: string,
          reason: string
        })
      )
    })
  )
});

function exactIds(actual, expected) {
  if (
    new Set(actual).size !== actual.length ||
    actual.length !== expected.length ||
    actual.some((id) => !expected.includes(id))
  ) {
    throw new Error("Quality audit must cover every requested ID exactly once");
  }
}

function factCatalogFor(topics) {
  return new Map(
    topics.flatMap((row) =>
      row.topics.flatMap((intent, index) =>
        intent.requirements.map((fact, i) => [
          `${row.row_id}#${index}#${i}`,
          {
            requirement_id: `${row.row_id}#${index}#${i}`,
            row_id: row.row_id,
            applies_when: intent.situation,
            ...fact
          }
        ])
      )
    )
  );
}

function contractsFor(topics, mappings, overrides = new Map()) {
  const byRow = new Map(topics.map((r) => [r.row_id, r.topics]));
  const catalog = factCatalogFor(topics);
  const contracts = new Map();
  const supplemental = new Map();
  for (const row of mappings)
    for (const target of row.targets) {
      const contract = contracts.get(target.menu_id) || { intents: [], requirements: [] };
      for (const index of target.topic_indices) {
        const intent = byRow.get(row.row_id)[index];
        const intentId = `${row.row_id}#${index}`;
        contract.intents.push({
          intent_id: intentId,
          row_id: row.row_id,
          goal: intent.goal,
          situation: intent.situation,
          next_action: intent.next_action
        });
        intent.requirements.forEach((fact, i) =>
          contract.requirements.push({ ...catalog.get(`${intentId}#${i}`), role: "primary" })
        );
      }
      supplemental.set(target.menu_id, [
        ...(supplemental.get(target.menu_id) || []),
        ...(target.supporting_fact_ids || [])
      ]);
      contracts.set(target.menu_id, contract);
    }
  for (const [id, contract] of contracts) {
    const seen = new Set(contract.requirements.map((r) => r.requirement_id));
    for (const factId of overrides.get(id) || supplemental.get(id) || []) {
      if (!catalog.has(factId)) throw new Error("Unknown supporting fact ID");
      if (!seen.has(factId)) {
        contract.requirements.push({ ...catalog.get(factId), role: "supporting" });
        seen.add(factId);
      }
    }
  }
  return contracts;
}

function menuPaths(plan) {
  const byId = new Map(plan.nodes.map((n) => [n.id, n]));
  const parents = new Set(plan.nodes.map((n) => n.parent_id));
  return plan.nodes
    .filter((n) => !parents.has(n.id))
    .map((node) => {
      const path = [node.label];
      let current = node;
      while (current.parent_id) {
        current = byId.get(current.parent_id);
        path.unshift(current.label);
      }
      return { menu_id: node.id, path };
    });
}

// The routing judge sees labels, not the generator's intended assignment or answer.
async function inspectDraft({
  plan,
  topics,
  mappings,
  answers,
  evidence,
  contracts,
  ask,
  batches,
  sourceRows = [],
  answerAuditCache = new Map()
}) {
  const menus = menuPaths(plan);
  const leafIds = new Set(menus.map((m) => m.menu_id));
  const findings = [];
  const routeChecks = [];
  const answerChecks = [];
  const originalText = new Map(sourceRows.map((r) => [r.row_id, r.text]));
  const questions = topics.flatMap((row) =>
    row.topics.map((t, i) => ({
      intent_id: `${row.row_id}#${i}`,
      row_id: row.row_id,
      source_text: originalText.get(row.row_id) || "",
      all_row_goals: row.topics.map((topic) => topic.goal),
      goal: t.goal,
      situation: t.situation,
      next_action: t.next_action
    }))
  );
  const expected = new Map(questions.map((q) => [q.intent_id, []]));
  for (const row of mappings)
    for (const target of row.targets)
      for (const index of target.topic_indices) {
        expected.get(`${row.row_id}#${index}`).push(target.menu_id);
      }
  for (const batch of batches(questions, 16_000)) {
    let result;
    try {
      result = await ask({
        name: "ars_route_audit",
        schema: ROUTES,
        data: { menus, questions: batch },
        instruction:
          INTENT_GUIDANCE +
          "Independently choose the ONE menu a customer would select using ONLY the spoken path labels for each goal and situation. The questions in this request are a subset of all cases; other extracted intents from the same row may be in a different batch. Never report missing cases merely because other question objects are absent here: assess source-intent omissions ONLY using all_row_goals, which is the complete extracted goal list for that row. Verify the goal and situation against the original customer question in source_text; an informational cost, eligibility or status question must not become a transaction or a step merely mentioned in its answer. Mark extraction_issue for a shifted customer state or outcome even if the invented action is a supported policy step; each case may cover one supported intent or conditional scenario of a multi-part source, so do not require every source intent in every case. Set extraction_issue when an extracted goal is only a step or answer-only fallback rather than a requested outcome, combines independently requested outcomes, changes the source meaning or starting state, or omits an independently requested source outcome. Never split the sequential steps needed for a single outcome. Do not solve a combined goal by merging independent procedures in the menu. Source answers may establish factual constraints but cannot supply a missing spoken label. Do not guess based on internal IDs. An unavailable or misleading route must use an empty menu_id and explain why. Prefer a path matching the specific goal and stage over a general policy overview. An overview referencing the same exception does not by itself make the concrete report procedure ambiguous. Mark ambiguous only when the spoken choices do not distinguish their actual goals/stages, or the label names an operation the source explicitly prohibits. An action-style label offering a prohibited operation is misleading even when its answer later refuses; use neutral policy or eligibility wording or a question instead. Return every intent_id once. This is a quality check, not permission to redesign the menu.",
        validate: (value) => {
          exactIds(
            value.routes.map((r) => r.intent_id),
            batch.map((q) => q.intent_id)
          );
          if (value.routes.some((r) => r.menu_id && !leafIds.has(r.menu_id)))
            throw new Error("Routing judge invented a menu ID");
        }
      });
    } catch {
      findings.push({
        kind: "verification",
        menu_ids: [...new Set(batch.flatMap((q) => expected.get(q.intent_id)))],
        row_ids: [...new Set(batch.map((q) => q.row_id))],
        reason: "Routing verification did not complete; no routing conclusion was accepted."
      });
      continue;
    }
    routeChecks.push(...result.routes);
    for (const check of result.routes)
      if (
        check.extraction_issue ||
        check.ambiguous ||
        !expected.get(check.intent_id).includes(check.menu_id)
      ) {
        findings.push({
          kind: check.extraction_issue ? "intent" : "structure",
          menu_ids: [...new Set([...expected.get(check.intent_id), check.menu_id].filter(Boolean))],
          row_ids: [batch.find((q) => q.intent_id === check.intent_id).row_id],
          requires_spoken_change: !check.extraction_issue && (check.ambiguous || !check.menu_id),
          reason:
            check.extraction_issue ||
            check.reason ||
            "Customer route differs from source assignment"
        });
      }
  }
  const items = [];
  for (const menu of menus) {
    const contract = contracts.get(menu.menu_id) || { intents: [], requirements: [] };
    const chunks = batches(evidence.get(menu.menu_id) || [], 24_000);
    if (!chunks.length) chunks.push([]);
    chunks.forEach((sourceChunk) => {
      const ids = new Set(sourceChunk.map((r) => r.row_id));
      const facts = contract.requirements.filter((r) => !sourceChunk.length || ids.has(r.row_id));
      const groups = batches(facts, 24_000);
      if (!groups.length) groups.push([]);
      groups.forEach((requirements) =>
        items.push({
          ...menu,
          audit_id: `audit_${items.length + 1}`,
          contract: { intents: contract.intents, requirements },
          source_rows: sourceChunk,
          answer: answers.get(menu.menu_id)?.answer_text || ""
        })
      );
    });
  }
  const policyContext =
    Buffer.byteLength(JSON.stringify(sourceRows), "utf8") <= 96_000 ? sourceRows : topics;
  const context = JSON.stringify(policyContext);
  const cacheKeys = new Map(
    items.map(({ audit_id, ...item }) => [
      audit_id,
      createHash("sha256").update(JSON.stringify(item)).update(context).digest("hex")
    ])
  );
  // Only reuse an audit when the answer, path, contract and complete policy context match.
  const pending = items.filter((item) => {
    const cached = answerAuditCache.get(cacheKeys.get(item.audit_id));
    if (cached) answerChecks.push({ ...cached, audit_id: item.audit_id });
    return !cached;
  });
  for (const batch of batches(pending, 96_000)) {
    let result;
    let unavailable = false;
    try {
      result = await ask({
        name: "ars_answer_audit",
        reasoningEffort: "medium",
        timeoutMs: 180_000,
        maxRetries: 0,
        schema: AUDIT,
        maxCompletionTokens: 32_768,
        data: {
          menus: batch,
          policy_context: policyContext
        },
        instruction:
          INTENT_GUIDANCE +
          "Independently audit each menu against its source rows and structured contract. Return every audit_id exactly once with its original menu_id. audit_id is an internal evidence chunk, never a spoken menu or sibling destination. Multiple items with the same menu_id are the SAME destination; do not diagnose a split procedure merely because its audit evidence is chunked. Some items check only a subset of one menu's evidence; audit those assigned facts and use policy_context for cross-row prerequisites. Check every requirement_id exactly once. Quote the shortest relevant exact excerpt, not the whole answer. A present verdict requires an exact non-empty excerpt from the supplied answer that actually preserves the condition, time anchor, amount or exception; merely mentioning the same number is insufficient. Mark missing, contradicted or not_applicable with reasons. Never treat the menu scope or a generator coverage claim as evidence. Inspect policy_context for prerequisites or exceptions needed by this procedure but missing from its local source assignment. Such omissions must be reported even if local contract extraction missed them. A request deadline in a different row must not disappear from how-to instructions. Inspect the full source for important qualifications missing from extraction too. Set answer_issue for unsupported statements, lost exceptions, ambiguous or indirect prerequisite deadlines, or a long omnibus answer. Set scope_issue only when the path is misleading or you can identify two distinct customer procedures with different concrete next actions that have been merged. Name those actions in the issue. Paraphrases, eligibility scenarios and supporting conditions resolved by the SAME steps are not distinct procedures just because they came from different source rows. Do not infer fragmentation outside the supplied path from audit chunks. Check cross-row prerequisites needed to execute THIS next action, rather than demanding the entire later lifecycle or another menu's follow-up procedure. A brief exception summary need not repeat the separate exception-claim procedure. Require the time anchors, costs and eligibility that govern this action, but do not expand a focused how-to into every related policy or future tracking timeline. Only an empty issue means no defect found. Do not demand unrelated source intents be repeated in this answer. Preserve conditions rather than forcing a word target. Each requirement's applies_when retains the source question's situation, including conditions omitted from a quoted answer fragment. A fallback for a specific state or missing tool must not become an unconditional step. For a concrete how-to, references such as the same window or usual conditions are not self-contained: resolve the relevant eligibility and deadline anchors from policy_context. A general support route may retain a general reference when it does not instruct one specific policy-covered procedure."
      });
    } catch {
      result = { menus: [] };
      unavailable = true;
    }
    const unexpected = result.menus.some(
      (m) => !batch.some((item) => item.audit_id === m.audit_id)
    );
    const checked = batch.map((item) => {
      const matches = result.menus.filter((m) => m.audit_id === item.audit_id);
      const identified = matches.length === 1 && matches[0].menu_id === item.menu_id;
      const raw = identified ? matches[0] : { scope_issue: "", answer_issue: "", checks: [] };
      const expected = new Set(item.contract.requirements.map((r) => r.requirement_id));
      const issues = [];
      if (!identified)
        issues.push(
          unavailable
            ? "Answer verification did not complete; no fact coverage conclusion was accepted."
            : "Audit omitted, duplicated or changed this destination's identity."
        );
      if (unexpected || raw.checks.some((c) => !expected.has(c.requirement_id)))
        issues.push("Audit returned unrequested IDs; verification must be repeated.");
      const checks = item.contract.requirements.map((requirement) => {
        const found = raw.checks.filter((c) => c.requirement_id === requirement.requirement_id);
        if (found.length !== 1)
          return {
            requirement_id: requirement.requirement_id,
            verdict: "unverified",
            answer_excerpt: "",
            reason: "Audit omitted or duplicated this required fact."
          };
        const fact = { ...found[0] };
        if (
          fact.verdict === "present" &&
          (!fact.answer_excerpt.trim() || !item.answer.includes(fact.answer_excerpt))
        ) {
          fact.verdict = "unverified";
          fact.reason =
            "Audit evidence is not an exact excerpt of the supplied answer; presence is unverified. " +
            fact.reason;
          fact.answer_excerpt = "";
        }
        return fact;
      });
      return {
        audit_id: item.audit_id,
        menu_id: item.menu_id,
        scope_issue: raw.scope_issue,
        answer_issue: raw.answer_issue,
        checks,
        verification_issue: issues.join(" ")
      };
    });
    answerChecks.push(...checked);
    for (const check of checked) {
      if (
        !check.scope_issue &&
        !check.answer_issue &&
        !check.verification_issue &&
        check.checks.every((c) => c.verdict === "present")
      ) {
        answerAuditCache.set(cacheKeys.get(check.audit_id), check);
      }
    }
  }
  for (const check of answerChecks) {
    const rowIds = [...new Set((contracts.get(check.menu_id)?.intents || []).map((i) => i.row_id))];
    if (check.scope_issue)
      findings.push({
        kind: "structure",
        menu_ids: [check.menu_id],
        row_ids: rowIds,
        reason: check.scope_issue
      });
    const unverified = check.checks.filter((c) => c.verdict === "unverified");
    if (unverified.length || check.verification_issue)
      findings.push({
        kind: "verification",
        menu_ids: [check.menu_id],
        row_ids: rowIds,
        reason: [
          check.verification_issue,
          ...unverified.map((c) => `${c.requirement_id}: ${c.reason}`)
        ]
          .filter(Boolean)
          .join("; ")
      });
    const primary = new Map(
      (contracts.get(check.menu_id)?.requirements || [])
        .filter((r) => r.role === "primary")
        .map((r) => [r.requirement_id, r])
    );
    const misplaced = check.checks.filter(
      (c) => c.verdict === "not_applicable" && primary.has(c.requirement_id)
    );
    if (misplaced.length)
      findings.push({
        kind: "structure",
        menu_ids: [check.menu_id],
        row_ids: [...new Set(misplaced.map((c) => primary.get(c.requirement_id).row_id))],
        reason:
          "Primary intent assigned outside this menu's scope; rebind the primary intent and retain only relevant supporting facts: " +
          misplaced.map((c) => c.reason).join("; ")
      });
    const reasons = [
      check.answer_issue,
      ...check.checks
        .filter(
          (c) => c.verdict !== "present" && c.verdict !== "unverified" && !misplaced.includes(c)
        )
        .map((c) => `${c.requirement_id}: ${c.verdict}: ${c.reason}`)
    ].filter(Boolean);
    if (reasons.length)
      findings.push({
        kind: "answer",
        menu_ids: [check.menu_id],
        row_ids: rowIds,
        reason: reasons.join("; ")
      });
  }
  return { findings, routes: routeChecks, answers: answerChecks };
}

// A patch cannot rewrite a previously accepted menu just because the model prefers a new tree.
function applyPlanPatch(plan, patch, allowedIds, validatePlan, findings = []) {
  const existing = new Map(plan.nodes.map((n) => [n.id, n]));
  if (
    new Set(patch.remove_ids).size !== patch.remove_ids.length ||
    new Set(patch.upsert_nodes.map((n) => n.id)).size !== patch.upsert_nodes.length
  ) {
    throw new Error("Duplicate patch IDs");
  }
  for (const id of patch.remove_ids) {
    if (!existing.has(id) || !allowedIds.has(id))
      throw new Error("Patch tried to remove an unaffected menu");
    existing.delete(id);
  }
  const changed = new Set(patch.remove_ids);
  for (const node of patch.upsert_nodes) {
    const previous = plan.nodes.find((n) => n.id === node.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(node) && !allowedIds.has(node.id))
      throw new Error("Patch tried to change an unaffected menu");
    existing.set(node.id, node);
    if (!previous || JSON.stringify(previous) !== JSON.stringify(node)) changed.add(node.id);
  }
  const next = { nodes: [...existing.values()] };
  validatePlan(next);
  const before = new Map(menuPaths(plan).map((m) => [m.menu_id, JSON.stringify(m.path)]));
  const after = new Map(menuPaths(next).map((m) => [m.menu_id, JSON.stringify(m.path)]));
  const addedDestination = [...after.keys()].some((id) => !before.has(id));
  for (const finding of findings.filter((f) => f.requires_spoken_change)) {
    if (!addedDestination && !finding.menu_ids.some((id) => before.get(id) !== after.get(id))) {
      throw new Error(
        "Routing findings require a spoken label or destination change; scope-only edits cannot repair them"
      );
    }
  }
  return { plan: next, changed };
}

module.exports = {
  INTENT,
  INTENT_GUIDANCE,
  factCatalogFor,
  contractsFor,
  inspectDraft,
  applyPlanPatch,
  exactIds,
  menuPaths
};
