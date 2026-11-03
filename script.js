/* ==========================================================================
   Tasks — a modern to-do app in vanilla JavaScript
   --------------------------------------------------------------------------
   Architecture: a single immutable-ish state object is the source of truth.
   Every mutation goes through `commit()`, which snapshots history for undo,
   writes to localStorage, and triggers one re-render. The DOM is never read
   to determine state.
   ========================================================================== */

(function () {
  "use strict";

  /* ───────────── Constants ───────────── */

  const STORAGE_KEY = "tasks.v2";
  const THEME_KEY = "tasks.theme";
  const MAX_HISTORY = 30;
  const TOAST_MS = 5000;

  const PRIORITIES = {
    low: { label: "Low", weight: 2 },
    normal: { label: "Normal", weight: 1 },
    high: { label: "High", weight: 0 },
  };

  /* ───────────── Element lookup ───────────── */

  const $ = (sel) => document.querySelector(sel);

  const el = {
    html: document.documentElement,
    themeToggle: $("#themeToggle"),
    themeMeta: $('meta[name="theme-color"]'),
    dateLine: $("#dateLine"),

    progressFill: $("#progressFill"),
    progressPct: $("#progressPct"),
    progressBar: $("#progressBar"),
    statTotal: $("#statTotal"),
    statActive: $("#statActive"),
    statDone: $("#statDone"),
    statOverdue: $("#statOverdue"),
    statOverdueWrap: $("#statOverdueWrap"),

    composer: $("#composer"),
    taskInput: $("#taskInput"),
    dueInput: $("#dueInput"),
    clearDue: $("#clearDue"),

    searchInput: $("#searchInput"),
    clearSearch: $("#clearSearch"),
    filters: $(".filters"),
    sortSelect: $("#sortSelect"),
    clearCompleted: $("#clearCompleted"),

    countAll: $("#countAll"),
    countActive: $("#countActive"),
    countDone: $("#countDone"),

    list: $("#taskList"),
    template: $("#taskTemplate"),

    empty: $("#emptyState"),
    emptyTitle: $("#emptyTitle"),
    emptyBody: $("#emptyBody"),

    exportBtn: $("#exportBtn"),
    resetAll: $("#resetAll"),

    toast: $("#toast"),
    toastMsg: $("#toastMsg"),
    toastAction: $("#toastAction"),
    srStatus: $("#srStatus"),
  };

  /* ───────────── State ───────────── */

  const state = {
    tasks: [],
    filter: "all", // all | active | done
    sort: "manual", // manual | created | due | priority | alpha
    query: "",
  };

  const history = [];
  let editingId = null;
  let toastTimer = null;
  let toastLeaveTimer = null;

  /* ───────────── Storage ───────────── */

  function loadTasks() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      return []; // private mode / storage disabled
    }
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed.tasks;
      if (!Array.isArray(list)) return [];
      return list.map(normalizeTask).filter(Boolean);
    } catch {
      return [];
    }
  }

  function normalizeTask(raw) {
    if (!raw || typeof raw !== "object") return null;
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (!text) return null;

    return {
      id: typeof raw.id === "string" ? raw.id : makeId(),
      text: text.slice(0, 280),
      done: Boolean(raw.done),
      priority: PRIORITIES[raw.priority] ? raw.priority : "normal",
      due: isIsoDate(raw.due) ? raw.due : null,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
      completedAt: Number.isFinite(raw.completedAt) ? raw.completedAt : null,
    };
  }

  function saveTasks() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks: state.tasks }));
    } catch {
      /* Out of quota or storage blocked — the app still works in-memory. */
    }
  }

  /* ───────────── Helpers ───────────── */

  function makeId() {
    if (window.crypto && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function isIsoDate(v) {
    return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  }

  /** Today as a local-time YYYY-MM-DD string (never UTC — avoids off-by-one). */
  function todayIso() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function dayDiff(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const target = new Date(y, m - 1, d);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((target - today) / 86400000);
  }

  function formatDue(iso) {
    const diff = dayDiff(iso);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff === -1) return "Yesterday";

    const [y, m, d] = iso.split("-").map(Number);
    const date = new Date(y, m - 1, d);

    if (diff > 1 && diff < 7) {
      return date.toLocaleDateString(undefined, { weekday: "long" });
    }
    if (diff < -1 && diff > -30) {
      return `${Math.abs(diff)} days ago`;
    }

    const opts = { month: "short", day: "numeric" };
    if (date.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
    return date.toLocaleDateString(undefined, opts);
  }

  function isOverdue(task) {
    return Boolean(task.due) && !task.done && dayDiff(task.due) < 0;
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  /** Find a rendered row by task id without needing selector escaping. */
  function nodeById(id) {
    for (const node of el.list.children) {
      if (node.dataset.id === id) return node;
    }
    return null;
  }

  /* ───────────── Mutation pipeline ───────────── */

  function snapshot() {
    return state.tasks.map((t) => ({ ...t }));
  }

  /**
   * Apply a mutation. `mutator` receives nothing and should edit state.tasks.
   * History is pushed first so undo restores the pre-mutation list.
   */
  function commit(mutator) {
    history.push(snapshot());
    if (history.length > MAX_HISTORY) history.shift();
    mutator();
    saveTasks();
    render();
  }

  function undo() {
    if (!history.length) {
      announce("Nothing left to undo");
      return false;
    }
    state.tasks = history.pop();
    saveTasks();
    render();
    return true;
  }

  /* ───────────── Actions ───────────── */

  function addTask(text, priority, due) {
    const clean = text.trim().replace(/\s+/g, " ");
    if (!clean) return false;

    commit(() => {
      state.tasks.unshift({
        id: makeId(),
        text: clean.slice(0, 280),
        done: false,
        priority: PRIORITIES[priority] ? priority : "normal",
        due: isIsoDate(due) ? due : null,
        createdAt: Date.now(),
        completedAt: null,
      });
    });

    announce(`Added "${clean}"`);
    return true;
  }

  function toggleTask(id) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;

    commit(() => {
      task.done = !task.done;
      task.completedAt = task.done ? Date.now() : null;
    });

    announce(task.done ? `Completed "${task.text}"` : `Reopened "${task.text}"`);

    if (task.done && state.tasks.length > 1 && state.tasks.every((t) => t.done)) {
      showToast("All tasks complete. Nice work.");
    }
  }

  function updateText(id, text) {
    const task = state.tasks.find((t) => t.id === id);
    const clean = text.trim().replace(/\s+/g, " ");
    if (!task || !clean || clean === task.text) return;

    commit(() => {
      task.text = clean.slice(0, 280);
    });
    announce("Task updated");
  }

  function deleteTask(id) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;

    const node = nodeById(id);
    const label = task.text.length > 32 ? task.text.slice(0, 32) + "…" : task.text;

    const removeNow = () => {
      commit(() => {
        state.tasks = state.tasks.filter((t) => t.id !== id);
      });
      showToast(`Deleted "${label}"`, "Undo", undo);
    };

    // Let the exit animation play before the list re-renders.
    if (node && !prefersReducedMotion()) {
      node.classList.add("is-removing");
      setTimeout(removeNow, 180);
    } else {
      removeNow();
    }
  }

  function clearCompleted() {
    const count = state.tasks.filter((t) => t.done).length;
    if (!count) return;

    commit(() => {
      state.tasks = state.tasks.filter((t) => !t.done);
    });
    showToast(`Cleared ${plural(count, "task")}`, "Undo", undo);
  }

  function deleteAll() {
    const count = state.tasks.length;
    if (!count) return;

    commit(() => {
      state.tasks = [];
    });
    showToast(`Deleted ${plural(count, "task")}`, "Undo", undo, 8000);
  }

  function moveTask(draggedId, targetId, placeAfter) {
    if (draggedId === targetId) return;

    const from = state.tasks.findIndex((t) => t.id === draggedId);
    if (from === -1) return;

    commit(() => {
      const [moved] = state.tasks.splice(from, 1);
      let to = state.tasks.findIndex((t) => t.id === targetId);
      if (to === -1) to = state.tasks.length - 1;
      state.tasks.splice(placeAfter ? to + 1 : to, 0, moved);
    });
    announce("Task reordered");
  }

  /* ───────────── Derived data ───────────── */

  function visibleTasks() {
    const q = state.query.trim().toLowerCase();

    let list = state.tasks.filter((task) => {
      if (state.filter === "active" && task.done) return false;
      if (state.filter === "done" && !task.done) return false;
      if (q && !task.text.toLowerCase().includes(q)) return false;
      return true;
    });

    const sorters = {
      created: (a, b) => b.createdAt - a.createdAt,
      alpha: (a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: "base" }),
      priority: (a, b) =>
        PRIORITIES[a.priority].weight - PRIORITIES[b.priority].weight ||
        b.createdAt - a.createdAt,
      due: (a, b) => {
        if (a.due === b.due) return b.createdAt - a.createdAt;
        if (!a.due) return 1; // undated sinks to the bottom
        if (!b.due) return -1;
        return a.due < b.due ? -1 : 1;
      },
    };

    if (sorters[state.sort]) list = list.slice().sort(sorters[state.sort]);
    return list;
  }

  /* ───────────── Rendering ───────────── */

  function render() {
    renderList();
    renderStats();
    renderToolbar();
    renderEmpty();
    document.title = buildTitle();
  }

  function buildTitle() {
    const active = state.tasks.filter((t) => !t.done).length;
    return active ? `(${active}) Tasks` : "Tasks — A Modern To-Do App";
  }

  function renderList() {
    const tasks = visibleTasks();
    const frag = document.createDocumentFragment();
    const draggable = state.sort === "manual";

    for (const task of tasks) {
      frag.appendChild(buildTaskNode(task, draggable));
    }

    el.list.replaceChildren(frag);
  }

  function buildTaskNode(task, draggable) {
    const node = el.template.content.firstElementChild.cloneNode(true);

    node.dataset.id = task.id;
    node.dataset.priority = task.priority;
    node.classList.toggle("is-done", task.done);
    node.draggable = draggable;

    const handle = node.querySelector(".drag-handle");
    handle.hidden = !draggable;

    // Checkbox
    const check = node.querySelector(".check-input");
    check.checked = task.done;
    check.setAttribute(
      "aria-label",
      task.done ? `Mark "${task.text}" as not done` : `Mark "${task.text}" as done`
    );

    // Text — built as nodes, so task text is never parsed as HTML
    const textEl = node.querySelector(".task-text");
    textEl.replaceChildren(highlight(task.text, state.query));

    // Priority tag
    const prioTag = node.querySelector(".tag-prio");
    if (task.priority === "normal") {
      prioTag.hidden = true;
    } else {
      prioTag.textContent = PRIORITIES[task.priority].label;
    }

    // Due tag
    const dueTag = node.querySelector(".tag-due");
    if (!task.due) {
      dueTag.hidden = true;
    } else {
      dueTag.textContent = formatDue(task.due);
      const diff = dayDiff(task.due);
      dueTag.classList.toggle("is-overdue", !task.done && diff < 0);
      dueTag.classList.toggle("is-today", !task.done && diff === 0);
    }

    // Action labels carry the task text for screen readers
    node.querySelector(".js-edit").setAttribute("aria-label", `Edit "${task.text}"`);
    node.querySelector(".js-delete").setAttribute("aria-label", `Delete "${task.text}"`);

    return node;
  }

  /** Wrap query matches in <mark>, returning a fragment of safe text nodes. */
  function highlight(text, query) {
    const frag = document.createDocumentFragment();
    const q = query.trim().toLowerCase();

    if (!q) {
      frag.appendChild(document.createTextNode(text));
      return frag;
    }

    const haystack = text.toLowerCase();
    let cursor = 0;

    while (cursor < text.length) {
      const hit = haystack.indexOf(q, cursor);
      if (hit === -1) {
        frag.appendChild(document.createTextNode(text.slice(cursor)));
        break;
      }
      if (hit > cursor) {
        frag.appendChild(document.createTextNode(text.slice(cursor, hit)));
      }
      const mark = document.createElement("mark");
      mark.textContent = text.slice(hit, hit + q.length);
      frag.appendChild(mark);
      cursor = hit + q.length;
    }

    return frag;
  }

  function renderStats() {
    const total = state.tasks.length;
    const done = state.tasks.filter((t) => t.done).length;
    const active = total - done;
    const overdue = state.tasks.filter(isOverdue).length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    el.statTotal.textContent = total;
    el.statActive.textContent = active;
    el.statDone.textContent = done;

    el.statOverdueWrap.hidden = overdue === 0;
    el.statOverdue.textContent = overdue;

    el.progressFill.style.width = pct + "%";
    el.progressPct.textContent = pct + "%";
    el.progressBar.setAttribute("aria-valuenow", String(pct));
    el.progressBar.setAttribute(
      "aria-valuetext",
      total ? `${done} of ${total} tasks complete` : "No tasks yet"
    );

    el.countAll.textContent = total;
    el.countActive.textContent = active;
    el.countDone.textContent = done;
    el.clearCompleted.disabled = done === 0;
  }

  function renderToolbar() {
    for (const chip of el.filters.children) {
      const on = chip.dataset.filter === state.filter;
      chip.classList.toggle("is-active", on);
      chip.setAttribute("aria-selected", String(on));
    }
    el.clearSearch.hidden = state.query === "";
    el.clearDue.hidden = el.dueInput.value === "";
  }

  function renderEmpty() {
    const total = state.tasks.length;
    const shown = el.list.children.length;

    el.empty.hidden = shown > 0;
    if (shown > 0) return;

    let title, body;

    if (total === 0) {
      title = "Nothing here yet";
      body = "Add your first task above and it will show up here.";
    } else if (state.query) {
      title = "No matches";
      body = `Nothing matches “${state.query}”. Try a different search.`;
    } else if (state.filter === "active") {
      title = "All caught up";
      body = "Every task is done. Enjoy the quiet.";
    } else {
      title = "No completed tasks";
      body = "Tick something off and it will appear here.";
    }

    el.emptyTitle.textContent = title;
    el.emptyBody.textContent = body;
  }

  /* ───────────── Inline editing ───────────── */

  function startEdit(id) {
    if (editingId) return;

    const node = nodeById(id);
    const task = state.tasks.find((t) => t.id === id);
    if (!node || !task) return;

    editingId = id;

    const textEl = node.querySelector(".task-text");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "edit-input";
    input.value = task.text;
    input.maxLength = 280;
    input.setAttribute("aria-label", "Edit task text");

    textEl.replaceWith(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    let settled = false;

    const finish = (save) => {
      if (settled) return;
      settled = true;
      editingId = null;
      if (save) updateText(id, input.value);
      render(); // rebuilds the row either way
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    });

    input.addEventListener("blur", () => finish(true));
  }

  /* ───────────── Toast + announcements ───────────── */

  function showToast(message, actionLabel, actionFn, duration) {
    clearTimeout(toastTimer);
    clearTimeout(toastLeaveTimer);

    el.toastMsg.textContent = message;
    el.toast.classList.remove("is-leaving");
    el.toast.hidden = false;

    if (actionLabel && typeof actionFn === "function") {
      el.toastAction.textContent = actionLabel;
      el.toastAction.hidden = false;
      el.toastAction.onclick = () => {
        hideToast();
        actionFn();
      };
    } else {
      el.toastAction.hidden = true;
      el.toastAction.onclick = null;
    }

    announce(message);
    toastTimer = setTimeout(hideToast, duration || TOAST_MS);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    if (el.toast.hidden) return;

    el.toast.classList.add("is-leaving");
    toastLeaveTimer = setTimeout(() => {
      el.toast.hidden = true;
      el.toast.classList.remove("is-leaving");
    }, 200);
  }

  function announce(message) {
    el.srStatus.textContent = "";
    // A tick of delay forces assistive tech to re-read identical messages.
    setTimeout(() => {
      el.srStatus.textContent = message;
    }, 60);
  }

  /* ───────────── Theme ───────────── */

  function applyTheme(theme) {
    el.html.dataset.theme = theme;
    el.themeToggle.setAttribute(
      "aria-label",
      theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
    );
    if (el.themeMeta) {
      el.themeMeta.setAttribute("content", theme === "dark" ? "#0a0d16" : "#6366f1");
    }
  }

  function initTheme() {
    let stored = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch {
      /* ignore */
    }

    const systemDark =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

    applyTheme(stored === "dark" || stored === "light" ? stored : systemDark ? "dark" : "light");

    // Follow the OS while the user has made no explicit choice.
    if (!stored && window.matchMedia) {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", (e) => {
          let hasChoice = null;
          try {
            hasChoice = localStorage.getItem(THEME_KEY);
          } catch {
            /* ignore */
          }
          if (!hasChoice) applyTheme(e.matches ? "dark" : "light");
        });
    }
  }

  function toggleTheme() {
    const next = el.html.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore */
    }
  }

  function prefersReducedMotion() {
    return (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  /* ───────────── Export ───────────── */

  function exportJson() {
    if (!state.tasks.length) {
      showToast("Nothing to export yet");
      return;
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      count: state.tasks.length,
      tasks: state.tasks,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tasks-${todayIso()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    showToast(`Exported ${plural(state.tasks.length, "task")}`);
  }

  /* ───────────── Event wiring ───────────── */

  function bindComposer() {
    el.composer.addEventListener("submit", (e) => {
      e.preventDefault();

      const text = el.taskInput.value;
      if (!text.trim()) {
        el.taskInput.classList.add("is-invalid");
        el.taskInput.focus();
        setTimeout(() => el.taskInput.classList.remove("is-invalid"), 400);
        announce("Please type a task first");
        return;
      }

      const priority =
        el.composer.querySelector('input[name="priority"]:checked')?.value || "normal";

      addTask(text, priority, el.dueInput.value);

      el.taskInput.value = "";
      // Reset the date so the next task cannot silently inherit this due date.
      // Priority is intentionally kept, which helps when adding a batch.
      el.dueInput.value = "";
      el.taskInput.focus();

      // A newly added task should be visible even if a filter hides it.
      if (state.filter === "done") setFilter("all");
      if (state.query) {
        el.searchInput.value = "";
        state.query = "";
        render();
      }
    });

    el.dueInput.addEventListener("change", renderToolbar);

    el.clearDue.addEventListener("click", () => {
      el.dueInput.value = "";
      renderToolbar();
      el.dueInput.focus();
    });
  }

  function bindToolbar() {
    el.filters.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-filter]");
      if (chip) setFilter(chip.dataset.filter);
    });

    // Arrow-key navigation across the filter tabs
    el.filters.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const chips = [...el.filters.children];
      const i = chips.indexOf(document.activeElement);
      if (i === -1) return;
      e.preventDefault();
      const next = chips[(i + (e.key === "ArrowRight" ? 1 : -1) + chips.length) % chips.length];
      next.focus();
      setFilter(next.dataset.filter);
    });

    let searchTimer;
    el.searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.query = el.searchInput.value;
        render();
      }, 110);
    });

    el.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        el.searchInput.value = "";
        state.query = "";
        render();
      }
    });

    el.clearSearch.addEventListener("click", () => {
      el.searchInput.value = "";
      state.query = "";
      render();
      el.searchInput.focus();
    });

    el.sortSelect.addEventListener("change", () => {
      state.sort = el.sortSelect.value;
      render();
      announce(
        state.sort === "manual"
          ? "Manual order — drag tasks to rearrange"
          : `Sorted by ${el.sortSelect.selectedOptions[0].textContent}`
      );
    });

    el.clearCompleted.addEventListener("click", clearCompleted);
    el.exportBtn.addEventListener("click", exportJson);
    el.resetAll.addEventListener("click", deleteAll);
    el.themeToggle.addEventListener("click", toggleTheme);
  }

  function setFilter(filter) {
    if (!["all", "active", "done"].includes(filter)) return;
    state.filter = filter;
    render();
  }

  function bindList() {
    el.list.addEventListener("click", (e) => {
      const node = e.target.closest(".task");
      if (!node) return;
      const id = node.dataset.id;

      if (e.target.closest(".js-delete")) {
        deleteTask(id);
      } else if (e.target.closest(".js-edit")) {
        startEdit(id);
      } else if (e.target.closest(".task-text")) {
        startEdit(id);
      }
    });

    el.list.addEventListener("change", (e) => {
      if (!e.target.classList.contains("check-input")) return;
      const node = e.target.closest(".task");
      if (node) toggleTask(node.dataset.id);
    });

    bindDragAndDrop();
  }

  function bindDragAndDrop() {
    let draggedId = null;

    el.list.addEventListener("dragstart", (e) => {
      const node = e.target.closest(".task");
      if (!node || state.sort !== "manual") return;

      draggedId = node.dataset.id;
      node.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      // Required for Firefox to start a drag at all.
      e.dataTransfer.setData("text/plain", draggedId);
    });

    el.list.addEventListener("dragover", (e) => {
      if (!draggedId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      const over = e.target.closest(".task");
      clearDropTargets();
      if (over && over.dataset.id !== draggedId) {
        over.classList.add("is-drop-target");
      }
    });

    el.list.addEventListener("dragleave", (e) => {
      const node = e.target.closest(".task");
      if (node) node.classList.remove("is-drop-target");
    });

    el.list.addEventListener("drop", (e) => {
      if (!draggedId) return;
      e.preventDefault();

      const target = e.target.closest(".task");
      clearDropTargets();

      if (target && target.dataset.id !== draggedId) {
        const box = target.getBoundingClientRect();
        const placeAfter = e.clientY > box.top + box.height / 2;
        moveTask(draggedId, target.dataset.id, placeAfter);
      }
      draggedId = null;
    });

    el.list.addEventListener("dragend", () => {
      draggedId = null;
      clearDropTargets();
      el.list.querySelectorAll(".is-dragging").forEach((n) =>
        n.classList.remove("is-dragging")
      );
    });
  }

  function clearDropTargets() {
    el.list
      .querySelectorAll(".is-drop-target")
      .forEach((n) => n.classList.remove("is-drop-target"));
  }

  function bindShortcuts() {
    document.addEventListener("keydown", (e) => {
      const target = e.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      // Undo works everywhere except mid-edit, where the browser's own
      // text undo is the more useful behaviour.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !editingId) {
        e.preventDefault();
        if (undo()) showToast("Undone");
        return;
      }

      if (typing) return;

      if (e.key === "/") {
        e.preventDefault();
        el.searchInput.focus();
        el.searchInput.select();
      } else if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        el.taskInput.focus();
      } else if (e.key.toLowerCase() === "t") {
        e.preventDefault();
        toggleTheme();
      } else if (e.key === "Escape") {
        if (state.query) {
          el.searchInput.value = "";
          state.query = "";
          render();
        } else {
          hideToast();
        }
      }
    });
  }

  function setDateLine() {
    el.dateLine.textContent = new Date().toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }

  /* ───────────── Boot ───────────── */

  function init() {
    initTheme();
    setDateLine();

    state.tasks = loadTasks();
    el.dueInput.min = todayIso();

    bindComposer();
    bindToolbar();
    bindList();
    bindShortcuts();

    render();

    // Keep tabs in sync when the same app is open twice.
    window.addEventListener("storage", (e) => {
      if (e.key !== STORAGE_KEY) return;
      state.tasks = loadTasks();
      render();
    });
  }

  init();
})();
