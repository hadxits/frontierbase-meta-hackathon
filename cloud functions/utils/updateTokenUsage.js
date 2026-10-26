/**
 * ============================================================================
 * updateTokenUsage.js - 토큰 사용량 업데이트 유틸리티
 * ============================================================================
 *
 * Firestore에 토큰 사용량을 업데이트합니다 (billing month 기준).
 *
 * 업데이트 대상:
 * - tenants/{tenant_id} 문서의 usage 필드 (token_used_billing_month, token_used_month, token_used_today 포함)
 * - tenants/{tenant_id}/usage_daily/{dateKey} 문서 생성/업데이트 (최초 생성 시 created_at 저장)
 * - tenants/{tenant_id}/usage_monthly/{monthKey} 문서 생성/업데이트 (최초 생성 시 created_at 저장)
 * - tenants/{tenant_id}/usage_billing/{billingKey} 문서 생성/업데이트 (최초 생성 시 created_at 저장)
 * - billing window 만료 시 token_used_billing_month 초기화 및 window 재계산
 *
 * @param {string} tenantId - 테넌트 ID
 * @param {number} tokenCount - 사용한 토큰 수
 * @param {Object} options - 선택적 옵션
 * @param {Date} options.now - 현재 시간 (테스트용, 기본값: new Date())
 * @param {boolean} [options.incrementMessageTotal] - usage_daily/monthly message.total +1
 * @param {boolean} [options.skipTokenUsage] - 토큰/애드온/usage tokens 차감 스킵 (message만)
 */
const { store } = require("@/firebase");
const { FieldValue, FieldPath } = require("firebase-admin/firestore");
const Collection = require("@/const/firestore/Collection");
const {
  calculateBillingWindow,
  isBillingWindowExpired,
  generateBillingKey,
  formatDateString
} = require("@/utils/calculateBillingWindow");
const { toUtcDateKey, toUtcMonthKey } = require("@/utils/utcDateKey");
const { logInfo, logWarn, logAndCaptureError } = require("@/utils/logger");
const { captureMessage } = require("@/utils/sentry");
const {
  processAddonStatus,
  consumeAddonTokens
} = require("@/utils/addonToken");

/**
 * Tenant의 billing window 계산 (재사용 가능한 함수)
 * @param {Object} billing - Tenant 문서의 billing 필드
 * @param {Date} now - 현재 시간
 * @returns {{windowStartAt: Date, windowEndAt: Date, shouldResetBillingMonth: boolean}}
 */
function calculateBillingWindowForTenant(billing, now) {
  // startDay가 null이면 오늘 날짜의 일(day)을 기준으로 설정
  const startDay = billing?.startDay != null ? billing.startDay : now.getDate();

  // number 타입 timestamp를 Date로 변환 (항상 number로 저장됨)
  let existingWindowStartAt = null;
  let existingWindowEndAt = null;

  if (billing?.windowStartAt) {
    existingWindowStartAt = new Date(billing.windowStartAt);
  }

  if (billing?.windowEndAt) {
    existingWindowEndAt = new Date(billing.windowEndAt);
  }

  let windowStartAt = existingWindowStartAt;
  let windowEndAt = existingWindowEndAt;
  let shouldResetBillingMonth = false;

  // billing window가 만료되었는지 확인
  if (existingWindowEndAt && isBillingWindowExpired(existingWindowEndAt, now)) {
    // window가 만료되었으면 재계산 및 초기화
    const newWindow = calculateBillingWindow(
      now,
      startDay,
      existingWindowStartAt
    );
    windowStartAt = newWindow.windowStartAt;
    windowEndAt = newWindow.windowEndAt;
    shouldResetBillingMonth = true;
  } else if (!existingWindowStartAt || !existingWindowEndAt) {
    // window가 없으면 오늘 날짜 기준으로 초기 계산
    const newWindow = calculateBillingWindow(now, startDay, null);
    windowStartAt = newWindow.windowStartAt;
    windowEndAt = newWindow.windowEndAt;
  }

  return {
    windowStartAt,
    windowEndAt,
    shouldResetBillingMonth
  };
}

/**
 * 토큰 사용량 업데이트 후 반환할 업데이트 정보
 * @typedef {Object} TokenUsageUpdateResult
 * @property {Object} usage - 업데이트된 usage 필드 값들
 * @property {Object} billing - 업데이트된 billing 필드 값들
 * @property {Array} addon_token - 업데이트된 addon_token 배열
 */
async function updateTokenUsage(tenantId, tokenCount, options = {}) {
  try {
    const incrementMessageTotal = options.incrementMessageTotal === true;
    // skipTokenUsage: 테넌트/usage_* 토큰 차감·애드온 소진 없이 message.total만 증가 (미답변 등)
    const skipTokenUsage = options.skipTokenUsage === true;
    const rawTokenCount = Number(tokenCount) || 0;
    const effectiveTokenCount = skipTokenUsage ? 0 : rawTokenCount;

    if (!tenantId) {
      return null;
    }
    if (!skipTokenUsage && rawTokenCount <= 0) {
      return null;
    }
    if (skipTokenUsage && !incrementMessageTotal) {
      return null;
    }

    const now = options.now || new Date();
    const timestamp = now.getTime();
    // 아래 기존 로직은 tokenCount 변수명을 쓰므로 effective로 통일
    tokenCount = effectiveTokenCount;

    // 날짜 정보 생성 (usage_daily / 일일 메일과 동일하게 UTC)
    const dateKey = toUtcDateKey(now); // "2024-01-15"
    const monthKey = toUtcMonthKey(now); // "2024-01"

    // 트랜잭션으로 billing window 체크 및 업데이트
    // 업데이트된 값을 반환하기 위해 변수 선언
    let updatedUsage = null;
    let updatedBilling = null;
    let updatedAddonToken = null;
    let tenantDocumentMissing = false;

    await store.runTransaction(async (transaction) => {
      const docRef = store.collection(Collection.TENANTS).doc(tenantId);
      const docSnap = await transaction.get(docRef);

      if (!docSnap.exists) {
        // transaction callback은 재실행될 수 있으므로 외부 로깅/Sentry는 종료 후 한 번만 수행
        tenantDocumentMissing = true;
        return;
      }

      const data = docSnap.data();
      const billing = data?.billing || {};
      const usage = data?.usage || {};
      const quota = data?.quota || {};

      // billing window 계산 (재사용 가능한 함수 사용)
      const billingWindowResult = calculateBillingWindowForTenant(billing, now);
      const windowStartAt = billingWindowResult.windowStartAt;
      const windowEndAt = billingWindowResult.windowEndAt;
      const shouldResetBillingMonth =
        billingWindowResult.shouldResetBillingMonth;

      // billingKey 생성
      const billingKey = generateBillingKey(windowStartAt, windowEndAt);

      // Firestore 트랜잭션 규칙: 모든 read를 write보다 먼저 수행해야 함
      const dailyRef = store
        .collection(Collection.TENANTS)
        .doc(tenantId)
        .collection(Collection.USAGE_DAILY)
        .doc(dateKey);
      const monthlyRef = store
        .collection(Collection.TENANTS)
        .doc(tenantId)
        .collection(Collection.USAGE_MONTHLY)
        .doc(monthKey);
      const billingRef = store
        .collection(Collection.TENANTS)
        .doc(tenantId)
        .collection(Collection.USAGE_BILLING)
        .doc(billingKey);
      const [dailySnap, monthlySnap, billingSnap] = await Promise.all([
        transaction.get(dailyRef),
        transaction.get(monthlyRef),
        transaction.get(billingRef)
      ]);

      // 날짜/월 초기화 체크
      const lastUpdatedDate = usage?.lastUpdatedDate; // "2024-01-15" 형식
      const lastUpdatedMonth = usage?.lastUpdatedMonth; // "2024-01" 형식

      // 날짜가 바뀌었는지 확인 (lastUpdatedDate가 있고 오늘과 다르면)
      const shouldResetToday = lastUpdatedDate && lastUpdatedDate !== dateKey;
      // 월이 바뀌었는지 확인 (lastUpdatedMonth가 있고 이번 달과 다르면)
      const shouldResetMonth =
        lastUpdatedMonth && lastUpdatedMonth !== monthKey;

      // ✅ 토큰 계산: windowStartAt 체크 후 수행 (shouldResetBillingMonth 반영)
      // 기본 플랜 한도 확인
      const baseTokenLimit = quota.token_limit_month || Infinity;
      // shouldResetBillingMonth가 true면 billing month가 초기화되므로 0으로 간주
      const currentTokenUsedBillingMonth = shouldResetBillingMonth
        ? 0
        : usage.token_used_billing_month || 0;

      // 기본 플랜에서 사용할 수 있는 토큰 계산
      let usedFromBasePlan = 0;
      let remainingForAddon = tokenCount;

      if (baseTokenLimit !== Infinity) {
        // 기본 플랜 한도 내에서 사용 가능한 토큰
        // 동시성 문제로 인해 currentTokenUsedBillingMonth가 baseTokenLimit을 초과할 수 있으므로 안전장치 추가
        const availableInBasePlan = Math.max(
          0,
          baseTokenLimit - currentTokenUsedBillingMonth
        );
        // 기본 플랜에서 사용할 토큰 (한도 내에서만, 마이너스 방지)
        usedFromBasePlan = Math.max(
          0,
          Math.min(tokenCount, availableInBasePlan)
        );
        // 기본 플랜 한도를 초과한 부분은 애드온에서 사용
        remainingForAddon = Math.max(0, tokenCount - usedFromBasePlan);
      } else {
        // 무제한이면 모두 기본 플랜에서 사용
        usedFromBasePlan = tokenCount;
        remainingForAddon = 0;
      }

      // 애드온 토큰 배열 처리
      let addonTokenArray = Array.isArray(data?.addon_token)
        ? data.addon_token
        : [];

      // F5, F6: 만료 및 소진 처리
      let updatedAddonTokenArray = processAddonStatus(
        addonTokenArray,
        timestamp
      );

      // 기본 플랜 한도를 초과한 부분만 애드온에서 차감
      let usedFromAddon = 0;

      if (remainingForAddon > 0) {
        const addonResult = consumeAddonTokens(
          updatedAddonTokenArray,
          remainingForAddon,
          timestamp
        );
        usedFromAddon = addonResult.usedFromAddon; // 애드온에서 사용한 토큰 수
        updatedAddonTokenArray = addonResult.updated; // 업데이트된 애드온 토큰 배열
        // 애드온에서 사용하지 못한 부분은 그대로 둠 (한도 초과로 처리)
      }

      // updatedAddonTokenArray가 없거나 유효하지 않으면 빈 배열로 설정
      if (!Array.isArray(updatedAddonTokenArray)) {
        updatedAddonTokenArray = [];
      }

      // 업데이트할 데이터 준비
      const updateData = {
        usage: {
          lastUpdatedDate: dateKey, // 마지막 업데이트 날짜 저장
          lastUpdatedMonth: monthKey // 마지막 업데이트 월 저장
        },
        billing: {
          ...billing,
          startDay:
            billing?.startDay != null ? billing.startDay : now.getDate(), // startDay가 null이면 오늘 날짜의 일(day)을 기준으로 설정
          windowStartAt: windowStartAt.getTime(),
          windowEndAt: windowEndAt.getTime()
        },
        // F5, F6: 업데이트된 애드온 토큰 배열 저장 (토큰 차감 시에만)
        ...(skipTokenUsage ? {} : { addon_token: updatedAddonTokenArray })
      };

      // F4) 기본 플랜 사용량 업데이트 (기본 플랜 한도 내에서 사용한 만큼만)
      // usedFromBasePlan이 마이너스가 되지 않도록 보장 (동시성 문제 대비)
      const safeUsedFromBasePlan = Math.max(0, usedFromBasePlan);

      // skipTokenUsage: 토큰/애드온/usage_* tokens 필드는 건드리지 않음 (message.total만)
      if (!skipTokenUsage) {
      // token_used_today 업데이트
      // 동시 요청 시 race condition 방지:
      // 트랜잭션의 원자성을 활용하여, lastUpdatedDate 업데이트와 함께 처리
      // 두 요청이 동시에 오면 하나는 성공하고 다른 하나는 재시도됨
      // 재시도 시에는 이미 lastUpdatedDate가 업데이트되어 있으므로 증가로 처리됨
      if (shouldResetToday) {
        // 날짜가 바뀌었으면 초기화
        // 트랜잭션의 원자성으로 인해, 동시 요청 시 하나만 성공하고
        // 다른 하나는 재시도되어 최신 데이터로 다시 판단됨
        updateData.usage.token_used_today = tokenCount;
      } else {
        // 날짜가 같으면 항상 증가
        updateData.usage.token_used_today = FieldValue.increment(tokenCount);
      }

      // token_used_month 업데이트
      // 동시 요청 시 race condition 방지:
      // 트랜잭션의 원자성을 활용하여, lastUpdatedMonth 업데이트와 함께 처리
      if (shouldResetMonth) {
        // 월이 바뀌었으면 초기화
        // 트랜잭션의 원자성으로 인해, 동시 요청 시 하나만 성공하고
        // 다른 하나는 재시도되어 최신 데이터로 다시 판단됨
        updateData.usage.token_used_month = tokenCount;
      } else {
        // 월이 같으면 항상 증가
        updateData.usage.token_used_month = FieldValue.increment(tokenCount);
      }

      // billing month 초기화가 필요한 경우
      if (shouldResetBillingMonth) {
        updateData.usage.token_used_billing_month = safeUsedFromBasePlan; // 초기화 후 기본 플랜 사용량만 추가
        // 토큰 부족 메일: 새 윈도우에서는 다시 발송 가능하도록 플래그 리셋
        if (data?.alarm?.tokenLowMailing === true) {
          updateData.alarm = {
            ...(data.alarm || {}),
            tokenLowMailingSent50ThisWindow: false,
            tokenLowMailingSent10ThisWindow: false,
          };
        }
      } else {
        // 마이너스 값으로 인한 감소 방지
        if (safeUsedFromBasePlan > 0) {
          updateData.usage.token_used_billing_month =
            FieldValue.increment(safeUsedFromBasePlan);
        }
        // safeUsedFromBasePlan이 0이면 업데이트하지 않음 (현재 값 유지)
      }

      // F3) 애드온 사용 누적값 업데이트 (통계용, 절대 감소하지 않음)
      if (usedFromAddon > 0) {
        const currentAddonUsed = usage.token_used_addon_token || 0;
        updateData.usage.token_used_addon_token =
          currentAddonUsed + usedFromAddon;
      }
      } // end !skipTokenUsage (토큰 필드 갱신)

      // 캐시 업데이트를 위해 업데이트된 값 계산
      const currentTokenUsedToday = usage.token_used_today || 0;
      const currentTokenUsedMonth = usage.token_used_month || 0;
      // currentTokenUsedBillingMonth는 Line 169에서 이미 선언됨
      const currentTokenUsedAddonToken = usage.token_used_addon_token || 0;

      // 업데이트된 usage 값 계산
      updatedUsage = skipTokenUsage
        ? {
            lastUpdatedDate: dateKey,
            lastUpdatedMonth: monthKey,
            token_used_today: currentTokenUsedToday,
            token_used_month: currentTokenUsedMonth,
            token_used_billing_month: currentTokenUsedBillingMonth,
            token_used_addon_token: currentTokenUsedAddonToken
          }
        : {
            lastUpdatedDate: dateKey,
            lastUpdatedMonth: monthKey,
            token_used_today: shouldResetToday
              ? tokenCount
              : currentTokenUsedToday + tokenCount,
            token_used_month: shouldResetMonth
              ? tokenCount
              : currentTokenUsedMonth + tokenCount,
            token_used_billing_month: shouldResetBillingMonth
              ? safeUsedFromBasePlan
              : currentTokenUsedBillingMonth + safeUsedFromBasePlan,
            token_used_addon_token:
              usedFromAddon > 0
                ? currentTokenUsedAddonToken + usedFromAddon
                : currentTokenUsedAddonToken
          };

      // 업데이트된 billing 값
      // startDay는 calculateBillingWindowForTenant에서 계산된 값 사용
      const calculatedStartDay =
        billing?.startDay != null ? billing.startDay : now.getDate();
      updatedBilling = {
        ...billing,
        startDay: calculatedStartDay,
        windowStartAt: windowStartAt.getTime(),
        windowEndAt: windowEndAt.getTime()
      };

      // 업데이트된 addon_token 배열
      updatedAddonToken = updatedAddonTokenArray;

      // 1. tenants/{tenant_id} 문서 업데이트
      transaction.set(docRef, updateData, { merge: true });

      // 2. tenants/{tenant_id}/usage_daily/{dateKey} 문서 생성/업데이트
      // message.total은 중첩 맵으로 저장해 실제 스키마와 일치시킵니다.
      const dailyPayload = {
        date_key: dateKey,
        month_key: monthKey,
        tenant_id: tenantId,
        updated_at: timestamp
      };
      if (!skipTokenUsage) {
        dailyPayload.tokens = {
          total: FieldValue.increment(tokenCount)
        };
      }
      if (incrementMessageTotal) {
        dailyPayload.message = {
          total: FieldValue.increment(1)
        };
      }
      if (!dailySnap.exists) {
        dailyPayload.created_at = timestamp;
      }
      transaction.set(dailyRef, dailyPayload, { merge: true });
      if (
        dailySnap.exists &&
        Object.prototype.hasOwnProperty.call(dailySnap.data() || {}, "message.total")
      ) {
        transaction.update(
          dailyRef,
          new FieldPath("message.total"),
          FieldValue.delete()
        );
      }

      // 3. tenants/{tenant_id}/usage_monthly/{monthKey} 문서 생성/업데이트
      const monthlyPayload = {
        month_key: monthKey,
        tenant_id: tenantId,
        updated_at: timestamp
      };
      if (!skipTokenUsage) {
        monthlyPayload.tokens = {
          total: FieldValue.increment(tokenCount)
        };
      }
      if (incrementMessageTotal) {
        monthlyPayload.message = {
          total: FieldValue.increment(1)
        };
      }
      if (!monthlySnap.exists) {
        monthlyPayload.created_at = timestamp;
      }
      transaction.set(monthlyRef, monthlyPayload, { merge: true });
      if (
        monthlySnap.exists &&
        Object.prototype.hasOwnProperty.call(monthlySnap.data() || {}, "message.total")
      ) {
        transaction.update(
          monthlyRef,
          new FieldPath("message.total"),
          FieldValue.delete()
        );
      }

      // 4. tenants/{tenant_id}/usage_billing/{billingKey} 문서 생성/업데이트
      // usage_billing에는 전체 사용량(기본 플랜 + 애드온)을 저장
      if (!skipTokenUsage) {
        const totalUsageForBilling = safeUsedFromBasePlan + usedFromAddon;

        const billingPayload = {
          billingKey,
          tokens: {
            total: FieldValue.increment(totalUsageForBilling)
          },
          windowStart: formatDateString(windowStartAt),
          windowEnd: formatDateString(windowEndAt),
          tenant_id: tenantId,
          updated_at: timestamp
        };
        if (!billingSnap.exists) {
          billingPayload.created_at = timestamp;
        }
        transaction.set(billingRef, billingPayload, { merge: true });
      }

      logInfo(
        `[updateTokenUsage] Token usage updated${shouldResetBillingMonth ? " (billing month 초기화됨)" : ""}${skipTokenUsage ? " (skipTokenUsage: message only)" : ""}`,
        {
          tenant_id: tenantId,
          function_name: "updateTokenUsage",
          extra: {
            token_count: tokenCount,
            raw_token_count: rawTokenCount,
            skip_token_usage: skipTokenUsage,
            increment_message_total: incrementMessageTotal,
            used_from_base_plan: usedFromBasePlan,
            used_from_addon: usedFromAddon,
            base_token_limit: baseTokenLimit,
            current_token_used_billing_month: currentTokenUsedBillingMonth,
            dateKey,
            monthKey,
            billingKey,
            shouldResetBillingMonth,
            purpose: options.purpose || null,
            step: options.step || null,
            batch_index: options.batch_index ?? null,
            batch_total: options.batch_total ?? null,
            leaf_index: options.leaf_index ?? null,
            leaf_total: options.leaf_total ?? null
          }
        }
      );
    });

    if (tenantDocumentMissing) {
      logWarn("[updateTokenUsage] Tenant 문서가 없음", {
        tenant_id: tenantId,
        function_name: "updateTokenUsage"
      });
      captureMessage(
        "[updateTokenUsage] Tenant document missing; token charge skipped",
        "warning",
        {
          tenant_id: tenantId || "unknown",
          function_name: "updateTokenUsage",
          tags: { alert_code: "token_usage_tenant_missing" },
          fingerprint: ["token_usage_tenant_missing", tenantId || "unknown"],
          extra: {
            token_count: tokenCount,
            skip_token_usage: skipTokenUsage,
            increment_message_total: incrementMessageTotal
          }
        }
      );
    }

    // 업데이트된 값 반환 (캐시 업데이트용)
    return {
      usage: updatedUsage,
      billing: updatedBilling,
      addon_token: updatedAddonToken
    };
  } catch (error) {
    logAndCaptureError(error, "[updateTokenUsage] Token usage update failed", {
      tenant_id: tenantId,
      function_name: "updateTokenUsage"
    });
    // 에러가 발생해도 메인 프로세스는 계속 진행
    return null;
  }
}

// 함수에 속성으로 추가 (하위 호환성 유지)
// updateTokenUsage() - 함수로 직접 호출 가능
// updateTokenUsage.calculateBillingWindowForTenant - 속성으로 접근 가능
updateTokenUsage.calculateBillingWindowForTenant =
  calculateBillingWindowForTenant;
module.exports = updateTokenUsage;