# RAG Observations

`rag_observations`는 답변을 덮어쓰기 위한 규칙 저장소가 아니라, 운영 중 발견되는 RAG 실패/애매 케이스를 구조화해 축적하는 관측 테이블이다.

저장 위치:
- `rag_observations/{observationId}`

식별/필터링 필드:
- `tenant_id`
- `conversation_id`
- `dataset_ids`
- `failure_class`

핵심 원칙:
- 런타임 프롬프트/룰 엔진에서 직접 참조하지 않는다.
- 사용량 집계(`audit_monthly`)와 분리한다.
- 실패 분석, 회귀셋 생성, 일반 규칙 개선의 입력으로만 사용한다.
- 전체 요청을 무조건 저장하지 않고 조건부로 저장한다.

저장 조건:
- 요청 자체가 에러로 끝난 경우
- 검색 결과가 비거나 필터링 후 비정상적으로 사라진 경우
- `selected_count`가 과도하게 줄어드는 `premature_compression`
- `weak_coverage`, `verification_reject`, `bad_axis_selection`
- 표 요청인데 표가 제대로 렌더링되지 않은 경우

저장하지 않는 경우:
- 단순 `compare`/`table`/긴 질문이라는 이유만으로는 저장하지 않음
- 정상적으로 처리된 wide-context 질문은 저장하지 않음
- `single_hop_ok`, `unknown`처럼 개선 우선순위가 낮은 케이스는 저장하지 않음

문서 구조:
- 요청 식별: `tenant_id`, `conversation_id`, `runner_run_id`, `dataset_ids`, `observed_at`
- 질문 구조: `question_type`, `intent`, `presentation_intent`, `entity_count`, `entities`, 각종 hint
- 검색 분포: `all_results_count`, `filtered_results_count`, `preselected_count`, `selected_count`, `score_summary`, `dataset_spread`
- 컨텍스트: `rag_context_length`, `context_chunk_count`, `avg_chunk_chars`, `debug`
- 최종 산출: `source`, `resolve_reason`, `verification_reason`, `used_table_fallback`, `used_main_model`, `delivery_model`
- 본문 최소화: 답변/에러 본문은 전문이 아니라 `final_text_preview`, `preferred_evidence_answer_preview`, `error_message_preview`만 저장
- 품질 신호: `looks_like_markdown_table`, `table_header_preview`, `empty_cell_ratio`, `meta_field_axis_risk`, `low_quality_markdown_table`
- 일반화 실패 분류: `failure_signals`, `failure_class`

대표 `failure_class` 예시:
- `request_error`
- `weak_retrieval`
- `premature_compression`
- `weak_coverage`
- `verification_reject`
- `bad_axis_selection`
- `presentation_miss`
- `single_hop_ok`

이 테이블은 새 케이스가 나왔을 때 if문을 추가하기 위한 용도가 아니라, 어떤 실패 클래스가 반복되는지 가로로 비교하기 위한 용도다.