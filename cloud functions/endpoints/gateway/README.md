# API Gateway (api.frontierbase.io)

단일 도메인 `https://api.frontierbase.io` 에서 path로 분기하는 게이트웨이입니다.

## 경로 매핑

| Path | 핸들러 | 인증 |
|------|--------|------|
| `/chat`, `/chat/*` | streamChatRag | **필수** `Authorization: Bearer <client_token>` (ephemeral JWT, scope `rag:stream`) |
| `/messages`, `/messages/*` | getChatMessages | **필수** `Authorization: Bearer <client_token>` (동일 JWT) |
| `/session`, `/session/*` | getSession | **필수** `Authorization: Bearer <Server API Secret>` (`fb_sk_...`) |
| `/public/session` | getSession.buildChatSessionData | Origin/Referer 제한 (www `/support` 전용, secret 없음) |
| 그 외 | 404 | - |

## 인증 흐름

1. **POST /session** (고객사 백엔드 전용)  
   헤더 `Authorization: Bearer <Server API Secret>` 필수.  
   Body: `user_id`, `project_id` (선택).  
   Server API Secret은 Console > Development > API Key Management에서 발급. DB에는 hash만 저장되고 원문은 생성 시 1회만 표시됩니다.  
   응답 `data`: `client_token`, `token_type: "Bearer"`, `expires_in`, `expires_at`, `conversation_id`, `plugin_key`(secret에 바인딩된 tenant).  
   JWT claim에 `tenant_id`가 포함되며, `conversation_id`는 `tenant_id|user_id|project_id` 결정적 해시입니다.

2. **POST /chat**, **POST /messages**  
   헤더 `Authorization: Bearer <client_token>` 필수.  
   Body의 `plugin_key`는 선택이나, 보낼 경우 JWT의 `tenant_id`와 일치해야 합니다(불일치 → FB_105).  
   생략 시 JWT의 `tenant_id`가 사용됩니다.  
   `conversation_id`는 JWT `cid`를 사용합니다.

3. **에러 코드**  
   - 토큰 없음 → FB_100  
   - 만료 → FB_101  
   - 잘못된 토큰 → FB_102  
   - scope 부족 → FB_103  
   - Server API Secret 무효 → FB_104  
   - plugin_key / tenant 불일치 → FB_105  
   - FREE 플랜 → FB_302

환경변수: `EPHEMERAL_JWT_SECRET`(32바이트 이상 권장, `openssl rand -hex 32`), `EPHEMERAL_TTL_SEC`(선택, 기본 300).

## GCP 도메인 매핑

1. **Cloud Functions** 에서 `apiGateway` 함수를 배포한 뒤 URL을 확인합니다.
   - 예: `https://us-central1-<project>.cloudfunctions.net/apiGateway`

2. **도메인 매핑** 방식 (둘 중 하나 선택)
   - **Firebase Hosting**: Hosting 사이트에 커스텀 도메인 `api.frontierbase.io` 추가 후, `rewrites` 로 `api.frontierbase.io/*` → `apiGateway` 연결.
   - **Load Balancer + Serverless NEG**: Backend에 Cloud Functions NEG로 `apiGateway` URL을 등록하고, 해당 백엔드에 `api.frontierbase.io` 호스트/경로 규칙으로 트래픽 전달.

3. 사용자 요청
   - `POST https://api.frontierbase.io/chat` → streamChatRag
   - `POST https://api.frontierbase.io/session` → getSession

보안·검증(POST 허용, body 스키마 등)은 각 핸들러(streamChatRag, getSession)에서 수행합니다.
