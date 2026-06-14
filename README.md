# YITA

이순신고 학생 커뮤니티 MVP입니다. 프론트엔드는 정적 파일, 백엔드는 FastAPI 서버리스 API로 분리했습니다.

## 구조

- `index.html`: 화면 마크업
- `static/app.js`: 브라우저 동작, API 호출, XSS 방지를 위한 DOM 기반 렌더링
- `static/styles.css`: 화면 스타일
- `api/index.py`: Vercel Python 서버리스용 FastAPI 앱
- `YSS.py`: 로컬 개발용 실행 진입점
- `vercel.json`: Vercel 라우팅 설정

## 로컬 실행

```bash
pip install -r requirements.txt
python YSS.py
```

브라우저에서 `http://127.0.0.1:8000`을 열면 됩니다.

## 환경 변수

- `SCHOOL_EMAIL_DOMAIN`: 허용할 학교 이메일 도메인, 기본값 `yisunsin.cnehs.kr`
- `ADMIN_EMAILS`: 관리자 이메일 목록, 쉼표로 구분
- `GOOGLE_CLIENT_ID`: 실제 Google Identity Services 토큰 검증 시 필요
- `CORS_ORIGINS`: 허용 origin 목록, 기본값 `*`
- `DATABASE_PATH`: 로컬 SQLite 파일 경로

## Vercel 주의사항

현재 API는 SQLite를 사용합니다. Vercel 서버리스 환경에서는 파일 시스템이 영구 저장소가 아니므로 `/tmp` 데이터는 재배포/콜드스타트에 따라 사라질 수 있습니다.

실서비스로 운영하려면 Neon, Supabase, Vercel Postgres 같은 외부 DB로 교체해야 합니다. 지금 구조는 `/api` 서버리스 진입점과 정적 프론트 분리를 끝낸 상태라 DB 어댑터만 바꾸면 배포 구조는 유지할 수 있습니다.
