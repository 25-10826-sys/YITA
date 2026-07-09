const BASE_API = window.location.protocol === "file:" ? "http://127.0.0.1:8000/api" : "/api";
const TOKEN_KEY = "yita_admin_auth_token";

let authToken = localStorage.getItem(TOKEN_KEY);
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
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    if (options.body) headers["Content-Type"] = "application/json";

    const response = await fetch(`${BASE_API}${path}`, { ...options, headers });
    const data = (response.headers.get("content-type") || "").includes("application/json")
        ? await response.json()
        : null;
    if (!response.ok) {
        if (response.status === 401) clearAdminSession();
        throw new Error(data?.detail || data?.message || "\uC694\uCCAD\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
    }
    return data;
}

function saveAdminSession(payload) {
    authToken = payload.token;
    adminUser = payload.user;
    localStorage.setItem(TOKEN_KEY, authToken);
}

function clearAdminSession() {
    authToken = null;
    adminUser = null;
    localStorage.removeItem(TOKEN_KEY);
}

async function loginAdmin() {
    try {
        const payload = await api("/auth/login", {
            method: "POST",
            body: JSON.stringify({
                email: qs("#admin-email").value.trim(),
                password: qs("#admin-password").value,
            }),
        });
        if (payload.user.role !== "admin") throw new Error("관리자 계정만 접근할 수 있습니다.");
        saveAdminSession(payload);
        applyAdminState();
        await refreshAdmin();
        showToast("관리자로 로그인되었습니다.");
    } catch (error) {
        clearAdminSession();
        showToast(error.message);
    }
}

async function restoreAdminSession() {
    if (!authToken) return;
    try {
        const user = await api("/auth/me");
        if (user.role !== "admin") throw new Error("관리자 계정만 접근할 수 있습니다.");
        adminUser = user;
        applyAdminState();
        await refreshAdmin();
    } catch (error) {
        clearAdminSession();
        showToast(error.message);
    }
}

function applyAdminState() {
    qs("#admin-login-card").hidden = true;
    qs("#admin-dashboard").hidden = false;
    qs("#admin-state").textContent = `${adminUser.name} 로그인`;
    qs("#admin-state").onclick = logoutAdmin;
}

async function logoutAdmin() {
    try {
        if (authToken) await api("/auth/logout", { method: "POST" });
    } catch (_) {
    } finally {
        clearAdminSession();
        location.reload();
    }
}

async function refreshAdmin() {
    await Promise.all([renderUsers(), renderReportedUsers(), renderReports(), renderClubs()]);
}

function switchAdminTab(tabName) {
    document.querySelectorAll("[data-admin-tab]").forEach((button) => {
        button.classList.toggle("active", button.dataset.adminTab === tabName);
    });
    document.querySelectorAll(".admin-panel").forEach((panel) => {
        panel.hidden = panel.id !== `admin-tab-${tabName}`;
    });
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
    users.forEach((user) => box.append(createUserRow(user)));
}

function createUserRow(user) {
    const row = make("div", { className: "admin-row" });
    const info = make("div");
    info.append(
        make("strong", { text: `${user.name} (${user.email})` }),
        make("p", {
            className: "post-meta",
                text: `${user.grade}\uD559\uB144 \u00B7 ${user.role} \u00B7 \uACF5\uC9C0\uAD8C\uD55C ${user.can_post_notice ? "\uC788\uC74C" : "\uC5C6\uC74C"}${user.timeout_until ? ` \u00B7 \uC815\uC9C0\uC911: ${user.timeout_until.slice(0, 16)}` : ""}`,
        }),
    );

    const actions = make("div", { className: "admin-actions" });
    if (user.role !== "admin") {
        const notice = make("button", {
            type: "button",
            text: user.can_post_notice ? "\uACF5\uC9C0\uAD8C\uD55C \uD68C\uC218" : "\uACF5\uC9C0\uAD8C\uD55C \uBD80\uC5EC",
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
    return row;
}

async function renderReportedUsers() {
    const users = await api("/admin/reported-users");
    const box = qs("#admin-reported-users");
    box.replaceChildren();
    if (users.length === 0) {
        box.textContent = "신고받은 계정이 없습니다.";
        box.classList.add("muted");
        return;
    }
    box.classList.remove("muted");
    for (const user of users) {
        const card = make("article", { className: "report-user-card" });
        const header = make("div", { className: "report-user-header" });
        const info = make("div");
        info.append(
            make("h3", { text: `${user.name} (${user.email})` }),
            make("p", {
                className: "post-meta",
                text: `${user.grade}\uD559\uB144 \u00B7 ${user.role} \u00B7 \uB204\uC801 \uC2E0\uACE0 ${user.report_count}\uAC74${user.timeout_until ? ` \u00B7 \uC815\uC9C0\uC911 ${user.timeout_until.slice(0, 16)}` : ""}`,
            }),
        );
        const actions = make("div", { className: "admin-actions" });
        const suspend = make("button", { type: "button", text: "계정 정지" });
        suspend.classList.add("danger");
        suspend.addEventListener("click", () => suspendUser(user.user_id));
        const unsuspend = make("button", { type: "button", text: "정지 해제" });
        unsuspend.addEventListener("click", () => unsuspendUser(user.user_id));
        actions.append(suspend, unsuspend);
        header.append(info, actions);
        card.append(header);

        for (const report of user.reports) {
            const reportBox = make("div", { className: "reported-post-box" });
            reportBox.append(
                make("strong", { text: report.post_title }),
                make("p", { className: "reported-post-content", text: report.post_content }),
                make("p", {
                    className: "post-meta",
                    text: `신고자 ${report.reporter_name} (${report.reporter_email}) · 사유: ${report.reason} · 상태: ${report.status}`,
                }),
            );
            card.append(reportBox);
        }
        box.append(card);
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
            make("p", { className: "reported-post-content", text: report.post_content }),
            make("p", {
                className: "post-meta",
                text: `신고자 ${report.reporter_name} (${report.reporter_email}) · 대상 ${report.target_name} (${report.target_email}) · ${report.reason} · ${report.status}`,
            }),
        );
        const actions = make("div", { className: "admin-actions" });
        const resolve = make("button", { type: "button", text: "처리 완료" });
        resolve.addEventListener("click", () => resolveReport(report.report_id));
        const suspend = make("button", { type: "button", text: "작성자 정지" });
        suspend.classList.add("danger");
        suspend.addEventListener("click", () => suspendUser(report.target_user_id));
        actions.append(resolve, suspend);
        row.append(info, actions);
        box.append(row);
    }
}

async function renderClubs() {
    const [pending, boards] = await Promise.all([api("/admin/pending-clubs"), api("/boards")]);
    const approved = boards.filter((board) => board.type === "club");
    const box = qs("#admin-clubs");
    box.replaceChildren();

    const pendingSection = make("section", { className: "admin-subsection" });
    pendingSection.append(make("h3", { text: "승인 대기 소모임" }));
    if (pending.length === 0) {
        pendingSection.append(make("p", { className: "muted", text: "승인 대기 중인 소모임이 없습니다." }));
    } else {
        pending.forEach((club) => pendingSection.append(createClubRow(club, true)));
    }

    const approvedSection = make("section", { className: "admin-subsection" });
    approvedSection.append(make("h3", { text: "승인된 소모임" }));
    if (approved.length === 0) {
        approvedSection.append(make("p", { className: "muted", text: "승인된 소모임이 없습니다." }));
    } else {
        approved.forEach((club) => approvedSection.append(createClubRow(club, false)));
    }

    box.classList.remove("muted");
    box.append(pendingSection, approvedSection);
}

function createClubRow(club, isPending) {
    const row = make("div", { className: "admin-row" });
    row.append(make("strong", { text: club.club_name || `소모임 #${club.board_id}` }));
    const actions = make("div", { className: "admin-actions" });
    if (isPending) {
        const approve = make("button", { type: "button", text: "승인" });
        approve.addEventListener("click", () => approveClub(club.board_id));
        actions.append(approve);
    }
    const remove = make("button", { type: "button", text: "삭제" });
    remove.classList.add("danger");
    remove.addEventListener("click", () => deleteClub(club.board_id));
    actions.append(remove);
    row.append(actions);
    return row;
}

async function setNoticePermission(userId, canPostNotice) {
    try {
        await api(`/admin/users/${userId}/notice-permission`, {
            method: "PATCH",
            body: JSON.stringify({ can_post_notice: canPostNotice }),
        });
        await refreshAdmin();
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
        await refreshAdmin();
        showToast("계정을 정지했습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function unsuspendUser(userId) {
    try {
        await api(`/admin/users/${userId}/unsuspend`, { method: "POST" });
        await refreshAdmin();
        showToast("정지를 해제했습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function resolveReport(reportId) {
    try {
        await api(`/admin/reports/${reportId}/resolve`, { method: "POST" });
        await refreshAdmin();
        showToast("신고를 처리했습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function approveClub(boardId) {
    try {
        await api(`/admin/boards/${boardId}/approve`, { method: "POST" });
        await refreshAdmin();
        showToast("소모임을 승인했습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function deleteClub(boardId) {
    if (!confirm("\uC774 \uC18C\uBAA8\uC784\uACFC \uC18C\uBAA8\uC784\uC758 \uAC8C\uC2DC\uAE00/\uB313\uAE00\uC744 \uBAA8\uB450 \uC0AD\uC81C\uD560\uAE4C\uC694?")) return;
    try {
        await api(`/admin/boards/${boardId}`, { method: "DELETE" });
        await refreshAdmin();
        showToast("소모임을 삭제했습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

qs("#admin-login-button").addEventListener("click", loginAdmin);
qs("#refresh-admin-button").addEventListener("click", () => refreshAdmin().catch((error) => showToast(error.message)));
document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.addEventListener("click", () => switchAdminTab(button.dataset.adminTab));
});
restoreAdminSession();
