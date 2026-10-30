// Paired live comparison: identical planning/mapping, fresh answers at concurrency one and two.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const dotenv = require('dotenv');
const { createMuseCaller } = require('../utils/arsMuseLlm');
const { generateMuseTree } = require('../utils/arsMuseGenerator');
const { parseJsonlToRows, hasJsonlParseIssues } = require('../utils/jsonl');
const [input, output, singleConcurrency] = process.argv.slice(2);
if (singleConcurrency && !["1", "2"].includes(singleConcurrency)) throw new Error("Concurrency must be 1 or 2");
if (!input || !output) throw new Error('Usage: node compareMuseAnswers.js input.jsonl output.json');
if (fs.existsSync(output)) throw new Error('Refusing to overwrite a previous comparison');
const config = dotenv.parse(fs.readFileSync(path.join(__dirname, '../.env')));
const parsed = parseJsonlToRows(fs.readFileSync(input, 'utf8'));
if (hasJsonlParseIssues(parsed.issues)) throw new Error('Invalid input');
const cached = [];
const report = { created_at: new Date().toISOString(), input_sha256: createHash('sha256').update(fs.readFileSync(input)).digest('hex'), runs: [] };
const fingerprint = (request) => createHash('sha256').update(JSON.stringify({ name: request.name, instruction: request.instruction, data: request.data, schema: request.schema })).digest('hex');
(async () => {
  for (const concurrency of (singleConcurrency ? [Number(singleConcurrency)] : [1, 2])) {
    const replayPlan = report.runs.length > 0;
    let replayIndex = 0;
    const events = [];
    const started = Date.now();
    const ask = createMuseCaller({ apiKey: config.MODEL_API_KEY, model: config.MUSE_ARS_MODEL || 'muse-spark-1.3',
      onEvent: (event, details) => {
        events.push({ event, ...details, at: Date.now() });
        if (event !== 'model_call_waiting') console.log(JSON.stringify({ concurrency, event, operation: details.operation, elapsed_ms: details.elapsed_ms, status: details.status }));
      }
    });
    const result = await generateMuseTree(parsed.rows, { answerConcurrency: concurrency,
      ask: async (request) => {
        const isAnswer = request.name === 'ars_answer' || request.name === 'ars_answer_merge';
        if (replayPlan && !isAnswer) {
          const entry = cached[replayIndex++];
          if (!entry || entry.hash !== fingerprint(request)) throw new Error('Paired inputs differ');
          request.validate?.(entry.response);
          return structuredClone(entry.response);
        }
        const response = await ask(request);
        if (!isAnswer) cached.push({ hash: fingerprint(request), response: structuredClone(response) });
        return response;
      },
      onProgress: async (progress, stage, timing) => console.log(JSON.stringify({ concurrency, progress, stage, ...timing }))
    });
    report.runs.push({ concurrency, elapsed_ms: Date.now() - started, events, ...result });
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(`Saved concurrency ${concurrency}`);
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
