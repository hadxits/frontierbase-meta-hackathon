/**
 * Statuspage.io 헬스 체크 + 컴포넌트/incident 반영 공통 로직.
 * scheduler/statuspageHealthCheck.js 및 endpoints/health/runStatuspageHealthCheck.js 에서 사용.
 */
const environment = require("@/env");
const { GoogleAuth } = require("google-auth-library");
const {
  logInfo,
  logWarn,
  logAndCaptureError,
  logOperationalWarn
} = require("@/utils/logger");

const googleAuth = new GoogleAuth();

const HEALTH_CHECK_TIMEOUT_MS = 15000;
const STATUSPAGE_RATE_LIMIT_MS = 1100;
const STATUSPAGE_FETCH_TIMEOUT_MS = 15000;
const STATUSPAGE_FETCH_MAX_ATTEMPTS = 3;
const STATUSPAGE_RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const TRANSIENT_FETCH_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT"
]);

const INCIDENT_NAMES = {
  CHAT_API: "Chat API: Service disruption",
  DATASET_API: "Dataset API: Service disruption",
  CORE_API: "Core API: Service disruption",
  PAYMENT_API: "Payment API: Service disruption"
};

const COMPONENT_ENDPOINTS = {
  CHAT_API: [
    { url: "https://apigateway-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://streamchatrag-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://getarsmenu-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://synthesizearsspeech-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true }
  ],
  DATASET_API: [
    { url: "https://uploaddataset-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    {
      url: "https://ingestworker-o63ys4b7qa-uc.a.run.app",
      useHealthCheckHeader: true,
      useOidc: true
    },
    { url: "https://deletedataset-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://exchangegoogleoauthcode-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://syncgooglesheetsdataset-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://generatearsmenu-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    {
      url: "https://arsmappingworker-o63ys4b7qa-uc.a.run.app",
      useHealthCheckHeader: true,
      useOidc: true
    },
    { url: "https://publisharsmenu-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://getarsmenutree-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://updatearsleafreview-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true }
  ],
  CORE_API: [
    { url: "https://getsourcedownloadurl-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://workertask-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://updateuser-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://createuser-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://createserverapisecret-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://listserverapisecrets-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://revokeserverapisecret-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://sendtemplateemail-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://queryuserbyemail-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://checkcredentialstuffingratelimit-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://sendpasswordresetemail-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://sendsupport-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true }
  ],
  PAYMENT_API: [
    { url: "https://lemonsqueezyrequest-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://lemonsqueezywebhook-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://lemonsqueezycancel-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://lemonsqueezygetsubscriptionlink-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true },
    { url: "https://lemonsqueezygeneratesubscriptioninvoice-o63ys4b7qa-uc.a.run.app", useHealthCheckHeader: true }
  ]
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientFetchError(err) {
  if (!err) return false;
  if (err.name === "AbortError") return true;
  const cause = err.cause;
  const code = String(err.code || cause?.code || "");
  if (TRANSIENT_FETCH_CODES.has(code)) return true;
  const message = `${err.message || ""} ${cause?.message || ""}`.toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("socket hang up") ||
    message.includes("timed out") ||
    message.includes("timeout")
  );
}

function formatFetchError(err) {
  const base = err instanceof Error ? err.message : String(err);
  const cause = err?.cause;
  const causeCode = cause?.code || err?.code;
  if (!causeCode || base.includes(String(causeCode))) return base;
  const causeMessage = cause?.message && cause.message !== causeCode ? `: ${cause.message}` : "";
  return `${base} (${causeCode}${causeMessage})`;
}

/** Statuspage API. ECONNRESET(stale keep-alive) 등 일시 오류는 재시도한다. */
async function statuspageFetch(url, init) {
  const method = init.method || "GET";
  let lastErr;
  for (let attempt = 1; attempt <= STATUSPAGE_FETCH_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), STATUSPAGE_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          ...init.headers,
          Connection: "close"
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (STATUSPAGE_RETRYABLE_STATUS.has(res.status) && attempt < STATUSPAGE_FETCH_MAX_ATTEMPTS) {
        await res.text().catch(() => {});
        logOperationalWarn("[runStatuspageHealthCheck] Statuspage request retrying", {
          tenant_id: "system",
          function_name: "runStatuspageHealthCheck",
          extra: { method, status: res.status, attempt }
        });
        await sleep(STATUSPAGE_RATE_LIMIT_MS);
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      const timedOut = err?.name === "AbortError";
      lastErr = timedOut
        ? Object.assign(new Error(`Statuspage request timed out after ${STATUSPAGE_FETCH_TIMEOUT_MS}ms`), {
          name: "AbortError",
          cause: err
        })
        : err;
      if (!isTransientFetchError(lastErr) || attempt >= STATUSPAGE_FETCH_MAX_ATTEMPTS) {
        throw lastErr;
      }
      logOperationalWarn("[runStatuspageHealthCheck] Statuspage request retrying", {
        tenant_id: "system",
        function_name: "runStatuspageHealthCheck",
        extra: { method, attempt, error: formatFetchError(lastErr) }
      });
      await sleep(STATUSPAGE_RATE_LIMIT_MS);
    }
  }
  throw lastErr;
}

function reportStatuspageFailure(err, message, context) {
  const formatted = formatFetchError(err);
  if (isTransientFetchError(err)) {
    logOperationalWarn(message, {
      ...context,
      extra: {
        ...context.extra,
        error: formatted
      }
    });
    return formatted;
  }
  logAndCaptureError(
    err instanceof Error ? err : new Error(formatted),
    message,
    context
  );
  return formatted;
}

async function checkUrl({
  url,
  useHealthCheckHeader,
  useOidc,
  timeoutMs = HEALTH_CHECK_TIMEOUT_MS
}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const headers = useHealthCheckHeader ? { "x-health-check": "1" } : {};
  try {
    if (useOidc) {
      const client = await googleAuth.getIdTokenClient(url);
      const authHeaders = await client.getRequestHeaders();
      if (authHeaders.Authorization) {
        headers.Authorization = authHeaders.Authorization;
      }
    }
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return { ok: res.status === 200, status: res.status };
  } catch (err) {
    clearTimeout(timeoutId);
    const error = err.name === "AbortError" ? "timeout" : (err.message || String(err));
    return { ok: false, error };
  }
}

async function checkComponent(componentKey) {
  const endpoints = COMPONENT_ENDPOINTS[componentKey];
  const results = await Promise.all(endpoints.map((ep) => checkUrl(ep)));
  const failures = results
    .map((r, i) => (r.ok ? null : { url: endpoints[i].url, ...r }))
    .filter(Boolean);
  return { ok: failures.length === 0, failures };
}

async function updateStatuspageComponent(pageId, componentId, status, apiKey) {
  const url = `https://api.statuspage.io/v1/pages/${pageId}/components/${componentId}`;
  const res = await statuspageFetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `OAuth ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ component: { status } })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Statuspage PATCH ${res.status}: ${text}`);
  }
  return res.json();
}

async function getUnresolvedIncidents(pageId, apiKey) {
  const url = `https://api.statuspage.io/v1/pages/${pageId}/incidents/unresolved.json`;
  const res = await statuspageFetch(url, {
    method: "GET",
    headers: { Authorization: `OAuth ${apiKey}` }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Statuspage GET unresolved ${res.status}: ${text}`);
  }
  return res.json();
}

function buildOpenIncidentsMap(unresolvedList) {
  const map = {};
  for (const key of Object.keys(INCIDENT_NAMES)) {
    const name = INCIDENT_NAMES[key];
    const incident = (unresolvedList || []).find((inc) => inc.name === name);
    map[key] = incident ? incident.id : null;
  }
  return map;
}

async function createIncident(pageId, apiKey, componentId, componentKey) {
  const name = INCIDENT_NAMES[componentKey];
  const url = `https://api.statuspage.io/v1/pages/${pageId}/incidents.json`;
  const res = await statuspageFetch(url, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      incident: {
        name,
        status: "investigating",
        body: "Health check failed. We are investigating.",
        component_ids: [componentId],
        deliver_notifications: true
      }
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Statuspage POST incident ${res.status}: ${text}`);
  }
  return res.json();
}

async function resolveIncident(pageId, apiKey, incidentId) {
  const url = `https://api.statuspage.io/v1/pages/${pageId}/incidents/${incidentId}.json`;
  const res = await statuspageFetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `OAuth ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      incident: {
        status: "resolved",
        body: "Service restored."
      }
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Statuspage PATCH incident ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * @param {{ functionName?: string, skipStatuspageUpdate?: boolean }} [options]
 */
async function runStatuspageHealthCheck(options = {}) {
  const functionName = options.functionName || "runStatuspageHealthCheck";
  const skipStatuspageUpdate = options.skipStatuspageUpdate === true;

  const pageId = environment.STATUSPAGE_PAGE_ID;
  const apiKey = environment.STATUSPAGE_API_KEY;
  const chatId = environment.STATUSPAGE_CHAT_API_COMPONENT_ID;
  const datasetId = environment.STATUSPAGE_DATASET_API_COMPONENT_ID;
  const coreId = environment.STATUSPAGE_CORE_API_COMPONENT_ID;
  const paymentId = environment.STATUSPAGE_PAYMENT_API_COMPONENT_ID;

  const statuspageEnabled =
    pageId && apiKey && chatId && datasetId && coreId && paymentId;

  const [chatResult, datasetResult, coreResult, paymentResult] = await Promise.all([
    checkComponent("CHAT_API"),
    checkComponent("DATASET_API"),
    checkComponent("CORE_API"),
    checkComponent("PAYMENT_API")
  ]);

  const summary = {
    CHAT_API: chatResult.ok ? "operational" : "major_outage",
    DATASET_API: datasetResult.ok ? "operational" : "major_outage",
    CORE_API: coreResult.ok ? "operational" : "major_outage",
    PAYMENT_API: paymentResult.ok ? "operational" : "major_outage"
  };

  const componentResults = [
    { key: "CHAT_API", result: chatResult },
    { key: "DATASET_API", result: datasetResult },
    { key: "CORE_API", result: coreResult },
    { key: "PAYMENT_API", result: paymentResult }
  ];

  for (const { key, result } of componentResults) {
    if (!result.ok) {
      logWarn(`[${functionName}] ${key} health check failures (Statuspage 반영)`, {
        tenant_id: "system",
        function_name: functionName,
        extra: { failures: result.failures }
      });
    }
  }

  logInfo(`[${functionName}] Health check done`, {
    tenant_id: "system",
    function_name: functionName,
    extra: { summary, statuspageEnabled, skipStatuspageUpdate }
  });

  const response = {
    summary,
    components: Object.fromEntries(
      componentResults.map(({ key, result }) => [
        key,
        { ok: result.ok, failures: result.failures }
      ])
    ),
    statuspageEnabled,
    statuspageUpdateSkipped: skipStatuspageUpdate || !statuspageEnabled,
    statuspage: {
      componentUpdates: [],
      incidentsCreated: [],
      incidentsResolved: [],
      errors: []
    }
  };

  if (skipStatuspageUpdate || !statuspageEnabled) {
    return response;
  }

  let openIncidents = {};
  let unresolvedFetchSucceeded = false;
  try {
    const unresolved = await getUnresolvedIncidents(pageId, apiKey);
    openIncidents = buildOpenIncidentsMap(unresolved);
    unresolvedFetchSucceeded = true;
    await sleep(STATUSPAGE_RATE_LIMIT_MS);
  } catch (err) {
    const message = formatFetchError(err);
    logOperationalWarn(`[${functionName}] Failed to fetch unresolved incidents`, {
      tenant_id: "system",
      function_name: functionName,
      extra: {
        error: message
      }
    });
    response.statuspage.errors.push({
      stage: "fetch_unresolved_incidents",
      message
    });
  }

  const updates = [
    { componentKey: "CHAT_API", componentId: chatId, status: summary.CHAT_API },
    { componentKey: "DATASET_API", componentId: datasetId, status: summary.DATASET_API },
    { componentKey: "CORE_API", componentId: coreId, status: summary.CORE_API },
    { componentKey: "PAYMENT_API", componentId: paymentId, status: summary.PAYMENT_API }
  ];

  for (const u of updates) {
    try {
      await updateStatuspageComponent(pageId, u.componentId, u.status, apiKey);
      response.statuspage.componentUpdates.push({
        componentKey: u.componentKey,
        componentId: u.componentId,
        status: u.status
      });
      logInfo(`[${functionName}] Statuspage component updated`, {
        tenant_id: "system",
        function_name: functionName,
        extra: { componentId: u.componentId, status: u.status }
      });
    } catch (err) {
      const message = reportStatuspageFailure(
        err,
        `[${functionName}] Statuspage component update failed`,
        {
          tenant_id: "system",
          function_name: functionName,
          extra: { componentId: u.componentId, status: u.status }
        }
      );
      response.statuspage.errors.push({
        stage: "component_update",
        componentKey: u.componentKey,
        message
      });
    }
    await sleep(STATUSPAGE_RATE_LIMIT_MS);

    try {
      if (unresolvedFetchSucceeded) {
        if (u.status === "major_outage" && !openIncidents[u.componentKey]) {
          const created = await createIncident(pageId, apiKey, u.componentId, u.componentKey);
          response.statuspage.incidentsCreated.push({
            componentKey: u.componentKey,
            incidentId: created?.incident?.id || created?.id || null
          });
          logInfo(`[${functionName}] Incident created`, {
            tenant_id: "system",
            function_name: functionName,
            extra: { componentKey: u.componentKey, componentId: u.componentId }
          });
          await sleep(STATUSPAGE_RATE_LIMIT_MS);
        } else if (u.status === "operational" && openIncidents[u.componentKey]) {
          await resolveIncident(pageId, apiKey, openIncidents[u.componentKey]);
          response.statuspage.incidentsResolved.push({
            componentKey: u.componentKey,
            incidentId: openIncidents[u.componentKey]
          });
          logInfo(`[${functionName}] Incident resolved`, {
            tenant_id: "system",
            function_name: functionName,
            extra: {
              componentKey: u.componentKey,
              incidentId: openIncidents[u.componentKey]
            }
          });
          await sleep(STATUSPAGE_RATE_LIMIT_MS);
        }
      }
    } catch (err) {
      const message = reportStatuspageFailure(
        err,
        `[${functionName}] Incident create/resolve failed`,
        {
          tenant_id: "system",
          function_name: functionName,
          extra: { componentKey: u.componentKey }
        }
      );
      response.statuspage.errors.push({
        stage: "incident_create_or_resolve",
        componentKey: u.componentKey,
        message
      });
    }
  }

  return response;
}

module.exports = {
  runStatuspageHealthCheck,
  COMPONENT_ENDPOINTS
};