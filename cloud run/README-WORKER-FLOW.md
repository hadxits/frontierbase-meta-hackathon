# worker.js 코드 흐름 문서

## 개요
`worker.js`는 Google Cloud Storage(GCS)에 저장된 JSONL 파일을 읽어 텍스트를 임베딩 벡터로 변환한 뒤, Qdrant 벡터 데이터베이스에 저장하는 ingest 워커입니다.  
이 워커는 **refresh-only 모드(삭제 → 업서트)** 로 동작하여 항상 데이터 일관성을 유지합니다.

## 주요 특징
- **증분 ingest + delete 동기화**: full JSONL과 worker JSONL을 함께 사용하여 변경 row만 upsert하고 삭제 row는 제거
- **테넌트 기반 컬렉션 구조**: `{base}__{tenant}` (예: `cm_chunks__hadfamily`)
- **row payload 보존**: `text`와 optional `fields` / `typed_fields`를 Qdrant payload에 함께 저장
- **배치 처리**: 대량 텍스트를 배치 단위로 임베딩 생성
- **토큰 사용량 추적**: Firestore에 토큰 사용량 기록

## 아키텍처 흐름

```
1. 환경변수 읽기 및 검증
   ↓
2. 컬렉션 이름 생성
   ↓
3. Ingest ID 생성
   ↓
4. worker JSONL / full JSONL 읽기
   ↓
5. canonical row 파싱 및 삭제 대상 계산
   ↓
6. 임베딩 생성 (변경 row만)
   ↓
7. 벡터 크기 검증
   ↓
8. Qdrant 컬렉션 확인/생성
   ↓
9. 포인트 준비
   ↓
10. 배치 업서트
    ↓
11. 삭제 row 제거
    ↓
12. 토큰 사용량 업데이트
    ↓
13. dataset/jsonl_paths 반영 및 완료 로그
```

## 환경변수

### 필수
- `TENANT`
- `DATASET`
- `GCS_PATH`
- `DOC_ID`
- `EMBED_MODEL`
- `OPENAI_API_KEY`
- `QDRANT_URL`

### 선택
- `QUERY_VECTOR`
- `JOB_ID`
- `QDRANT_COLLECTION_BASE`
- `EMBED_BATCH`
- `EMBED_MAX_RETRIES`