# Cloud Run Worker Job

이 디렉토리는 Cloud Run Job으로 실행되는 worker.js를 포함합니다.

## 주요 특징

- GCS에서 JSONL 파일을 읽어 임베딩 벡터로 변환
- Qdrant 벡터 데이터베이스에 저장
- Incremental Upsert/Delete 방식

## 배포

### Cloud Run Job Timeout 설정

기본 timeout은 10분이지만, 대용량 데이터 처리를 위해 **20분(1200초)으로 설정**되어 있습니다.

### 배포 스크립트 사용

```bash
cd cloud\ run
chmod +x deploy.sh
./deploy.sh
```

또는 환경변수로 커스터마이징:

```bash
GCP_PROJECT_ID=your-project \
JOB_REGION=us-central1 \
JOB_NAME=ingest-worker-job \
TIMEOUT=1200s \
./deploy.sh
```

### 수동 배포

```bash
# Docker 이미지 빌드 및 푸시
docker build -t gcr.io/PROJECT_ID/ingest-worker-job .
docker push gcr.io/PROJECT_ID/ingest-worker-job

# Cloud Run Job 생성/업데이트 (Timeout: 20분)
# Direct VPC egress 설정 포함 (Qdrant 접근용)
gcloud builds submit --tag gcr.io/frontierbase-console/ingest-worker-job . --project=frontierbase-console
  
gcloud run jobs deploy ingest-worker-job \
  --image=gcr.io/frontierbase-console/ingest-worker-job \
  --region=us-central1 \
  --project=frontierbase-console \
  --task-timeout=1200s \
  --max-retries=2 \
  --tasks=1 \
  --parallelism=1 \
  --cpu=2 \
  --memory=1Gi \
  --vpc-egress=private-ranges-only \
  --network=default \
  --set-env-vars="NODE_ENV=production"
```

### Timeout 업데이트만 필요한 경우

```bash
gcloud run jobs update ingest-worker-job \
  --region=us-central1 \
  --task-timeout=1200s
```

### Direct VPC Egress 설정

Job이 VPC 안 리소스(Qdrant 등)에 접근하기 위해 **Direct VPC egress**를 사용합니다.

- **장점**: Serverless VPC Access Connector 대비 비용 절감 및 성능 향상
- **설정**: `deploy.sh`에서 자동으로 설정됩니다 (`--vpc-egress=private-ranges-only --network=default`)
- **동작**: 내부 IP(private ranges)로의 트래픽만 VPC를 통해 라우팅됩니다

**수동으로 Direct VPC egress 설정:**

```bash
gcloud run jobs update ingest-worker-job \
  --region=us-central1 \
  --project=frontierbase-console \
  --vpc-egress=private-ranges-only \
  --network=default
```

**Direct VPC egress 제거 (VPC 미사용 시):**

```bash
gcloud run jobs update ingest-worker-job \
  --region=us-central1 \
  --project=frontierbase-console \
  --clear-vpc-egress \
  --clear-network
```

## Timeout 설정

- **현재 설정**: 20분 (1200초)
- **최대값**: 168시간 (7일) - Standard tasks
- **권장값**:
  - 소규모 데이터 (1,000 레코드 이하): 10분
  - 중규모 데이터 (1,000-10,000 레코드): 20분
  - 대규모 데이터 (10,000 레코드 이상): 30-60분

## 재시도 설정

- **현재 설정**: `--max-retries=2` (최대 2회 재시도)
- **재시도 제어 전략**: exit code를 사용하여 재시도 여부 제어
  - **재시도 가능한 오류**: `process.exit(1)` → Cloud Run이 재시도 (최대 2회)
    - 네트워크 오류, GCS/Qdrant/Firestore 연결 오류, 일시적 서비스 장애 (5xx 오류)
    - ⚠️ **중요**: 재시도 가능한 오류는 Firestore 상태를 업데이트하지 않음
      - 재시도 시도 시 정상적으로 작업을 진행할 수 있도록 하기 위함
      - 최대 재시도 횟수(2회)를 초과해도 상태는 업데이트되지 않음 (Cloud Run Job이 최종 실패로 표시)
  - **재시도 불가능한 오류**: `process.exit(0)` → Cloud Run이 재시도 안 함
    - 타임아웃 (데이터가 너무 많음), 설정 오류, 벡터 사이즈 불일치, 데이터 형식 오류, 동시 실행 오류
    - ⚠️ **중요**: 재시도 불가능한 오류만 Firestore 상태를 FAILED로 업데이트
      - 재시도해도 해결되지 않으므로 즉시 실패 처리
- **⚠️ 주의사항**:
  - `process.exit(0)`으로 종료하면 Cloud Run Job 대시보드에서는 **성공**으로 표시됨
  - 하지만 Firestore에는 이미 `status: FAILED`로 기록했으므로, **실제 상태는 실패**임
  - Cloud Run Job 대시보드와 Firestore 상태가 다를 수 있으므로, Firestore 상태를 기준으로 판단해야 함
- **오류 분류**:
  - `worker.js`에서 오류 유형을 자동으로 판단 (`isRetryableError()` 함수)
  - 재시도 가능 여부에 따라 exit code 결정
  - 로그에 `is_retryable` 정보 기록하여 모니터링 가능
- **일시적 오류 처리**:
  - OpenAI API 오류: `embedWithRetry` 함수에서 내부적으로 재시도 (최대 5회, 지수 백오프)
  - GCS, Qdrant, Firestore 연결 오류: Cloud Run Job 레벨에서 재시도 (최대 2회)

## 환경변수

필수 환경변수는 `workerTask.js`에서 Cloud Run Job 실행 시 전달됩니다:
- `TENANT`: 테넌트 ID
- `DATASET`: 데이터셋 ID
- `GCS_PATH`: GCS 파일 경로
- `QDRANT_URL`: Qdrant 서버 URL
- `EMBED_MODEL`: 임베딩 모델
- `VECTOR_SIZE`: 벡터 차원

## 동시성 설정

ingest-worker-job 은 **최대 5개 execution** 이 동시에 돌도록 Cloud Tasks 큐와 맞춥니다.
(같은 dataset 에 대한 동시 인덱싱은 `worker.js` 의 `processing_job_id` 로 방지)

### 1. Cloud Run Job 설정 (`--parallelism=1`)
```bash
--parallelism=1  # 한 execution 당 task 1개 (tasks=1 과 함께 사용)
--tasks=1
```

### 2. Cloud Tasks Queue 설정 (`max-concurrent-dispatches=10`) ⚠️ 중요
```bash
gcloud tasks queues create worker-queue \
  --location=us-central1 \
  --max-concurrent-dispatches=10 \
  --max-dispatches-per-second=5
```

기존 큐 업데이트:
```bash
gcloud tasks queues update worker-queue \
  --location=us-central1 \
  --max-concurrent-dispatches=5 \
  --max-dispatches-per-second=5
```

- `max-concurrent-dispatches=5`: 동시에 최대 5개 workerTask dispatch → Job execution 상한
- `workerTask` 는 Job 완료를 기다리지 않으므로, 실제 동시 execution 은 이 값 + 빠른 연속 enqueue 에 따라 달라질 수 있음

## 성능 추정

10,000 레코드 처리 시:
- 임베딩 생성: 약 5-6분 (배치 크기 64 기준)
- Qdrant Upsert: 약 1분
- 기타 처리: 약 1분
- **총 예상 시간: 약 6-8분**

20분 timeout으로 여유있게 처리 가능합니다.