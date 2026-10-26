# Worker.js 동시 실행 이슈 분석

## 현재 동시 실행 방지 메커니즘

### 1. Dataset 상태 체크 (Firestore 트랜잭션)
- **위치**: `main()` 함수 시작 부분 (1293-1352 라인)
- **방식**: Firestore 트랜잭션으로 `processing_job_id` 체크
- **동작**:
  - `INDEXING` 상태이고 30분 이내 업데이트된 경우 → 다른 작업 실행 중으로 판단
  - `processing_job_id`가 다르면 → 에러 발생하여 작업 중단
  - `processing_job_id`가 같으면 → 재시도로 간주하여 계속 진행

### 2. Cloud Tasks Queue 설정
- **`max-concurrent-dispatches=1`**: Queue 레벨에서 동시 dispatch 제한
- **`--parallelism=1`**: Cloud Run Job 레벨에서 동시 task 제한

## 동시 실행 시 잠재 이슈

### ⚠️ 1. Race Condition (트랜잭션 타이밍)
**시나리오**: 두 작업이 거의 동시에 시작되는 경우

```
시간 | 작업 A                    | 작업 B
-----|--------------------------|--------------------------
T1   | 트랜잭션 시작             |
T2   | 상태 체크: READY         | 트랜잭션 시작
T3   | 상태 업데이트: INDEXING  | 상태 체크: READY (아직 업데이트 안됨)
T4   | processing_job_id 저장   | 상태 업데이트: INDEXING
T5   | 트랜잭션 커밋             | processing_job_id 저장
T6   |                          | 트랜잭션 커밋 ✅
```

**문제점**:
- 두 작업 모두 `READY` 상태를 보고 시작할 수 있음
- Firestore 트랜잭션은 원자성을 보장하지만, 두 트랜잭션이 동시에 시작되면 둘 다 통과할 수 있음

**현재 보호**:
- 트랜잭션 내에서 `processing_job_id`를 체크하므로, 첫 번째 작업이 커밋하면 두 번째 작업은 실패
- 하지만 타이밍에 따라 둘 다 통과할 가능성 있음

### ⚠️ 2. Qdrant 동시 접근
**시나리오**: 같은 dataset에 대해 두 작업이 동시에 실행되는 경우

**문제점**:
1. **기존 row_id 조회 시점 불일치**:
   - 작업 A: 기존 row_id 조회 → [1, 2, 3]
   - 작업 B: 기존 row_id 조회 → [1, 2, 3] (A가 아직 upsert 전)
   - 작업 A: row 4 upsert
   - 작업 B: row 4 upsert (중복 또는 덮어쓰기)

2. **삭제 작업 충돌**:
   - 작업 A: row 1 삭제
   - 작업 B: row 1 삭제 (이미 삭제됨)
   - 결과: 무해하지만 불필요한 작업

3. **Upsert 순서 문제**:
   - 작업 A: row 1을 버전 2로 upsert
   - 작업 B: row 1을 버전 1로 upsert (이전 데이터)
   - 결과: 최종적으로 어떤 버전이 남을지 불확실

### ⚠️ 3. Token 사용량 중복 계산
**시나리오**: 두 작업이 동시에 토큰 사용량을 업데이트하는 경우

**현재 보호**:
- Firestore 트랜잭션으로 처리 (`runTransaction`)
- `FieldValue.increment()` 사용으로 원자적 증가 보장
- **안전함**: 트랜잭션으로 보호됨

### ⚠️ 4. Dataset 상태 업데이트 충돌
**시나리오**: 두 작업이 동시에 상태를 업데이트하는 경우

**문제점**:
- 작업 A: `READY`로 업데이트
- 작업 B: `FAILED`로 업데이트 (에러 발생)
- 결과: 마지막에 업데이트한 작업의 상태가 남음

**현재 보호**:
- `processing_job_id` 체크로 동시 실행 방지
- 하지만 완전히 보장되지 않음

## 권장 사항

### 1. 현재 메커니즘 유지 (권장)
- Cloud Tasks Queue의 `max-concurrent-dispatches=1`이 가장 중요한 보호 장치
- Dataset 상태 체크는 추가 안전장치
- **대부분의 경우 충분함**

### 2. 추가 보호가 필요한 경우
- **분산 락 사용**: Redis 또는 Firestore를 이용한 분산 락
- **Optimistic Locking**: `updated_at` 타임스탬프를 이용한 낙관적 잠금
- **Qdrant 트랜잭션**: Qdrant가 트랜잭션을 지원하는지 확인

### 3. 모니터링
- `processing_job_id` 충돌 로그 모니터링
- 동시 실행 감지 시 Sentry 알림

## 서로 다른 Tenant에서 동시 실행되는 경우

### ✅ 완전히 격리되어 있음 (이슈 없음)

서로 다른 tenant에서 실행되는 경우, 모든 리소스가 tenant별로 완전히 분리되어 있습니다:

1. **Dataset 상태 체크**:
   - 경로: `tenants/{tenant}/datasets/{datasetId}`
   - 서로 다른 tenant → 서로 다른 Firestore 경로
   - **충돌 없음**

2. **Qdrant 컬렉션**:
   - 컬렉션 이름: `{base}__{tenant}` (예: `cm_chunks__hadfamily`)
   - 서로 다른 tenant → 서로 다른 컬렉션
   - **충돌 없음**

3. **Token 사용량**:
   - 경로: `tenants/{tenant}`
   - 서로 다른 tenant → 서로 다른 Firestore 문서
   - **충돌 없음**

4. **Qdrant 조회/삭제**:
   - Filter에 `tenant`와 `dataset` 모두 포함
   - 서로 다른 tenant → 서로 다른 데이터셋
   - **충돌 없음**

### 결론: 서로 다른 Tenant → 완전히 안전함 ✅

## 같은 Tenant, 다른 Dataset에서 동시 실행되는 경우

### ⚠️ 일부 격리, 일부 공유

1. **Dataset 상태 체크**: ✅ 격리됨
   - 경로: `tenants/{tenant}/datasets/{datasetId}`
   - 다른 dataset → 다른 Firestore 경로
   - **충돌 없음**

2. **Qdrant 컬렉션**: ⚠️ 공유됨
   - 컬렉션: `{base}__{tenant}` (tenant 단위)
   - 같은 tenant, 다른 dataset → 같은 컬렉션 사용
   - 하지만 filter로 `dataset` 구분하므로 **직접적 충돌 없음**
   - 다만 컬렉션 레벨 리소스 경합 가능 (성능 영향만, 데이터 무결성 문제 없음)

3. **Token 사용량**: ⚠️ 공유됨
   - 경로: `tenants/{tenant}` (tenant 단위)
   - 같은 tenant → 같은 Firestore 문서
   - **하지만 Firestore 트랜잭션으로 보호됨** ✅
   - `FieldValue.increment()` 사용으로 원자적 증가 보장

### 결론: 같은 Tenant, 다른 Dataset → 대부분 안전함 ✅

## 같은 Tenant, 같은 Dataset에서 동시 실행되는 경우

### ⚠️ 이슈 가능성 있음 (현재 분석 내용)

이 경우에만 위에서 분석한 race condition 및 데이터 불일치 가능성이 있습니다.

## 결론

**서로 다른 Tenant에서 실행**: ✅ **완전히 안전함** (이슈 없음)
- 모든 리소스가 tenant별로 완전히 격리됨
- 동시 실행해도 문제 없음

**같은 Tenant, 다른 Dataset에서 실행**: ✅ **대부분 안전함**
- Dataset 상태는 격리됨
- Qdrant는 같은 컬렉션이지만 filter로 구분됨
- Token 사용량은 트랜잭션으로 보호됨

**같은 Tenant, 같은 Dataset에서 실행**: ⚠️ **이슈 가능성 있음**
- Cloud Tasks Queue `max-concurrent-dispatches=1`이 주요 보호 장치
- Dataset 상태 체크가 추가 안전장치
- 극히 드문 경우에 race condition 가능성 있음