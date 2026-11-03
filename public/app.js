const state = {
  user: null,
  projects: [],
  projectId: null,
  tasks: [],
  agents: [],
  dashboard: null,
  runs: [],
  recommendations: [],
  artifacts: []
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showToast(message, type = '') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`.trim();
  toast.textContent = message;
  $('#toast-stack').append(toast);
  setTimeout(() => toast.remove(), 4200);
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body = options.body;
  if (body && !(body instanceof FormData) && typeof body !== 'string') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const response = await fetch(url, { ...options, headers, body });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    if (response.status === 401) showAuth();
    const error = new Error(data?.error?.message || `Request failed (${response.status})`);
    error.code = data?.error?.code;
    error.details = data?.error?.details;
    throw error;
  }
  return data;
}

function showAuth() {
  $('#app-view').classList.add('hidden');
  $('#auth-view').classList.remove('hidden');
}

function showApp() {
  $('#auth-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatLatency(ms) {
  if (ms == null) return '—';
  const number = Number(ms);
  if (number < 1000) return `${number} ms`;
  return `${(number / 1000).toFixed(1)} s`;
}

function badge(status) {
  return `<span class="status ${escapeHtml(status)}">${escapeHtml(String(status).replaceAll('_', ' '))}</span>`;
}

function successRate(agent) {
  const total = Number(agent.total_runs || 0);
  if (!total) return 0;
  return Math.round((Number(agent.successful_runs || 0) / total) * 100);
}

function priorityRank(priority) {
  return { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }[priority] || 0;
}

function taskIsReady(task) {
  if (!['TODO', 'BLOCKED'].includes(task.status)) return false;
  return task.dependencies.every((dependency) => dependency.status === 'DONE');
}

function activeProject() {
  return state.projects.find((project) => Number(project.id) === Number(state.projectId));
}

async function init() {
  bindStaticEvents();
  try {
    const data = await api('/api/auth/me');
    state.user = data.user;
    await enterApp();
  } catch {
    showAuth();
  }
}

function bindStaticEvents() {
  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: {
          identifier: form.get('identifier'),
          password: form.get('password')
        }
      });
      state.user = data.user;
      await enterApp();
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  $('#register-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: {
          username: form.get('username'),
          email: form.get('email'),
          password: form.get('password')
        }
      });
      state.user = data.user;
      await enterApp();
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  $('#show-register').addEventListener('click', () => {
    $('#login-form').classList.add('hidden');
    $('#show-register').classList.add('hidden');
    $('#register-form').classList.remove('hidden');
  });

  $('#show-login').addEventListener('click', () => {
    $('#register-form').classList.add('hidden');
    $('#login-form').classList.remove('hidden');
    $('#show-register').classList.remove('hidden');
  });

  $('#logout-btn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    state.user = null;
    showAuth();
  });

  $('#refresh-btn').addEventListener('click', () => refreshProject());
  $('#run-next-btn').addEventListener('click', runNextAgent);
  $('#new-task-shortcut').addEventListener('click', runNextAgent);
  $('#new-project-btn').addEventListener('click', () => $('#project-dialog').showModal());

  $('#project-select').addEventListener('change', async (event) => {
    state.projectId = Number(event.target.value);
    await loadProject(state.projectId);
  });

  $('#project-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const data = await api('/api/projects', {
        method: 'POST',
        body: { name: form.get('name'), description: form.get('description') }
      });
      $('#project-dialog').close();
      event.currentTarget.reset();
      state.projectId = data.project.id;
      await loadProjects();
      showToast('Project created.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  $('#task-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const dependencySelect = $('#dependency-select');
    try {
      const data = await api(`/api/projects/${state.projectId}/tasks`, {
        method: 'POST',
        body: {
          title: form.get('title'),
          description: form.get('description'),
          required_role: form.get('required_role'),
          priority: form.get('priority'),
          estimated_hours: form.get('estimated_hours'),
          depends_on_ids: [...dependencySelect.selectedOptions].map((option) => Number(option.value))
        }
      });
      event.currentTarget.reset();
      await refreshProject();
      if (data.duplicate) {
        showToast(data.duplicate.reason, 'error');
      } else {
        showToast('Task created.', 'success');
      }
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  $('#agent-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api('/api/agents', {
        method: 'POST',
        body: {
          name: form.get('name'),
          role: form.get('role'),
          provider: form.get('provider'),
          execution_mode: form.get('execution_mode'),
          model_name: form.get('model_name')
        }
      });
      event.currentTarget.reset();
      $('input[name="model_name"]', event.currentTarget).value = 'mock-agent-v1';
      await refreshProject();
      showToast('Agent registered.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  $$('.view-tab').forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.view));
  });

  document.addEventListener('click', handleDelegatedClick);
  $('#close-artifact').addEventListener('click', () => $('#artifact-dialog').close());
}

async function enterApp() {
  showApp();
  $('#user-name').textContent = state.user.username;
  $('#user-role').textContent = state.user.role;
  $('#user-initial').textContent = state.user.username.slice(0, 1).toUpperCase();
  await loadProjects();
}

async function loadProjects() {
  const data = await api('/api/projects');
  state.projects = data.projects;
  const select = $('#project-select');
  select.innerHTML = state.projects
    .map((project) => `<option value="${project.id}">${escapeHtml(project.name)}</option>`)
    .join('');

  if (!state.projects.length) {
    state.projectId = null;
    state.tasks = [];
    state.agents = [];
    state.dashboard = null;
    state.runs = [];
    state.recommendations = [];
    state.artifacts = [];
    renderAll();
    return;
  }

  if (!state.projects.some((project) => Number(project.id) === Number(state.projectId))) {
    state.projectId = state.projects[0].id;
  }
  select.value = String(state.projectId);
  await loadProject(state.projectId);
}

async function loadProject(projectId) {
  if (!projectId) return;
  const previousProject = state.projectId;
  state.projectId = Number(projectId);
  try {
    const [tasks, agents, dashboard, runs, recommendations, artifacts] = await Promise.all([
      api(`/api/projects/${projectId}/tasks`),
      api('/api/agents'),
      api(`/api/projects/${projectId}/dashboard`),
      api(`/api/projects/${projectId}/runs`),
      api(`/api/projects/${projectId}/recommendations`),
      api(`/api/projects/${projectId}/artifacts`)
    ]);
    if (Number(state.projectId) !== Number(projectId)) return;
    state.tasks = tasks.tasks;
    state.agents = agents.agents;
    state.dashboard = dashboard;
    state.runs = runs.runs;
    state.recommendations = recommendations.recommendations;
    state.artifacts = artifacts.artifacts;
    renderAll();
  } catch (error) {
    state.projectId = previousProject;
    showToast(error.message, 'error');
  }
}

async function refreshProject() {
  if (state.projectId) await loadProject(state.projectId);
}

async function loadAgentsOnly() {
  const data = await api('/api/agents');
  state.agents = data.agents;
  renderAgents();
  renderFleet();
}

function switchView(view) {
  $$('.view-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $$('.view-section').forEach((section) => {
    section.classList.toggle('active', section.id === `view-${view}`);
  });
}

function renderAll() {
  const project = activeProject();
  if (project) {
    $('#project-title').textContent = project.name;
    $('#project-description').textContent = project.description || 'No project description yet.';
  } else {
    $('#project-title').textContent = 'No project yet';
    $('#project-description').textContent = 'Create a project to begin coordinating AI agents.';
  }

  $('#task-count-badge').textContent = state.tasks.length;
  renderDependencyOptions();
  renderStats();
  renderReadyTasks();
  renderFleet();
  renderRecentRuns();
  renderRecommendationsSummary();
  renderTasks();
  renderAgents();
  renderRuns();
  renderArtifacts();
  renderRecommendationLog();
}

function renderDependencyOptions() {
  const select = $('#dependency-select');
  const selected = new Set([...select.selectedOptions].map((option) => option.value));
  select.innerHTML = state.tasks
    .map((task) => `<option value="${task.id}">#${task.id} · ${escapeHtml(task.title)} [${escapeHtml(task.status)}]</option>`)
    .join('');
  [...select.options].forEach((option) => {
    option.selected = selected.has(option.value);
  });
}

function renderStats() {
  const stats = state.dashboard?.taskStats || {};
  const runStats = state.dashboard?.runStats || {};
  const availableAgents = state.agents.filter((agent) => agent.status === 'AVAILABLE').length;
  const totalAgents = state.agents.length;
  const success = Number(runStats.successful_runs || 0);
  const totalRuns = Number(runStats.total_runs || 0);
  const successPct = totalRuns ? Math.round((success / totalRuns) * 100) : 0;

  $('#stat-grid').innerHTML = `
    <article class="stat-card">
      <span>Tasks complete</span>
      <strong>${Number(stats.done || 0)} / ${Number(stats.total || 0)}</strong>
      <small>${Number(stats.review || 0)} waiting for review</small>
    </article>
    <article class="stat-card">
      <span>Agent fleet</span>
      <strong>${availableAgents} / ${totalAgents}</strong>
      <small>available specialists</small>
    </article>
    <article class="stat-card">
      <span>Execution success</span>
      <strong>${successPct}%</strong>
      <small>${success} successful of ${totalRuns} runs</small>
    </article>
    <article class="stat-card">
      <span>Avg latency</span>
      <strong>${formatLatency(runStats.avg_latency_ms)}</strong>
      <small>${Number(stats.blocked || 0)} tasks currently blocked</small>
    </article>
  `;
}

function renderReadyTasks() {
  const ready = state.tasks
    .filter(taskIsReady)
    .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority));
  const container = $('#ready-task-list');
  if (!ready.length) {
    container.innerHTML = `<div class="empty-state">No task is ready. Approve review tasks or resolve dependencies first.</div>`;
    return;
  }

  container.innerHTML = ready.slice(0, 4).map((task) => `
    <div class="ready-item">
      <div>
        <h3>${escapeHtml(task.title)}</h3>
        <p>#${task.id} · ${escapeHtml(task.required_role)} · ${escapeHtml(task.priority)} priority</p>
      </div>
      <div class="ready-item-actions">
        <button class="btn btn-accent btn-small" data-action="run-task" data-task-id="${task.id}">Run agent</button>
      </div>
    </div>
  `).join('');
}

function renderFleet() {
  const agents = [...state.agents].sort((a, b) => {
    if (a.status === b.status) return a.id - b.id;
    return a.status === 'AVAILABLE' ? -1 : 1;
  });
  $('#fleet-list').innerHTML = agents.length
    ? agents.slice(0, 4).map((agent) => {
        const rate = successRate(agent);
        return `
          <div class="fleet-item">
            <div class="fleet-item-head">
              <strong>${escapeHtml(agent.name)}</strong>
              ${badge(agent.status)}
            </div>
            <p>${escapeHtml(agent.role)} · ${escapeHtml(agent.execution_mode)}</p>
            <div class="mini-meter"><span style="width:${rate}%"></span></div>
            <p>${rate}% success · ${Number(agent.total_runs || 0)} runs</p>
          </div>
        `;
      }).join('')
    : `<div class="empty-state">No agents registered.</div>`;
}

function renderRecentRuns() {
  const runs = state.dashboard?.recentRuns || [];
  if (!runs.length) {
    $('#recent-runs').innerHTML = `<div class="empty-state">No agent runs yet.</div>`;
    return;
  }

  $('#recent-runs').innerHTML = `
    <table>
      <thead><tr><th>Agent</th><th>Task</th><th>Status</th><th>Latency</th></tr></thead>
      <tbody>
        ${runs.slice(0, 6).map((run) => `
          <tr>
            <td><strong>${escapeHtml(run.agent_name)}</strong><br><small>${escapeHtml(run.agent_role)}</small></td>
            <td>${escapeHtml(run.task_title)}</td>
            <td>${badge(run.status)}</td>
            <td>${formatLatency(run.latency_ms)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderRecommendationsSummary() {
  const items = state.recommendations.slice(0, 4);
  $('#recommendation-list').innerHTML = items.length
    ? items.map((item) => `
        <div class="signal-item ${item.recommendation_type === 'RISK' ? 'risk' : item.recommendation_type === 'DUPLICATE' ? 'duplicate' : ''}">
          <strong>${escapeHtml(item.recommendation_type)} · ${item.score == null ? '—' : Number(item.score).toFixed(1)}</strong>
          <p>${escapeHtml(item.reason || 'No reason recorded.')}</p>
        </div>
      `).join('')
    : `<div class="empty-state">AI recommendations appear here.</div>`;
}

function renderTasks() {
  const container = $('#task-list');
  if (!state.tasks.length) {
    container.innerHTML = `<div class="empty-state">No tasks yet. Create the first task on the left.</div>`;
    return;
  }

  container.innerHTML = state.tasks.map((task) => {
    const dependencies = task.dependencies || [];
    const assignments = task.assignments || [];
    const blocked = dependencies.some((dependency) => dependency.status !== 'DONE');
    const canRun = !['DONE', 'CANCELLED', 'IN_PROGRESS'].includes(task.status) && !blocked;
    const dependencyHtml = dependencies.length
      ? dependencies.map((dependency) => `
          <span class="meta-chip ${dependency.status === 'DONE' ? 'dependency-done' : 'dependency-blocked'}">
            ${dependency.status === 'DONE' ? '✓' : '⛔'} #${dependency.id} ${escapeHtml(dependency.title)}
          </span>
        `).join('')
      : '<span class="meta-chip">No dependencies</span>';
    const assignmentHtml = assignments.length
      ? assignments.map((assignment) => `<span class="meta-chip">${escapeHtml(assignment.name)} · ${escapeHtml(assignment.assignment_role)}</span>`).join('')
      : '<span class="meta-chip">Unassigned</span>';

    return `
      <article class="task-card">
        <div class="task-card-top">
          <div>
            <div class="task-title-row">
              <h3>${escapeHtml(task.title)}</h3>
              ${badge(task.status)}
              <span class="meta-chip">${escapeHtml(task.priority)}</span>
            </div>
            <p class="task-description">${escapeHtml(task.description || 'No description provided.')}</p>
          </div>
          <span class="meta-chip">#${task.id}</span>
        </div>
        <div class="task-meta">
          <span class="meta-chip">Role: ${escapeHtml(task.required_role)}</span>
          <span class="meta-chip">Estimate: ${task.estimated_hours == null ? '—' : Number(task.estimated_hours).toFixed(1)}h</span>
          ${dependencyHtml}
          ${assignmentHtml}
        </div>
        <div class="task-actions">
          <button class="btn btn-quiet btn-small" data-action="recommend-task" data-task-id="${task.id}">Recommend agent</button>
          <button class="btn btn-accent btn-small" data-action="run-task" data-task-id="${task.id}" ${canRun ? '' : 'disabled title="Resolve dependencies or finish the current run first"'}>Run agent</button>
          ${task.status === 'REVIEW' ? `<button class="btn btn-quiet btn-small" data-action="approve-task" data-task-id="${task.id}">Approve</button>` : ''}
          <button class="btn btn-danger btn-small" data-action="delete-task" data-task-id="${task.id}">Delete</button>
        </div>
      </article>
    `;
  }).join('');
}

function renderAgents() {
  const container = $('#agent-list');
  if (!state.agents.length) {
    container.innerHTML = `<div class="empty-state">No agents registered.</div>`;
    return;
  }

  container.innerHTML = state.agents.map((agent) => {
    const rate = successRate(agent);
    const canPause = agent.status === 'AVAILABLE';
    const canActivate = agent.status === 'OFFLINE';
    return `
      <article class="agent-card">
        <div class="agent-card-head">
          <div>
            <h3>${escapeHtml(agent.name)}</h3>
            <span class="role">${escapeHtml(agent.role)} · ${escapeHtml(agent.provider)} / ${escapeHtml(agent.execution_mode)}</span>
          </div>
          ${badge(agent.status)}
        </div>
        <div class="agent-stats">
          <div class="agent-stat"><strong>${Number(agent.total_runs || 0)}</strong><span>Runs</span></div>
          <div class="agent-stat"><strong>${rate}%</strong><span>Success</span></div>
          <div class="agent-stat"><strong>${formatLatency(agent.avg_latency_ms)}</strong><span>Avg time</span></div>
        </div>
        <div class="agent-footer">
          <small>${escapeHtml(agent.model_name || 'No model')} · last run ${formatDate(agent.last_run_at)}</small>
          ${canPause ? `<button class="btn btn-quiet btn-small" data-action="pause-agent" data-agent-id="${agent.id}">Pause</button>` : ''}
          ${canActivate ? `<button class="btn btn-quiet btn-small" data-action="activate-agent" data-agent-id="${agent.id}">Activate</button>` : ''}
        </div>
      </article>
    `;
  }).join('');
}

function renderRuns() {
  if (!state.runs.length) {
    $('#runs-table').innerHTML = `<div class="empty-state">No runs recorded yet.</div>`;
    return;
  }
  $('#runs-table').innerHTML = `
    <table>
      <thead><tr><th>Run</th><th>Agent</th><th>Task</th><th>Status</th><th>Started</th><th>Latency</th></tr></thead>
      <tbody>
        ${state.runs.map((run) => `
          <tr>
            <td>#${run.id}</td>
            <td><strong>${escapeHtml(run.agent_name)}</strong><br><small>${escapeHtml(run.agent_role)}</small></td>
            <td>${escapeHtml(run.task_title)}</td>
            <td>${badge(run.status)}</td>
            <td>${formatDate(run.started_at)}</td>
            <td>${formatLatency(run.latency_ms)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderArtifacts() {
  if (!state.artifacts.length) {
    $('#artifact-list').innerHTML = `<div class="empty-state">No artifacts yet.</div>`;
    return;
  }
  $('#artifact-list').innerHTML = state.artifacts.slice(0, 8).map((artifact) => `
    <div class="artifact-item">
      <div>
        <h4>${escapeHtml(artifact.file_name)}</h4>
        <p>${escapeHtml(artifact.artifact_type)} · ${escapeHtml(artifact.agent_name)} · ${escapeHtml(artifact.task_title)}</p>
      </div>
      <button class="btn btn-quiet btn-small" data-action="view-artifact" data-artifact-id="${artifact.id}">Open</button>
    </div>
  `).join('');
}

function renderRecommendationLog() {
  if (!state.recommendations.length) {
    $('#recommendation-log').innerHTML = `<div class="empty-state">No recommendations yet.</div>`;
    return;
  }
  $('#recommendation-log').innerHTML = state.recommendations.slice(0, 10).map((item) => `
    <div class="signal-item ${item.recommendation_type === 'RISK' ? 'risk' : item.recommendation_type === 'DUPLICATE' ? 'duplicate' : ''}">
      <strong>${escapeHtml(item.recommendation_type)} · ${item.score == null ? '—' : Number(item.score).toFixed(1)}</strong>
      <p>${escapeHtml(item.task_title)}<br>${escapeHtml(item.reason || 'No reason recorded.')}</p>
    </div>
  `).join('');
}

async function handleDelegatedClick(event) {
  const viewLink = event.target.closest('[data-view-link]');
  if (viewLink) {
    switchView(viewLink.dataset.viewLink);
    return;
  }

  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const taskId = Number(button.dataset.taskId);
  const agentId = Number(button.dataset.agentId);
  const artifactId = Number(button.dataset.artifactId);

  try {
    if (button.dataset.action === 'run-task') {
      button.disabled = true;
      button.textContent = 'Running...';
      const result = await api(`/api/tasks/${taskId}/run`, { method: 'POST', body: {} });
      showToast(`${result.run.agent.name} produced ${result.artifact.fileName}.`, 'success');
      await refreshProject();
    }

    if (button.dataset.action === 'recommend-task') {
      button.disabled = true;
      button.textContent = 'Scoring...';
      const result = await api(`/api/tasks/${taskId}/recommend`, { method: 'POST', body: {} });
      showToast(`Recommended ${result.best.name}: ${result.best.score.toFixed(1)} / 100.`, 'success');
      await refreshProject();
    }

    if (button.dataset.action === 'approve-task') {
      await api(`/api/tasks/${taskId}/approve`, { method: 'POST', body: {} });
      showToast('Task approved and marked done.', 'success');
      await refreshProject();
    }

    if (button.dataset.action === 'delete-task') {
      if (!window.confirm('Delete this task and its run history?')) return;
      await api(`/api/tasks/${taskId}`, { method: 'DELETE' });
      showToast('Task deleted.', 'success');
      await refreshProject();
    }

    if (button.dataset.action === 'pause-agent') {
      await api(`/api/agents/${agentId}`, { method: 'PATCH', body: { status: 'OFFLINE' } });
      await loadAgentsOnly();
      showToast('Agent paused.', 'success');
    }

    if (button.dataset.action === 'activate-agent') {
      await api(`/api/agents/${agentId}`, { method: 'PATCH', body: { status: 'AVAILABLE' } });
      await loadAgentsOnly();
      showToast('Agent activated.', 'success');
    }

    if (button.dataset.action === 'view-artifact') {
      const artifact = state.artifacts.find((item) => Number(item.id) === artifactId);
      if (artifact) {
        $('#artifact-title').textContent = artifact.file_name;
        $('#artifact-content').textContent = artifact.content || 'No content stored for this artifact.';
        $('#artifact-dialog').showModal();
      }
    }
  } catch (error) {
    button.disabled = false;
    showToast(error.message, 'error');
  }
}

async function runNextAgent() {
  if (!state.projectId) {
    showToast('Create a project first.', 'error');
    return;
  }
  const button = $('#run-next-btn');
  button.disabled = true;
  button.textContent = 'Orchestrating...';
  try {
    const result = await api(`/api/projects/${state.projectId}/run-next`, { method: 'POST', body: {} });
    showToast(`${result.run.agent.name} ran "${result.task.title}".`, 'success');
    await refreshProject();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Run next agent';
  }
}

init();
