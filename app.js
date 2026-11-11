let state;
let adminMode = false;
let currentUser = null;
let currentView = "election";
let dashboardState;
let toastTimer;
const rolesGrid = document.getElementById("rolesGrid");
const pendingList = document.getElementById("pendingList");
const modalBackdrop = document.getElementById("modalBackdrop");
const modal = document.getElementById("modal");
const toast = document.getElementById("toast");

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (adminMode) {
    const { data, error } = await window.neonAuth.token();
    if (error) throw new Error(error.message);
    if (!data?.token) throw new Error("Sua sessão expirou. Entre novamente.");
    headers.Authorization = `Bearer ${data.token}`;
  }
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers,
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Resposta inválida do servidor.");
  }
  if (!response.ok) throw new Error(result.error || `Erro ${response.status}`);
  return result;
}

async function refreshState() {
  const query = new URLSearchParams(location.search);
  const electionId = query.get("election") || "";
  state = await api(`/api/state${electionId ? `?electionId=${encodeURIComponent(electionId)}` : ""}`);
  render();
}

async function sendMutation(path, method, data) {
  await api(path, { method, body: JSON.stringify(data) });
  await refreshState();
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3600);
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

function getRole(id) {
  return state.roles.find((role) => role.id === id);
}

function statusLabel(nomination) {
  if (nomination.status === "pending") return "Pendente";
  if (nomination.status === "first") return "Aceito como 1ª opção";
  if (nomination.status === "second") return "Aceito como 2ª opção";
  if (nomination.status === "declined") return "Recusado";
  return "Indeferido";
}

function statusClass(status) {
  return {
    pending: "status-pending",
    first: "status-first",
    second: "status-second",
    declined: "status-declined",
    rejected: "status-rejected",
  }[status] || "status-pending";
}

function renderRoles() {
  rolesGrid.innerHTML = state.roles.map((role) => {
    const nominees = state.nominations.filter((nomination) => nomination.roleId === role.id);
    const people = nominees.length ? nominees.map((nomination) => `
      <article class="nominee ${statusClass(nomination.status)}">
        <span class="avatar">${escapeHtml(initials(nomination.name))}</span>
        <div class="nominee-info">
          <span class="nominee-name">${escapeHtml(nomination.name)}</span>
          <span class="nominee-course">${escapeHtml(nomination.course)}</span>
          <span class="nominee-status ${statusClass(nomination.status)}">${escapeHtml(statusLabel(nomination))}</span>
          ${adminMode && nomination.contact ? `<span class="nominee-contact">Contato: ${escapeHtml(nomination.contact)}</span>` : ""}
        </div>
        ${adminMode && nomination.status !== "rejected" && nomination.status !== "declined" ? `<button class="reject-button" type="button" data-reject="${escapeHtml(nomination.id)}" aria-label="Indeferir candidatura de ${escapeHtml(nomination.name)}">Indeferir</button>` : ""}
      </article>
    `).join("") : `<div class="no-nominees">Ainda não há indicações</div>`;
    return `
      <article class="role-card">
        <div class="role-card-head">
          <div class="role-title-line">
            <h3 class="role-title">${escapeHtml(role.name)}</h3>
            <button type="button" class="tooltip-trigger" data-tooltip="${escapeHtml(role.description || "Descrição não informada.")}" aria-label="Descrição de ${escapeHtml(role.name)}" title="Descrição do cargo">i</button>
          </div>
          <span class="term-badge">◷ Mandato de ${role.term} ${role.term === 1 ? "ano" : "anos"}</span>
          ${role.succession ? `<span class="succession-badge">Sucessão</span>` : ""}
        </div>
        <div class="nominee-list">${people}</div>
        <div class="role-card-foot">${role.succession
          ? `<span class="succession-note">Sucessão prevista · não recebe indicações</span>`
          : `<button type="button" class="button button-primary nominate-button" data-role="${escapeHtml(role.id)}">＋ Indicar alguém</button>`}</div>
      </article>
    `;
  }).join("");
  document.getElementById("emptyRoles").classList.toggle("hidden", state.roles.length > 0);
  document.getElementById("roleCount").textContent = `${state.roles.length} ${state.roles.length === 1 ? "cargo" : "cargos"}`;
}

function renderPending() {
  const pendings = state.nominations.filter((nomination) => nomination.status === "pending");
  document.getElementById("pendingCount").textContent = pendings.length;
  pendingList.innerHTML = pendings.map((nomination) => {
    const role = getRole(nomination.roleId);
    return `
      <article class="pending-card">
        <div class="pending-card-top">
          <div>
            <p class="pending-role">${escapeHtml(role?.name || "Cargo removido")}</p>
            <h3>${escapeHtml(nomination.name)}</h3>
            <p>${escapeHtml(nomination.course)}</p>
          </div>
          <span class="nominee-status status-pending">Pendente</span>
        </div>
        ${adminMode && nomination.contact ? `<span class="nominee-contact">Contato: ${escapeHtml(nomination.contact)}</span>` : ""}
        <div class="pending-actions">
          <button class="button button-outline" type="button" data-response="${escapeHtml(nomination.id)}" data-choice="declined">Recusar</button>
          <button class="button button-primary" type="button" data-response="${escapeHtml(nomination.id)}" data-choice="first">Aceitar como 1ª opção</button>
          <button class="button button-outline" type="button" data-response="${escapeHtml(nomination.id)}" data-choice="second">Aceitar como 2ª opção</button>
        </div>
      </article>
    `;
  }).join("");
  document.getElementById("emptyPending").classList.toggle("hidden", pendings.length > 0);
}

function renderAdminSettings() {
  document.getElementById("adminPanel").classList.toggle("hidden", !adminMode);
  document.getElementById("adminToggle").classList.toggle("enabled", adminMode);
  document.getElementById("adminToggleText").textContent = adminMode
    ? (currentView === "dashboard" ? "Sair" : "Dashboard")
    : "Configurações";
  if (!adminMode) return;
  const electionForm = document.getElementById("electionForm");
  electionForm.elements.year.value = state.year;
  electionForm.elements.date.value = state.election.dateValue;
  electionForm.elements.time.value = state.election.time;
  electionForm.elements.eventLocation.value = state.election.location;
  document.getElementById("settingsElectionTitle").textContent = `Eleição ${state.year}`;
  document.getElementById("roleSettingsList").innerHTML = state.roles.map((role) => `
    <form class="role-editor" data-role-editor="${escapeHtml(role.id)}">
      <label>Nome<input name="name" value="${escapeHtml(role.name)}" required /></label>
      <label>Mandato<select name="term"><option value="1" ${role.term === 1 ? "selected" : ""}>1 ano</option><option value="2" ${role.term === 2 ? "selected" : ""}>2 anos</option></select></label>
      <label class="role-editor-check"><input name="succession" type="checkbox" ${role.succession ? "checked" : ""} /> Sucessão</label>
      <label>Descrição do cargo<input name="description" value="${escapeHtml(role.description)}" /></label>
      <button class="role-delete" type="button" data-delete-role="${escapeHtml(role.id)}">Remover</button>
      <button class="button button-dark button-small role-editor-save" type="submit">Salvar cargo</button>
    </form>
  `).join("");
}

function render() {
  renderRoles();
  renderPending();
  renderAdminSettings();
  document.getElementById("eventSummary").textContent = state.election.date;
  document.getElementById("eventLocation").textContent = state.election.location;
  document.getElementById("electionYearLabel").textContent = `ELEIÇÃO ${state.year}`;
}

function showElectionView() {
  currentView = "election";
  document.getElementById("dashboardView").classList.add("hidden");
  document.getElementById("electionView").classList.remove("hidden");
  renderAdminSettings();
}

async function showDashboard() {
  if (!adminMode) return;
  dashboardState = await api("/api/admin/dashboard");
  currentView = "dashboard";
  document.getElementById("electionView").classList.add("hidden");
  document.getElementById("dashboardView").classList.remove("hidden");
  document.getElementById("adminPanel").classList.add("hidden");
  document.getElementById("adminToggleText").textContent = "Sair";
  document.getElementById("globalRulesForm").elements.rules.value = dashboardState.globalRules;
  document.getElementById("electionCount").textContent = `${dashboardState.elections.length} ${dashboardState.elections.length === 1 ? "eleição" : "eleições"}`;
  document.getElementById("electionsList").innerHTML = dashboardState.elections
    .slice()
    .sort((a, b) => b.year - a.year)
    .map((election) => `
      <article class="election-admin-card">
        <div class="election-admin-main">
          <div class="election-admin-year">${escapeHtml(election.year)}</div>
          <div><h3>Eleição ${escapeHtml(election.year)} ${election.isActive ? `<span class="active-election-badge">Página principal</span>` : ""}</h3><p>${escapeHtml(election.date)} · ${escapeHtml(election.location)}</p><span class="election-meta">${election.nominationCount} indicações · ${election.pendingCount} pendentes</span></div>
        </div>
        <div class="election-admin-actions">
          <button class="button button-outline button-small" type="button" data-open-election="${escapeHtml(election.id)}">Abrir configurações</button>
          ${!election.isActive ? `<button class="button button-dark button-small" type="button" data-activate-election="${escapeHtml(election.id)}">Publicar como principal</button>` : ""}
          <a class="button button-outline button-small" href="/?election=${encodeURIComponent(election.id)}" target="_blank" rel="noopener">Link público ↗</a>
          ${!election.isActive ? `<button class="button button-danger button-small" type="button" data-delete-election="${escapeHtml(election.id)}" data-election-year="${escapeHtml(election.year)}">Excluir eleição</button>` : ""}
        </div>
      </article>
    `).join("");
}

async function openElectionSettings(electionId) {
  history.pushState({}, "", `/?election=${encodeURIComponent(electionId)}`);
  state = await api(`/api/state?electionId=${encodeURIComponent(electionId)}`);
  showElectionView();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openModal(content) {
  modal.innerHTML = content;
  modalBackdrop.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  const firstInput = modal.querySelector("input, textarea, button");
  if (firstInput) firstInput.focus();
}

function closeModal() {
  modalBackdrop.classList.add("hidden");
  document.body.style.overflow = "";
  modal.innerHTML = "";
}

function showRulesThen(continuation) {
  openModal(`
    <span class="modal-kicker">REQUISITOS PARA A DIRETORIA</span>
    <h2 id="modalTitle">Antes de continuar</h2>
    <p class="modal-description">Leia com atenção os requisitos para fazer parte da diretoria da ABU Beagá.</p>
    <div class="modal-rules">${escapeHtml(state.rules)}</div>
    <div class="modal-actions rules-actions"><button class="button button-muted" type="button" data-close-modal>Agora não</button><button class="button button-muted" type="button" id="continueAfterRules">Li e quero continuar</button></div>
  `);
  document.getElementById("continueAfterRules").addEventListener("click", () => {
    closeModal();
    continuation();
  });
}

async function finishAuthentication(user) {
  adminMode = true;
  currentUser = user;
  let verifiedSession;
  try {
    verifiedSession = await api("/api/session");
  } catch (error) {
    adminMode = false;
    currentUser = null;
    throw error;
  }
  if (!verifiedSession.authenticated) {
    adminMode = false;
    currentUser = null;
    throw new Error("O servidor não confirmou a sessão do Neon Auth.");
  }
  closeModal();
  await refreshState();
  await showDashboard();
  showToast("Acesso às configurações autorizado.");
}

function showLoginForm() {
  openModal(`
    <span class="modal-kicker">ÁREA RESTRITA</span>
    <h2 id="modalTitle">Configurações</h2>
    <p class="modal-description">Entre com o e-mail e a senha da sua conta autorizada no Neon Auth.</p>
    <form id="loginForm">
      <label class="field">E-mail<input name="email" type="email" autocomplete="username" placeholder="seu@email.com" required /></label>
      <label class="field">Senha<input name="password" type="password" autocomplete="current-password" required /></label>
      <button class="auth-link" id="forgotPasswordButton" type="button">Esqueci minha senha</button>
      <div class="modal-actions"><button class="button button-muted" type="button" data-close-modal>Cancelar</button><button class="button button-primary" type="submit">Entrar</button></div>
    </form>
  `);
  document.getElementById("forgotPasswordButton").addEventListener("click", showForgotPasswordForm);
  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await window.neonAuth.signIn.email(data);
      if (result.error) {
        if (result.error.code === "EMAIL_NOT_VERIFIED") {
          showVerifyEmailForm(data.email);
          showToast("Enviamos um código de confirmação para seu e-mail.");
          return;
        }
        throw new Error(result.error.message);
      }
      await finishAuthentication(result.data.user);
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

function showVerifyEmailForm(email) {
  openModal(`
    <span class="modal-kicker">CONFIRMAÇÃO DE E-MAIL</span>
    <h2 id="modalTitle">Verifique seu e-mail</h2>
    <p class="modal-description">Digite o código enviado para <strong>${escapeHtml(email)}</strong>.</p>
    <form id="verifyEmailForm">
      <label class="field">Código<input name="otp" inputmode="numeric" autocomplete="one-time-code" required /></label>
      <div class="modal-actions"><button class="button button-muted" type="button" data-close-modal>Cancelar</button><button class="button button-primary" type="submit">Confirmar e-mail</button></div>
    </form>
  `);
  document.getElementById("verifyEmailForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const otp = String(new FormData(event.currentTarget).get("otp")).trim();
    try {
      const result = await window.neonAuth.emailOtp.verifyEmail({ email, otp });
      if (result.error) throw new Error(result.error.message);
      if (result.data?.session?.user) {
        await finishAuthentication(result.data.session.user);
      } else {
        closeModal();
        showToast("E-mail confirmado. Entre com sua senha.");
        showLoginForm();
      }
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

function showForgotPasswordForm() {
  openModal(`
    <span class="modal-kicker">RECUPERAÇÃO DE ACESSO</span>
    <h2 id="modalTitle">Redefinir senha</h2>
    <p class="modal-description">Informe o e-mail da sua conta Neon Auth para receber um link seguro de redefinição.</p>
    <form id="requestPasswordResetForm">
      <label class="field">E-mail<input name="email" type="email" autocomplete="email" required /></label>
      <div class="modal-actions"><button class="button button-muted" type="button" data-close-modal>Cancelar</button><button class="button button-primary" type="submit">Enviar link</button></div>
    </form>
  `);
  document.getElementById("requestPasswordResetForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email")).trim();
    try {
      const { error } = await window.neonAuth.requestPasswordReset({
        email,
        redirectTo: `${location.origin}/`,
      });
      if (error) throw new Error(error.message);
      closeModal();
      showToast("Se a conta existir, você receberá um link para redefinir a senha.");
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

function showResetPasswordForm(token) {
  openModal(`
    <span class="modal-kicker">RECUPERAÇÃO DE ACESSO</span>
    <h2 id="modalTitle">Escolha uma senha nova</h2>
    <form id="resetPasswordForm">
      <label class="field">Nova senha<input name="newPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required /></label>
      <label class="field">Confirme a nova senha<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required /></label>
      <div class="modal-actions"><button class="button button-primary" type="submit">Salvar senha</button></div>
    </form>
  `);
  document.getElementById("resetPasswordForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword"));
    if (newPassword !== String(form.get("confirmPassword"))) {
      showToast("As senhas não coincidem.", true);
      return;
    }
    try {
      const { error } = await window.neonAuth.resetPassword({ newPassword, token });
      if (error) throw new Error(error.message);
      history.replaceState({}, "", "/");
      closeModal();
      showToast("Senha redefinida. Entre com sua nova senha.");
      showLoginForm();
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

function showPasswordForm() {
  openModal(`
    <span class="modal-kicker">SUA CONTA NEON AUTH</span>
    <h2 id="modalTitle">Alterar minha senha</h2>
    <p class="modal-description">Confirme a senha atual e escolha uma senha nova. As outras sessões serão encerradas.</p>
    <form id="changePasswordForm">
      <label class="field">Senha atual<input name="currentPassword" type="password" autocomplete="current-password" required /></label>
      <label class="field">Nova senha<input name="newPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required /></label>
      <div class="modal-actions"><button class="button button-muted" type="button" data-close-modal>Cancelar</button><button class="button button-primary" type="submit">Salvar senha</button></div>
    </form>
  `);
  document.getElementById("changePasswordForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const { error } = await window.neonAuth.changePassword({
        currentPassword: String(form.get("currentPassword")),
        newPassword: String(form.get("newPassword")),
        revokeOtherSessions: true,
      });
      if (error) throw new Error(error.message);
      closeModal();
      showToast("Sua senha foi alterada e as outras sessões foram encerradas.");
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

function showNominationForm(roleId) {
  const role = getRole(roleId);
  if (!role) return;
  openModal(`
    <span class="modal-kicker">NOVA INDICAÇÃO</span>
    <h2 id="modalTitle">Quem você gostaria de indicar?</h2>
    <div class="role-summary"><strong>${escapeHtml(role.name)}</strong><span>Mandato de ${role.term} ${role.term === 1 ? "ano" : "anos"}${role.succession ? " · Sucessão prevista" : ""}</span></div>
    <p class="modal-description">A pessoa indicada poderá responder na página de indicações pendentes.</p>
    <form id="nominationForm">
      <label class="field">Nome completo<input name="name" autocomplete="name" required maxlength="100" placeholder="Nome da pessoa indicada" /></label>
      <label class="field">Curso + faculdade<input name="course" required maxlength="140" placeholder="Ex.: Direito · UFMG" /></label>
      <label class="field">Contato <span class="field-hint">Opcional — pode ser informado depois pela pessoa indicada.</span><input name="contact" maxlength="160" placeholder="E-mail, telefone ou rede social" /></label>
      <div class="modal-actions"><button class="button button-muted" type="button" data-close-modal>Cancelar</button><button class="button button-primary" type="submit">Enviar indicação</button></div>
    </form>
  `);
  document.getElementById("nominationForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(`/api/nominations?electionId=${encodeURIComponent(state.electionId)}`, { method: "POST", body: JSON.stringify({ ...form, roleId }) });
      closeModal();
      await refreshState();
      showToast("Indicação enviada. Ela agora está pendente de aceitação.");
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

function showResponseForm(nominationId, choice) {
  const nomination = state.nominations.find((item) => item.id === nominationId);
  if (!nomination || nomination.status !== "pending") return;
  const labels = { declined: "Recusado", first: "Aceito como 1ª opção", second: "Aceito como 2ª opção" };
  openModal(`
    <span class="modal-kicker">RESPOSTA À INDICAÇÃO</span>
    <h2 id="modalTitle">${labels[choice]}</h2>
    <div class="role-summary"><strong>${escapeHtml(nomination.name)}</strong><span>${escapeHtml(getRole(nomination.roleId)?.name || "Cargo removido")} · ${escapeHtml(nomination.course)}</span></div>
    <p class="modal-description">${choice === "declined" ? "Confirme se deseja recusar esta indicação." : "Confirme sua resposta. Se o contato não foi informado, você pode adicioná-lo agora."}</p>
    <form id="responseForm">
      ${choice !== "declined" ? `<label class="field">Sua forma de contato<input name="contact" maxlength="160" placeholder="E-mail, telefone ou rede social" /><span class="field-hint">Opcional — permite que a diretoria entre em contato.</span></label>` : ""}
      <div class="modal-actions"><button class="button button-muted" type="button" data-close-modal>Voltar</button><button class="button ${choice === "declined" ? "button-danger" : "button-primary"}" type="submit">Confirmar resposta</button></div>
    </form>
  `);
  document.getElementById("responseForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const contact = String(form.get("contact") || "").trim();
    try {
      await api(`/api/elections/${encodeURIComponent(state.electionId)}/nominations/${encodeURIComponent(nominationId)}/response`, {
        method: "POST",
        body: JSON.stringify({ choice, ...(contact ? { contact } : {}) }),
      });
      closeModal();
      await refreshState();
      showToast(`Resposta registrada: ${labels[choice]}.`);
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

function showRoleForm() {
  openModal(`
    <span class="modal-kicker">CONFIGURAÇÃO DA ELEIÇÃO</span>
    <h2 id="modalTitle">Adicionar cargo</h2>
    <p class="modal-description">Defina o nome, duração do mandato e descrição que ficará disponível aos participantes.</p>
    <form id="newRoleForm">
      <label class="field">Nome do cargo<input name="name" required maxlength="90" placeholder="Ex.: Diretor(a) de eventos" /></label>
      <label class="field">Duração do mandato<select name="term"><option value="1">1 ano</option><option value="2">2 anos</option></select></label>
      <label class="field"><input name="succession" type="checkbox" style="display:inline;width:auto;margin-right:6px" /> Marcar como sucessão prevista</label>
      <label class="field">Descrição do cargo<textarea name="description" maxlength="360" placeholder="Descreva as responsabilidades do cargo"></textarea></label>
      <div class="modal-actions"><button class="button button-muted" type="button" data-close-modal>Cancelar</button><button class="button button-primary" type="submit">Adicionar cargo</button></div>
    </form>
  `);
  document.getElementById("newRoleForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await sendMutation(`/api/admin/elections/${encodeURIComponent(state.electionId)}/roles`, "POST", {
        name: String(form.get("name")).trim(),
        term: Number(form.get("term")),
        succession: form.has("succession"),
        description: String(form.get("description")).trim(),
      });
      closeModal();
      showToast("Cargo adicionado à eleição.");
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

function showCreateElectionForm() {
  const nextYear = Math.max(new Date().getFullYear(), ...(dashboardState?.elections.map((item) => item.year + 1) || []));
  openModal(`
    <span class="modal-kicker">NOVA ELEIÇÃO</span>
    <h2 id="modalTitle">Criar eleição</h2>
    <p class="modal-description">Informe o calendário e o local. Os cargos serão iniciados com uma cópia dos cargos da eleição existente.</p>
    <form id="createElectionForm">
      <label class="field">Ano<input name="year" type="number" min="2020" max="2100" value="${nextYear}" required /></label>
      <label class="field">Data<input name="date" type="date" value="${nextYear}-11-12" required /></label>
      <label class="field">Horário<input name="time" type="time" value="19:00" required /></label>
      <label class="field">Local<input name="location" required maxlength="160" placeholder="Local da eleição" /></label>
      <div class="modal-actions"><button class="button button-muted" type="button" data-close-modal>Cancelar</button><button class="button button-primary" type="submit">Criar eleição</button></div>
    </form>
  `);
  document.getElementById("createElectionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/admin/elections", {
        method: "POST",
        body: JSON.stringify({
          year: Number(form.get("year")),
          date: String(form.get("date")),
          time: String(form.get("time")),
          location: String(form.get("location")).trim(),
        }),
      });
      closeModal();
      await showDashboard();
      showToast("Eleição criada. Configure os cargos ou publique o link público.");
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

document.getElementById("adminToggle").addEventListener("click", async () => {
  if (!adminMode) {
    showLoginForm();
    return;
  }
  if (currentView !== "dashboard") {
    try {
      await showDashboard();
    } catch (error) {
      showToast(error.message, true);
    }
    return;
  }
  try {
    const { error } = await window.neonAuth.signOut();
    if (error) throw new Error(error.message);
    adminMode = false;
    currentUser = null;
    currentView = "election";
    history.pushState({}, "", "/");
    await refreshState();
    showElectionView();
    showToast("Sessão administrativa encerrada.");
  } catch (error) {
    showToast(error.message, true);
  }
});

document.getElementById("rolesTab").addEventListener("click", () => {
  document.getElementById("rolesTab").classList.add("active");
  document.getElementById("rolesTab").setAttribute("aria-selected", "true");
  document.getElementById("pendingTab").classList.remove("active");
  document.getElementById("pendingTab").setAttribute("aria-selected", "false");
  document.getElementById("rolesView").classList.remove("hidden");
  document.getElementById("pendingView").classList.add("hidden");
});
document.getElementById("pendingTab").addEventListener("click", () => {
  document.getElementById("pendingTab").classList.add("active");
  document.getElementById("pendingTab").setAttribute("aria-selected", "true");
  document.getElementById("rolesTab").classList.remove("active");
  document.getElementById("rolesTab").setAttribute("aria-selected", "false");
  document.getElementById("pendingView").classList.remove("hidden");
  document.getElementById("rolesView").classList.add("hidden");
});

document.getElementById("openRulesButton").addEventListener("click", () => {
  openModal(`<span class="modal-kicker">REQUISITOS PARA A DIRETORIA</span><h2 id="modalTitle">Regras para fazer parte</h2><div class="modal-rules">${escapeHtml(state.rules)}</div><div class="modal-actions"><button class="button button-primary" type="button" data-close-modal>Entendi</button></div>`);
});

document.getElementById("electionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await sendMutation(`/api/admin/elections/${encodeURIComponent(state.electionId)}`, "PUT", {
      year: Number(form.get("year")),
      date: String(form.get("date")),
      time: String(form.get("time")),
      location: String(form.get("eventLocation")).trim(),
    });
    showToast("Dados da eleição atualizados.");
  } catch (error) {
    showToast(error.message, true);
  }
});
document.getElementById("globalRulesForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/admin/global-rules", {
      method: "PUT",
      body: JSON.stringify({ rules: String(new FormData(event.currentTarget).get("rules")).trim() }),
    });
    await showDashboard();
    showToast("Regras globais atualizadas.");
  } catch (error) {
    showToast(error.message, true);
  }
});
document.getElementById("addRoleButton").addEventListener("click", showRoleForm);
document.getElementById("dashboardBackButton").addEventListener("click", () => {
  showDashboard().catch((error) => showToast(error.message, true));
});
document.getElementById("createElectionButton").addEventListener("click", showCreateElectionForm);

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const nominationButton = target.closest("[data-role]");
  if (nominationButton?.classList.contains("nominate-button")) {
    const roleId = nominationButton.getAttribute("data-role");
    showRulesThen(() => showNominationForm(roleId));
    return;
  }
  const responseButton = target.closest("[data-response]");
  if (responseButton) {
    const nominationId = responseButton.getAttribute("data-response");
    const choice = responseButton.getAttribute("data-choice");
    showRulesThen(() => showResponseForm(nominationId, choice));
    return;
  }
  const rejectButton = target.closest("[data-reject]");
  if (rejectButton && adminMode) {
    const nominationId = rejectButton.getAttribute("data-reject");
    const nomination = state.nominations.find((item) => item.id === nominationId);
    if (nomination) {
      openModal(`<span class="modal-kicker">AÇÃO ADMINISTRATIVA</span><h2 id="modalTitle">Indeferir candidatura?</h2><p class="modal-description">A candidatura de <strong>${escapeHtml(nomination.name)}</strong> ficará marcada como indeferida.</p><div class="modal-actions"><button class="button button-muted" type="button" data-close-modal>Cancelar</button><button class="button button-danger" type="button" id="confirmReject">Indeferir candidatura</button></div>`);
      document.getElementById("confirmReject").addEventListener("click", async () => {
        try {
          await api(`/api/admin/elections/${encodeURIComponent(state.electionId)}/nominations/${encodeURIComponent(nominationId)}/reject`, { method: "POST", body: "{}" });
          closeModal();
          await refreshState();
          showToast("Candidatura indeferida.");
        } catch (error) {
          showToast(error.message, true);
        }
      });
    }
    return;
  }
  const deleteButton = target.closest("[data-delete-role]");
  if (deleteButton && adminMode) {
    const roleId = deleteButton.getAttribute("data-delete-role");
    sendMutation(`/api/admin/elections/${encodeURIComponent(state.electionId)}/roles/${encodeURIComponent(roleId)}`, "DELETE")
      .then(() => showToast("Cargo removido. As indicações existentes foram mantidas no histórico."))
      .catch((error) => showToast(error.message, true));
  }
  const openElectionButton = target.closest("[data-open-election]");
  if (openElectionButton && adminMode) {
    openElectionSettings(openElectionButton.getAttribute("data-open-election"))
      .catch((error) => showToast(error.message, true));
    return;
  }
  const activateElectionButton = target.closest("[data-activate-election]");
  if (activateElectionButton && adminMode) {
    api(`/api/admin/elections/${encodeURIComponent(activateElectionButton.getAttribute("data-activate-election"))}/activate`, { method: "POST", body: "{}" })
      .then(async () => {
        await showDashboard();
        showToast("Eleição definida como principal para visitantes.");
      })
      .catch((error) => showToast(error.message, true));
    return;
  }
  const deleteElectionButton = target.closest("[data-delete-election]");
  if (deleteElectionButton && adminMode) {
    const electionId = deleteElectionButton.getAttribute("data-delete-election");
    const electionYear = deleteElectionButton.getAttribute("data-election-year");
    openModal(`
      <span class="modal-kicker">AÇÃO PERMANENTE</span>
      <h2 id="modalTitle">Excluir eleição ${escapeHtml(electionYear)}?</h2>
      <p class="modal-description">Esta ação excluirá permanentemente a eleição e todas as suas indicações. A eleição publicada como principal não pode ser excluída.</p>
      <div class="modal-actions"><button class="button button-muted" type="button" data-close-modal>Cancelar</button><button class="button button-danger" type="button" id="confirmDeleteElection">Excluir eleição</button></div>
    `);
    document.getElementById("confirmDeleteElection").addEventListener("click", async () => {
      try {
        await api(`/api/admin/elections/${encodeURIComponent(electionId)}`, { method: "DELETE" });
        closeModal();
        await showDashboard();
        showToast(`Eleição ${electionYear} excluída.`);
      } catch (error) {
        showToast(error.message, true);
      }
    });
    return;
  }
  if (target.closest("[data-close-modal]")) closeModal();
});

document.getElementById("changePasswordButton").addEventListener("click", showPasswordForm);

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.matches("[data-role-editor]")) return;
  event.preventDefault();
  const data = new FormData(form);
  try {
    await sendMutation(`/api/admin/elections/${encodeURIComponent(state.electionId)}/roles/${encodeURIComponent(form.getAttribute("data-role-editor"))}`, "PUT", {
      name: String(data.get("name")).trim(),
      term: Number(data.get("term")),
      succession: data.has("succession"),
      description: String(data.get("description")).trim(),
    });
    showToast("Cargo atualizado.");
  } catch (error) {
    showToast(error.message, true);
  }
});

modalBackdrop.addEventListener("click", (event) => {
  if (event.target === modalBackdrop) closeModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modalBackdrop.classList.contains("hidden")) closeModal();
});

async function initialize() {
  try {
    const resetToken = new URLSearchParams(location.search).get("token");
    const authSession = await window.neonAuth.getSession();
    if (authSession.error) throw new Error(authSession.error.message);
    currentUser = authSession.data?.session?.user || null;
    adminMode = Boolean(currentUser);
    const serverSession = await api("/api/session");
    adminMode = serverSession.authenticated;
    if (!adminMode) currentUser = null;
    await refreshState();
    if (adminMode) await showDashboard();
    else showElectionView();
    if (resetToken) showResetPasswordForm(resetToken);
  } catch (error) {
    showToast(`Não foi possível conectar ao servidor: ${error.message}`, true);
    rolesGrid.innerHTML = `<div class="empty-state"><h3>Servidor indisponível</h3><p>Inicie o site com <code>node server.js</code> e tente novamente.</p></div>`;
  }
}

initialize();

window.addEventListener("popstate", () => {
  refreshState()
    .then(() => showElectionView())
    .catch((error) => showToast(error.message, true));
});
