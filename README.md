# YITA

이순신고 학생 커뮤니티 MVP입니다. Vercel 정적 프론트 + FastAPI API + Turso/libSQL DB 구조입니다.

## 로컬 실행

```bash
pip install -r requirements.txt
python YSS.py
```

- 커뮤니티: `http://127.0.0.1:8000`
- 관리자: `http://127.0.0.1:8000/admin`

`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`이 없으면 로컬 개발용 `database.sqlite`를 사용합니다.

## Vercel + Turso 환경 변수

Vercel 프로젝트의 Environment Variables에 아래 값을 넣으세요.

- `TURSO_DATABASE_URL`: Turso DB URL. 예: `libsql://...turso.io`
- `TURSO_AUTH_TOKEN`: Turso DB auth token
- `SCHOOL_EMAIL_DOMAIN`: `yisunsin.cnehs.kr`
- `DEFAULT_ADMIN_EMAIL`: 예) `admin@yisunsin.cnehs.kr`
- `ADMIN_PASSWORD`: 운영 관리자 비밀번호
- `CORS_ORIGINS`: 운영 도메인. 개발 중에는 `*`

## Turso에서 해야 할 일

```bash
turso auth login
turso db create yita
turso db show --url yita
turso db tokens create yita
```

출력된 URL을 `TURSO_DATABASE_URL`, 토큰을 `TURSO_AUTH_TOKEN`으로 Vercel에 등록하면 됩니다.

## 기본 관리자

- 이메일 입력칸: `admin`
- 기본 비밀번호: `pol357000**`

운영 배포에서는 반드시 `ADMIN_PASSWORD` 환경변수로 변경하세요.

## 보안 주의

- `.env`, `.env.*`, `database.sqlite`는 `.gitignore`에 포함되어 있습니다.
- `TURSO_AUTH_TOKEN`은 프론트 코드나 Git에 넣지 마세요.
- 실수로 노출한 토큰은 Turso에서 새 토큰을 발급하고 기존 토큰을 폐기하세요.

## 구현된 기능

- 토큰 세션 기반 회원가입/로그인
- 게시판별 목록/상세/댓글/좋아요/신고
- 공지 게시판 작성 권한 제한
- 관리자 페이지 `/admin`
- 특정 계정 공지 권한 부여/회수
- 계정 정지/정지 해제
- 신고 목록 조회/처리
- 소모임 승인
