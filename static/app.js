const BASE_API = window.location.protocol === "file:" ? "http://127.0.0.1:8000/api" : "/api";

let sessionUser = null;
let selectedBoardId = 1;
let currentBoards = [];
let currentPosts = [];

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

function qs(selector) {
    return document.querySelector(selector);
}

function make(tag, options = {}) {
    const element = document.createElement(tag);
    if (options.className) element.className = options.className;
    if (options.text !== undefined) element.textContent = options.text;
    if (options.type) element.type = options.type;
    if (options.dataset) Object.assign(element.dataset, options.dataset);
    return element;
}

function showToast(message) {
    const toast = qs("#toast");
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
        toast.hidden = true;
    }, 2600);
}

async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (sessionUser) headers["user-id"] = sessionUser.user_id;
    if (options.body && !(options.body instanceof FormData)) headers["Content-Type"] = "application/json";

    const response = await fetch(`${BASE_API}${path}`, { ...options, headers });
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await response.json() : null;
    if (!response.ok) {
        throw new Error(data?.detail || data?.message || "요청 처리 중 오류가 발생했습니다.");
    }
    return data;
}

function requireLogin() {
    if (!sessionUser) {
        showToast("로그인이 필요합니다.");
        return false;
    }
    return true;
}

async function executeLogin() {
    const email = qs("#u-email").value.trim();
    const name = qs("#u-name").value.trim();
    const grade = Number(qs("#u-grade").value);

    try {
        sessionUser = await api("/auth/google", {
            method: "POST",
            body: JSON.stringify({ email, name, grade }),
        });
        qs("#login-card").hidden = true;
        qs("#profile-card").hidden = false;
        qs("#write-panel").hidden = false;
        qs("#top-login-indicator").textContent = "인증 완료";
        qs("#display-name").textContent = sessionUser.name;
        qs("#display-grade").textContent = `이순신고등학교 ${sessionUser.grade}학년`;
        qs("#display-role").textContent = sessionUser.role === "admin" ? "관리자" : "학생";
        qs("#admin-card").hidden = sessionUser.role !== "admin";

        await syncBoards();
        await switchBoard(1);
        if (sessionUser.role === "admin") await syncAdminClubConsole();
        showToast("로그인되었습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function syncBoards() {
    currentBoards = await api("/boards");
    const clubList = qs("#club-board-list");
    clubList.replaceChildren();
    const clubs = currentBoards.filter((board) => board.type === "club");
    if (clubs.length === 0) {
        clubList.textContent = "승인된 소모임 없음";
        clubList.classList.add("muted");
        return;
    }

    clubList.classList.remove("muted");
    for (const club of clubs) {
        const button = make("button", { type: "button", text: club.club_name });
        button.addEventListener("click", () => switchBoard(club.board_id));
        clubList.append(button);
    }
}

function getBoardName(boardId) {
    const board = currentBoards.find((item) => item.board_id === boardId);
    if (board?.type === "club") return board.club_name;
    return boardNames[boardId] || "게시판";
}

async function switchBoard(boardId) {
    if (!requireLogin()) return;
    selectedBoardId = Number(boardId);
    qs("#current-board-title").textContent = `${getBoardName(selectedBoardId)}에 글쓰기`;
    qs("#post-list-title").textContent = getBoardName(selectedBoardId);
    qs("#article-detail-viewer").hidden = true;

    await renderPostList();
    await renderPreviews();
    await renderHotPosts();
}

async function renderPostList() {
    currentPosts = await api(`/boards/${selectedBoardId}/posts`);
    const list = qs("#post-list");
    list.replaceChildren();
    qs("#post-list-count").textContent = `${currentPosts.length}개`;

    if (currentPosts.length === 0) {
        list.textContent = "아직 작성된 글이 없습니다.";
        list.classList.add("muted");
        return;
    }

    list.classList.remove("muted");
    for (const post of currentPosts) {
        list.append(createPostRow(post, selectedBoardId, "post-row"));
    }
}

function createPostRow(post, boardId, className) {
    const row = make("article", { className });
    const button = make("button", { type: "button", text: post.title });
    button.addEventListener("click", () => openArticleDetail(post.post_id, boardId));
    const meta = make("div", {
        className: "post-meta",
        text: `${post.author_name} · 👍 ${post.like_count} · 💬 ${post.comment_count} · ${formatDate(post.created_at)}`,
    });
    row.append(button, meta);
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
    const title = qs("#form-title").value;
    const content = qs("#form-content").value;
    const isAnonymous = qs("#form-anon").checked;

    try {
        await api("/posts", {
            method: "POST",
            body: JSON.stringify({
                board_id: selectedBoardId,
                title,
                content,
                is_anonymous: isAnonymous,
            }),
        });
        qs("#form-title").value = "";
        qs("#form-content").value = "";
        qs("#form-anon").checked = false;
        await switchBoard(selectedBoardId);
        showToast("게시글이 등록되었습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function openArticleDetail(postId, boardId) {
    try {
        const posts = await api(`/boards/${boardId}/posts`);
        const article = posts.find((post) => post.post_id === postId);
        if (!article) throw new Error("게시글을 찾을 수 없습니다.");
        const comments = await api(`/posts/${postId}/comments`);
        renderArticle(article, comments, boardId);
    } catch (error) {
        showToast(error.message);
    }
}

function renderArticle(article, comments, boardId) {
    const viewer = qs("#article-detail-viewer");
    viewer.hidden = false;
    viewer.replaceChildren();

    const title = make("h2", { text: article.title });
    const content = make("p", { text: article.content });
    const meta = make("div", {
        className: "post-meta",
        text: `작성자: ${article.author_name} · 👍 ${article.like_count} · ${formatDate(article.created_at)}`,
    });

    const actions = make("div", { className: "article-actions" });
    const likeButton = make("button", { type: "button", text: "👍 좋아요" });
    likeButton.addEventListener("click", () => triggerLike(article.post_id, boardId));
    const reportButton = make("button", { type: "button", text: "🚨 신고" });
    reportButton.classList.add("danger");
    reportButton.addEventListener("click", () => triggerReport(article.post_id, boardId));
    actions.append(likeButton, reportButton);

    if (sessionUser && (sessionUser.role === "admin" || article.user_id === sessionUser.user_id)) {
        const deleteButton = make("button", { type: "button", text: "삭제" });
        deleteButton.addEventListener("click", () => deletePost(article.post_id, boardId));
        actions.append(deleteButton);
    }

    const commentBox = make("section", { className: "comment-list" });
    if (comments.length === 0) {
        commentBox.append(make("div", { className: "muted", text: "댓글이 없습니다." }));
    } else {
        for (const comment of comments) {
            commentBox.append(createCommentRow(comment, article.post_id, boardId));
        }
    }

    const commentForm = make("div", { className: "comment-form" });
    const input = make("input");
    input.id = "reply-input";
    input.placeholder = "댓글을 입력하세요.";
    input.maxLength = 500;
    const anonLabel = make("label", { text: "익명" });
    const anon = make("input");
    anon.type = "checkbox";
    anon.id = "reply-anon";
    anonLabel.prepend(anon);
    const submit = make("button", { type: "button", text: "등록" });
    submit.addEventListener("click", () => submitReply(article.post_id, boardId));
    commentForm.append(input, anonLabel, submit);

    viewer.append(title, content, meta, actions, commentBox, commentForm);
}

function createCommentRow(comment, postId, boardId) {
    const row = make("div", { className: "comment-row" });
    const content = make("div", { text: `${comment.author_name}: ${comment.content}` });
    const meta = make("div", { className: "comment-meta", text: formatDate(comment.created_at) });
    row.append(content, meta);

    if (sessionUser && (sessionUser.role === "admin" || comment.user_id === sessionUser.user_id)) {
        const button = make("button", { type: "button", text: "댓글 삭제" });
        button.addEventListener("click", () => deleteComment(comment.comment_id, postId, boardId));
        row.append(button);
    }
    return row;
}

async function triggerLike(postId, boardId) {
    try {
        await api(`/posts/${postId}/like`, { method: "POST" });
        await switchBoard(boardId);
        await openArticleDetail(postId, boardId);
        showToast("좋아요를 눌렀습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function triggerReport(postId, boardId) {
    const reason = window.prompt("신고 사유를 입력해 주세요.", "부적절한 게시글");
    if (!reason) return;
    try {
        const result = await api(`/posts/${postId}/report`, {
            method: "POST",
            body: JSON.stringify({ reason }),
        });
        await openArticleDetail(postId, boardId);
        showToast(result.message);
    } catch (error) {
        showToast(error.message);
    }
}

async function submitReply(postId, boardId) {
    const content = qs("#reply-input").value;
    const isAnonymous = qs("#reply-anon").checked;
    try {
        await api("/comments", {
            method: "POST",
            body: JSON.stringify({ post_id: postId, content, is_anonymous: isAnonymous }),
        });
        await renderPostList();
        await openArticleDetail(postId, boardId);
        showToast("댓글이 등록되었습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function deletePost(postId, boardId) {
    if (!window.confirm("게시글을 삭제할까요?")) return;
    try {
        await api(`/posts/${postId}`, { method: "DELETE" });
        qs("#article-detail-viewer").hidden = true;
        await switchBoard(boardId);
        showToast("게시글이 삭제되었습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function deleteComment(commentId, postId, boardId) {
    try {
        await api(`/comments/${commentId}`, { method: "DELETE" });
        await openArticleDetail(postId, boardId);
        showToast("댓글이 삭제되었습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function requestNewClub() {
    const clubName = qs("#new-club-name").value;
    try {
        await api("/boards/club", {
            method: "POST",
            body: JSON.stringify({ club_name: clubName }),
        });
        qs("#new-club-name").value = "";
        if (sessionUser?.role === "admin") await syncAdminClubConsole();
        showToast("소모임 개설 요청이 접수되었습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function syncAdminClubConsole() {
    if (sessionUser?.role !== "admin") return;
    const pending = await api("/admin/pending-clubs");
    const consoleBox = qs("#admin-club-console");
    consoleBox.replaceChildren();
    if (pending.length === 0) {
        consoleBox.textContent = "대기 중인 요청 없음";
        consoleBox.classList.add("muted");
        return;
    }

    consoleBox.classList.remove("muted");
    for (const club of pending) {
        const row = make("div", { className: "post-row" });
        const name = make("strong", { text: club.club_name });
        const button = make("button", { type: "button", text: "승인" });
        button.addEventListener("click", () => approveClub(club.board_id));
        row.append(name, button);
        consoleBox.append(row);
    }
}

async function approveClub(boardId) {
    try {
        await api(`/admin/boards/${boardId}/approve`, { method: "POST" });
        await syncBoards();
        await syncAdminClubConsole();
        showToast("소모임이 승인되었습니다.");
    } catch (error) {
        showToast(error.message);
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
    qs("#login-button").addEventListener("click", executeLogin);
    qs("#submit-post-button").addEventListener("click", submitArticle);
    qs("#club-request-button").addEventListener("click", requestNewClub);
    qs("#search-input").addEventListener("keydown", (event) => {
        if (event.key === "Enter") searchPosts().catch((error) => showToast(error.message));
    });

    document.querySelectorAll("[data-board]").forEach((element) => {
        element.addEventListener("click", () => switchBoard(element.dataset.board));
    });
}

bindEvents();
