const BASE_API = window.location.protocol === "file:" ? "http://127.0.0.1:8000/api" : "/api";
const TOKEN_KEY = "yita_auth_token";

let authToken = localStorage.getItem(TOKEN_KEY);
let sessionUser = null;
let selectedBoardId = null;
let currentBoards = [];
let homeCache = null;

const boardMeta = {
    all: { title: "전체 게시판", description: "학교 생활 전반을 자유롭게 이야기하는 공간입니다." },
    grade_1: { title: "1학년 게시판", description: "1학년 학생 전용 게시판입니다." },
    grade_2: { title: "2학년 게시판", description: "2학년 학생 전용 게시판입니다." },
    grade_3: { title: "3학년 게시판", description: "3학년 학생 전용 게시판입니다." },
    notice_math: { title: "수학 공지", description: "수학 과목 공지와 자료를 공유합니다." },
    notice_science: { title: "과학 공지", description: "과학 과목 공지와 자료를 공유합니다." },
    notice_korean: { title: "국어 공지", description: "국어 과목 공지와 자료를 공유합니다." },
    notice_english: { title: "영어 공지", description: "영어 과목 공지와 자료를 공유합니다." },
    notice_society: { title: "사회 공지", description: "사회 과목 공지와 자료를 공유합니다." },
};

const qs = (selector) => document.querySelector(selector);

function make(tag, options = {}) {
    const element = document.createElement(tag);
    if (options.className) element.className = options.className;
    if (options.text !== undefined) element.textContent = options.text;
    if (options.type) element.type = options.type;
    return element;
}

function showToast(message) {
    const toast = qs("#toast");
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
        toast.hidden = true;
    }, 2600);
}

async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    if (options.body) headers["Content-Type"] = "application/json";

    const response = await fetch(`${BASE_API}${path}`, { ...options, headers });
    const data = (response.headers.get("content-type") || "").includes("application/json")
        ? await response.json()
        : null;
    if (!response.ok) {
        if (response.status === 401) clearSession();
        throw new Error(data?.detail || data?.message || "\uC694\uCCAD\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
    }
    return data;
}

function saveAuth(payload) {
    authToken = payload.token;
    sessionUser = payload.user;
    localStorage.setItem(TOKEN_KEY, authToken);
}

function clearSession() {
    authToken = null;
    sessionUser = null;
    localStorage.removeItem(TOKEN_KEY);
}

let currentAuthRole = "student";

function switchAuthRole(role) {
    currentAuthRole = role;
    const isTeacher = role === "teacher";
    qs("#role-tab-student")?.classList.toggle("active", !isTeacher);
    qs("#role-tab-teacher")?.classList.toggle("active", isTeacher);

    const titleEl = qs("#login-card-title");
    const descEl = qs("#login-card-desc");
    const emailInput = qs("#u-email");
    const gradeLabel = qs("#u-grade-label");
    const officeLabel = qs("#u-office-label");

    if (isTeacher) {
        if (titleEl) titleEl.textContent = "선생님 로그인";
        if (descEl) descEl.textContent = "일반 이메일로 가입할 수 있으며, 관리자 승인 후 이용 가능합니다.";
        if (emailInput) emailInput.placeholder = "이메일 (예: teacher@gmail.com)";
        if (gradeLabel) gradeLabel.hidden = true;
        if (officeLabel) officeLabel.hidden = false;
    } else {
        if (titleEl) titleEl.textContent = "학생 로그인";
        if (descEl) descEl.textContent = "학교 이메일(@yisunsin.cnehs.kr)로 로그인 및 회원가입할 수 있습니다.";
        if (emailInput) emailInput.placeholder = "student@yisunsin.cnehs.kr";
        if (gradeLabel) gradeLabel.hidden = false;
        if (officeLabel) officeLabel.hidden = true;
    }
}

function readAuthForm() {
    return {
        role: currentAuthRole,
        email: qs("#u-email").value.trim(),
        password: qs("#u-password").value,
        name: qs("#u-name").value.trim(),
        grade: Number(qs("#u-grade") ? qs("#u-grade").value : 1),
        office: qs("#u-office") ? qs("#u-office").value.trim() : "",
    };
}

async function signup() {
    const data = readAuthForm();
    if (!data.email) {
        showToast("이메일을 입력해주세요.");
        return;
    }
    if (!data.password) {
        showToast("비밀번호를 입력해주세요.");
        return;
    }
    if (!data.name) {
        showToast("이름을 입력해주세요.");
        return;
    }
    if (data.role === "teacher") {
        if (!data.office || data.office.length < 2) {
            showToast("교무실을 2자 이상 입력해주세요.");
            return;
        }
    } else {
        if (!data.email.endsWith("@yisunsin.cnehs.kr")) {
            showToast("학생은 학교 계정(@yisunsin.cnehs.kr)만 사용할 수 있습니다.");
            return;
        }
    }

    try {
        const res = await api("/auth/signup", {
            method: "POST",
            body: JSON.stringify(data),
        });
        if (res.pending) {
            showToast(res.message || "선생님 회원가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.");
            qs("#u-password").value = "";
            return;
        }
        saveAuth(res);
        applyLoginState();
        await bootCommunity();
        showToast("회원가입이 완료되었습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function login() {
    const data = readAuthForm();
    if (!data.email) {
        showToast("이메일을 입력해주세요.");
        return;
    }
    if (!data.password) {
        showToast("비밀번호를 입력해주세요.");
        return;
    }
    if (data.role === "student" && !data.email.endsWith("@yisunsin.cnehs.kr") && data.email !== "admin") {
        showToast("학생 로그인은 학교 계정(@yisunsin.cnehs.kr)만 가능합니다. 선생님이시라면 상단 [선생님] 탭을 눌러주세요.");
        return;
    }
    try {
        saveAuth(await api("/auth/login", {
            method: "POST",
            body: JSON.stringify({ email: data.email, password: data.password }),
        }));
        applyLoginState();
        await bootCommunity();
        showToast("로그인되었습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function logout() {
    try {
        if (authToken) await api("/auth/logout", { method: "POST" });
    } catch (_) {
    } finally {
        clearSession();
        location.reload();
    }
}

async function restoreSession() {
    if (authToken) {
        try {
            const [user, home] = await Promise.all([
                api("/auth/me"),
                api("/home"),
            ]);
            sessionUser = user;
            applyLoginState();
            applyHomeData(home);
        } catch (_) {
            clearSession();
            await bootCommunity();
        }
    } else {
        await bootCommunity();
    }
    await handleUrlRouting();
}

function applyLoginState() {
    qs("#login-card").hidden = true;
    qs("#profile-card").hidden = false;
    qs("#profile-edit-button").hidden = false;

    let indicatorText = "로그인 완료";
    if (sessionUser.role === "admin") {
        indicatorText = "관리자 로그인";
    } else if (sessionUser.role === "teacher") {
        indicatorText = "선생님 로그인";
    }
    qs("#top-login-indicator").textContent = indicatorText;
    qs("#top-login-indicator").onclick = logout;
    qs("#profile-edit-button").onclick = () => showProfileEdit(true);
    qs("#display-name").textContent = sessionUser.name;

    if (sessionUser.role === "teacher") {
        qs("#display-grade").textContent = `이순신고등학교 교사 · ${sessionUser.office || "교무실"}`;
        qs("#display-role").textContent = "선생님 · 공지 작성 및 전 학년 게시판 이용 가능";
    } else if (sessionUser.role === "admin") {
        qs("#display-grade").textContent = `이순신고등학교 관리자`;
        qs("#display-role").textContent = "관리자 · 모든 게시판 관리 가능";
    } else {
        qs("#display-grade").textContent = `이순신고등학교 ${sessionUser.grade}학년`;
        qs("#display-role").textContent = sessionUser.can_post_notice
            ? "학생 · 공지 작성 권한 있음"
            : "학생";
    }
    qs("#admin-card").hidden = sessionUser.role !== "admin";
}

function requireLogin() {
    if (!sessionUser) {
        showToast("로그인이 필요합니다.");
        return false;
    }
    return true;
}

function applyHomeData(home) {
    homeCache = home;
    currentBoards = homeCache.boards;
    renderBoardDirectory();
    renderClubMenu();
    renderHotPosts(homeCache.hot_posts);
    if (sessionUser && sessionUser.role === "admin") syncAdminClubConsole().catch(() => {});
}

async function bootCommunity() {
    homeCache = await api("/home");
    applyHomeData(homeCache);
}

function boardKey(board) {
    if (board.type === "notice") return `notice_${board.category}`;
    return board.type;
}

function boardTitle(board) {
    if (board.type === "club") return board.club_name || "소모임";
    return boardMeta[boardKey(board)]?.title || "\uAC8C\uC2DC\uD310";
}

function boardDescription(board) {
    if (board.type === "club") return "학생들이 만든 소모임 게시판입니다.";
    return boardMeta[boardKey(board)]?.description || "\uAC8C\uC2DC\uD310\uC785\uB2C8\uB2E4.";
}

function renderBoardDirectory() {
    const grid = qs("#board-directory-grid");
    grid.replaceChildren();
    qs("#board-directory-count").textContent = `${currentBoards.length}개 게시판`;
    if (currentBoards.length === 0) {
        grid.append(make("p", { className: "muted", text: "이용 가능한 게시판이 없습니다." }));
        return;
    }
    currentBoards.forEach((board) => {
        const card = make("button", { className: "board-entry-card", type: "button" });
        const previewCount = (homeCache?.previews?.[String(board.board_id)] || []).length;
        card.append(
            make("strong", { text: boardTitle(board) }),
            make("span", { text: boardDescription(board) }),
            make("small", { text: previewCount > 0 ? `\uCD5C\uADFC \uAE00 ${previewCount}\uAC1C` : "\uC544\uC9C1 \uAE00 \uC5C6\uC74C" }),
        );
        card.addEventListener("click", () => enterBoard(board.board_id));
        grid.append(card);
    });
}

function renderClubMenu() {
    const container = qs("#club-board-list");
    container.replaceChildren();
    const clubs = currentBoards.filter((board) => board.type === "club");
    if (clubs.length === 0) {
        container.textContent = "승인된 소모임 없음";
        container.classList.add("muted");
        return;
    }
    container.classList.remove("muted");
    clubs.forEach((club) => {
        const button = make("button", { type: "button", text: club.club_name });
        button.addEventListener("click", () => enterBoard(club.board_id));
        container.append(button);
    });
}

async function enterBoard(boardId, pushHistory = true) {
    selectedBoardId = Number(boardId);
    const board = currentBoards.find((item) => item.board_id === selectedBoardId);
    qs("#board-directory").hidden = true;
    qs("#board-view").hidden = false;
    showWritePanel(false);
    const title = board ? boardTitle(board) : "게시판";
    qs("#post-list-title").textContent = title;
    qs("#current-board-title").textContent = `${title} 글쓰기`;
    qs("#article-detail-viewer").hidden = true;
    qs("#post-list").hidden = false;

    const canWrite = sessionUser && (!board || board.type !== "notice" || sessionUser.role === "admin" || sessionUser.can_post_notice);
    qs("#open-write-button").style.display = canWrite ? "" : (sessionUser ? "none" : "");

    if (pushHistory) updateUrlParams({ board: selectedBoardId });
    document.title = `${title} - YITA 이순신고 커뮤니티`;

    // Stale-While-Revalidate: 홈 캐시의 미리보기 글이 있다면 즉시 먼저 렌더링 (0ms)
    const cachedPreviews = homeCache?.previews?.[String(selectedBoardId)];
    if (cachedPreviews && cachedPreviews.length > 0) {
        const list = qs("#post-list");
        list.replaceChildren();
        list.classList.remove("muted");
        qs("#post-list-count").textContent = `${cachedPreviews.length}개+`;
        cachedPreviews.forEach((post, index) => list.append(createPostRow(post, selectedBoardId, "post-row", index + 1)));
    }

    await renderPostList();
}

function showDirectory(pushHistory = true) {
    selectedBoardId = null;
    qs("#board-view").hidden = true;
    qs("#board-directory").hidden = false;
    qs("#article-detail-viewer").hidden = true;
    if (pushHistory) updateUrlParams({});
    document.title = "YITA - 이순신고 커뮤니티";
}

async function renderPostList() {
    if (!selectedBoardId) return;
    const posts = await api(`/boards/${selectedBoardId}/posts`);
    const list = qs("#post-list");
    list.replaceChildren();
    qs("#post-list-count").textContent = `${posts.length}개`;
    if (posts.length === 0) {
        list.textContent = "아직 작성된 글이 없습니다.";
        list.classList.add("muted");
        return;
    }
    list.classList.remove("muted");
    posts.forEach((post, index) => list.append(createPostRow(post, selectedBoardId, "post-row", index + 1)));
}

function createPostRow(post, boardId, className, index) {
    const row = make("article", { className: className ? `${className} post-row clickable-post-row` : "post-row clickable-post-row" });
    row.tabIndex = 0;
    row.addEventListener("click", () => openArticleDetail(post.post_id, boardId));
    row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openArticleDetail(post.post_id, boardId);
        }
    });

    if (index !== undefined) {
        const indexBadge = make("div", { className: "post-row-index", text: String(index) });
        row.append(indexBadge);
    }

    const title = make("button", { type: "button", className: "post-title", text: post.title });
    title.addEventListener("click", (event) => {
        event.stopPropagation();
        openArticleDetail(post.post_id, boardId);
    });

    const snippet = make("p", { className: "post-snippet", text: post.content });
    const meta = make("div", { className: "post-row-meta" });
    const leftMeta = make("div", { className: "post-row-meta-left" });
    const rightMeta = make("div", { className: "post-row-meta-right" });

    leftMeta.append(
        make("span", { text: post.author_name }),
        make("span", { text: formatDate(post.created_at) }),
    );
    rightMeta.append(
        make("span", { text: `추천 ${post.like_count}` }),
        make("span", { text: `댓글 ${post.comment_count}` }),
    );
    meta.append(leftMeta, rightMeta);

    row.append(title, snippet, meta);
    return row;
}

function renderHotPosts(posts = []) {
    const hotBox = qs("#right-hot-box");
    hotBox.replaceChildren();
    const hotPosts = posts.slice(0, 5);
    if (hotPosts.length === 0) {
        hotBox.textContent = "인기 글이 없습니다.";
        hotBox.classList.add("muted");
        return;
    }
    hotBox.classList.remove("muted");
    hotPosts.forEach((post, index) => hotBox.append(createPostRow(post, post.board_id, "hot-row", index + 1)));
}

async function submitArticle() {
    if (!requireLogin() || !selectedBoardId) {
        showToast("게시판을 먼저 선택하세요.");
        return;
    }
    try {
        await api("/posts", {
            method: "POST",
            body: JSON.stringify({
                board_id: selectedBoardId,
                title: qs("#form-title").value,
                content: qs("#form-content").value,
                is_anonymous: qs("#form-anon").checked,
            }),
        });
        qs("#form-title").value = "";
        qs("#form-content").value = "";
        qs("#form-anon").checked = false;
        showWritePanel(false);
        await refreshAll();
        showToast("게시글이 등록되었습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function openArticleDetail(postId, boardId, pushHistory = true) {
    try {
        const detail = await api(`/posts/${postId}/detail`);
        if (boardId) {
            selectedBoardId = Number(boardId);
            const board = currentBoards.find((item) => item.board_id === selectedBoardId);
            if (board) qs("#post-list-title").textContent = boardTitle(board);
        }
        qs("#board-directory").hidden = true;
        qs("#board-view").hidden = false;
        qs("#write-panel").hidden = true;
        qs("#post-list").hidden = true;

        if (pushHistory) updateUrlParams({ post: postId, board: selectedBoardId || boardId || "" });
        document.title = `${detail.post.title} - YITA`;

        renderArticle(detail.post, detail.comments, boardId || selectedBoardId);
    } catch (error) {
        showToast(error.message);
    }
}

function renderArticle(post, comments, boardId) {
    const viewer = qs("#article-detail-viewer");
    viewer.hidden = false;
    viewer.replaceChildren();

    const article = make("article", { className: "article-thread" });
    article.append(
        make("div", { className: "thread-meta", text: `${post.author_name} · ${formatDate(post.created_at)}` }),
        make("h2", { className: "thread-title", text: post.title }),
        make("p", { className: "article-content", text: post.content }),
    );
    viewer.append(article);

    const actions = make("div", { className: "article-actions" });
    const like = make("button", { type: "button", text: "좋아요" });
    like.addEventListener("click", () => likePost(post.post_id, boardId));
    const report = make("button", { type: "button", text: "신고" });
    report.classList.add("danger");
    report.addEventListener("click", () => reportPost(post.post_id, boardId));
    actions.append(like, report);
    if (sessionUser.role === "admin" || post.user_id === sessionUser.user_id) {
        const remove = make("button", { type: "button", text: "삭제" });
        remove.addEventListener("click", () => deletePost(post.post_id));
        actions.append(remove);
    }
    viewer.append(actions);

    const commentList = make("section", { className: "comment-list" });
    if (comments.length === 0) {
        commentList.append(make("p", { className: "muted", text: "댓글이 없습니다." }));
    } else {
        comments.forEach((comment) => {
            const timeText = comment.created_at ? ` · ${formatDate(comment.created_at)}` : "";
            commentList.append(make("div", { className: "comment-row", text: `${comment.author_name}${timeText}: ${comment.content}` }));
        });
    }
    viewer.append(commentList);

    const form = make("div", { className: "comment-form" });
    const input = make("input");
    input.id = "reply-input";
    input.placeholder = "댓글을 입력하세요.";
    const label = make("label", { text: "익명" });
    const anon = make("input");
    anon.type = "checkbox";
    anon.id = "reply-anon";
    label.prepend(anon);
    const submit = make("button", { type: "button", text: "등록" });
    submit.addEventListener("click", () => submitReply(post.post_id, boardId));
    form.append(input, label, submit);
    viewer.append(form);
}

async function likePost(postId, boardId) {
    try {
        await api(`/posts/${postId}/like`, { method: "POST" });
        await openArticleDetail(postId, boardId);
    } catch (error) {
        showToast(error.message);
    }
}

async function reportPost(postId, boardId) {
    const reason = prompt("신고 사유를 입력하세요.", "부적절한 게시글");
    if (!reason) return;
    try {
        await api(`/posts/${postId}/report`, {
            method: "POST",
            body: JSON.stringify({ reason }),
        });
        await openArticleDetail(postId, boardId);
        showToast("신고가 접수되었습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function submitReply(postId, boardId) {
    const input = qs("#reply-input");
    const content = input ? input.value.trim() : "";
    if (!content) {
        showToast("댓글 내용을 입력해주세요.");
        return;
    }
    try {
        await api("/comments", {
            method: "POST",
            body: JSON.stringify({
                post_id: postId,
                content: content,
                is_anonymous: qs("#reply-anon").checked,
            }),
        });
        if (input) input.value = "";
        await openArticleDetail(postId, boardId);
    } catch (error) {
        showToast(error.message);
    }
}

async function deletePost(postId) {
    if (!confirm("\uAC8C\uC2DC\uAE00\uC744 \uC0AD\uC81C\uD560\uAE4C\uC694?")) return;
    try {
        await api(`/posts/${postId}`, { method: "DELETE" });
        qs("#article-detail-viewer").hidden = true;
        await refreshAll();
    } catch (error) {
        showToast(error.message);
    }
}

async function requestNewClub() {
    const clubName = qs("#new-club-name").value.trim();
    if (!clubName) {
        showToast("소모임 이름을 입력해주세요.");
        return;
    }
    try {
        await api("/boards/club", {
            method: "POST",
            body: JSON.stringify({ club_name: clubName }),
        });
        qs("#new-club-name").value = "";
        showToast("소모임 개설 요청이 접수되었습니다.");
        if (sessionUser.role === "admin") await syncAdminClubConsole();
    } catch (error) {
        showToast(error.message);
    }
}

async function syncAdminClubConsole() {
    const pending = await api("/admin/pending-clubs");
    const box = qs("#admin-club-console");
    box.replaceChildren();
    if (pending.length === 0) {
        box.textContent = "대기 중인 요청 없음";
        box.classList.add("muted");
        return;
    }
    box.classList.remove("muted");
    pending.forEach((club) => {
        const row = make("div", { className: "post-row" });
        row.append(make("strong", { text: club.club_name }));
        const approve = make("button", { type: "button", text: "승인" });
        approve.addEventListener("click", async () => {
            await api(`/admin/boards/${club.board_id}/approve`, { method: "POST" });
            await bootCommunity();
        });
        row.append(approve);
        box.append(row);
    });
}

let isSearching = false;

async function searchPosts(pushHistory = true) {
    if (isSearching) return;
    const keyword = qs("#search-input").value.trim();
    isSearching = true;
    try {
        selectedBoardId = null;
        const posts = await api(`/posts?q=${encodeURIComponent(keyword)}`);
        qs("#board-directory").hidden = true;
        qs("#board-view").hidden = false;
        qs("#write-panel").hidden = true;
        qs("#article-detail-viewer").hidden = true;
        qs("#post-list").hidden = false;
        qs("#open-write-button").style.display = "none";
        qs("#post-list-title").textContent = keyword ? `"${keyword}" 검색 결과` : "전체 검색";
        qs("#post-list-count").textContent = `${posts.length}개`;

        if (pushHistory) updateUrlParams(keyword ? { q: keyword } : {});
        document.title = keyword ? `"${keyword}" 검색 결과 - YITA` : "전체 검색 - YITA";

        const list = qs("#post-list");
        list.replaceChildren();
        if (posts.length === 0) {
            list.textContent = "검색 결과가 없습니다.";
            list.classList.add("muted");
            return;
        }
        list.classList.remove("muted");
        posts.forEach((post, index) => list.append(createPostRow(post, post.board_id, "post-row", index + 1)));
    } finally {
        isSearching = false;
    }
}

async function refreshAll() {
    await Promise.all([selectedBoardId ? renderPostList() : Promise.resolve(), refreshHome()]);
}

async function refreshHome() {
    homeCache = await api("/home");
    currentBoards = homeCache.boards;
    renderBoardDirectory();
    renderClubMenu();
    renderHotPosts(homeCache.hot_posts);
}

function parseKstDate(value) {
    if (!value) return null;
    let s = String(value).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
        s = s.replace(" ", "T") + "Z";
    } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) {
        s = s + "Z";
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}

function formatDate(value) {
    const d = parseKstDate(value);
    if (!d) return "";
    return d.toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
}

function bindEvents() {
    qs("#role-tab-student")?.addEventListener("click", () => switchAuthRole("student"));
    qs("#role-tab-teacher")?.addEventListener("click", () => switchAuthRole("teacher"));
    qs("#login-button").addEventListener("click", login);
    qs("#signup-button").addEventListener("click", signup);
    qs("#submit-post-button").addEventListener("click", submitArticle);
    qs("#open-write-button").addEventListener("click", () => {
        if (!requireLogin()) return;
        showWritePanel(true);
    });
    qs("#close-write-button").addEventListener("click", () => showWritePanel(false));
    qs("#profile-edit-button").addEventListener("click", () => showProfileEdit(true));
    qs("#close-profile-edit-button").addEventListener("click", () => showProfileEdit(false));
    qs("#save-profile-button").addEventListener("click", saveProfileChanges);
    qs("#club-request-button").addEventListener("click", requestNewClub);
    qs("#refresh-board-button").addEventListener("click", refreshAll);
    qs("#back-directory-button").addEventListener("click", () => showDirectory(true));
    qs("#back-list-button").addEventListener("click", () => {
        qs("#article-detail-viewer").hidden = true;
        qs("#post-list").hidden = false;
        showWritePanel(false);
        if (selectedBoardId) {
            updateUrlParams({ board: selectedBoardId });
            renderPostList();
        } else {
            showDirectory(true);
        }
    });
    qs("#top-login-indicator").addEventListener("click", () => {
        if (!sessionUser) qs("#u-email")?.focus();
    });
    qs("#search-input").addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            searchPosts(true).catch((error) => showToast(error.message));
        }
    });
}

function updateUrlParams(params) {
    const url = new URL(window.location);
    url.search = "";
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
            url.searchParams.set(key, String(value));
        }
    });
    window.history.pushState(params, "", url.toString());
}

async function handleUrlRouting() {
    const urlParams = new URLSearchParams(window.location.search);
    const postId = urlParams.get("post");
    const boardId = urlParams.get("board");
    const query = urlParams.get("q");

    if (postId) {
        await openArticleDetail(Number(postId), boardId ? Number(boardId) : null, false);
    } else if (boardId) {
        await enterBoard(Number(boardId), false);
    } else if (query) {
        qs("#search-input").value = query;
        await searchPosts(false);
    }
}

window.addEventListener("popstate", async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const postId = urlParams.get("post");
    const boardId = urlParams.get("board");
    const query = urlParams.get("q");

    if (postId) {
        await openArticleDetail(Number(postId), boardId ? Number(boardId) : null, false);
    } else if (boardId) {
        await enterBoard(Number(boardId), false);
    } else if (query) {
        qs("#search-input").value = query;
        await searchPosts(false);
    } else {
        showDirectory(false);
    }
});

function showWritePanel(show) {
    qs("#write-panel").hidden = !show;
    qs("#post-list").hidden = show;
    qs("#article-detail-viewer").hidden = true;
    if (show) {
        qs("#current-board-title").textContent = `${qs("#post-list-title").textContent} 글쓰기`;
        qs("#form-title").focus();
    }
}

function showProfileEdit(show) {
    qs("#profile-edit-panel").hidden = !show;
    if (show) {
        qs("#board-directory").hidden = true;
        qs("#board-view").hidden = true;
        qs("#post-list").hidden = true;
        qs("#article-detail-viewer").hidden = true;
        qs("#write-panel").hidden = true;
        if (!sessionUser) {
            showToast("로그인이 필요합니다.");
            return;
        }
        qs("#profile-name-input").value = sessionUser.name;
        qs("#profile-grade-input").value = String(sessionUser.grade);
        qs("#profile-current-password").value = "";
        qs("#profile-new-password").value = "";
    } else {
        if (selectedBoardId) {
            qs("#board-view").hidden = false;
            qs("#post-list").hidden = false;
        } else {
            qs("#board-directory").hidden = false;
        }
    }
}

async function saveProfileChanges() {
    if (!requireLogin()) return;
    const name = qs("#profile-name-input").value.trim();
    const grade = Number(qs("#profile-grade-input").value);
    const currentPassword = qs("#profile-current-password").value;
    const newPassword = qs("#profile-new-password").value;
    if (!name) {
        showToast("이름을 입력해주세요.");
        return;
    }
    try {
        const data = { name, grade };
        if (newPassword) {
            data.current_password = currentPassword;
            data.new_password = newPassword;
        }
        const updated = await api("/auth/profile", {
            method: "PATCH",
            body: JSON.stringify(data),
        });
        sessionUser = updated;
        applyLoginState();
        showProfileEdit(false);
        showToast("프로필이 저장되었습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

bindEvents();
restoreSession();
