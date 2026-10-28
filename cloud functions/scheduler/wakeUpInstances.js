const { onSchedule } = require("firebase-functions/v2/scheduler");
const { GoogleAuth } = require("google-auth-library");

const googleAuth = new GoogleAuth();

const RUN_HOST_SUFFIX = "o63ys4b7qa-uc.a.run.app";

/** @param {string} serviceName Cloud Run service id (Firebase export name, lowercase) */
function runUrl(serviceName) {
  return `https://${serviceName.toLowerCase()}-${RUN_HOST_SUFFIX}`;
}

/**
 * Warm-up target every 10 minutes (statuspageHealthCheck COMPONENT_ENDPOINTS + user-facing missing parts).
 * - x-health-check: _onRequest / apiGateway / lemonsqueezyWebhook immediately return 200 (handler not entered)
 * - cloudRunHealthCheck also uses only x-health-check (prevents Run Job API calls every 5 minutes)
 */
const wakeUpEndpoints = [
  // Chat (production: api.frontierbase.io → apiGateway)
  { url: runUrl("apigateway"), useHealthCheckHeader: true },
  { url: runUrl("streamchatrag"), useHealthCheckHeader: true },

  // Core
  { url: runUrl("getsourcedownloadurl"), useHealthCheckHeader: true },
  { url: runUrl("workertask"), useHealthCheckHeader: true },
  { url: runUrl("updateuser"), useHealthCheckHeader: true },
  { url: runUrl("createuser"), useHealthCheckHeader: true },
  { url: runUrl("sendtemplateemail"), useHealthCheckHeader: true },
  { url: runUrl("queryuserbyemail"), useHealthCheckHeader: true },
  { url: runUrl("checkcredentialstuffingratelimit"), useHealthCheckHeader: true },
  { url: runUrl("sendpasswordresetemail"), useHealthCheckHeader: true },
  { url: runUrl("sendsupport"), useHealthCheckHeader: true },

  // Dataset
  { url: runUrl("cloudrunhealthcheck"), useHealthCheckHeader: true },
  { url: runUrl("uploaddataset"), useHealthCheckHeader: true },
  { url: runUrl("ingestworker"), useHealthCheckHeader: true, useOidc: true },
  { url: runUrl("deletedataset"), useHealthCheckHeader: true },
  { url: runUrl("exchangegoogleoauthcode"), useHealthCheckHeader: true },
  { url: runUrl("syncgooglesheetsdataset"), useHealthCheckHeader: true },

  // Payment (Lemon Squeezy)
  { url: runUrl("lemonsqueezyrequest"), useHealthCheckHeader: true },
  { url: runUrl("lemonsqueezywebhook"), useHealthCheckHeader: true },
  { url: runUrl("lemonsqueezycancel"), useHealthCheckHeader: true },
  { url: runUrl("lemonsqueezyresumesubscription"), useHealthCheckHeader: true },
  { url: runUrl("lemonsqueezyschedulesubscriptionchange"), useHealthCheckHeader: true },
  {
    url: runUrl("lemonsqueezycancelscheduledsubscriptionchange"),
    useHealthCheckHeader: true
  },
  { url: runUrl("lemonsqueezyupgradesubscription"), useHealthCheckHeader: true },
  { url: runUrl("lemonsqueezygetsubscriptionlink"), useHealthCheckHeader: true },
  {
    url: runUrl("lemonsqueezygeneratesubscriptioninvoice"),
    useHealthCheckHeader: true
  }
];

async function pingWarmupEndpoint({ url, useHealthCheckHeader, useOidc }) {
  const headers = useHealthCheckHeader ? { "x-health-check": "1" } : {};
  if (useOidc) {
    const client = await googleAuth.getIdTokenClient(url);
    const authHeaders = await client.getRequestHeaders();
    if (authHeaders.Authorization) {
      headers.Authorization = authHeaders.Authorization;
    }
  }
  const res = await fetch(url, { method: "GET", headers });
  if (res.status !== 200) {
    throw new Error(`Failed to wake up ${url}: HTTP ${res.status}`);
  }
}

/**
 * Send a lightweight GET to Cloud Run instances every 10 minutes to reduce idle scale-down.
 * (To completely remove cold start when minInstances=0, setting minInstances is required.)
 */
const wakeUpInstances = onSchedule(
  {
    schedule: "*/10 * * * *",
    timeZone: "Asia/Seoul",
    cpu: "gcf_gen1"
  },
  async () => {
    const results = await Promise.allSettled(
      wakeUpEndpoints.map((ep) => pingWarmupEndpoint(ep))
    );
    const failures = results
      .map((result, index) =>
        result.status === "rejected"
          ? { url: wakeUpEndpoints[index].url, reason: result.reason }
          : null
      )
      .filter(Boolean);
    if (failures.length > 0) {
      const detail = failures
        .map((f) => `${f.url}: ${f.reason?.message || f.reason}`)
        .join("; ");
      throw new Error(`Wake-up failed for ${failures.length} endpoint(s): ${detail}`);
    }
  }
);

module.exports = wakeUpInstances;