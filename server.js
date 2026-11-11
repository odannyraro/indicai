const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { Pool } = require("pg");
const { createRemoteJWKSet, errors: joseErrors, jwtVerify } = require("jose");

const ROOT = __dirname;
function readEnvFile() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

readEnvFile();

const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "election.json");
const DATABASE_URL = process.env.DATABASE_URL;
const NEON_AUTH_BASE_URL = process.env.NEON_AUTH_BASE_URL
  || "https://ep-hidden-forest-b68mpt4e.neonauth.c-2.sa-east-1.aws.neon.tech/neondb/auth";
const NEON_AUTH_JWKS_URL = process.env.NEON_AUTH_JWKS_URL
  || `${NEON_AUTH_BASE_URL}/.well-known/jwks.json`;
const neonAuthKeys = NEON_AUTH_JWKS_URL ? createRemoteJWKSet(new URL(NEON_AUTH_JWKS_URL)) : null;
let pool;
let state;
let writeQueue = Promise.resolve();

const HOST = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const PORT = Number(process.env.PORT || 8000);

if (process.env.NODE_ENV === "production" && !DATABASE_URL) {
  throw new Error("Configure DATABASE_URL com um banco PostgreSQL persistente em produção.");
}
const INITIAL_STATE = {
  election: {
    date: "12 de novembro de 2026 · 19h",
    location: "Igreja Presbiteriana de Belo Horizonte",
  },
  rules: [
    "Ser membro e estar sujeito à disciplina e pastoreio de uma igreja evangélica;",
    "Concordar com as bases de fé da ABUB;",
    "Estar comprometido com a visão, fins e objetivos da ABUB;",
    "Estar ciente e comprometido a cumprir, se Deus o permitir, a totalidade da duração de seu mandato.",
  ].join("\n"),
  roles: [
    { id: "coordenador-geral", name: "Coordenador(a) Geral", term: 1, succession: false, description: "Coordena a diretoria e representa a ABU Beagá. Facilita o planejamento e acompanha as equipes." },
    { id: "vice-coordenador", name: "Vice-coordenador(a)", term: 1, succession: false, description: "Apoia a coordenação geral e acompanha a integração entre as áreas da diretoria." },
    { id: "secretario-local", name: "1º Secretário(a) Local", term: 1, succession: true, description: "Registra reuniões, organiza documentos e apoia a comunicação interna da diretoria." },
    { id: "tesoureiro-local", name: "1º Tesoureiro(a) Local", term: 2, succession: false, description: "Cuida do planejamento financeiro, da prestação de contas e dos recursos do grupo." },
    { id: "coordenador-nucleos", name: "1º Coordenador(a) de Núcleos", term: 2, succession: false, description: "Acompanha os núcleos e apoia a formação de novas frentes universitárias." },
    { id: "comunicacao", name: "Diretor(a) de Comunicação e Mídia", term: 1, succession: false, description: "Planeja a comunicação da ABU Beagá e compartilha as atividades com a comunidade." },
    { id: "literatura", name: "Diretor(a) de Literatura e Formação", term: 1, succession: false, description: "Incentiva a formação bíblica e organiza recursos e encontros de estudo." },
    { id: "auxiliar-abs", name: "Diretor(a) Auxiliar de ABS", term: 1, succession: false, description: "Apoia os estudos bíblicos e o desenvolvimento das atividades nos campi." },
  ],
  nominations: [
    { id: "seed-1", roleId: "secretario-local", name: "Marina Costa", course: "Psicologia · PUC Minas", contact: "marina@example.com", status: "pending", preference: null },
    { id: "seed-2", roleId: "tesoureiro-local", name: "Lucas Almeida", course: "Administração · UFMG", contact: "", status: "pending", preference: null },
    { id: "seed-3", roleId: "coordenador-geral", name: "Ana Clara Souza", course: "Medicina · UFMG", contact: "ana@example.com", status: "first", preference: "1ª opção" },
  ],
};

function migrateState(saved) {
  if (saved && Array.isArray(saved.elections) && saved.elections.every((item) => Array.isArray(item.roles) && Array.isArray(item.nominations))) {
    const { users, ...savedState } = saved;
    return savedState;
  }
  if (!saved || !Array.isArray(saved.roles) || !Array.isArray(saved.nominations)) {
    throw new Error("O arquivo de dados da eleição está inválido.");
  }
  const electionId = "election-2026";
  const year = Number(saved.election?.date?.match(/\b(20\d{2})\b/)?.[1] || 2026);
  const dateParts = saved.election?.date?.match(/^(\d{1,2}) de ([a-zç]+) de (20\d{2}) · (\d{1,2})h(\d{2})?$/i);
  const months = { janeiro: "01", fevereiro: "02", março: "03", abril: "04", maio: "05", junho: "06", julho: "07", agosto: "08", setembro: "09", outubro: "10", novembro: "11", dezembro: "12" };
  const month = dateParts && months[dateParts[2].toLocaleLowerCase("pt-BR")];
  return {
    globalRules: saved.rules || INITIAL_STATE.rules,
    activeElectionId: electionId,
    elections: [{
      id: electionId,
      year,
      election: {
        ...saved.election,
        time: dateParts ? `${dateParts[4].padStart(2, "0")}:${dateParts[5] || "00"}` : "19:00",
        dateValue: dateParts && month ? `${dateParts[3]}-${month}-${dateParts[1].padStart(2, "0")}` : `${year}-11-12`,
      },
      roles: saved.roles,
      nominations: saved.nominations,
    }],
  };
}

async function initializeStorage() {
  if (DATABASE_URL) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS election_app_state (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        state JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const stored = await pool.query("SELECT state FROM election_app_state WHERE id = 1");
    if (stored.rowCount) {
      state = migrateState(stored.rows[0].state);
      if (!Array.isArray(stored.rows[0].state.elections) || Object.hasOwn(stored.rows[0].state, "users")) await saveState();
      return;
    }

    const initialData = fs.existsSync(DATA_FILE)
      ? JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
      : INITIAL_STATE;
    state = migrateState(initialData);
    await pool.query(
      "INSERT INTO election_app_state (id, state) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING",
      [JSON.stringify(state)],
    );
    const initialized = await pool.query("SELECT state FROM election_app_state WHERE id = 1");
    state = migrateState(initialized.rows[0].state);
    return;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(INITIAL_STATE, null, 2), { mode: 0o600, flag: "wx" });
  }
  const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  state = migrateState(saved);
  if (!Array.isArray(saved.elections) || Object.hasOwn(saved, "users")) await saveState();
}

function saveState() {
  if (pool) {
    const write = writeQueue.then(() => pool.query(
      `INSERT INTO election_app_state (id, state, updated_at) VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`,
      [JSON.stringify(state)],
    ));
    writeQueue = write.then(() => undefined, () => undefined);
    return write;
  }
  const temporary = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, DATA_FILE);
  return Promise.resolve();
}

function findElection(id) {
  return state.elections.find((election) => election.id === id);
}

function selectedElection(url) {
  const id = url.searchParams.get("electionId") || url.searchParams.get("election") || state.activeElectionId;
  return findElection(id);
}

function sendJson(response, status, data, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(data));
}

async function authUserFor(request) {
  const authorization = request.headers.authorization;
  const match = typeof authorization === "string" && authorization.match(/^Bearer ([^\s]+)$/);
  if (!match || !neonAuthKeys) return null;
  try {
    const { payload } = await jwtVerify(match[1], neonAuthKeys, { issuer: NEON_AUTH_BASE_URL });
    return typeof payload.sub === "string" ? { id: payload.sub, email: payload.email } : null;
  } catch (error) {
    if (error instanceof joseErrors.JOSEError) return null;
    throw error;
  }
}

function requireAdmin(user, response) {
  if (user) return true;
  sendJson(response, 401, { error: "Autenticação administrativa necessária." });
  return false;
}

function checkOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100_000) {
        reject(Object.assign(new Error("Requisição muito grande."), { status: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error("JSON inválido."), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function validText(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

function publicState(admin, election) {
  if (!election) return null;
  return {
    electionId: election.id,
    year: election.year,
    activeElectionId: state.activeElectionId,
    election: election.election,
    rules: state.globalRules,
    roles: election.roles,
    nominations: admin
      ? election.nominations
      : election.nominations.map(({ contact, ...nomination }) => nomination),
  };
}

function validateElectionDetails(body) {
  if (!Number.isInteger(body.year) || body.year < 2020 || body.year > 2100
    || typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)
    || typeof body.time !== "string" || !/^\d{2}:\d{2}$/.test(body.time)
    || !validText(body.location, 160)) return false;
  const [year, month, day] = body.date.split("-").map(Number);
  const [hour, minute] = body.time.split(":").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day && hour <= 23 && minute <= 59;
}

function formatElectionDate(dateValue, timeValue) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const dateLabel = new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  const [hour, minute] = timeValue.split(":");
  return `${dateLabel} · ${hour}h${minute === "00" ? "" : minute}`;
}

function staticFile(response, pathname) {
  if (pathname === "/auth-config.js") {
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(`window.NEON_AUTH_BASE_URL = ${JSON.stringify(NEON_AUTH_BASE_URL)};`);
    return;
  }
  const files = {
    "/": "index.html",
    "/index.html": "index.html",
    "/styles.css": "styles.css",
    "/app.js": "app.js",
    "/auth-client.js": "dist/auth-client.js",
    "/abubeaga_w.png": "abubeaga_w.png",
    "/abubeaga_b.png": "abubeaga_b.png",
  };
  const filename = files[pathname];
  if (!filename) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const types = { "index.html": "text/html; charset=utf-8", "styles.css": "text/css; charset=utf-8", "app.js": "text/javascript; charset=utf-8", "dist/auth-client.js": "text/javascript; charset=utf-8", "abubeaga_w.png": "image/png", "abubeaga_b.png": "image/png" };
  response.writeHead(200, {
    "Content-Type": types[filename],
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Cache-Control": "no-cache",
  });
  fs.createReadStream(path.join(ROOT, filename)).pipe(response);
}

async function handleApi(request, response, url) {
  if (!checkOrigin(request)) return sendJson(response, 403, { error: "Origem da requisição não permitida." });
  const method = request.method;
  const pathname = url.pathname;
  const currentUser = await authUserFor(request);
  const admin = Boolean(currentUser);

  if (method === "GET" && pathname === "/api/session") {
    return sendJson(response, 200, {
      authenticated: Boolean(currentUser),
      user: currentUser ? { id: currentUser.id, email: currentUser.email } : null,
    });
  }
  if (method === "GET" && pathname === "/api/state") {
    const election = selectedElection(url);
    if (!election) return sendJson(response, 404, { error: "Eleição não encontrada." });
    return sendJson(response, 200, publicState(admin, election));
  }
  if (method === "GET" && pathname === "/api/admin/dashboard") {
    if (!requireAdmin(currentUser, response)) return;
    return sendJson(response, 200, {
      activeElectionId: state.activeElectionId,
      globalRules: state.globalRules,
      elections: state.elections.map((election) => ({
        id: election.id,
        year: election.year,
        date: election.election.date,
        location: election.election.location,
        isActive: election.id === state.activeElectionId,
        nominationCount: election.nominations.length,
        pendingCount: election.nominations.filter((nomination) => nomination.status === "pending").length,
      })),
    });
  }
  if (method === "POST" && pathname === "/api/nominations") {
    const body = await readBody(request);
    const election = selectedElection(url);
    if (!election) return sendJson(response, 404, { error: "Eleição não encontrada." });
    const role = election.roles.find((item) => item.id === body.roleId);
    if (!role
      || !validText(body.name, 100) || !validText(body.course, 140)
      || (body.contact !== undefined && (typeof body.contact !== "string" || body.contact.length > 160))) {
      return sendJson(response, 400, { error: "Confira o cargo e os dados da indicação." });
    }
    if (role.succession) return sendJson(response, 409, { error: "Este cargo está marcado como sucessão e não recebe novas indicações." });
    const nomination = {
      id: crypto.randomUUID(),
      roleId: body.roleId,
      name: body.name.trim(),
      course: body.course.trim(),
      contact: (body.contact || "").trim(),
      status: "pending",
      preference: null,
    };
    election.nominations.unshift(nomination);
    await saveState();
    return sendJson(response, 201, { nomination: publicState(false, election).nominations[0] });
  }
  const responseMatch = pathname.match(/^\/api\/elections\/([^/]+)\/nominations\/([^/]+)\/response$/);
  if (method === "POST" && responseMatch) {
    const election = findElection(responseMatch[1]);
    const nomination = election?.nominations.find((item) => item.id === responseMatch[2]);
    if (!nomination || nomination.status !== "pending") return sendJson(response, 404, { error: "Indicação pendente não encontrada." });
    const body = await readBody(request);
    if (!["declined", "first", "second"].includes(body.choice)
      || (body.contact !== undefined && (typeof body.contact !== "string" || body.contact.length > 160))) {
      return sendJson(response, 400, { error: "Resposta inválida." });
    }
    if (body.contact?.trim()) nomination.contact = body.contact.trim();
    nomination.status = body.choice;
    nomination.preference = body.choice === "first" ? "1ª opção" : body.choice === "second" ? "2ª opção" : null;
    await saveState();
    return sendJson(response, 200, { ok: true });
  }
  if (method === "POST" && pathname === "/api/admin/elections") {
    if (!requireAdmin(currentUser, response)) return;
    const body = await readBody(request);
    if (!validateElectionDetails(body)) return sendJson(response, 400, { error: "Informe um ano, data, horário e local válidos." });
    if (state.elections.some((election) => election.year === body.year)) return sendJson(response, 409, { error: "Já existe uma eleição cadastrada para este ano." });
    const election = {
      id: `election-${body.year}-${crypto.randomUUID().slice(0, 8)}`,
      year: body.year,
      election: { date: formatElectionDate(body.date, body.time), time: body.time, dateValue: body.date, location: body.location.trim() },
      roles: JSON.parse(JSON.stringify(state.elections[0]?.roles || INITIAL_STATE.roles)),
      nominations: [],
    };
    state.elections.push(election);
    await saveState();
    return sendJson(response, 201, { id: election.id });
  }
  const electionAdminMatch = pathname.match(/^\/api\/admin\/elections\/([^/]+)$/);
  if (method === "PUT" && electionAdminMatch) {
    if (!requireAdmin(currentUser, response)) return;
    const body = await readBody(request);
    const election = findElection(electionAdminMatch[1]);
    if (!election) return sendJson(response, 404, { error: "Eleição não encontrada." });
    if (!validateElectionDetails(body)) return sendJson(response, 400, { error: "Informe um ano, data, horário e local válidos." });
    if (state.elections.some((item) => item.id !== election.id && item.year === body.year)) return sendJson(response, 409, { error: "Já existe uma eleição cadastrada para este ano." });
    election.year = body.year;
    election.election = { date: formatElectionDate(body.date, body.time), time: body.time, dateValue: body.date, location: body.location.trim() };
    await saveState();
    return sendJson(response, 200, { ok: true });
  }
  if (method === "DELETE" && electionAdminMatch) {
    if (!requireAdmin(currentUser, response)) return;
    const election = findElection(electionAdminMatch[1]);
    if (!election) return sendJson(response, 404, { error: "Eleição não encontrada." });
    if (election.id === state.activeElectionId) {
      return sendJson(response, 409, { error: "A eleição publicada como principal não pode ser excluída." });
    }
    state.elections = state.elections.filter((item) => item.id !== election.id);
    await saveState();
    return sendJson(response, 200, { ok: true });
  }
  const activateMatch = pathname.match(/^\/api\/admin\/elections\/([^/]+)\/activate$/);
  if (method === "POST" && activateMatch) {
    if (!requireAdmin(currentUser, response)) return;
    if (!findElection(activateMatch[1])) return sendJson(response, 404, { error: "Eleição não encontrada." });
    state.activeElectionId = activateMatch[1];
    await saveState();
    return sendJson(response, 200, { ok: true });
  }
  if (method === "PUT" && pathname === "/api/admin/global-rules") {
    if (!requireAdmin(currentUser, response)) return;
    const body = await readBody(request);
    if (!validText(body.rules, 5000)) return sendJson(response, 400, { error: "Informe as regras globais para candidaturas." });
    state.globalRules = body.rules.trim();
    await saveState();
    return sendJson(response, 200, { ok: true });
  }
  const roleCreateMatch = pathname.match(/^\/api\/admin\/elections\/([^/]+)\/roles$/);
  if (method === "POST" && roleCreateMatch) {
    if (!requireAdmin(currentUser, response)) return;
    const election = findElection(roleCreateMatch[1]);
    if (!election) return sendJson(response, 404, { error: "Eleição não encontrada." });
    const body = await readBody(request);
    if (!validText(body.name, 90) || ![1, 2].includes(body.term)
      || typeof body.succession !== "boolean" || typeof body.description !== "string" || body.description.length > 360) {
      return sendJson(response, 400, { error: "Confira os dados do cargo." });
    }
    const role = { id: crypto.randomUUID(), name: body.name.trim(), term: body.term, succession: body.succession, description: body.description.trim() };
    election.roles.push(role);
    await saveState();
    return sendJson(response, 201, { role });
  }
  const roleMatch = pathname.match(/^\/api\/admin\/elections\/([^/]+)\/roles\/([^/]+)$/);
  if (roleMatch && method === "PUT") {
    if (!requireAdmin(currentUser, response)) return;
    const election = findElection(roleMatch[1]);
    const role = election?.roles.find((item) => item.id === roleMatch[2]);
    if (!role) return sendJson(response, 404, { error: "Cargo não encontrado." });
    const body = await readBody(request);
    if (!validText(body.name, 90) || ![1, 2].includes(body.term)
      || typeof body.succession !== "boolean" || typeof body.description !== "string" || body.description.length > 360) {
      return sendJson(response, 400, { error: "Confira os dados do cargo." });
    }
    Object.assign(role, { name: body.name.trim(), term: body.term, succession: body.succession, description: body.description.trim() });
    await saveState();
    return sendJson(response, 200, { ok: true });
  }
  if (roleMatch && method === "DELETE") {
    if (!requireAdmin(currentUser, response)) return;
    const election = findElection(roleMatch[1]);
    if (!election) return sendJson(response, 404, { error: "Eleição não encontrada." });
    election.roles = election.roles.filter((item) => item.id !== roleMatch[2]);
    await saveState();
    return sendJson(response, 200, { ok: true });
  }
  const rejectMatch = pathname.match(/^\/api\/admin\/elections\/([^/]+)\/nominations\/([^/]+)\/reject$/);
  if (method === "POST" && rejectMatch) {
    if (!requireAdmin(currentUser, response)) return;
    const election = findElection(rejectMatch[1]);
    const nomination = election?.nominations.find((item) => item.id === rejectMatch[2]);
    if (!nomination || nomination.status === "rejected" || nomination.status === "declined") {
      return sendJson(response, 404, { error: "Candidatura não encontrada ou já encerrada." });
    }
    nomination.status = "rejected";
    await saveState();
    return sendJson(response, 200, { ok: true });
  }
  return sendJson(response, 404, { error: "Rota não encontrada." });
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
    } else if (request.method === "GET") {
      staticFile(response, url.pathname);
    } else {
      response.writeHead(405, { Allow: "GET" });
      response.end("Method not allowed");
    }
  } catch (error) {
    if (response.headersSent || response.destroyed) return;
    sendJson(response, error.status || 500, { error: error.status ? error.message : "Erro interno do servidor." });
    if (!error.status) console.error(error);
  }
});

initializeStorage()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`ABU Beagá election app running at http://${HOST}:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Could not initialize persistent election storage.", error);
    if (pool) {
      pool.end()
        .catch((closeError) => console.error("Could not close the PostgreSQL connection pool.", closeError))
        .finally(() => { process.exitCode = 1; });
    } else {
      process.exitCode = 1;
    }
  });
