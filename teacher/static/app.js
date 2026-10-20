// Bellwork class dashboard. Plain JS, no framework. Every piece of user data goes into the page with textContent.
"use strict";

const TOKEN_KEY = "bellwork_teacher_token";
const state = { token: "", teacher: null, subjects: [], students: [], base: "", offline: false };

// ------------------------------------------------------------ where the API is
// <meta name="bellwork-api" content="same-origin">          -> this page's own server (local use, or the tunnel URL)
// <meta name="bellwork-api" content="discover:../api.json"> -> the GitHub Pages copy: api.json holds the current
//                                                              tunnel address ({"api": "https://….trycloudflare.com"})
// ?api=http://127.0.0.1:8097 overrides it for testing. Only a server on this computer is accepted, so a link can't
// send a teacher's password to someone else's server.
const API_MODE = (document.querySelector('meta[name="bellwork-api"]') || {}).content || "same-origin";
const DISCOVERY = API_MODE.startsWith("discover:") ? API_MODE.slice(9) : "";
const MSG_OFFLINE = "The class server is offline right now. The teacher's computer must be on, with the class server running.";
const MSG_NO_NET = "Can't reach the class server. Check your internet connection.";
const DEAD_TUNNEL = [502, 503, 504, 521, 522, 523, 530];   // what Cloudflare answers when the computer behind it is off

class OfflineError extends Error {}

function isLoopback(u) {
  return u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
}

function apiOverride() {
  let raw = "";
  try { raw = new URLSearchParams(window.location.search).get("api") || ""; } catch (_) { raw = ""; }
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (isLoopback(u)) return u.origin;
  } catch (_) { /* fall through */ }
  return { bad: raw };
}

async function resolveBase() {
  const o = apiOverride();
  if (o && o.bad) throw new OfflineError("?api= only accepts a server on this computer, like http://127.0.0.1:8097.");
  if (o) return o;
  if (!DISCOVERY) return "";
  let data;
  try {
    const url = new URL(DISCOVERY, window.location.href);
    url.searchParams.set("t", String(Date.now()));          // GitHub Pages caches files for ~10 minutes
    const res = await fetch(url.href, { cache: "no-store" });
    if (!res.ok) throw new OfflineError(MSG_OFFLINE);
    data = await res.json();
  } catch (e) {
    throw e instanceof OfflineError ? e : new OfflineError(MSG_NO_NET);
  }
  const raw = String((data && data.api) || "").trim();
  if (!raw) throw new OfflineError(MSG_OFFLINE);
  let u;
  try { u = new URL(raw); } catch (_) { throw new OfflineError(MSG_OFFLINE); }
  if (u.protocol !== "https:" && !isLoopback(u)) throw new OfflineError(MSG_OFFLINE);
  return u.origin;
}

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
};

function loadToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (_) { return state.token; }
}
function saveToken(t) {
  state.token = t || "";
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (_) { /* private mode */ }
}

async function api(method, path, body, retried = false) {
  const opts = { method, headers: {}, credentials: "omit" };
  if (state.token) opts.headers["Authorization"] = "Bearer " + state.token;
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(state.base + path, opts);
  } catch (_) {
    res = null;
  }
  if (!res || DEAD_TUNNEL.includes(res.status)) {
    // The tunnel address changes whenever the teacher's computer restarts: look it up again once.
    if (DISCOVERY && !retried) {
      const before = state.base;
      try { state.base = await resolveBase(); } catch (e) { goOffline(e.message); throw e; }
      if (state.base !== before) return api(method, path, body, true);
    }
    const msg = DISCOVERY || state.base ? MSG_OFFLINE : MSG_NO_NET;
    if (!state.offline && (DISCOVERY || state.base)) goOffline(msg);
    throw new OfflineError(msg);
  }
  let data = {};
  try { data = await res.json(); } catch (_) { /* empty body */ }
  if (res.status === 401 && state.teacher) {
    saveToken("");
    state.teacher = null;
    show();
    banner(data.error || "Please log in again.", true);
  }
  if (!res.ok) throw new Error(data.error || ("Something went wrong (" + res.status + ")."));
  return data;
}

function banner(text, bad = false) {
  const b = $("#banner");
  b.textContent = text || "";
  b.hidden = !text;
  b.classList.toggle("bad", !!bad);
  if (text) {
    clearTimeout(banner._t);
    banner._t = setTimeout(() => { b.hidden = true; }, 6000);
  }
}

function formError(form, text) {
  const e = $("[data-error]", form);
  if (e) e.textContent = text || "";
}

// ------------------------------------------------------------ view switching

function show() {
  const signedIn = !!state.teacher;
  $("#offline-view").hidden = !state.offline;
  $("#auth-view").hidden = state.offline || signedIn;
  $("#class-view").hidden = state.offline || !signedIn;
  $("#who").hidden = !signedIn;
  $("#who-name").textContent = signedIn ? state.teacher.display_name : "";
}

function goOffline(message) {
  state.offline = true;
  $("#offline-detail").textContent = message && message !== MSG_OFFLINE ? message : "";
  show();
}

async function start() {
  state.token = loadToken();
  wire();
  await connect();
}

// Finds the server (discovery on the hosted copy), then loads the subjects and the signed-in teacher.
async function connect() {
  state.offline = false;
  const o = apiOverride();
  const note = $("#test-server");
  note.hidden = !(o && !o.bad);
  if (o && !o.bad) note.textContent = "Test mode: using the class server at " + o + " (from ?api= in the address).";
  try {
    state.base = await resolveBase();
  } catch (e) {
    goOffline(e.message);
    return;
  }
  try {
    state.subjects = (await api("GET", "/api/subjects")).subjects || [];
  } catch (e) {
    if (e instanceof OfflineError) {
      if (!state.offline) goOffline(e.message);
      return;
    }
    banner(e.message, true);
  }
  fillSubjectPicker($("#add-form [data-subjects]"), []);
  if (state.token) {
    try {
      state.teacher = (await api("GET", "/api/teacher/me")).teacher;
    } catch (e) {
      if (e instanceof OfflineError) return;       // keep the sign-in for when the server is back
      saveToken("");
    }
  }
  show();
  if (state.teacher) await refresh();
}

// ------------------------------------------------------------ subject picker

function fillSubjectPicker(box, selected) {
  box.replaceChildren();
  const sel = new Set(selected || []);
  const full = el("label", "subject full");
  const fullInput = el("input");
  fullInput.type = "checkbox";
  fullInput.name = "full_story";
  fullInput.checked = sel.size === 0;
  const fullText = el("span");
  fullText.append(el("b", "", "Full story (no subjects)"), el("small", "", "Every job in the story, all the strands."));
  full.append(fullInput, fullText);
  box.append(full);
  const subjectInputs = [];
  for (const s of state.subjects) {
    const lab = el("label", "subject" + (s.assignable ? "" : " soon"));
    const inp = el("input");
    inp.type = "checkbox";
    inp.name = "subject";
    inp.value = s.id;
    inp.disabled = !s.assignable;
    inp.checked = sel.has(s.id);
    const txt = el("span");
    const b = el("b", "", s.name);
    if (!s.assignable) b.append(el("span", "soon-tag", "coming soon"));
    txt.append(b, el("small", "", s.description));
    lab.append(inp, txt);
    box.append(lab);
    subjectInputs.push(inp);
    inp.addEventListener("change", () => {
      if (inp.checked) fullInput.checked = false;
      if (!subjectInputs.some((i) => i.checked)) fullInput.checked = true;
    });
  }
  fullInput.addEventListener("change", () => {
    if (fullInput.checked) subjectInputs.forEach((i) => { i.checked = false; });
    else if (!subjectInputs.some((i) => i.checked)) fullInput.checked = true;
  });
}

function pickedSubjects(form) {
  return [...form.querySelectorAll('input[name="subject"]:checked')].map((i) => i.value);
}

function subjectName(id) {
  const s = state.subjects.find((x) => x.id === id);
  return s ? s.name : id;
}

function looksLikeFullName(name) {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2 && parts.every((p) => p.replace(/[^A-Za-zÀ-ÿ]/g, "").length >= 2);
}

// ------------------------------------------------------------ class list

async function refresh() {
  try {
    state.students = (await api("GET", "/api/teacher/students")).students || [];
  } catch (e) {
    banner(e.message, true);
    return;
  }
  renderStudents();
}

function ago(ts) {
  if (!ts) return "never";
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 90) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : d + " days ago";
}

function renderStudents() {
  const box = $("#students");
  box.replaceChildren();
  $("#count").textContent = state.students.length ? "(" + state.students.length + ")" : "";
  $("#empty").hidden = state.students.length > 0;
  $("#print").disabled = state.students.length === 0;
  const tpl = $("#student-tpl");
  for (const st of state.students) {
    const card = tpl.content.firstElementChild.cloneNode(true);
    $("[data-name]", card).textContent = st.name;
    $("[data-meta]", card).textContent = "Grade " + st.grade + " · last played " + ago(st.last_seen);
    $("[data-code]", card).textContent = st.code;
    $("[data-code]", card).setAttribute("aria-label", "Join code " + st.code.split("").join(" "));
    const chips = $("[data-chips]", card);
    if (!st.subjects.length) chips.append(el("span", "chip story", "Full story"));
    for (const name of st.subject_names) chips.append(el("span", "chip", name));
    const pct = st.jobs_total ? Math.round((100 * st.jobs_done) / st.jobs_total) : 0;
    $("[data-bar]", card).style.width = pct + "%";
    let line = st.jobs_done + " of " + st.jobs_total + " jobs done";
    if (st.jobs_total === 0) line = "No jobs in this assignment yet for grade " + st.grade;
    if (st.current_job) line += " · now: " + st.current_job;
    line += " · " + Math.round(st.minutes) + " min played";
    $("[data-progress]", card).textContent = line;
    $("[data-copy]", card).addEventListener("click", (ev) => copyCode(st.code, ev.currentTarget));
    card.querySelectorAll("[data-act]").forEach((b) => {
      b.addEventListener("click", () => act(b.dataset.act, st));
    });
    box.append(card);
  }
}

async function copyCode(code, btn) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(code);
    ok = true;
  } catch (_) {
    ok = false;
  }
  const old = btn.textContent;
  btn.textContent = ok ? "Copied" : "Select it: " + code;
  setTimeout(() => { btn.textContent = old; }, 1800);
}

function confirmBox(title, text, yes) {
  const d = $("#confirm-dialog");
  $("[data-title]", d).textContent = title;
  $("[data-text]", d).textContent = text;
  $("[data-yes]", d).textContent = yes;
  return new Promise((resolve) => {
    d.addEventListener("close", () => resolve(d.returnValue === "yes"), { once: true });
    d.returnValue = "";
    d.showModal();
  });
}

async function act(what, st) {
  if (what === "edit") return openEdit(st);
  if (what === "progress") return openProgress(st);
  if (what === "code") {
    if (!(await confirmBox("New code for " + st.name + "?",
      "The old code stops working. If " + st.name + " already joined on a device, they type the new code once. Their progress is kept.",
      "Make a new code"))) return;
    try {
      await api("POST", "/api/teacher/students/" + encodeURIComponent(st.student_id) + "/code");
      banner("New code made for " + st.name + ".");
      await refresh();
    } catch (e) { banner(e.message, true); }
  }
  if (what === "delete") {
    if (!(await confirmBox("Delete " + st.name + "?",
      "This removes " + st.name + " and their class progress from the dashboard. Their code stops working. This cannot be undone.",
      "Delete student"))) return;
    try {
      await api("DELETE", "/api/teacher/students/" + encodeURIComponent(st.student_id));
      banner(st.name + " was deleted.");
      await refresh();
    } catch (e) { banner(e.message, true); }
  }
}

// ------------------------------------------------------------ edit

let editing = null;

function openEdit(st) {
  editing = st;
  const d = $("#edit-dialog");
  const f = $("#edit-form");
  formError(f, "");
  $("[data-name]", d).textContent = st.name;
  f.elements.name.value = st.name;
  f.querySelectorAll('input[name="grade"]').forEach((r) => { r.checked = Number(r.value) === st.grade; });
  fillSubjectPicker($("[data-subjects]", f), st.subjects);
  d.showModal();
}

async function saveEdit(ev) {
  ev.preventDefault();
  const f = ev.currentTarget;
  if (!editing) return;
  const grade = Number((f.querySelector('input[name="grade"]:checked') || {}).value || editing.grade);
  try {
    await api("PATCH", "/api/teacher/students/" + encodeURIComponent(editing.student_id),
      { name: f.elements.name.value, grade, subjects: pickedSubjects(f) });
    $("#edit-dialog").close();
    banner("Saved. " + f.elements.name.value.trim() + " gets the change next time they play.");
    await refresh();
  } catch (e) { formError(f, e.message); }
}

// ------------------------------------------------------------ progress

async function openProgress(st) {
  const d = $("#progress-dialog");
  $("[data-name]", d).textContent = st.name + " · Grade " + st.grade;
  const body = $("[data-body]", d);
  body.replaceChildren(el("p", "note", "Loading…"));
  d.showModal();
  let s;
  try {
    s = (await api("GET", "/api/teacher/students/" + encodeURIComponent(st.student_id))).student;
  } catch (e) {
    body.replaceChildren(el("p", "error", e.message));
    return;
  }
  body.replaceChildren();
  const stats = el("div", "stats");
  const stat = (label, value) => { const b = el("div", "stat"); b.append(el("b", "", value), el("span", "meta", label)); stats.append(b); };
  stat("jobs done", s.jobs_done + " of " + s.jobs_total);
  stat("minutes played", Math.round(s.minutes));
  stat("last played", ago(s.last_seen));
  stat("working on", s.current_job ? s.current_job + " (step " + s.current_step + ")" : "nothing right now");
  body.append(stats);
  for (const g of s.groups) {
    const box = el("div", "group");
    box.append(el("h3", "", g.name));
    box.append(el("p", "meta", "Jobs"));
    const jobs = el("ul", "list");
    if (!g.jobs.length) jobs.append(el("li", "meta", "No jobs written for this grade yet."));
    for (const j of g.jobs) {
      const li = el("li");
      li.append(el("span", "tag " + (j.done ? "done" : j.active ? "now" : "todo"), j.done ? "done" : j.active ? "now" : "to do"), el("span", "", j.title));
      jobs.append(li);
    }
    box.append(jobs);
    box.append(el("p", "meta", "Lessons read"));
    const les = el("ul", "list");
    if (!g.lessons.length) les.append(el("li", "meta", "No lessons in these jobs."));
    for (const l of g.lessons) {
      const li = el("li");
      li.append(el("span", "tag " + (l.read ? "done" : "todo"), l.read ? "read" : "not yet"), el("span", "", l.title));
      les.append(li);
    }
    box.append(les);
    const n = g.solution_items;
    let solText = n === 0 ? "No questions needed the worked solution."
      : n + (n === 1 ? " question" : " questions") + " needed the worked solution (after 3 tries).";
    const where = Object.entries(g.solution_jobs || {}).map(([t, c]) => t + ": " + c);
    if (where.length) solText += " " + where.join(" · ");
    box.append(el("p", "", solText));
    body.append(box);
  }
}

// ------------------------------------------------------------ print code cards

function printCards() {
  const sheet = $("#print-sheet");
  sheet.replaceChildren();
  // Hosted copy: students play the web game next door and leave Class server on "auto". Local: this server's address.
  const where = DISCOVERY
    ? "Play at " + new URL("../", window.location.href).href + " (Class server in Settings: auto)"
    : "Class server (Settings): " + (state.base || window.location.origin);
  for (const st of state.students) {
    const c = el("div", "print-card");
    c.append(el("div", "pc-name", st.name),
      el("div", "pc-small", "Grade " + st.grade + " · " + (st.subjects.length ? st.subject_names.join(", ") : "Full story")),
      el("div", "pc-code", st.code),
      el("div", "pc-small", "Open Bellwork, choose Join my class, and type this code."),
      el("div", "pc-small", where));
    sheet.append(c);
  }
  window.print();
}

// ------------------------------------------------------------ wiring

function wire() {
  $("#login-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    formError(f, "");
    try {
      const r = await api("POST", "/api/teacher/login", { username: f.elements.username.value, password: f.elements.password.value });
      saveToken(r.token);
      state.teacher = r.teacher;
      f.reset();
      show();
      await refresh();
    } catch (e) { formError(f, e.message); }
  });
  $("#register-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    formError(f, "");
    try {
      const r = await api("POST", "/api/teacher/register", {
        display_name: f.elements.display_name.value, username: f.elements.username.value, password: f.elements.password.value });
      saveToken(r.token);
      state.teacher = r.teacher;
      f.reset();
      show();
      banner("Welcome, " + r.teacher.display_name + ". Add your first student below.");
      await refresh();
    } catch (e) { formError(f, e.message); }
  });
  $("#logout").addEventListener("click", async () => {
    try { await api("POST", "/api/teacher/logout"); } catch (_) { /* ignore */ }
    saveToken("");
    state.teacher = null;
    state.students = [];
    show();
  });
  const add = $("#add-form");
  add.elements.name.addEventListener("input", () => {
    $("#name-warning").hidden = !looksLikeFullName(add.elements.name.value);
  });
  add.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    formError(add, "");
    const grade = Number((add.querySelector('input[name="grade"]:checked') || {}).value || 0);
    if (!grade) return formError(add, "Pick grade 6 or grade 7.");
    try {
      const r = await api("POST", "/api/teacher/students", { name: add.elements.name.value, grade, subjects: pickedSubjects(add) });
      banner(r.student.name + " was added. Their code is " + r.student.code + ".");
      add.elements.name.value = "";
      $("#name-warning").hidden = true;
      await refresh();
      add.elements.name.focus();
    } catch (e) { formError(add, e.message); }
  });
  $("#edit-form").addEventListener("submit", saveEdit);
  document.querySelectorAll("dialog [data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
  $("#refresh").addEventListener("click", refresh);
  $("#retry").addEventListener("click", connect);
  $("#print").addEventListener("click", printCards);
}

document.addEventListener("DOMContentLoaded", start);
