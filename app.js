const APP_VERSION = 'v1.2.1';
const TABLE_NAME = 'taskroom_workspaces';
const config = window.LINK_DECK_CONFIG;
const db = window.supabase?.createClient(config.supabaseUrl, config.supabasePublishableKey);
const today = new Date();
const formatDate = (date) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(date));
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);

const defaultData = { tasks: [], selectedId: null, logs: [], docs: [] };
let data = { ...defaultData };
let activeView = 'items';
let categoryFilter = 'all';
let currentUser = null;
let loadedUserId = null;
let syncQueue = Promise.resolve();

const setSyncStatus = (message) => { document.querySelector('#sync-status').textContent = message; };
const normalizeWorkspace = (value) => ({
  tasks: Array.isArray(value?.tasks) ? value.tasks : [],
  selectedId: null,
  logs: Array.isArray(value?.logs) ? value.logs : [],
  docs: Array.isArray(value?.docs) ? value.docs : []
});
const save = () => {
  if (!currentUser) return;
  const snapshot = JSON.parse(JSON.stringify(data));
  setSyncStatus('Saving…');
  syncQueue = syncQueue.catch(() => {}).then(async () => {
    const { error } = await db.from(TABLE_NAME).upsert({ user_id: currentUser.id, data: snapshot, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
    setSyncStatus('Synced');
  }).catch((error) => { setSyncStatus('Sync error'); console.error('Taskroom sync failed:', error); });
};
const selectedTask = () => data.tasks.find((task) => task.id === data.selectedId);
const logEvent = (message, taskId = data.selectedId, manual = false) => {
  data.logs.unshift({ id: uid(), taskId, message, manual, date: new Date().toISOString() });
};
const isAutomaticLog = (message = '') => /^(Created this (item|task)\.|Added task |Updated task |Updated item details\.|Marked this item complete\.|Reopened this item\.|Added document |Added a new document\.|Updated document |Deleted a document\.)/.test(message);

async function loadWorkspace() {
  setSyncStatus('Loading…');
  const { data: row, error } = await db.from(TABLE_NAME).select('data').eq('user_id', currentUser.id).maybeSingle();
  if (error) throw error;
  data = normalizeWorkspace(row?.data);
  activeView = 'items';
  categoryFilter = 'all';
  if (!row) {
    const { error: createError } = await db.from(TABLE_NAME).insert({ user_id: currentUser.id, data });
    if (createError) throw createError;
  }
  setSyncStatus('Synced');
  render();
}

async function applySession(session) {
  const user = session?.user || null;
  if (!user) {
    currentUser = null;
    loadedUserId = null;
    data = { ...defaultData };
    document.querySelector('#user-email').hidden = true;
    document.querySelector('#sign-out-button').hidden = true;
    setSyncStatus('Signed out');
    render();
    const dialog = document.querySelector('#auth-dialog');
    if (!dialog.open) dialog.showModal();
    return;
  }
  if (loadedUserId === user.id) return;
  loadedUserId = user.id;
  currentUser = user;
  document.querySelector('#user-email').textContent = user.email;
  document.querySelector('#user-email').hidden = false;
  document.querySelector('#sign-out-button').hidden = false;
  const dialog = document.querySelector('#auth-dialog');
  if (dialog.open) dialog.close();
  try { await loadWorkspace(); }
  catch (error) { loadedUserId = null; setSyncStatus('Setup required'); console.error('Taskroom load failed:', error); alert(`Taskroom could not load from Supabase. Run supabase-schema.sql in the Supabase SQL Editor first.\n\n${error.message}`); }
}

function render() {
  const itemTasks = selectedTask()?.subtasks || [];
  const open = data.tasks.filter((item) => !item.done).length;
  const done = data.tasks.filter((item) => item.done).length;
  document.querySelector('#open-count').textContent = open;
  document.querySelector('#done-count').textContent = done;
  document.querySelector('#task-count').textContent = itemTasks.length;
  renderCategoryFilter(); renderTasks(); renderItemNotes(); renderItemTasks(); renderLog(); renderDocs();
}

const taskCategory = (task) => task.category || task.tag || 'General';
const sortItems = (items) => {
  const priorityRank = { High: 0, Medium: 1, Low: 2 };
  return [...items].sort((a, b) => {
    const priorityDifference = (priorityRank[a.priority || 'Medium'] ?? 1) - (priorityRank[b.priority || 'Medium'] ?? 1);
    if (priorityDifference) return priorityDifference;
    if (a.due && b.due) return a.due.localeCompare(b.due);
    if (a.due) return -1;
    if (b.due) return 1;
    return a.title.localeCompare(b.title);
  });
};

function renderCategoryFilter() {
  const select = document.querySelector('#category-filter');
  const categories = [...new Set(data.tasks.map(taskCategory))].sort((a, b) => a.localeCompare(b));
  if (categoryFilter !== 'all' && !categories.includes(categoryFilter)) categoryFilter = 'all';
  select.innerHTML = `<option value="all">All</option>${categories.map((category) => `<option value="${escapeAttribute(category)}" ${category === categoryFilter ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}`;
}

function renderTasks() {
  const list = document.querySelector('#task-list');
  if (!data.tasks.length) { list.innerHTML = '<div class="empty-state">No items yet.<br>Add an item to get started.</div>'; return; }
  const selected = selectedTask();
  const tasks = selected ? [selected] : sortItems(categoryFilter === 'all' ? data.tasks : data.tasks.filter((task) => taskCategory(task) === categoryFilter));
  if (!tasks.length) { list.innerHTML = '<div class="empty-state">No items in this category.</div>'; return; }
  list.innerHTML = tasks.map((task) => `<div class="task-row ${task.id === data.selectedId ? 'selected' : ''} ${task.done ? 'completed' : ''}" data-id="${task.id}">
    <button class="check ${task.done ? 'done' : ''}" data-action="toggle" aria-label="Mark ${escapeHtml(task.title)} ${task.done ? 'open' : 'complete'}">${task.done ? '✓' : ''}</button>
    <div class="task-info"><button class="task-title" data-action="select"><span class="task-name">${escapeHtml(task.title)}</span><span class="task-meta"><span class="category">${escapeHtml(taskCategory(task))}</span><span class="priority priority-${escapeAttribute((task.priority || 'Medium').toLowerCase())}">${escapeHtml(task.priority || 'Medium')} priority</span></span></button>${task.id === data.selectedId ? '<div class="item-row-menu"><button data-item-view="log">Log</button><button data-item-view="tasks">Tasks</button><button data-item-view="docs">Docs</button><button data-action="edit">Edit</button><button data-action="delete">Delete</button></div>' : ''}</div>
  </div>`).join('');
}

function renderItemNotes() {
  const panel = document.querySelector('#item-notes-panel');
  panel.hidden = activeView !== 'notes';
  if (panel.hidden) { panel.innerHTML = ''; return; }
  const item = selectedTask();
  if (!item) { panel.innerHTML = ''; return; }
  const initialHtml = sanitizeDocHtml(item.descriptionHtml || escapeHtml(item.description || '').replace(/\n/g, '<br>'));
  panel.innerHTML = `<form id="item-notes-form"><div class="editor-toolbar" role="toolbar" aria-label="Item notes formatting"><button type="button" data-item-format="bold"><strong>B</strong></button><button type="button" data-item-format="underline"><u>U</u></button><label>Size <select data-item-format-select="fontSize"><option value="2">Small</option><option value="3" selected>Normal</option><option value="5">Large</option><option value="6">Extra large</option></select></label><label>Font <select data-item-format-select="fontName"><option value="Manrope">Manrope</option><option value="Arial">Arial</option><option value="Georgia">Georgia</option><option value="Courier New">Courier</option></select></label></div><div id="item-notes-editor" class="doc-editor item-notes-editor" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Add notes for this item...">${initialHtml}</div><div class="item-notes-actions"><button class="primary-button" type="submit">Save notes</button></div></form>`;
  const editor = panel.querySelector('#item-notes-editor');
  panel.querySelectorAll('[data-item-format]').forEach((button) => button.addEventListener('click', () => { editor.focus(); document.execCommand(button.dataset.itemFormat, false); }));
  panel.querySelectorAll('[data-item-format-select]').forEach((select) => select.addEventListener('change', () => { editor.focus(); document.execCommand(select.dataset.itemFormatSelect, false, select.value); }));
  panel.querySelector('#item-notes-form').addEventListener('submit', (event) => { event.preventDefault(); item.descriptionHtml = sanitizeDocHtml(editor.innerHTML); item.description = editor.innerText; save(); });
}

function renderItemTasks() {
  const panel = document.querySelector('#item-tasks-panel');
  panel.hidden = activeView !== 'tasks';
  if (panel.hidden) { panel.innerHTML = ''; return; }
  const item = selectedTask();
  if (!item) { panel.innerHTML = '<div class="selected-item-empty">Select an item to see its tasks.</div>'; return; }
  item.subtasks ||= [];
  panel.innerHTML = `<div class="selected-item-heading"><div><span class="eyebrow">Tasks for</span><strong>${escapeHtml(item.title)}</strong></div><span class="mono">${item.subtasks.filter((entry) => !entry.done).length} open</span></div><form class="quick-add selected-task-add" id="selected-task-form"><input name="title" required placeholder="Add a task for this item"><button type="submit">Add task</button></form><div class="workspace-list">${item.subtasks.length ? item.subtasks.map((entry) => `<div class="workspace-row item-subtask-row"><button type="button" class="mini-check ${entry.done ? 'done' : ''}" data-main-subtask-toggle="${entry.id}">${entry.done ? '✓' : ''}</button><button type="button" class="subtask-title ${entry.done ? 'is-done' : ''}" data-main-subtask-edit="${entry.id}">${escapeHtml(entry.title)}</button><span class="subtask-actions"><button type="button" data-main-subtask-edit="${entry.id}">Edit</button><button type="button" data-main-subtask-delete="${entry.id}">Delete</button></span></div>`).join('') : '<p class="workspace-empty">No tasks for this item yet.</p>'}</div>`;
  panel.querySelector('#selected-task-form').addEventListener('submit', (event) => { event.preventDefault(); const title = new FormData(event.currentTarget).get('title').trim(); if (!title) return; item.subtasks.push({ id: uid(), title, notes: '', done: false }); save(); render(); });
  panel.querySelectorAll('[data-main-subtask-toggle]').forEach((button) => button.addEventListener('click', () => { const entry = item.subtasks.find((candidate) => candidate.id === button.dataset.mainSubtaskToggle); entry.done = !entry.done; save(); render(); }));
  panel.querySelectorAll('[data-main-subtask-edit]').forEach((button) => button.addEventListener('click', () => { const entry = item.subtasks.find((candidate) => candidate.id === button.dataset.mainSubtaskEdit); openSubtaskModal(item, entry); }));
  panel.querySelectorAll('[data-main-subtask-delete]').forEach((button) => button.addEventListener('click', () => { item.subtasks = item.subtasks.filter((entry) => entry.id !== button.dataset.mainSubtaskDelete); save(); render(); }));
}

function openSubtaskModal(item, entry) {
  document.querySelector('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal"><form id="subtask-edit-form"><h3>Edit task</h3><div class="form-field"><label for="subtask-title">Task</label><input id="subtask-title" name="title" required value="${escapeAttribute(entry.title)}"></div><div class="form-field"><label for="subtask-notes">Notes</label><textarea id="subtask-notes" name="notes" placeholder="Add notes for this task...">${escapeHtml(entry.notes || '')}</textarea></div><div class="modal-actions"><button type="button" class="text-button" data-close>Cancel</button><button type="submit" class="primary-button">Save task</button></div></form></div></div>`;
  document.querySelector('#subtask-title').focus();
  document.querySelector('#subtask-edit-form').addEventListener('submit', (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); Object.assign(entry, values); closeModal(); save(); render(); });
}

function renderLog() {
  const content = document.querySelector('#log-content'); const task = selectedTask();
  content.hidden = activeView !== 'log';
  if (content.hidden) { content.innerHTML = ''; return; }
  if (!task) { content.innerHTML = '<div class="empty-state">Select an item first to see its activity log.</div>'; return; }
  const logs = data.logs.filter((entry) => entry.taskId === task.id && (entry.manual === true || !isAutomaticLog(entry.message)));
  content.innerHTML = `<div class="selected-item-heading"><div><span class="eyebrow">Log for</span><strong>${escapeHtml(task.title)}</strong></div><span class="mono">${logs.length} entries</span></div><form class="quick-add selected-task-add" id="main-log-form"><input name="message" required placeholder="Add a log entry"><button type="submit">Add entry</button></form>${logs.length ? logs.map((entry) => `<article class="log-card"><time class="log-time">${formatDate(entry.date)}<br>${new Date(entry.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><p class="log-message">${escapeHtml(entry.message)}</p></article>`).join('') : '<div class="empty-state">No activity recorded yet.</div>'}`;
  content.querySelector('#main-log-form').addEventListener('submit', (event) => { event.preventDefault(); const message = new FormData(event.currentTarget).get('message').trim(); if (!message) return; logEvent(message, task.id, true); save(); render(); });
}

function renderDocs() {
  const content = document.querySelector('#docs-content'); const task = selectedTask();
  content.hidden = activeView !== 'docs';
  if (content.hidden) { content.innerHTML = ''; return; }
  if (!task) { content.innerHTML = '<div class="empty-state">Select an item first to see its documents.</div>'; return; }
  const docs = data.docs.filter((doc) => doc.taskId === task.id);
  content.innerHTML = `<div class="selected-item-heading"><div><span class="eyebrow">Documents for</span><strong>${escapeHtml(task.title)}</strong></div><button class="primary-button compact-button" data-new-doc><span>＋</span> New doc</button></div>${docs.length ? `<div class="doc-grid">${docs.map((doc) => `<article class="doc-card" data-doc-id="${doc.id}"><div class="doc-tools"><span class="eyebrow">Note</span><span><button data-doc-action="edit" data-id="${doc.id}">Edit</button> · <button data-doc-action="delete" data-id="${doc.id}">Delete</button></span></div><h3>${escapeHtml(doc.title)}</h3><div class="doc-preview">${sanitizeDocHtml(doc.bodyHtml || escapeHtml(doc.body || '').replace(/\n/g, '<br>'))}</div></article>`).join('')}</div>` : '<div class="empty-state">No documents for this item yet.</div>'}`;
}

function openTaskModal(task = null) {
  document.querySelector('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal"><form id="task-form"><h3>${task ? 'Edit item' : 'New item'}</h3><div class="form-field"><label for="task-title">Item name</label><input id="task-title" name="title" required value="${task ? escapeAttribute(task.title) : ''}" placeholder="What is this item?"></div><div class="form-field"><label for="task-description">Notes</label><textarea id="task-description" name="description" placeholder="A little context...">${task ? escapeHtml(task.description || '') : ''}</textarea></div><div class="form-row"><div class="form-field"><label for="task-category">Category</label><input id="task-category" name="category" value="${task ? escapeAttribute(taskCategory(task)) : 'General'}" placeholder="Work, admin, personal..."></div><div class="form-field"><label for="task-priority">Priority</label><select id="task-priority" name="priority"><option value="Low" ${task?.priority === 'Low' ? 'selected' : ''}>Low</option><option value="Medium" ${!task?.priority || task.priority === 'Medium' ? 'selected' : ''}>Medium</option><option value="High" ${task?.priority === 'High' ? 'selected' : ''}>High</option></select></div></div><div class="form-field"><label for="task-due">Due date</label><input id="task-due" name="due" type="date" value="${task ? (task.due || '') : ''}"></div><div class="modal-actions">${task ? '<button type="button" class="text-button delete modal-delete" data-delete-task>Delete item</button>' : ''}<span class="modal-spacer"></span><button type="button" class="text-button" data-close>Cancel</button><button class="primary-button" type="submit">${task ? 'Save item' : 'Add item'}</button></div></form></div></div>`;
  document.querySelector('#task-title').focus();
document.querySelector('#task-form').addEventListener('submit', (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const values = Object.fromEntries(form); values.category = values.category.trim() || 'General'; if (task) { Object.assign(task, values); delete task.tag; } else { const newTask = { id: uid(), ...values, priority: values.priority || 'Medium', done: false, subtasks: [] }; data.tasks.unshift(newTask); data.selectedId = null; } closeModal(); save(); render(); if (!task) { switchView('items'); window.scrollTo(0, 0); } });
}

function renderItemWorkspace(item) {
  item.subtasks ||= [];
  const logs = data.logs.filter((entry) => entry.taskId === item.id);
  const docs = data.docs.filter((doc) => doc.taskId === item.id);
  const workspace = document.querySelector('#item-workspace');
  workspace.innerHTML = `<div class="workspace-grid"><section class="workspace-section"><div class="workspace-heading"><span>Tasks</span><span class="mono">${item.subtasks.filter((entry) => !entry.done).length} open</span></div><form class="quick-add" id="subtask-form"><input name="title" required placeholder="Add a task"><button type="submit">Add</button></form><div class="workspace-list">${item.subtasks.length ? item.subtasks.map((entry) => `<div class="workspace-row"><button type="button" class="mini-check ${entry.done ? 'done' : ''}" data-subtask-toggle="${entry.id}">${entry.done ? '✓' : ''}</button><span class="${entry.done ? 'is-done' : ''}">${escapeHtml(entry.title)}</span><button type="button" class="row-delete" data-subtask-delete="${entry.id}" aria-label="Delete task">×</button></div>`).join('') : '<p class="workspace-empty">No tasks for this item.</p>'}</div></section><section class="workspace-section"><div class="workspace-heading"><span>Log</span><span class="mono">${logs.length} entries</span></div><form class="quick-add" id="log-entry-form"><input name="message" required placeholder="Add a log entry"><button type="submit">Add</button></form><div class="workspace-list">${logs.length ? logs.map((entry) => `<div class="workspace-entry"><time>${formatDate(entry.date)}</time><span>${escapeHtml(entry.message)}</span></div>`).join('') : '<p class="workspace-empty">No log entries yet.</p>'}</div></section><section class="workspace-section workspace-docs"><div class="workspace-heading"><span>Documents</span><span class="mono">${docs.length} docs</span></div><form class="doc-quick-add" id="workspace-doc-form"><input name="title" required placeholder="Document title"><textarea name="body" required placeholder="Document content"></textarea><button type="submit">Create document</button></form><div class="workspace-list">${docs.length ? docs.map((doc) => `<div class="workspace-entry"><strong>${escapeHtml(doc.title)}</strong><span>${escapeHtml(doc.body)}</span><button type="button" class="row-delete" data-workspace-doc-delete="${doc.id}" aria-label="Delete document">×</button></div>`).join('') : '<p class="workspace-empty">No documents yet.</p>'}</div></section></div>`;
  workspace.querySelector('#subtask-form').addEventListener('submit', (event) => { event.preventDefault(); const title = new FormData(event.currentTarget).get('title').trim(); if (!title) return; item.subtasks.push({ id: uid(), title, done: false }); save(); renderItemWorkspace(item); });
  workspace.querySelector('#log-entry-form').addEventListener('submit', (event) => { event.preventDefault(); const message = new FormData(event.currentTarget).get('message').trim(); if (!message) return; logEvent(message, item.id, true); save(); renderLog(); renderItemWorkspace(item); });
  workspace.querySelector('#workspace-doc-form').addEventListener('submit', (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); data.docs.unshift({ id: uid(), taskId: item.id, ...values }); save(); renderDocs(); renderItemWorkspace(item); });
  workspace.querySelectorAll('[data-subtask-toggle]').forEach((button) => button.addEventListener('click', () => { const entry = item.subtasks.find((candidate) => candidate.id === button.dataset.subtaskToggle); entry.done = !entry.done; save(); renderItemWorkspace(item); }));
  workspace.querySelectorAll('[data-subtask-delete]').forEach((button) => button.addEventListener('click', () => { item.subtasks = item.subtasks.filter((entry) => entry.id !== button.dataset.subtaskDelete); save(); renderItemWorkspace(item); }));
  workspace.querySelectorAll('[data-workspace-doc-delete]').forEach((button) => button.addEventListener('click', () => { data.docs = data.docs.filter((doc) => doc.id !== button.dataset.workspaceDocDelete); save(); renderDocs(); renderItemWorkspace(item); }));
}

function deleteTask(task) {
  if (!confirm('Delete this item and everything attached to it?')) return;
  data.tasks = data.tasks.filter((item) => item.id !== task.id);
  data.docs = data.docs.filter((doc) => doc.taskId !== task.id);
  data.logs = data.logs.filter((entry) => entry.taskId !== task.id);
  data.selectedId = null;
  closeModal(); save(); switchView('items');
}

function openDocModal(doc = null) {
  if (!selectedTask()) { switchView('tasks'); return; }
  const initialHtml = doc ? sanitizeDocHtml(doc.bodyHtml || escapeHtml(doc.body || '').replace(/\n/g, '<br>')) : '';
  document.querySelector('#modal-root').innerHTML = `<div class="modal-backdrop"><form class="modal doc-editor-modal" id="doc-form"><h3>${doc ? 'Edit document' : 'New document'}</h3><div class="form-field"><label for="doc-title">Title</label><input id="doc-title" name="title" required value="${doc ? escapeAttribute(doc.title) : ''}" placeholder="Project brief"></div><div class="form-field"><label>Content</label><div class="editor-toolbar" role="toolbar" aria-label="Document formatting"><button type="button" data-format="bold"><strong>B</strong></button><button type="button" data-format="underline"><u>U</u></button><label>Size <select data-format-select="fontSize"><option value="2">Small</option><option value="3" selected>Normal</option><option value="5">Large</option><option value="6">Extra large</option></select></label><label>Font <select data-format-select="fontName"><option value="Manrope">Manrope</option><option value="Arial">Arial</option><option value="Georgia">Georgia</option><option value="Courier New">Courier</option></select></label></div><div id="doc-editor" class="doc-editor" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Write something useful...">${initialHtml}</div></div><div class="modal-actions"><button type="button" class="text-button" data-close>Cancel</button><button class="primary-button" type="submit">${doc ? 'Save changes' : 'Add document'}</button></div></form></div>`;
  document.querySelector('#doc-title').focus();
  const editor = document.querySelector('#doc-editor');
  document.querySelectorAll('[data-format]').forEach((button) => button.addEventListener('click', () => { editor.focus(); document.execCommand(button.dataset.format, false); }));
  document.querySelectorAll('[data-format-select]').forEach((select) => select.addEventListener('change', () => { editor.focus(); document.execCommand(select.dataset.formatSelect, false, select.value); }));
  document.querySelector('#doc-form').addEventListener('submit', (event) => { event.preventDefault(); const title = document.querySelector('#doc-title').value.trim(); const bodyHtml = sanitizeDocHtml(editor.innerHTML); if (!title || !editor.textContent.trim()) return; const values = { title, bodyHtml, body: editor.innerText }; if (doc) { Object.assign(doc, values); } else { data.docs.unshift({ id: uid(), taskId: data.selectedId, ...values }); } closeModal(); save(); render(); });
}

function closeModal() { document.querySelector('#modal-root').innerHTML = ''; }
function switchView(view) { activeView = view; document.querySelector('#items-view').classList.add('active-view'); document.querySelectorAll('[data-view="items"]').forEach((element) => element.classList.toggle('active', true)); render(); }
function escapeHtml(value = '') { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
function escapeAttribute(value = '') { return escapeHtml(value).replace(/"/g, '&quot;'); }
function sanitizeDocHtml(html = '') { const template = document.createElement('template'); template.innerHTML = html; const allowed = new Set(['B', 'STRONG', 'U', 'FONT', 'DIV', 'P', 'BR']); template.content.querySelectorAll('*').forEach((element) => { if (!allowed.has(element.tagName)) { element.replaceWith(...element.childNodes); return; } [...element.attributes].forEach((attribute) => { if (element.tagName === 'FONT' && ['face', 'size'].includes(attribute.name.toLowerCase())) return; element.removeAttribute(attribute.name); }); }); return template.innerHTML; }

window.addEventListener('click', (event) => {
  const nav = event.target.closest('[data-view]'); if (nav) { if (nav.dataset.view === 'items') { data.selectedId = null; save(); } switchView(nav.dataset.view); return; }
  if (event.target.matches('[data-close], .modal-backdrop')) { closeModal(); return; }
  if (event.target.matches('[data-delete-task]')) { deleteTask(selectedTask()); return; }
  const row = event.target.closest('.task-row'); if (row) { const task = data.tasks.find((item) => item.id === row.dataset.id); const itemView = event.target.closest('[data-item-view]'); if (event.target.closest('[data-action="toggle"]')) { data.selectedId = task.id; task.done = !task.done; save(); render(); } else if (itemView) { switchView(itemView.dataset.itemView); } else if (event.target.closest('[data-action="edit"]')) { data.selectedId = task.id; render(); openTaskModal(task); } else if (event.target.closest('[data-action="delete"]')) { deleteTask(task); } else { data.selectedId = task.id; save(); switchView('notes'); } return; }
  const docAction = event.target.dataset.docAction; if (docAction) { const doc = data.docs.find((item) => item.id === event.target.dataset.id); if (docAction === 'edit') openDocModal(doc); if (docAction === 'delete' && confirm('Delete this document?')) { data.docs = data.docs.filter((item) => item.id !== doc.id); save(); render(); } return; }
  const docCard = event.target.closest('[data-doc-id]'); if (docCard) { openDocModal(data.docs.find((doc) => doc.id === docCard.dataset.docId)); return; }
  if (event.target.closest('[data-new-doc]')) openDocModal();
});
document.querySelector('#new-task-button').addEventListener('click', () => openTaskModal());
document.querySelector('#category-filter').addEventListener('change', (event) => { categoryFilter = event.target.value; renderTasks(); });
document.querySelector('#clear-data').addEventListener('click', () => { if (confirm('Clear all items, tasks, logs, and documents from your Taskroom account?')) { data = { ...defaultData }; save(); render(); } });
document.querySelector('#app-version').textContent = APP_VERSION;
const authDialog = document.querySelector('#auth-dialog');
authDialog.addEventListener('cancel', (event) => event.preventDefault());
if (!authDialog.open) authDialog.showModal();
document.querySelector('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.querySelector('#sign-in-button');
  const message = document.querySelector('#auth-message');
  if (!db) { message.textContent = 'Could not load the secure sign-in service. Check your connection and reload.'; return; }
  button.disabled = true;
  message.textContent = 'Signing in…';
  const { error } = await db.auth.signInWithPassword({ email: document.querySelector('#auth-email').value.trim(), password: document.querySelector('#auth-password').value });
  button.disabled = false;
  message.textContent = error ? error.message : '';
});
document.querySelector('#sign-up-button').addEventListener('click', async () => {
  const form = document.querySelector('#auth-form');
  if (!form.reportValidity()) return;
  const button = document.querySelector('#sign-up-button');
  const message = document.querySelector('#auth-message');
  if (!db) { message.textContent = 'Could not load the secure sign-in service. Check your connection and reload.'; return; }
  button.disabled = true;
  message.textContent = 'Creating account…';
  const emailRedirectTo = `${window.location.origin}${window.location.pathname}`;
  const { data: authData, error } = await db.auth.signUp({ email: document.querySelector('#auth-email').value.trim(), password: document.querySelector('#auth-password').value, options: { emailRedirectTo } });
  button.disabled = false;
  message.textContent = error ? error.message : (authData.session ? '' : 'Check your email to confirm your account, then sign in.');
});
document.querySelector('#sign-out-button').addEventListener('click', () => db?.auth.signOut());

render();
if (db) {
  db.auth.onAuthStateChange((_event, session) => setTimeout(() => applySession(session), 0));
  db.auth.getSession().then(({ data: sessionData }) => applySession(sessionData.session)).catch((error) => {
    setSyncStatus('Connection error');
    document.querySelector('#auth-message').textContent = error.message;
  });
} else {
  setSyncStatus('Connection error');
  document.querySelector('#auth-message').textContent = 'Could not load the secure sign-in service. Check your connection and reload.';
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch((error) => console.error('Service worker registration failed:', error)));
}
// Force installed PWAs to check for and activate the latest app shell on launch.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' });
      await registration.update();
    } catch (error) {
      console.error('PWA update check failed', error);
    }
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (sessionStorage.getItem('taskroom-worker-reloaded')) return;
    sessionStorage.setItem('taskroom-worker-reloaded', 'true');
    window.location.reload();
  });
}
