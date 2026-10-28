/**
 * synthesizeArsSpeech — ElevenLabs TTS for ARS leaf text (voice_id by content language).
 * GCS cache: ars/{tenantId}/tts/{sha256(text)}.mp3 — miss synthesizes then afterSend saves.
 */
const _onRequest = require("@/_onRequest");
const PropertyType = require("@/const/ajv/PropertyType");
const ApiError = require("@/errors/apiError");
const environment = require("@/env");
const { MAX_ARS_ANSWER_LENGTH } = require("@/const/ArsLimits");
const {
  resolveArsVoiceId,
  detectContentLang,
  ELEVEN_MODEL
} = require("@/utils/arsVoices");
const {
  buildTtsCacheKey,
  loadTtsCache,
  saveTtsCache
} = require("@/utils/arsTtsCache");
const { logWarn, logInfo, logDebug } = require("@/utils/logger");

const FN = "synthesizeArsSpeech";

function ctx(tenant_id, extra) {
  return {
    tenant_id,
    function_name: FN,
    extra
  };
}

module.exports = _onRequest({
  opts: {
    memory: "512MiB",
    timeoutSeconds: 60,
    cors: true,
    maxInstances: 2,
    concurrency: 4
  },
  requireCredential: false,
  params: {
    type: PropertyType.OBJECT,
    properties: {
      tenant_id: { type: PropertyType.STRING },
      text: { type: PropertyType.STRING },
      locale: { type: PropertyType.STRING }
    },
    required: ["text", "tenant_id"],
    additionalProperties: true
  },
  handler: async (req) => {
    const text = String(req.body.text ?? "");
    const tenant_id = String(req.body.tenant_id || "").trim();
    const locale = String(req.body.locale || "").trim();
    if (!tenant_id) {
      throw new ApiError({
        errorCode: "INVALID_REQUEST",
        message: "tenant_id required",
        httpStatusCode: 400,
        returnToUser: true
      });
    }
    if (!text) {
      throw new ApiError({
        errorCode: "INVALID_REQUEST",
        message: "text required",
        httpStatusCode: 400,
        returnToUser: true
      });
    }
    if (text.length > MAX_ARS_ANSWER_LENGTH) {
      throw new ApiError({
        errorCode: "TEXT_TOO_LONG",
        message: "text too long",
        httpStatusCode: 400,
        returnToUser: true
      });
    }

    const cacheHash = buildTtsCacheKey(text);
    const apiKeyPresent = Boolean(environment.ELEVENLABS_API_KEY);

    logDebug("[synthesizeArsSpeech] start", ctx(tenant_id, {
      step: "start",
      text_len: text.length,
      hash: cacheHash.slice(0, 16),
      locale: locale || null,
      elevenlabs_key: apiKeyPresent ? "present" : "missing"
    }));

    logDebug("[synthesizeArsSpeech] cache lookup", ctx(tenant_id, {
      step: "cache_lookup",
      hash: cacheHash.slice(0, 16)
    }));

    const cached = await loadTtsCache(tenant_id, cacheHash);
    if (cached) {
      logDebug("[synthesizeArsSpeech] cache hit — skip ElevenLabs", ctx(tenant_id, {
        step: "cache_hit",
        hash: cacheHash.slice(0, 16),
        audio_bytes: cached.length,
        elevenlabs: "skipped"
      }));
      logInfo("[synthesizeArsSpeech] TTS cache hit", ctx(tenant_id, {
        cache: "hit",
        hash: cacheHash.slice(0, 16),
        audio_bytes: cached.length
      }));
      return {
        success: true,
        audio_base64: cached.toString("base64"),
        content_type: "audio/mpeg",
        cache: "hit"
      };
    }

    logDebug("[synthesizeArsSpeech] cache miss", ctx(tenant_id, {
      step: "cache_miss",
      hash: cacheHash.slice(0, 16),
      elevenlabs: "will_call"
    }));

    const apiKey = environment.ELEVENLABS_API_KEY;
    if (!apiKey) {
      logDebug("[synthesizeArsSpeech] no ElevenLabs API key", ctx(tenant_id, {
        step: "no_api_key",
        elevenlabs: "skipped"
      }));
      return {
        success: true,
        audio_base64: null,
        fallback_text: text,
        reason: "no_api_key",
        cache: "miss"
      };
    }

    const contentLang = locale || detectContentLang(text);
    const voiceId = resolveArsVoiceId(contentLang);
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

    logDebug("[synthesizeArsSpeech] ElevenLabs request", ctx(tenant_id, {
      step: "elevenlabs_request",
      content_lang: contentLang,
      voice_id: voiceId,
      model_id: ELEVEN_MODEL,
      text_len: text.length
    }));

    const t0 = Date.now();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg"
      },
      body: JSON.stringify({
        text,
        model_id: ELEVEN_MODEL,
        voice_settings: {
          stability: 0.7,
          similarity_boost: 0.75,
          speed: 0.9
        }
      })
    });
    const elapsed_ms = Date.now() - t0;

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      logWarn("[synthesizeArsSpeech] ElevenLabs error", ctx(tenant_id, {
        step: "elevenlabs_error",
        status: res.status,
        elapsed_ms,
        errText: errText.slice(0, 200),
        voice_id: voiceId
      }));
      return {
        success: true,
        audio_base64: null,
        fallback_text: text,
        reason: "tts_failed",
        cache: "miss"
      };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    logDebug("[synthesizeArsSpeech] ElevenLabs ok", ctx(tenant_id, {
      step: "elevenlabs_ok",
      status: res.status,
      elapsed_ms,
      audio_bytes: buf.length,
      voice_id: voiceId,
      content_lang: contentLang
    }));

    const payload = {
      success: true,
      audio_base64: buf.toString("base64"),
      content_type: "audio/mpeg",
      cache: "miss"
    };

    return {
      data: payload,
      afterSend: async () => {
        logDebug("[synthesizeArsSpeech] cache save start", ctx(tenant_id, {
          step: "cache_save_start",
          hash: cacheHash.slice(0, 16),
          audio_bytes: buf.length
        }));
        try {
          const gsPath = await saveTtsCache(tenant_id, cacheHash, buf);
          logDebug("[synthesizeArsSpeech] cache save ok", ctx(tenant_id, {
            step: "cache_save_ok",
            hash: cacheHash.slice(0, 16),
            gs_path: gsPath
          }));
          logInfo("[synthesizeArsSpeech] TTS cache saved", ctx(tenant_id, {
            cache: "saved",
            hash: cacheHash.slice(0, 16)
          }));
        } catch (e) {
          logWarn("[synthesizeArsSpeech] cache save failed", ctx(tenant_id, {
            step: "cache_save_failed",
            hash: cacheHash.slice(0, 16),
            error: e?.message || String(e)
          }));
        }
      }
    };
  }
});
