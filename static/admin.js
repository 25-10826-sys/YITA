const BASE_API = window.location.protocol === "file:" ? "http://127.0.0.1:8000/api" : "/api";

let adminUser = null;

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
    if (adminUser) headers["user-id"] = adminUser.user_id;
    if (options.body) headers["Content-Type"] = "application/json";
    const response = await fetch(`${BASE_API}${path}`, { ...options, headers });
    const data = (response.headers.get("content-type") || "").includes("application/json")
        ? await response.json()
        : null;
    if (!response.ok) throw new Error(data?.detail || data?.message || "요청에 실패했습니다.");
    return data;
}

async function loginAdmin() {
    try {
        adminUser = await api("/auth/login", {
            method: "POST",
            body: JSON.stringify({
                email: qs("#admin-email").value.trim(),
                password: qs("#admin-password").value,
            }),
        });
        if (adminUser.role !== "admin") {
            adminUser = null;
            throw new Error("관리자 계정만 접근할 수 있습니다.");
        }
        qs("#admin-login-card").hidden = true;
        qs("#admin-dashboard").hidden = false;
        qs("#admin-state").textContent = `${adminUser.name} 로그인`;
        await refreshAdmin();
        showToast("관리자로 로그인되었습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function refreshAdmin() {
    await Promise.all([renderUsers(), renderReports(), renderClubs()]);
}

async function renderUsers() {
    const users = await api("/admin/users");
    const box = qs("#admin-users");
    box.replaceChildren();
    if (users.length === 0) {
        box.textContent = "회원이 없습니다.";
        box.classList.add("muted");
        return;
    }
    box.classList.remove("muted");
    for (const user of users) {
        const row = make("div", { className: "admin-row" });
        const info = make("div");
        info.append(
            make("strong", { text: `${user.name} (${user.email})` }),
            make("p", {
                className: "post-meta",
                text: `${user.grade}학년 · ${user.role} · 공지권한 ${user.can_post_notice ? "있음" : "없음"}${user.timeout_until ? ` · 정지중: ${user.timeout_until.slice(0, 16)}` : ""}`,
            }),
        );

        const actions = make("div", { className: "admin-actions" });
        if (user.role !== "admin") {
            const notice = make("button", {
                type: "button",
                text: user.can_post_notice ? "공지권한 회수" : "공지권한 부여",
            });
            notice.addEventListener("click", () => setNoticePermission(user.user_id, !user.can_post_notice));
            actions.append(notice);
        }

        const suspend = make("button", { type: "button", text: "정지" });
        suspend.classList.add("danger");
        suspend.addEventListener("click", () => suspendUser(user.user_id));
        const unsuspend = make("button", { type: "button", text: "정지 해제" });
        unsuspend.addEventListener("click", () => unsuspendUser(user.user_id));
        actions.append(suspend, unsuspend);
        row.append(info, actions);
        box.append(row);
    }
}

async function setNoticePermission(userId, canPostNotice) {
    try {
        await api(`/admin/users/${userId}/notice-permission`, {
            method: "PATCH",
            body: JSON.stringify({ can_post_notice: canPostNotice }),
        });
        await renderUsers();
        showToast("공지 권한이 변경되었습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function suspendUser(userId) {
    const days = Number(prompt("정지 일수", "7"));
    if (!days) return;
    const reason = prompt("정지 사유", "커뮤니티 이용규칙 위반");
    if (!reason) return;
    try {
        await api(`/admin/users/${userId}/suspend`, {
            method: "POST",
            body: JSON.stringify({ days, reason }),
        });
        await renderUsers();
        showToast("계정을 정지했습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function unsuspendUser(userId) {
    try {
        await api(`/admin/users/${userId}/unsuspend`, { method: "POST" });
        await renderUsers();
        showToast("정지를 해제했습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function renderReports() {
    const reports = await api("/admin/reports");
    const box = qs("#admin-reports");
    box.replaceChildren();
    if (reports.length === 0) {
        box.textContent = "신고가 없습니다.";
        box.classList.add("muted");
        return;
    }
    box.classList.remove("muted");
    for (const report of reports) {
        const row = make("div", { className: "admin-row" });
        const info = make("div");
        info.append(
            make("strong", { text: report.post_title }),
            make("p", {
                className: "post-meta",
                text: `신고자 ${report.reporter_email} · 대상 ${report.target_email} · ${report.reason} · ${report.status}`,
            }),
        );
        const actions = make("div", { className: "admin-actions" });
        const resolve = make("button", { type: "button", text: "처리 완료" });
        resolve.addEventListener("click", () => resolveReport(report.report_id));
        const suspend = make("button", { type: "button", text: "대상 정지" });
        suspend.classList.add("danger");
        suspend.addEventListener("click", () => suspendUser(report.target_user_id));
        actions.append(resolve, suspend);
        row.append(info, actions);
        box.append(row);
    }
}

async function resolveReport(reportId) {
    try {
        await api(`/admin/reports/${reportId}/resolve`, { method: "POST" });
        await renderReports();
        showToast("신고를 처리했습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function renderClubs() {
    const clubs = await api("/admin/pending-clubs");
    const box = qs("#admin-clubs");
    box.replaceChildren();
    if (clubs.length === 0) {
        box.textContent = "대기 중인 소모임이 없습니다.";
        box.classList.add("muted");
        return;
    }
    box.classList.remove("muted");
    for (const club of clubs) {
        const row = make("div", { className: "admin-row" });
        row.append(make("strong", { text: club.club_name || `소모임 #${club.board_id}` }));
        const approve = make("button", { type: "button", text: "승인" });
        approve.addEventListener("click", () => approveClub(club.board_id));
        row.append(approve);
        box.append(row);
    }
}

async function approveClub(boardId) {
    try {
        await api(`/admin/boards/${boardId}/approve`, { method: "POST" });
        await renderClubs();
        showToast("소모임을 승인했습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

qs("#admin-login-button").addEventListener("click", loginAdmin);
qs("#refresh-admin-button").addEventListener("click", () => refreshAdmin().catch((error) => showToast(error.message)));
