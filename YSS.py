from fastapi import FastAPI, Header, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import sqlite3
from datetime import datetime, timedelta

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_FILE = "database.sqlite"

def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    # 1. 회원 테이블 (타임아웃 정지일 포함)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE,
            name TEXT,
            grade INTEGER,
            role TEXT DEFAULT 'student',
            timeout_until TEXT
        )
    """)
    
    # 2. 게시판 테이블 (소모임 승인 여부, 과목 카테고리 포함)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS boards (
            board_id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT, -- 'all', 'grade_1', 'grade_2', 'grade_3', 'notice', 'club'
            category TEXT, -- 'math', 'science', 'korean', 'english', 'society' 등
            club_name TEXT,
            is_approved INTEGER DEFAULT 1 -- 소모임 승인 대기(0), 승인완료(1)
        )
    """)
    
    # 3. 게시글 테이블 (익명, 좋아요 포함)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS posts (
            post_id INTEGER PRIMARY KEY AUTOINCREMENT,
            board_id INTEGER,
            user_id INTEGER,
            title TEXT,
            content TEXT,
            is_anonymous INTEGER DEFAULT 0,
            like_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 4. 댓글 테이블 (익명 포함)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS comments (
            comment_id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER,
            user_id INTEGER,
            content TEXT,
            is_anonymous INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 5. 신고 테이블
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS reports (
            report_id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER,
            user_id INTEGER,
            reason TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # 기본 고정 게시판 자동 생성
    cursor.execute("SELECT COUNT(*) FROM boards WHERE type != 'club'")
    if cursor.fetchone()[0] == 0:
        cursor.execute("INSERT INTO boards (type) VALUES ('all')")      # ID: 1
        cursor.execute("INSERT INTO boards (type) VALUES ('grade_1')")  # ID: 2
        cursor.execute("INSERT INTO boards (type) VALUES ('grade_2')")  # ID: 3
        cursor.execute("INSERT INTO boards (type) VALUES ('grade_3')")  # ID: 4
        # 공지사항 과목별 분리 생성
        for subject in ['math', 'science', 'korean', 'english', 'society']:
            cursor.execute("INSERT INTO boards (type, category) VALUES ('notice', ?)", (subject,))
        conn.commit()
    conn.close()

init_db()

def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try: yield conn
    finally: conn.close()

# 유저 및 정지(타임아웃) 검증 함수
def get_current_user(user_id: int = Header(None, alias="user-id"), conn: sqlite3.Connection = Depends(get_db)):
    if not user_id: raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
    user = cursor.fetchone()
    if not user: raise HTTPException(status_code=404, detail="존재하지 않는 유저입니다.")
    user_dict = dict(user)
    
    if user_dict['timeout_until']:
        if datetime.now().isoformat() < user_dict['timeout_until']:
            raise HTTPException(status_code=403, detail=f"신고 누적으로 이용 정지 상태입니다. (~{user_dict['timeout_until'][:16]})")
    return user_dict

# 데이터 모델 정의
class GoogleAuthInput(BaseModel):
    email: str
    name: str
    grade: int

class PostCreateInput(BaseModel):
    board_id: int
    title: str
    content: str
    is_anonymous: bool

class CommentCreateInput(BaseModel):
    post_id: int
    content: str
    is_anonymous: bool

class ClubCreateInput(BaseModel):
    club_name: str

# --- API 구현부 ---

# 1. 구글 로그인 및 가입
@app.post("/api/auth/google")
def google_auth(data: GoogleAuthInput, conn: sqlite3.Connection = Depends(get_db)):
    if not data.email.endswith('@yisunsin.cnehs.kr'):
        raise HTTPException(status_code=403, detail="학교 구글 계정(@yisunsin.cnehs.kr)만 가능합니다.")
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE email = ?", (data.email,))
    user = cursor.fetchone()
    if not user:
        cursor.execute("INSERT INTO users (email, name, grade) VALUES (?, ?, ?)", (data.email, data.name, data.grade))
        conn.commit()
        return {"user_id": cursor.lastrowid, "email": data.email, "name": data.name, "grade": data.grade, "role": "student"}
    return dict(user)

# 게시판 리스트 조회 (소모임 승인 완료된 것 포함)
@app.get("/api/boards")
def get_boards(conn: sqlite3.Connection = Depends(get_db)):
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM boards WHERE is_approved = 1")
    return [dict(row) for row in cursor.fetchall()]

# 2~5. 게시글 조회 및 학년 분리 작성
@app.post("/api/posts")
def create_post(data: PostCreateInput, user: dict = Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)):
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM boards WHERE board_id = ?", (data.board_id,))
    board = dict(cursor.fetchone())
    
    # 학년 분리 제한 규칙
    if board['type'] == 'grade_1' and user['grade'] != 1: raise HTTPException(status_code=403, detail="1학년만 작성 가능합니다.")
    if board['type'] == 'grade_2' and user['grade'] != 2: raise HTTPException(status_code=403, detail="2학년만 작성 가능합니다.")
    if board['type'] == 'grade_3' and user['grade'] != 3: raise HTTPException(status_code=403, detail="3학년만 작성 가능합니다.")
    
    cursor.execute("INSERT INTO posts (board_id, user_id, title, content, is_anonymous) VALUES (?, ?, ?, ?, ?)",
                   (data.board_id, user['user_id'], data.title, data.content, 1 if data.is_anonymous else 0))
    conn.commit()
    return {"message": "성공"}

@app.get("/api/posts/{board_id}")
def get_posts(board_id: int, conn: sqlite3.Connection = Depends(get_db)):
    cursor = conn.cursor()
    cursor.execute("""
        SELECT p.*, u.name as author_name, 
        (SELECT COUNT(*) FROM comments WHERE post_id = p.post_id) as comment_count
        FROM posts p JOIN users u ON p.user_id = u.user_id 
        WHERE p.board_id = ? ORDER BY p.created_at DESC
    """, (board_id,))
    result = []
    for post in cursor.fetchall():
        p_dict = dict(post)
        if p_dict['is_anonymous'] == 1: p_dict['author_name'] = "익명"
        result.append(p_dict)
    return result

# 6. 좋아요 기능
@app.post("/api/posts/{post_id}/like")
def like_post(post_id: int, user: dict = Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)):
    cursor = conn.cursor()
    cursor.execute("UPDATE posts SET like_count = like_count + 1 WHERE post_id = ?", (post_id,))
    conn.commit()
    return {"message": "좋아요 완료"}

# 7. 댓글 기능
@app.post("/api/comments")
def create_comment(data: CommentCreateInput, user: dict = Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)):
    cursor = conn.cursor()
    cursor.execute("INSERT INTO comments (post_id, user_id, content, is_anonymous) VALUES (?, ?, ?, ?)",
                   (data.post_id, user['user_id'], data.content, 1 if data.is_anonymous else 0))
    conn.commit()
    return {"message": "댓글 등록 완료"}

@app.get("/api/posts/{post_id}/comments")
def get_comments(post_id: int, conn: sqlite3.Connection = Depends(get_db)):
    cursor = conn.cursor()
    cursor.execute("SELECT c.*, u.name as author_name FROM comments c JOIN users u ON c.user_id = u.user_id WHERE c.post_id = ?", (post_id,))
    result = []
    for row in cursor.fetchall():
        c_dict = dict(row)
        if c_dict['is_anonymous'] == 1: c_dict['author_name'] = "익명"
        result.append(c_dict)
    return result

# 8. 소모임 게시판 개설 신청
@app.post("/api/boards/club")
def create_club(data: ClubCreateInput, user: dict = Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)):
    cursor = conn.cursor()
    # 학생이 개설하면 승인 대기 상태(is_approved=0)로 생성됨
    cursor.execute("INSERT INTO boards (type, club_name, is_approved) VALUES ('club', ?, 0)", (data.club_name,))
    conn.commit()
    return {"message": "소모임 개설 신청 완료 (관리자 승인 대기)"}

# 9. 신고 기능 및 자동 타임아웃 정지 (신고 3회 이상시 1일 정지)
@app.post("/api/posts/{post_id}/report")
def report_post(post_id: int, user: dict = Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)):
    cursor = conn.cursor()
    cursor.execute("INSERT INTO reports (post_id, user_id, reason) VALUES (?, ?, '부적절한 게시글')", (post_id, user['user_id']))
    
    # 해당 글 작성자 찾기
    cursor.execute("SELECT user_id FROM posts WHERE post_id = ?", (post_id,))
    target_user_id = cursor.fetchone()[0]
    
    # 해당 작성자의 총 누적 신고수 조회
    cursor.execute("SELECT COUNT(*) FROM reports WHERE post_id IN (SELECT post_id FROM posts WHERE user_id = ?)", (target_user_id,))
    report_count = cursor.fetchone()[0]
    
    # 신고가 3회 이상 쌓이면 자동 1일 정지(timeout) 처리
    if report_count >= 3:
        until_time = (datetime.now() + timedelta(days=1)).isoformat()
        cursor.execute("UPDATE users SET timeout_until = ? WHERE user_id = ?", (until_time, target_user_id))
        
    conn.commit()
    return {"message": f"신고 완료 (작성자 누적 신고: {report_count}회)"}

# 10. 관리자 모드 전용 API (소모임 승인 및 대기 리스트 조회)
@app.get("/api/admin/pending-clubs")
def get_pending_clubs(conn: sqlite3.Connection = Depends(get_db)):
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM boards WHERE is_approved = 0")
    return [dict(row) for row in cursor.fetchall()]

@app.post("/api/admin/boards/{board_id}/approve")
def approve_board(board_id: int, conn: sqlite3.Connection = Depends(get_db)):
    cursor = conn.cursor()
    cursor.execute("UPDATE boards SET is_approved = 1 WHERE board_id = ?", (board_id,))
    conn.commit()
    return {"message": "소모임 승인 완료"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("YSS:app", host="127.0.0.1", port=8000, reload=True)