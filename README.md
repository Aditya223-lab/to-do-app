# Tasks — a modern to-do app

A fast, accessible to-do app built with **plain HTML, CSS and JavaScript**. No
framework, no build step, no dependencies — open `index.html` and it runs.

**[▶ Live demo](https://aditya223-lab.github.io/to-do-app/)**

---

## Features

**Task management**
- Add, edit and delete tasks; click any task's text to edit it in place
- Three priority levels (Low / Normal / High) with a colour-coded accent
- Optional due dates, shown as *Today*, *Tomorrow*, *Friday* or *3 days ago*
- Overdue tasks are highlighted and counted separately

**Finding things**
- Live search with the matching text highlighted in each result
- Filter by All / Active / Done, each with a live count
- Sort by manual order, newest, due date, priority or alphabetically
- Drag and drop to reorder (in manual mode)

**Staying oriented**
- Progress bar and stat tiles for total / active / done / overdue
- Active task count appears in the browser tab title
- Distinct empty states for "no tasks yet", "no search matches" and "all caught up"

**Quality of life**
- Everything is saved to `localStorage` automatically — close the tab and come back
- Undo for every destructive action, via the toast button or <kbd>Ctrl</kbd>+<kbd>Z</kbd>
- Dark and light themes, following your system setting until you choose one
- Export all tasks to a JSON file
- Open in two tabs and they stay in sync

**Built to be usable by everyone**
- Full keyboard support, including arrow keys across the filter tabs
- Screen-reader announcements for every action via an ARIA live region
- Visible focus rings, proper labels, and a progress bar with `aria-valuetext`
- Honours `prefers-reduced-motion` and `prefers-contrast`
- Responsive down to 320px, and has a print stylesheet

---

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| <kbd>Enter</kbd> | Add the task (or commit an edit) |
| <kbd>N</kbd> | Jump to the new-task field |
| <kbd>/</kbd> | Jump to search |
| <kbd>T</kbd> | Toggle dark / light theme |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> | Undo the last change |
| <kbd>Esc</kbd> | Clear the search, cancel an edit, or dismiss a toast |
| <kbd>←</kbd> <kbd>→</kbd> | Move between filter tabs |

---

## Running it

No tooling required:

```bash
git clone https://github.com/Aditya223-lab/to-do-app.git
cd to-do-app
```

Then open `index.html` in a browser. That's it.

If you'd rather serve it over HTTP:

```bash
python -m http.server 8000
# or
npx serve
```

---

## How the code is organised

```
index.html    Markup, plus a <template> for a task row
style.css     Design tokens → base → layout → components → responsive
script.js     All behaviour, in one IIFE
favicon.svg
```

`script.js` keeps a single `state` object as the only source of truth:

```js
const state = {
  tasks: [],       // the task list
  filter: "all",   // all | active | done
  sort: "manual",  // manual | created | due | priority | alpha
  query: "",       // current search text
};
```

Every change flows through one function:

```js
function commit(mutator) {
  history.push(snapshot());   // snapshot first, so undo works
  mutator();                  // apply the change
  saveTasks();                // persist
  render();                   // one re-render
}
```

The DOM is never read to work out what the state is, which keeps the two from
drifting apart. Three details worth noting:

- **Task text is never passed to `innerHTML`.** Rows are built from a `<template>`
  and search highlighting is assembled from real text nodes and `<mark>` elements,
  so a task called `<img onerror=...>` renders as literal text.
- **Dates are handled in local time.** Using `toISOString()` for "today" would
  shift the date by one for anyone west of UTC, so the date is built from
  `getFullYear()` / `getMonth()` / `getDate()` instead.
- **`localStorage` is wrapped in `try/catch`.** Private browsing and a full quota
  both throw; the app carries on in memory rather than breaking.

### Task shape

```js
{
  id: "uuid",
  text: "Buy milk",
  done: false,
  priority: "normal",   // low | normal | high
  due: "2026-11-05",    // or null
  createdAt: 1762070400000,
  completedAt: null
}
```

Stored under the `tasks.v2` key, with the theme under `tasks.theme`.

---

## Browser support

Works in current Chrome, Firefox, Safari and Edge. Uses `localStorage`,
`crypto.randomUUID()` (with a fallback), CSS custom properties, `color-mix()`
and `backdrop-filter`.

---

## License

MIT — see [LICENSE](LICENSE).
