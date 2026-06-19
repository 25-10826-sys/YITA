const BASE_API = window.location.protocol === "file:" ? "http://127.0.0.1:8000/api" : "/api";

let sessionUser = null;
let selectedBoardId = 1;
let currentBoards = [];

const boardNames = {
    1: "전체 게시판",
    2: "1학년 게시판",
    3: "2학년 게시판",
    4: "3학년 게시판",
    5: "수학 공지",
    6: "과학 공지",
    7: "국어 공지",
    8: "영어 공지",
    9: "사회 공지",
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
    if (sessionUser) headers["user-id"] = sessionUser.user_id;
    if (options.body) headers["Content-Type"] = "application/json";

    const response = await fetch(`${BASE_API}${path}`, { ...options, headers });
    const data = (response.headers.get("content-type") || "").includes("application/json")
        ? await response.json()
        : null;
    if (!response.ok) throw new Error(data?.detail || data?.message || "요청에 실패했습니다.");
    return data;
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
        sessionUser = await api("/auth/signup", {
            method: "POST",
            body: JSON.stringify(data),
        });
        applyLoginState();
        await bootBoards();
        showToast("회원가입이 완료되었습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function login() {
    const data = readAuthForm();
    try {
        sessionUser = await api("/auth/login", {
            method: "POST",
            body: JSON.stringify({ email: data.email, password: data.password }),
        });
        applyLoginState();
        await bootBoards();
        showToast("로그인되었습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

function applyLoginState() {
    qs("#login-card").hidden = true;
    qs("#profile-card").hidden = false;
    qs("#write-panel").hidden = false;
    qs("#top-login-indicator").textContent = sessionUser.role === "admin" ? "관리자 로그인" : "로그인 완료";
    qs("#display-name").textContent = sessionUser.name;
    qs("#display-grade").textContent = `이순신고등학교 ${sessionUser.grade}학년`;
    qs("#display-role").textContent = sessionUser.role === "admin"
        ? "관리자 · 모든 공지 작성 가능"
        : sessionUser.can_post_notice
            ? "학생 · 공지 작성 권한 있음"
            : "학생";
    qs("#admin-card").hidden = sessionUser.role !== "admin";
}

function requireLogin() {
    if (!sessionUser) {
        showToast("로그인이 필요합니다.");
        return false;
    }
    return true;
}

async function bootBoards() {
    currentBoards = await api("/boards");
    renderClubMenu();
    await switchBoard(selectedBoardId);
    await renderPreviews();
    await renderHotPosts();
    if (sessionUser.role === "admin") await syncAdminClubConsole();
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
    for (const club of clubs) {
        const button = make("button", { type: "button", text: club.club_name });
        button.addEventListener("click", () => switchBoard(club.board_id));
        container.append(button);
    }
}

function boardName(boardId) {
    const board = currentBoards.find((item) => item.board_id === Number(boardId));
    if (board?.type === "club") return board.club_name;
    return boardNames[Number(boardId)] || "게시판";
}

async function switchBoard(boardId) {
    if (!requireLogin()) return;
    selectedBoardId = Number(boardId);
    qs("#post-list-title").textContent = boardName(selectedBoardId);
    qs("#current-board-title").textContent = `${boardName(selectedBoardId)} 글쓰기`;
    qs("#article-detail-viewer").hidden = true;
    await renderPostList();
}

async function renderPostList() {
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
    for (const post of posts) {
        list.append(createPostRow(post, selectedBoardId, "post-row"));
    }
}

function createPostRow(post, boardId, className) {
    const row = make("article", { className });
    const title = make("button", { type: "button", text: post.title });
    title.addEventListener("click", () => openArticleDetail(post.post_id, boardId));
    const content = make("p", { className: "post-snippet", text: post.content });
    const meta = make("div", {
        className: "post-meta",
        text: `${post.author_name} · 👍 ${post.like_count} · 💬 ${post.comment_count} · ${formatDate(post.created_at)}`,
    });
    row.append(title, content, meta);
    return row;
}

async function renderPreviews() {
    for (let boardId = 1; boardId <= 4; boardId += 1) {
        const target = qs(`#mini-board-${boardId}`);
        target.replaceChildren();
        const posts = await api(`/boards/${boardId}/posts`);
        if (posts.length === 0) {
            target.textContent = "작성된 글이 없습니다.";
            target.classList.add("muted");
            continue;
        }
        target.classList.remove("muted");
        for (const post of posts.slice(0, 3)) {
            target.append(createPostRow(post, boardId, "preview-row"));
        }
    }
}

async function renderHotPosts() {
    const posts = await api("/posts");
    const hotBox = qs("#right-hot-box");
    hotBox.replaceChildren();
    const hotPosts = posts
        .slice()
        .sort((a, b) => b.like_count + b.comment_count - (a.like_count + a.comment_count))
        .slice(0, 5);
    if (hotPosts.length === 0) {
        hotBox.textContent = "인기 글이 없습니다.";
        hotBox.classList.add("muted");
        return;
    }
    hotBox.classList.remove("muted");
    for (const post of hotPosts) {
        hotBox.append(createPostRow(post, post.board_id, "hot-row"));
    }
}

async function submitArticle() {
    if (!requireLogin()) return;
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
        const posts = await api(`/boards/${boardId}/posts`);
        const post = posts.find((item) => item.post_id === postId);
        if (!post) throw new Error("게시글을 찾을 수 없습니다.");
        const comments = await api(`/posts/${postId}/comments`);
        renderArticle(post, comments, boardId);
    } catch (error) {
        showToast(error.message);
    }
}

function renderArticle(post, comments, boardId) {
    const viewer = qs("#article-detail-viewer");
    viewer.hidden = false;
    viewer.replaceChildren();
    viewer.append(
        make("h2", { text: post.title }),
        make("p", { className: "article-content", text: post.content }),
        make("div", { className: "post-meta", text: `${post.author_name} · ${formatDate(post.created_at)} · 👍 ${post.like_count}` }),
    );

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
        for (const comment of comments) {
            commentList.append(make("div", { className: "comment-row", text: `${comment.author_name}: ${comment.content}` }));
        }
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
        await refreshAll();
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
    try {
        await api("/comments", {
            method: "POST",
            body: JSON.stringify({
                post_id: postId,
                content: qs("#reply-input").value,
                is_anonymous: qs("#reply-anon").checked,
            }),
        });
        await refreshAll();
        await openArticleDetail(postId, boardId);
    } catch (error) {
        showToast(error.message);
    }
}

async function deletePost(postId) {
    if (!confirm("게시글을 삭제할까요?")) return;
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
    for (const club of pending) {
        const row = make("div", { className: "post-row" });
        row.append(make("strong", { text: club.club_name }));
        const approve = make("button", { type: "button", text: "승인" });
        approve.addEventListener("click", async () => {
            await api(`/admin/boards/${club.board_id}/approve`, { method: "POST" });
            await bootBoards();
        });
        row.append(approve);
        box.append(row);
    }
}

async function searchPosts() {
    if (!requireLogin()) return;
    const keyword = qs("#search-input").value.trim();
    const posts = await api(`/posts?q=${encodeURIComponent(keyword)}`);
    const list = qs("#post-list");
    qs("#post-list-title").textContent = keyword ? `"${keyword}" 검색 결과` : "전체 검색";
    qs("#post-list-count").textContent = `${posts.length}개`;
    list.replaceChildren();
    if (posts.length === 0) {
        list.textContent = "검색 결과가 없습니다.";
        list.classList.add("muted");
        return;
    }
    list.classList.remove("muted");
    for (const post of posts) {
        list.append(createPostRow(post, post.board_id, "post-row"));
    }
}

async function refreshAll() {
    await renderPostList();
    await renderPreviews();
    await renderHotPosts();
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
    qs("#back-list-button").addEventListener("click", () => {
        qs("#article-detail-viewer").hidden = true;
        renderPostList();
    });
    qs("#search-input").addEventListener("keydown", (event) => {
        if (event.key === "Enter") searchPosts().catch((error) => showToast(error.message));
    });
    document.querySelectorAll("[data-board]").forEach((element) => {
        element.addEventListener("click", () => switchBoard(element.dataset.board));
    });
}

bindEvents();
