from datetime import datetime, timedelta
import base64
import hashlib
import hmac
import os
from pathlib import Path
import sqlite3
import traceback
from typing import Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

try:
    import psycopg
    from psycopg.rows import dict_row
except Exception:
    psycopg = None
    dict_row = None


def clean_postgres_url(url: Optional[str]) -> Optional[str]:
    if not url:
        return url
    parsed = urlsplit(url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        return url

    allowed_query_keys = {
        "application_name",
        "channel_binding",
        "connect_timeout",
        "gssencmode",
        "keepalives",
        "keepalives_count",
        "keepalives_idle",
        "keepalives_interval",
        "sslcert",
        "sslcompression",
        "sslcrl",
        "sslkey",
        "sslmode",
        "sslrootcert",
        "sslsni",
        "target_session_attrs",
    }
    query = urlencode(
        [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True) if key in allowed_query_keys]
    )
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, query, parsed.fragment))


SCHOOL_DOMAIN = os.getenv("SCHOOL_EMAIL_DOMAIN", "yisunsin.cnehs.kr")
DEFAULT_ADMIN_EMAIL = os.getenv("DEFAULT_ADMIN_EMAIL", f"admin@{SCHOOL_DOMAIN}").lower()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "pol357000**")
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATABASE_URL = clean_postgres_url(
    os.getenv("DATABASE_URL")
    or os.getenv("POSTGRES_URL")
    or os.getenv("POSTGRES_PRISMA_URL")
    or os.getenv("POSTGRES_URL_NON_POOLING")
)
DB_KIND = "postgres" if DATABASE_URL else "sqlite"
DEFAULT_SQLITE_PATH = Path(os.getenv("TMPDIR", "/tmp")) / "database.sqlite" if os.getenv("VERCEL") else PROJECT_ROOT / "database.sqlite"
DB_FILE = os.getenv("DATABASE_PATH", str(DEFAULT_SQLITE_PATH))

STATIC_DIR = PROJECT_ROOT / "static"
INDEX_FILE = PROJECT_ROOT / "index.html"
ADMIN_FILE = PROJECT_ROOT / "admin.html"

app = FastAPI(title="YITA API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("CORS_ORIGINS", "*").split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class RowDict(dict):
    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


def normalize_row(row):
    if row is None:
        return None
    if isinstance(row, RowDict):
        return row
    return RowDict(dict(row))


class DbCursor:
    def __init__(self, cursor):
        self.cursor = cursor
        self.lastrowid = None

    def execute(self, sql: str, params=()):
        if DB_KIND == "postgres":
            sql = self._to_postgres(sql)
            self.cursor.execute(sql, params)
            if " returning " in sql.lower():
                row = self.cursor.fetchone()
                self.lastrowid = next(iter(row.values())) if row else None
            return self

        self.cursor.execute(sql, params)
        self.lastrowid = self.cursor.lastrowid
        return self

    def fetchone(self):
        return normalize_row(self.cursor.fetchone())

    def fetchall(self):
        return [normalize_row(row) for row in self.cursor.fetchall()]

    def __iter__(self):
        return iter(self.fetchall())

    @staticmethod
    def _to_postgres(sql: str) -> str:
        lowered = " ".join(sql.lower().split())
        returning_map = {
            "insert into users": "user_id",
            "insert into boards": "board_id",
            "insert into posts": "post_id",
            "insert into comments": "comment_id",
            "insert into reports": "report_id",
        }
        sql = sql.replace("?", "%s")
        if lowered.startswith("insert into") and " returning " not in lowered:
            for prefix, column in returning_map.items():
                if lowered.startswith(prefix):
                    sql = f"{sql} RETURNING {column}"
                    break
        return sql


class DbConnection:
    def __init__(self, connection):
        self.connection = connection

    def cursor(self):
        return DbCursor(self.connection.cursor())

    def commit(self):
        self.connection.commit()

    def close(self):
        self.connection.close()


def get_connection():
    if DB_KIND == "postgres":
        if psycopg is None:
            raise RuntimeError("DATABASE_URL을 사용하려면 psycopg[binary]가 필요합니다.")
        return DbConnection(psycopg.connect(DATABASE_URL, row_factory=dict_row, prepare_threshold=None))

    Path(DB_FILE).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return DbConnection(conn)


def get_db():
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()


def column_exists(cursor: DbCursor, table: str, column: str) -> bool:
    if DB_KIND == "postgres":
        cursor.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ? AND column_name = ?
            """,
            (table, column),
        )
        return cursor.fetchone() is not None
    return any(row["name"] == column for row in cursor.execute(f"PRAGMA table_info({table})"))


def ensure_column(cursor: DbCursor, table: str, column: str, ddl: str):
    if not column_exists(cursor, table, column):
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


def hash_password(password: str, salt: Optional[str] = None) -> str:
    if salt is None:
        salt = base64.urlsafe_b64encode(os.urandom(16)).decode("utf-8")
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    encoded = base64.urlsafe_b64encode(digest).decode("utf-8")
    return f"{salt}${encoded}"


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash or "$" not in password_hash:
        return False
    salt, expected = password_hash.split("$", 1)
    actual = hash_password(password, salt).split("$", 1)[1]
    return hmac.compare_digest(actual, expected)


def clean_text(value: str, field_name: str, min_length: int, max_length: int) -> str:
    value = value.strip()
    if len(value) < min_length:
        raise ValueError(f"{field_name}은(는) {min_length}자 이상이어야 합니다.")
    if len(value) > max_length:
        raise ValueError(f"{field_name}은(는) {max_length}자를 넘을 수 없습니다.")
    return value


def init_db():
    conn = get_connection()
    cursor = conn.cursor()
    auto_id = "SERIAL PRIMARY KEY" if DB_KIND == "postgres" else "INTEGER PRIMARY KEY AUTOINCREMENT"
    now_default = "(CURRENT_TIMESTAMP::TEXT)" if DB_KIND == "postgres" else "CURRENT_TIMESTAMP"
    add_created_at = (
        "TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::TEXT)"
        if DB_KIND == "postgres"
        else "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP"
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS users (
            user_id {auto_id},
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            grade INTEGER NOT NULL,
            password_hash TEXT,
            role TEXT NOT NULL DEFAULT 'student',
            can_post_notice INTEGER NOT NULL DEFAULT 0,
            timeout_until TEXT,
            suspend_reason TEXT,
            created_at TEXT NOT NULL DEFAULT {now_default}
        )
        """
    )
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS boards (
            board_id {auto_id},
            type TEXT NOT NULL,
            category TEXT,
            club_name TEXT,
            is_approved INTEGER NOT NULL DEFAULT 1
        )
        """
    )
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS posts (
            post_id {auto_id},
            board_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            is_anonymous INTEGER NOT NULL DEFAULT 0,
            like_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT {now_default},
            updated_at TEXT,
            FOREIGN KEY(board_id) REFERENCES boards(board_id),
            FOREIGN KEY(user_id) REFERENCES users(user_id)
        )
        """
    )
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS comments (
            comment_id {auto_id},
            post_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            is_anonymous INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT {now_default},
            FOREIGN KEY(post_id) REFERENCES posts(post_id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(user_id)
        )
        """
    )
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS reports (
            report_id {auto_id},
            post_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            reason TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL DEFAULT {now_default},
            UNIQUE(post_id, user_id),
            FOREIGN KEY(post_id) REFERENCES posts(post_id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(user_id)
        )
        """
    )
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS post_likes (
            post_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT {now_default},
            PRIMARY KEY(post_id, user_id),
            FOREIGN KEY(post_id) REFERENCES posts(post_id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(user_id)
        )
        """
    )

    for table, column, ddl in [
        ("users", "password_hash", "TEXT"),
        ("users", "can_post_notice", "INTEGER NOT NULL DEFAULT 0"),
        ("users", "suspend_reason", "TEXT"),
        ("users", "created_at", add_created_at),
        ("boards", "club_name", "TEXT"),
        ("boards", "is_approved", "INTEGER NOT NULL DEFAULT 1"),
        ("posts", "like_count", "INTEGER NOT NULL DEFAULT 0"),
        ("posts", "updated_at", "TEXT"),
        ("reports", "status", "TEXT NOT NULL DEFAULT 'pending'"),
    ]:
        ensure_column(cursor, table, column, ddl)

    seed_boards(cursor)
    seed_admin(cursor)
    conn.commit()
    conn.close()


def seed_boards(cursor: DbCursor):
    seeds = [
        ("all", None, None, 1),
        ("grade_1", None, None, 1),
        ("grade_2", None, None, 1),
        ("grade_3", None, None, 1),
        ("notice", "math", None, 1),
        ("notice", "science", None, 1),
        ("notice", "korean", None, 1),
        ("notice", "english", None, 1),
        ("notice", "society", None, 1),
    ]
    for board_type, category, club_name, is_approved in seeds:
        cursor.execute(
            """
            SELECT board_id FROM boards
            WHERE type = ? AND COALESCE(category, '') = COALESCE(?, '')
                  AND COALESCE(club_name, '') = COALESCE(?, '')
            """,
            (board_type, category, club_name),
        )
        if cursor.fetchone() is None:
            cursor.execute(
                "INSERT INTO boards (type, category, club_name, is_approved) VALUES (?, ?, ?, ?)",
                (board_type, category, club_name, is_approved),
            )


def seed_admin(cursor: DbCursor):
    cursor.execute("SELECT * FROM users WHERE email = ?", (DEFAULT_ADMIN_EMAIL,))
    user = cursor.fetchone()
    password_hash = hash_password(ADMIN_PASSWORD)
    if user is None:
        cursor.execute(
            """
            INSERT INTO users (email, name, grade, password_hash, role, can_post_notice)
            VALUES (?, ?, ?, ?, 'admin', 1)
            """,
            (DEFAULT_ADMIN_EMAIL, "관리자", 3, password_hash),
        )
        return
    cursor.execute(
        """
        UPDATE users
        SET role = 'admin', can_post_notice = 1,
            password_hash = COALESCE(password_hash, ?)
        WHERE email = ?
        """,
        (password_hash, DEFAULT_ADMIN_EMAIL),
    )


init_db()


class SignupInput(BaseModel):
    email: str
    name: str
    grade: int = Field(ge=1, le=3)
    password: str = Field(min_length=6, max_length=80)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not value.endswith(f"@{SCHOOL_DOMAIN}"):
            raise ValueError(f"학교 계정(@{SCHOOL_DOMAIN})만 사용할 수 있습니다.")
        return value

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return clean_text(value, "이름", 1, 30)


class LoginInput(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if value == "admin":
            return DEFAULT_ADMIN_EMAIL
        return value


class PostCreateInput(BaseModel):
    board_id: int
    title: str
    content: str
    is_anonymous: bool = False

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        return clean_text(value, "제목", 1, 80)

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str) -> str:
        return clean_text(value, "본문", 1, 2000)


class PostUpdateInput(PostCreateInput):
    board_id: int = 0


class CommentCreateInput(BaseModel):
    post_id: int
    content: str
    is_anonymous: bool = False

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str) -> str:
        return clean_text(value, "댓글", 1, 500)


class ClubCreateInput(BaseModel):
    club_name: str

    @field_validator("club_name")
    @classmethod
    def validate_club_name(cls, value: str) -> str:
        return clean_text(value, "소모임 이름", 2, 30)


class ReportInput(BaseModel):
    reason: str = "부적절한 게시글"

    @field_validator("reason")
    @classmethod
    def validate_reason(cls, value: str) -> str:
        return clean_text(value, "신고 사유", 2, 200)


class NoticePermissionInput(BaseModel):
    can_post_notice: bool


class SuspendInput(BaseModel):
    days: int = Field(ge=1, le=365)
    reason: str = Field(min_length=1, max_length=200)


def public_user(user: dict):
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user["name"],
        "grade": user["grade"],
        "role": user["role"],
        "can_post_notice": bool(user.get("can_post_notice", 0)),
        "timeout_until": user.get("timeout_until"),
        "suspend_reason": user.get("suspend_reason"),
    }


def get_current_user(
    user_id: Optional[int] = Header(None, alias="user-id"),
    conn: DbConnection = Depends(get_db),
):
    if not user_id:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
    user = cursor.fetchone()
    if user is None:
        raise HTTPException(status_code=404, detail="존재하지 않는 사용자입니다.")
    user = dict(user)
    if user.get("timeout_until") and datetime.now().isoformat() < user["timeout_until"]:
        raise HTTPException(status_code=403, detail=f"정지된 계정입니다. 사유: {user.get('suspend_reason') or '관리자 정지'}")
    return user


def require_admin(user: dict = Depends(get_current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다.")
    return user


def get_board_or_404(cursor: DbCursor, board_id: int):
    cursor.execute("SELECT * FROM boards WHERE board_id = ?", (board_id,))
    board = cursor.fetchone()
    if board is None:
        raise HTTPException(status_code=404, detail="존재하지 않는 게시판입니다.")
    return dict(board)


def get_post_or_404(cursor: DbCursor, post_id: int):
    cursor.execute("SELECT * FROM posts WHERE post_id = ?", (post_id,))
    post = cursor.fetchone()
    if post is None:
        raise HTTPException(status_code=404, detail="존재하지 않는 게시글입니다.")
    return dict(post)


def ensure_can_write_board(board: dict, user: dict):
    if board["is_approved"] != 1:
        raise HTTPException(status_code=403, detail="아직 승인되지 않은 게시판입니다.")
    grade_map = {"grade_1": 1, "grade_2": 2, "grade_3": 3}
    if board["type"] in grade_map and user["grade"] != grade_map[board["type"]]:
        raise HTTPException(status_code=403, detail=f"{grade_map[board['type']]}학년만 작성할 수 있습니다.")
    if board["type"] == "notice" and user["role"] != "admin" and not user.get("can_post_notice"):
        raise HTTPException(status_code=403, detail="공지 작성 권한이 없습니다.")


@app.get("/")
def serve_index():
    return FileResponse(INDEX_FILE)


@app.get("/admin")
def serve_admin():
    return FileResponse(ADMIN_FILE)


@app.get("/api/health")
def health():
    return {"ok": True, "database": DB_KIND}


@app.post("/api/auth/signup")
def signup(data: SignupInput, conn: DbConnection = Depends(get_db)):
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT user_id FROM users WHERE email = ?", (data.email,))
        if cursor.fetchone():
            raise HTTPException(status_code=409, detail="이미 가입된 이메일입니다.")
        cursor.execute(
            """
            INSERT INTO users (email, name, grade, password_hash, role, can_post_notice)
            VALUES (?, ?, ?, ?, 'student', 0)
            """,
            (data.email, data.name, data.grade, hash_password(data.password)),
        )
        conn.commit()
        cursor.execute("SELECT * FROM users WHERE user_id = ?", (cursor.lastrowid,))
        return public_user(dict(cursor.fetchone()))
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"회원가입 처리 중 서버 오류: {exc}")


@app.post("/api/auth/login")
def login(data: LoginInput, conn: DbConnection = Depends(get_db)):
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE email = ?", (data.email,))
    user = cursor.fetchone()
    if user is None or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다.")
    user = dict(user)
    if user.get("timeout_until") and datetime.now().isoformat() < user["timeout_until"]:
        raise HTTPException(status_code=403, detail=f"정지된 계정입니다. 사유: {user.get('suspend_reason') or '관리자 정지'}")
    return public_user(user)


@app.get("/api/boards")
def get_boards(conn: DbConnection = Depends(get_db)):
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM boards WHERE is_approved = 1 ORDER BY board_id")
    return [dict(row) for row in cursor.fetchall()]


@app.get("/api/posts")
def search_posts(q: str = Query("", max_length=100), conn: DbConnection = Depends(get_db)):
    cursor = conn.cursor()
    keyword = f"%{q.strip()}%"
    cursor.execute(
        """
        SELECT p.*, u.name as author_name,
               (SELECT COUNT(*) FROM comments WHERE post_id = p.post_id) as comment_count
        FROM posts p
        JOIN users u ON p.user_id = u.user_id
        JOIN boards b ON p.board_id = b.board_id
        WHERE b.is_approved = 1 AND (? = '%%' OR p.title LIKE ? OR p.content LIKE ?)
        ORDER BY p.created_at DESC
        LIMIT 50
        """,
        (keyword, keyword, keyword),
    )
    return [serialize_post(row) for row in cursor.fetchall()]


@app.get("/api/boards/{board_id}/posts")
def get_posts(board_id: int, conn: DbConnection = Depends(get_db)):
    cursor = conn.cursor()
    get_board_or_404(cursor, board_id)
    cursor.execute(
        """
        SELECT p.*, u.name as author_name,
               (SELECT COUNT(*) FROM comments WHERE post_id = p.post_id) as comment_count
        FROM posts p
        JOIN users u ON p.user_id = u.user_id
        WHERE p.board_id = ?
        ORDER BY p.created_at DESC
        """,
        (board_id,),
    )
    return [serialize_post(row) for row in cursor.fetchall()]


def serialize_post(row):
    post = dict(row)
    if post["is_anonymous"] == 1:
        post["author_name"] = "익명"
    return post


@app.post("/api/posts")
def create_post(data: PostCreateInput, user: dict = Depends(get_current_user), conn: DbConnection = Depends(get_db)):
    cursor = conn.cursor()
    board = get_board_or_404(cursor, data.board_id)
    ensure_can_write_board(board, user)
    cursor.execute(
        "INSERT INTO posts (board_id, user_id, title, content, is_anonymous) VALUES (?, ?, ?, ?, ?)",
        (data.board_id, user["user_id"], data.title, data.content, int(data.is_anonymous)),
    )
    conn.commit()
    return {"message": "게시글이 등록되었습니다.", "post_id": cursor.lastrowid}


@app.put("/api/posts/{post_id}")
def update_post(post_id: int, data: PostUpdateInput, user: dict = Depends(get_current_user), conn: DbConnection = Depends(get_db)):
    cursor = conn.cursor()
    post = get_post_or_404(cursor, post_id)
    if post["user_id"] != user["user_id"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="게시글 수정 권한이 없습니다.")
    cursor.execute(
        "UPDATE posts SET title = ?, content = ?, is_anonymous = ?, updated_at = ? WHERE post_id = ?",
        (data.title, data.content, int(data.is_anonymous), datetime.now().isoformat(), post_id),
    )
    conn.commit()
    return {"message": "게시글이 수정되었습니다."}


@app.delete("/api/posts/{post_id}")
def delete_post(post_id: int, user: dict = Depends(get_current_user), conn: DbConnection = Depends(get_db)):
    cursor = conn.cursor()
    post = get_post_or_404(cursor, post_id)
    if post["user_id"] != user["user_id"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="게시글 삭제 권한이 없습니다.")
    cursor.execute("DELETE FROM posts WHERE post_id = ?", (post_id,))
    conn.commit()
    return {"message": "게시글이 삭제되었습니다."}


@app.post("/api/posts/{post_id}/like")
def like_post(post_id: int, user: dict = Depends(get_current_user), conn: DbConnection = Depends(get_db)):
    cursor = conn.cursor()
    get_post_or_404(cursor, post_id)
    cursor.execute("SELECT post_id FROM post_likes WHERE post_id = ? AND user_id = ?", (post_id, user["user_id"]))
    if cursor.fetchone():
        raise HTTPException(status_code=409, detail="이미 좋아요를 눌렀습니다.")
    cursor.execute("INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)", (post_id, user["user_id"]))
    cursor.execute(
        "UPDATE posts SET like_count = (SELECT COUNT(*) FROM post_likes WHERE post_id = ?) WHERE post_id = ?",
        (post_id, post_id),
    )
    conn.commit()
    return {"message": "좋아요가 반영되었습니다."}


@app.post("/api/comments")
def create_comment(data: CommentCreateInput, user: dict = Depends(get_current_user), conn: DbConnection = Depends(get_db)):
    cursor = conn.cursor()
    get_post_or_404(cursor, data.post_id)
    cursor.execute(
        "INSERT INTO comments (post_id, user_id, content, is_anonymous) VALUES (?, ?, ?, ?)",
        (data.post_id, user["user_id"], data.content, int(data.is_anonymous)),
    )
    conn.commit()
    return {"message": "댓글이 등록되었습니다.", "comment_id": cursor.lastrowid}


@app.get("/api/posts/{post_id}/comments")
def get_comments(post_id: int, conn: DbConnection = Depends(get_db)):
    cursor = conn.cursor()
    get_post_or_404(cursor, post_id)
    cursor.execute(
        """
        SELECT c.*, u.name as author_name
        FROM comments c
        JOIN users u ON c.user_id = u.user_id
        WHERE c.post_id = ?
        ORDER BY c.created_at
        """,
        (post_id,),
    )
    comments = []
    for row in cursor.fetchall():
        comment = dict(row)
        if comment["is_anonymous"] == 1:
            comment["author_name"] = "익명"
        comments.append(comment)
    return comments


@app.delete("/api/comments/{comment_id}")
def delete_comment(comment_id: int, user: dict = Depends(get_current_user), conn: DbConnection = Depends(get_db)):
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM comments WHERE comment_id = ?", (comment_id,))
    comment = cursor.fetchone()
    if comment is None:
        raise HTTPException(status_code=404, detail="존재하지 않는 댓글입니다.")
    comment = dict(comment)
    if comment["user_id"] != user["user_id"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="댓글 삭제 권한이 없습니다.")
    cursor.execute("DELETE FROM comments WHERE comment_id = ?", (comment_id,))
    conn.commit()
    return {"message": "댓글이 삭제되었습니다."}


@app.post("/api/posts/{post_id}/report")
def report_post(post_id: int, data: ReportInput, user: dict = Depends(get_current_user), conn: DbConnection = Depends(get_db)):
    cursor = conn.cursor()
    post = get_post_or_404(cursor, post_id)
    if post["user_id"] == user["user_id"]:
        raise HTTPException(status_code=400, detail="본인 글은 신고할 수 없습니다.")
    cursor.execute("SELECT report_id FROM reports WHERE post_id = ? AND user_id = ?", (post_id, user["user_id"]))
    if cursor.fetchone():
        raise HTTPException(status_code=409, detail="이미 신고한 게시글입니다.")
    cursor.execute("INSERT INTO reports (post_id, user_id, reason) VALUES (?, ?, ?)", (post_id, user["user_id"], data.reason))
    conn.commit()
    return {"message": "신고가 접수되었습니다."}


@app.post("/api/boards/club")
def create_club(data: ClubCreateInput, user: dict = Depends(get_current_user), conn: DbConnection = Depends(get_db)):
    cursor = conn.cursor()
    cursor.execute("SELECT board_id FROM boards WHERE type = 'club' AND club_name = ?", (data.club_name,))
    if cursor.fetchone():
        raise HTTPException(status_code=409, detail="이미 같은 이름의 소모임이 있습니다.")
    cursor.execute("INSERT INTO boards (type, club_name, is_approved) VALUES ('club', ?, 0)", (data.club_name,))
    conn.commit()
    return {"message": "소모임 개설 요청이 접수되었습니다.", "board_id": cursor.lastrowid}


@app.get("/api/admin/users")
def admin_users(_: dict = Depends(require_admin), conn: DbConnection = Depends(get_db)):
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users ORDER BY user_id")
    return [public_user(dict(row)) for row in cursor.fetchall()]


@app.patch("/api/admin/users/{user_id}/notice-permission")
def set_notice_permission(user_id: int, data: NoticePermissionInput, _: dict = Depends(require_admin), conn: DbConnection = Depends(get_db)):
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET can_post_notice = ? WHERE user_id = ?", (int(data.can_post_notice), user_id))
    conn.commit()
    return {"message": "공지 권한이 변경되었습니다."}


@app.post("/api/admin/users/{user_id}/suspend")
def suspend_user(user_id: int, data: SuspendInput, admin: dict = Depends(require_admin), conn: DbConnection = Depends(get_db)):
    if user_id == admin["user_id"]:
        raise HTTPException(status_code=400, detail="본인 계정은 정지할 수 없습니다.")
    until_time = (datetime.now() + timedelta(days=data.days)).isoformat()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE users SET timeout_until = ?, suspend_reason = ? WHERE user_id = ?",
        (until_time, data.reason, user_id),
    )
    conn.commit()
    return {"message": "계정이 정지되었습니다.", "timeout_until": until_time}


@app.post("/api/admin/users/{user_id}/unsuspend")
def unsuspend_user(user_id: int, _: dict = Depends(require_admin), conn: DbConnection = Depends(get_db)):
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET timeout_until = NULL, suspend_reason = NULL WHERE user_id = ?", (user_id,))
    conn.commit()
    return {"message": "계정 정지가 해제되었습니다."}


@app.get("/api/admin/reports")
def admin_reports(_: dict = Depends(require_admin), conn: DbConnection = Depends(get_db)):
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT r.*, p.title as post_title, p.user_id as target_user_id,
               reporter.email as reporter_email, target.email as target_email
        FROM reports r
        JOIN posts p ON r.post_id = p.post_id
        JOIN users reporter ON r.user_id = reporter.user_id
        JOIN users target ON p.user_id = target.user_id
        ORDER BY r.created_at DESC
        """
    )
    return [dict(row) for row in cursor.fetchall()]


@app.post("/api/admin/reports/{report_id}/resolve")
def resolve_report(report_id: int, _: dict = Depends(require_admin), conn: DbConnection = Depends(get_db)):
    cursor = conn.cursor()
    cursor.execute("UPDATE reports SET status = 'resolved' WHERE report_id = ?", (report_id,))
    conn.commit()
    return {"message": "신고가 처리되었습니다."}


@app.get("/api/admin/pending-clubs")
def get_pending_clubs(_: dict = Depends(require_admin), conn: DbConnection = Depends(get_db)):
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM boards WHERE is_approved = 0 ORDER BY board_id")
    return [dict(row) for row in cursor.fetchall()]


@app.post("/api/admin/boards/{board_id}/approve")
def approve_board(board_id: int, _: dict = Depends(require_admin), conn: DbConnection = Depends(get_db)):
    cursor = conn.cursor()
    get_board_or_404(cursor, board_id)
    cursor.execute("UPDATE boards SET is_approved = 1 WHERE board_id = ?", (board_id,))
    conn.commit()
    return {"message": "소모임이 승인되었습니다."}
