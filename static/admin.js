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

function formatKoreanDateTime(value) {
    const d = parseKstDate(value);
    if (!d) return value || "";
    return d.toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
}

function formatSuspendStatus(user) {
    if (!user || !user.timeout_until) return "";
    const until = String(user.timeout_until).trim();
    const reasonText = user.suspend_reason ? ` (${user.suspend_reason})` : "";
    if (until.startsWith("9999")) {
        return `영구정지${reasonText}`;
    }
    const formatted = formatKoreanDateTime(until);
    return `${formatted}까지${reasonText}`;
}

let currentSuspendTargetUserId = null;

function openSuspendModal(userId, name, email) {
    currentSuspendTargetUserId = userId;
    const targetInfo = qs("#suspend-target-info");
    if (targetInfo) {
        targetInfo.textContent = `${name || "회원"} (${email || `ID ${userId}`}) 계정을 정지합니다.`;
    }
    const durationSelect = qs("#suspend-duration-select");
    if (durationSelect) durationSelect.value = "permanent";
    const reasonInput = qs("#suspend-reason-input");
    if (reasonInput) reasonInput.value = "커뮤니티 이용규칙 위반";
    const modal = qs("#suspend-modal");
    if (modal) modal.hidden = false;
}

function closeSuspendModal() {
    currentSuspendTargetUserId = null;
    const modal = qs("#suspend-modal");
    if (modal) modal.hidden = true;
}

async function confirmSuspendModal() {
    if (!currentSuspendTargetUserId) return;
    const duration = qs("#suspend-duration-select") ? qs("#suspend-duration-select").value : "permanent";
    const reason = qs("#suspend-reason-input") ? qs("#suspend-reason-input").value.trim() : "";
    if (!reason) {
        showToast("정지 사유를 입력해주세요.");
        return;
    }
    try {
        await api(`/admin/users/${currentSuspendTargetUserId}/suspend`, {
            method: "POST",
            body: JSON.stringify({ duration, reason }),
        });
        closeSuspendModal();
        await refreshAdmin();
        showToast("계정을 정지했습니다.");
    } catch (error) {
        showToast(error.message);
    }
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


function switchAdminTab(tabName) {
    document.querySelectorAll("[data-admin-tab]").forEach((button) => {
        button.classList.toggle("active", button.dataset.adminTab === tabName);
    });
    document.querySelectorAll(".admin-panel").forEach((panel) => {
        panel.hidden = panel.id !== `admin-tab-${tabName}`;
    });
}

async function renderUsers() {
    const query = qs("#admin-user-search").value.trim();
    const users = await api(`/admin/users${query ? `?q=${encodeURIComponent(query)}` : ""}`);
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
            text: user.role === "teacher"
                ? `교사 · 교무실: ${user.office || "미입력"} · 공지권한 ${user.can_post_notice ? "있음" : "없음"}${user.timeout_until ? ` · 정지중: ${formatSuspendStatus(user)}` : ""}`
                : `${user.grade}학년 · ${user.role} · 공지권한 ${user.can_post_notice ? "있음" : "없음"}${user.timeout_until ? ` · 정지중: ${formatSuspendStatus(user)}` : ""}`,
        }),
    );

    const actions = make("div", { className: "admin-actions" });
    if (user.role !== "admin") {
        const grant = make("button", { type: "button", text: "어드민 부여" });
        grant.addEventListener("click", () => grantAdmin(user.user_id));
        actions.append(grant);

        const notice = make("button", {
            type: "button",
            text: user.can_post_notice ? "공지권한 해제" : "공지권한 부여",
        });
        notice.addEventListener("click", () => setNoticePermission(user.user_id, !user.can_post_notice));
        actions.append(notice);
    }

    const suspend = make("button", { type: "button", text: "정지" });
    suspend.classList.add("danger");
    suspend.addEventListener("click", () => openSuspendModal(user.user_id, user.name, user.email));
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
                text: `${user.grade}학년 · ${user.role} · 누적 신고 ${user.report_count}건${user.latest_reported_at ? ` · 최근 신고: ${formatKoreanDateTime(user.latest_reported_at)}` : ""}${user.timeout_until ? ` · 정지중: ${formatSuspendStatus(user)}` : ""}`,
            }),
        );
        const actions = make("div", { className: "admin-actions" });
        const suspend = make("button", { type: "button", text: "계정 정지" });
        suspend.classList.add("danger");
        suspend.addEventListener("click", () => openSuspendModal(user.user_id, user.name, user.email));
        const unsuspend = make("button", { type: "button", text: "정지 해제" });
        unsuspend.addEventListener("click", () => unsuspendUser(user.user_id));
        actions.append(suspend, unsuspend);
        header.append(info, actions);
        card.append(header);

        for (const report of user.reports) {
            const reportBox = make("div", { className: "reported-post-box" });
            const postTime = report.post_created_at ? ` · 작성: ${formatKoreanDateTime(report.post_created_at)}` : "";
            const reportTime = report.created_at ? ` · 신고: ${formatKoreanDateTime(report.created_at)}` : "";
            reportBox.append(
                make("strong", { text: report.post_title }),
                make("p", { className: "reported-post-content", text: report.post_content }),
                make("p", {
                    className: "post-meta",
                    text: `신고자 ${report.reporter_name} (${report.reporter_email})${reportTime}${postTime} · 사유: ${report.reason} · 상태: ${report.status}`,
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
        const reportTime = report.created_at ? `${formatKoreanDateTime(report.created_at)} · ` : "";
        const postTime = report.post_created_at ? ` (글 작성: ${formatKoreanDateTime(report.post_created_at)})` : "";
        info.append(
            make("strong", { text: report.post_title }),
            make("p", { className: "reported-post-content", text: report.post_content }),
            make("p", {
                className: "post-meta",
                text: `${reportTime}신고자 ${report.reporter_name} (${report.reporter_email}) · 대상 ${report.target_name} (${report.target_email}) · 사유: ${report.reason} · 상태: ${report.status}${postTime}`,
            }),
        );
        const actions = make("div", { className: "admin-actions" });
        const resolve = make("button", { type: "button", text: "처리 완료" });
        resolve.addEventListener("click", () => resolveReport(report.report_id));
        const suspend = make("button", { type: "button", text: "작성자 정지" });
        suspend.classList.add("danger");
        suspend.addEventListener("click", () => openSuspendModal(report.target_user_id, report.target_name, report.target_email));
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

async function grantAdmin(userId) {
    if (!confirm("이 회원에게 관리자 권한을 부여하시겠습니까?")) return;
    try {
        await api(`/admin/users/${userId}/grant-admin`, { method: "POST" });
        await refreshAdmin();
        showToast("관리자 권한을 부여했습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function suspendUser(userId, name, email) {
    openSuspendModal(userId, name, email);
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
    if (!confirm("이 소모임과 소모임의 게시글/댓글을 모두 삭제할까요?")) return;
    try {
        await api(`/admin/boards/${boardId}`, { method: "DELETE" });
        await refreshAdmin();
        showToast("소모임을 삭제했습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function renderPendingTeachers() {
    const teachers = await api("/admin/pending-teachers");
    const box = qs("#admin-pending-teachers");
    box.replaceChildren();

    // Update badge count
    const badge = qs("#pending-teachers-count");
    if (badge) {
        if (teachers.length > 0) {
            badge.textContent = teachers.length;
            badge.hidden = false;
        } else {
            badge.hidden = true;
        }
    }

    if (teachers.length === 0) {
        box.textContent = "승인 대기 중인 선생님 계정이 없습니다.";
        box.classList.add("muted");
        return;
    }
    box.classList.remove("muted");

    teachers.forEach((teacher) => {
        const row = make("div", { className: "admin-row" });
        const info = make("div");
        const joinTime = teacher.created_at ? formatKoreanDateTime(teacher.created_at) : "-";
        info.append(
            make("strong", { text: `${teacher.name} (${teacher.email})` }),
            make("p", {
                className: "post-meta",
                text: `교사 · 교무실: ${teacher.office || "미입력"} · 신청일시: ${joinTime}`,
            }),
        );

        const actions = make("div", { className: "admin-actions" });
        const approve = make("button", { type: "button", text: "승인" });
        approve.classList.add("btn-approve");
        approve.addEventListener("click", () => approveTeacher(teacher.user_id, teacher.name));
        const reject = make("button", { type: "button", text: "거절" });
        reject.classList.add("danger");
        reject.addEventListener("click", () => rejectTeacher(teacher.user_id, teacher.name));
        actions.append(approve, reject);
        row.append(info, actions);
        box.append(row);
    });
}

async function approveTeacher(userId, name) {
    if (!confirm(`${name || "선생님"} 계정을 승인하시겠습니까?`)) return;
    try {
        await api(`/admin/teachers/${userId}/approve`, { method: "POST" });
        await refreshAdmin();
        showToast("선생님 계정이 승인되었습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function rejectTeacher(userId, name) {
    if (!confirm(`${name || "선생님"} 가입 요청을 거절(삭제)하시겠습니까?`)) return;
    try {
        await api(`/admin/teachers/${userId}`, { method: "DELETE" });
        await refreshAdmin();
        showToast("선생님 가입 요청이 거절되었습니다.");
    } catch (error) {
        showToast(error.message);
    }
}

async function refreshAdmin() {
    await Promise.all([renderUsers(), renderPendingTeachers(), renderReportedUsers(), renderReports(), renderClubs()]);
}

qs("#admin-login-button").addEventListener("click", loginAdmin);
qs("#refresh-admin-button").addEventListener("click", () => refreshAdmin().catch((error) => showToast(error.message)));
qs("#refresh-teachers-button")?.addEventListener("click", () => renderPendingTeachers().catch((error) => showToast(error.message)));
qs("#admin-user-search-button").addEventListener("click", () => renderUsers().catch((error) => showToast(error.message)));
qs("#admin-user-search").addEventListener("keydown", (event) => {
    if (event.key === "Enter") renderUsers().catch((error) => showToast(error.message));
});
document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.addEventListener("click", () => switchAdminTab(button.dataset.adminTab));
});

qs("#suspend-modal-close")?.addEventListener("click", closeSuspendModal);
qs("#suspend-cancel-button")?.addEventListener("click", closeSuspendModal);
qs("#suspend-confirm-button")?.addEventListener("click", confirmSuspendModal);
qs("#suspend-modal")?.addEventListener("click", (event) => {
    if (event.target === qs("#suspend-modal")) closeSuspendModal();
});

restoreAdminSession();
