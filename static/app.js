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

function readAuthForm() {
    return {
        email: qs("#u-email").value.trim(),
        password: qs("#u-password").value,
        name: qs("#u-name").value.trim(),
        grade: Number(qs("#u-grade").value),
    };
}

async function signup() {
    const data = readAuthForm();
    try {
        saveAuth(await api("/auth/signup", {
            method: "POST",
            body: JSON.stringify(data),
        }));
        applyLoginState();
        await bootCommunity();
        showToast("회원가입이 완료되었습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function login() {
    const data = readAuthForm();
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
    if (!authToken) return;
    try {
        sessionUser = await api("/auth/me");
        applyLoginState();
        await bootCommunity();
    } catch (_) {
        clearSession();
    }
}

function applyLoginState() {
    qs("#login-card").hidden = true;
    qs("#profile-card").hidden = false;
    qs("#top-login-indicator").textContent = sessionUser.role === "admin" ? "\uAD00\uB9AC\uC790 \uB85C\uADF8\uC778" : "\uB85C\uADF8\uC778 \uC644\uB8CC";
    qs("#top-login-indicator").onclick = logout;
    qs("#display-name").textContent = sessionUser.name;
    qs("#display-grade").textContent = `이순신고등학교 ${sessionUser.grade}학년`;
    qs("#display-role").textContent = sessionUser.role === "admin"
        ? "\uAD00\uB9AC\uC790 \u00B7 \uBAA8\uB4E0 \uAC8C\uC2DC\uD310 \uAD00\uB9AC \uAC00\uB2A5"
        : sessionUser.can_post_notice
            ? "\uD559\uC0DD \u00B7 \uACF5\uC9C0 \uC791\uC131 \uAD8C\uD55C \uC788\uC74C"
            : "\uD559\uC0DD";
    qs("#admin-card").hidden = sessionUser.role !== "admin";
}

function requireLogin() {
    if (!sessionUser) {
        showToast("로그인이 필요합니다.");
        return false;
    }
    return true;
}

async function bootCommunity() {
    homeCache = await api("/home");
    currentBoards = homeCache.boards;
    renderBoardDirectory();
    renderClubMenu();
    renderHotPosts(homeCache.hot_posts);
    if (sessionUser.role === "admin") await syncAdminClubConsole();
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

async function enterBoard(boardId) {
    if (!requireLogin()) return;
    selectedBoardId = Number(boardId);
    const board = currentBoards.find((item) => item.board_id === selectedBoardId);
    qs("#board-directory").hidden = true;
    qs("#board-view").hidden = false;
    qs("#write-panel").hidden = false;
    qs("#post-list-title").textContent = board ? boardTitle(board) : "\uAC8C\uC2DC\uD310";
    qs("#current-board-title").textContent = `${board ? boardTitle(board) : "\uAC8C\uC2DC\uD310"} \uAE00\uC4F0\uAE30`;
    qs("#article-detail-viewer").hidden = true;
    await renderPostList();
}

function showDirectory() {
    selectedBoardId = null;
    qs("#board-view").hidden = true;
    qs("#board-directory").hidden = false;
    qs("#article-detail-viewer").hidden = true;
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
    posts.forEach((post) => list.append(createPostRow(post, selectedBoardId, "post-row")));
}

function createPostRow(post, boardId, className) {
    const row = make("article", { className: className ? `${className} post-row` : "post-row" });
    const title = make("button", { type: "button", className: "post-title", text: post.title });
    title.addEventListener("click", () => openArticleDetail(post.post_id, boardId));

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
    hotPosts.forEach((post) => hotBox.append(createPostRow(post, post.board_id, "hot-row")));
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
        await refreshAll();
        showToast("게시글이 등록되었습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function openArticleDetail(postId, boardId) {
    try {
        const detail = await api(`/posts/${postId}/detail`);
        renderArticle(detail.post, detail.comments, boardId);
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
            commentList.append(make("div", { className: "comment-row", text: `${comment.author_name}: ${comment.content}` }));
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
        refreshAll().catch(() => {});
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
    try {
        await api("/comments", {
            method: "POST",
            body: JSON.stringify({
                post_id: postId,
                content: qs("#reply-input").value,
                is_anonymous: qs("#reply-anon").checked,
            }),
        });
        await openArticleDetail(postId, boardId);
        refreshAll().catch(() => {});
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
    try {
        await api("/boards/club", {
            method: "POST",
            body: JSON.stringify({ club_name: qs("#new-club-name").value }),
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

async function searchPosts() {
    if (!requireLogin()) return;
    const keyword = qs("#search-input").value.trim();
    const posts = await api(`/posts?q=${encodeURIComponent(keyword)}`);
    qs("#board-directory").hidden = true;
    qs("#board-view").hidden = false;
    qs("#write-panel").hidden = true;
    qs("#article-detail-viewer").hidden = true;
    qs("#post-list-title").textContent = keyword ? `"${keyword}" \uAC80\uC0C9 \uACB0\uACFC` : "\uC804\uCCB4 \uAC80\uC0C9";
    qs("#post-list-count").textContent = `${posts.length}개`;
    const list = qs("#post-list");
    list.replaceChildren();
    if (posts.length === 0) {
        list.textContent = "검색 결과가 없습니다.";
        list.classList.add("muted");
        return;
    }
    list.classList.remove("muted");
    posts.forEach((post) => list.append(createPostRow(post, post.board_id, "post-row")));
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

function formatDate(value) {
    if (!value) return "";
    return new Date(value.replace(" ", "T")).toLocaleString("ko-KR", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function bindEvents() {
    qs("#login-button").addEventListener("click", login);
    qs("#signup-button").addEventListener("click", signup);
    qs("#submit-post-button").addEventListener("click", submitArticle);
    qs("#club-request-button").addEventListener("click", requestNewClub);
    qs("#refresh-board-button").addEventListener("click", refreshAll);
    qs("#back-directory-button").addEventListener("click", showDirectory);
    qs("#back-list-button").addEventListener("click", () => {
        qs("#article-detail-viewer").hidden = true;
        renderPostList();
    });
    qs("#search-input").addEventListener("keydown", (event) => {
        if (event.key === "Enter") searchPosts().catch((error) => showToast(error.message));
    });
}

bindEvents();
restoreSession();
