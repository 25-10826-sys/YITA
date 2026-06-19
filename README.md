# YITA

이순신고 학생 커뮤니티 MVP입니다. Vercel 배포를 고려해 정적 프론트와 FastAPI API를 분리했습니다.

## 실행

```bash
pip install -r requirements.txt
python YSS.py
```

- 커뮤니티: `http://127.0.0.1:8000`
- 관리자: `http://127.0.0.1:8000/admin`

## 기본 관리자

- 이메일 입력칸: `admin`
- 비밀번호: `pol357000**`
- 실제 이메일: `admin@yisunsin.cnehs.kr`

배포 시에는 Vercel 환경 변수 `ADMIN_PASSWORD`로 바꾸는 것을 권장합니다.

## Vercel 환경 변수

- `DATABASE_URL`: Postgres 연결 문자열. Neon, Supabase, Vercel Postgres 모두 가능
- `SCHOOL_EMAIL_DOMAIN`: 학교 이메일 도메인, 기본값 `yisunsin.cnehs.kr`
- `DEFAULT_ADMIN_EMAIL`: 관리자 이메일, 기본값 `admin@yisunsin.cnehs.kr`
- `ADMIN_PASSWORD`: 관리자 비밀번호, 기본값 `pol357000**`
- `CORS_ORIGINS`: 허용 origin, 기본값 `*`

`DATABASE_URL`이 있으면 Postgres를 사용하고, 없으면 로컬 개발용 `database.sqlite`를 사용합니다.

## 구현된 기능

- 비밀번호 기반 회원가입/로그인
- 게시판별 목록/상세/댓글/좋아요/신고
- 공지 게시판 작성 권한 제한
- 관리자 페이지 `/admin`
- 관리자 회원 목록 조회
- 특정 계정 공지 권한 부여/회수
- 계정 정지/정지 해제
- 신고 목록 조회/처리
- 소모임 승인
