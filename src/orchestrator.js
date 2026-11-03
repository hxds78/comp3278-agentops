const pool = require('./db');
const { runAgent } = require('./agent-runtime');

class AppError extends Error {
  constructor(status, message, code = 'APP_ERROR', details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function normalizeText(value) {
  return String(value || '').toLowerCase().normalize('NFKC');
}

function tokenize(value) {
  const chunks = normalizeText(value).match(/[\p{L}\p{N}]+/gu) || [];
  const tokens = new Set();

  for (const chunk of chunks) {
    tokens.add(chunk);
    if (/[\u3400-\u9fff]/.test(chunk) && chunk.length > 1) {
      for (let index = 0; index < chunk.length - 1; index += 1) {
        tokens.add(chunk.slice(index, index + 2));
      }
    }
  }

  return tokens;
}

function jaccardSimilarity(left, right) {
  const a = tokenize(left);
  const b = tokenize(right);
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

async function getTaskContext(taskId, executor = pool) {
  const [rows] = await executor.execute(
    `SELECT
       t.*,
       p.name AS project_name,
       p.description AS project_description,
       p.owner_id
     FROM tasks t
     JOIN projects p ON p.id = t.project_id
     WHERE t.id = ?`,
    [taskId]
  );

  if (!rows.length) throw new AppError(404, 'Task not found.', 'TASK_NOT_FOUND');
  return rows[0];
}

async function getBlockingDependencies(taskId, executor = pool) {
  const [rows] = await executor.execute(
    `SELECT dep.id, dep.title, dep.status
     FROM task_dependencies td
     JOIN tasks dep ON dep.id = td.depends_on_task_id
     WHERE td.task_id = ?
       AND dep.status <> 'DONE'
     ORDER BY dep.id`,
    [taskId]
  );
  return rows;
}

async function findDuplicateTask(taskId, projectId) {
  const [taskRows] = await pool.execute(
    'SELECT id, title, description FROM tasks WHERE id = ?',
    [taskId]
  );
  if (!taskRows.length) return null;

  const [otherTasks] = await pool.execute(
    'SELECT id, title, description FROM tasks WHERE project_id = ? AND id <> ?',
    [projectId, taskId]
  );

  const source = `${taskRows[0].title} ${taskRows[0].description || ''}`;
  let best = null;

  for (const other of otherTasks) {
    const score = jaccardSimilarity(source, `${other.title} ${other.description || ''}`);
    if (!best || score > best.score) best = { ...other, score };
  }

  if (best && best.score >= 0.42) {
    const percentage = Number((best.score * 100).toFixed(2));
    const reason = `Possible duplicate of task #${best.id} "${best.title}" (${percentage}% similarity).`;
    const [result] = await pool.execute(
      `INSERT INTO ai_recommendations
         (task_id, recommendation_type, recommended_agent_id, score, reason, accepted)
       VALUES (?, 'DUPLICATE', NULL, ?, ?, NULL)`,
      [taskId, percentage, reason]
    );
    return { id: result.insertId, taskId: best.id, title: best.title, score: percentage, reason };
  }

  return null;
}

async function scoreAgents(task) {
  const [agents] = await pool.execute(
    `SELECT
       a.*,
       COUNT(r.id) AS total_runs,
       SUM(CASE WHEN r.status = 'SUCCESS' THEN 1 ELSE 0 END) AS successful_runs,
       SUM(CASE WHEN r.status = 'RUNNING' THEN 1 ELSE 0 END) AS running_runs
     FROM agents a
     LEFT JOIN agent_runs r ON r.agent_id = a.id
     WHERE a.role = ?
     GROUP BY a.id
     ORDER BY a.id`,
    [task.required_role]
  );

  return agents
    .filter((agent) => agent.status === 'AVAILABLE')
    .map((agent) => {
      const totalRuns = Number(agent.total_runs || 0);
      const successfulRuns = Number(agent.successful_runs || 0);
      const successRate = totalRuns === 0 ? 0.65 : successfulRuns / totalRuns;
      const availabilityBonus = agent.status === 'AVAILABLE' ? 10 : 0;
      const experienceBonus = Math.min(totalRuns, 5);
      const score = Math.min(100, 60 + successRate * 25 + availabilityBonus + experienceBonus);
      const reasons = [
        `Matches required role ${task.required_role}`,
        agent.status === 'AVAILABLE' ? 'Currently available' : `Current status: ${agent.status}`,
        totalRuns === 0 ? 'No prior runs, neutral prior used' : `${successfulRuns}/${totalRuns} successful runs`
      ];

      return {
        ...agent,
        score: Number(score.toFixed(2)),
        reason: reasons.join('; ')
      };
    })
    .sort((a, b) => b.score - a.score || a.id - b.id);
}

async function recommendAssignee(taskId, { persist = true } = {}) {
  const task = await getTaskContext(taskId);
  const candidates = await scoreAgents(task);
  if (!candidates.length) {
    throw new AppError(409, `No available agent for role ${task.required_role}.`, 'NO_AGENT');
  }

  const best = candidates[0];
  let recommendationId = null;

  if (persist) {
    const [result] = await pool.execute(
      `INSERT INTO ai_recommendations
         (task_id, recommendation_type, recommended_agent_id, score, reason, accepted)
       VALUES (?, 'ASSIGNEE', ?, ?, ?, NULL)`,
      [taskId, best.id, best.score, best.reason]
    );
    recommendationId = result.insertId;

    const blocking = await getBlockingDependencies(taskId);
    const priorityWeight = { LOW: 0, MEDIUM: 10, HIGH: 20, URGENT: 30 }[task.priority] || 0;
    const riskScore = Math.max(0, Math.min(100, 25 + blocking.length * 18 + priorityWeight));
    const riskReason = blocking.length
      ? `${blocking.length} unfinished dependenc${blocking.length === 1 ? 'y' : 'ies'} and ${task.priority.toLowerCase()} priority.`
      : `All dependencies are clear; ${task.priority.toLowerCase()} priority.`;

    await pool.execute(
      `INSERT INTO ai_recommendations
         (task_id, recommendation_type, recommended_agent_id, score, reason, accepted)
       VALUES (?, 'RISK', NULL, ?, ?, NULL)`,
      [taskId, riskScore, riskReason]
    );
  }

  return { recommendationId, task, best, candidates };
}

async function runTask(taskId, requestedAgentId = null) {
  const task = await getTaskContext(taskId);
  if (task.status === 'DONE') throw new AppError(409, 'Task is already done.', 'TASK_DONE');
  if (task.status === 'CANCELLED') throw new AppError(409, 'Task is cancelled.', 'TASK_CANCELLED');

  const blocking = await getBlockingDependencies(taskId);
  if (blocking.length) {
    throw new AppError(
      409,
      'Task is blocked by unfinished dependencies.',
      'DEPENDENCIES_BLOCKED',
      blocking
    );
  }

  let agent = null;
  if (requestedAgentId) {
    const [rows] = await pool.execute('SELECT * FROM agents WHERE id = ?', [requestedAgentId]);
    agent = rows[0];
    if (!agent) throw new AppError(404, 'Agent not found.', 'AGENT_NOT_FOUND');
    if (agent.role !== task.required_role) {
      throw new AppError(
        400,
        `Agent role ${agent.role} does not match required role ${task.required_role}.`,
        'ROLE_MISMATCH'
      );
    }
    if (agent.status !== 'AVAILABLE') {
      throw new AppError(409, `Agent is currently ${agent.status.toLowerCase()}.`, 'AGENT_UNAVAILABLE');
    }
  } else {
    const recommendation = await recommendAssignee(taskId, { persist: true });
    agent = recommendation.best;
  }

  const [runResult] = await pool.execute(
    `INSERT INTO agent_runs
       (task_id, agent_id, status, started_at, input_summary, model_name)
     VALUES (?, ?, 'RUNNING', NOW(), ?, ?)`,
    [taskId, agent.id, `${task.title}: ${task.description || 'No description'}`, agent.model_name]
  );
  const runId = runResult.insertId;

  await pool.execute('UPDATE agents SET status = ? WHERE id = ?', ['BUSY', agent.id]);
  await pool.execute('UPDATE tasks SET status = ? WHERE id = ?', ['IN_PROGRESS', taskId]);

  const started = Date.now();
  let output;

  try {
    output = await runAgent({
      agent,
      task,
      project: { name: task.project_name, description: task.project_description }
    });
  } catch (error) {
    const latencyMs = Date.now() - started;
    await pool.execute(
      `UPDATE agent_runs
       SET status = 'FAILED', finished_at = NOW(), latency_ms = ?, error_message = ?
       WHERE id = ?`,
      [latencyMs, String(error.message).slice(0, 2000), runId]
    );
    await pool.execute('UPDATE agents SET status = ? WHERE id = ?', ['AVAILABLE', agent.id]);
    await pool.execute('UPDATE tasks SET status = ? WHERE id = ?', ['BLOCKED', taskId]);
    throw new AppError(502, `Agent execution failed: ${error.message}`, 'AGENT_FAILED', { runId });
  }

  const latencyMs = Date.now() - started;
  const nextStatus = agent.role === 'REVIEWER' ? 'DONE' : 'REVIEW';
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.execute(
      `UPDATE agent_runs
       SET status = 'SUCCESS', finished_at = NOW(), latency_ms = ?,
           output_summary = ?, raw_output = ?
       WHERE id = ?`,
      [
        latencyMs,
        output.summary,
        JSON.stringify({
          provider: output.provider || 'mock',
          model: output.model || agent.model_name,
          confidence: output.confidence,
          content: output.content
        }),
        runId
      ]
    );

    const [artifactResult] = await connection.execute(
      `INSERT INTO artifacts
         (task_id, agent_run_id, artifact_type, file_name, file_path, content)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        taskId,
        runId,
        output.artifactType,
        output.fileName,
        `outputs/${output.fileName}`,
        output.content
      ]
    );

    await connection.execute(
      `INSERT INTO task_assignments (task_id, agent_id, assignment_role)
       VALUES (?, ?, 'PRIMARY')
       ON DUPLICATE KEY UPDATE assigned_at = CURRENT_TIMESTAMP`,
      [taskId, agent.id]
    );

    await connection.execute('UPDATE tasks SET status = ? WHERE id = ?', [nextStatus, taskId]);
    await connection.execute('UPDATE agents SET status = ? WHERE id = ?', ['AVAILABLE', agent.id]);

    if (output.provider !== 'mock') {
      await connection.execute(
        'UPDATE agents SET provider = ?, model_name = ? WHERE id = ?',
        [output.provider, output.model, agent.id]
      );
    }

    await connection.commit();

    return {
      run: {
        id: runId,
        status: 'SUCCESS',
        latencyMs,
        agent,
        output
      },
      artifact: {
        id: artifactResult.insertId,
        type: output.artifactType,
        fileName: output.fileName,
        filePath: `outputs/${output.fileName}`
      },
      task: { ...task, status: nextStatus }
    };
  } catch (error) {
    await connection.rollback();
    await pool.execute('UPDATE agents SET status = ? WHERE id = ?', ['AVAILABLE', agent.id]);
    throw error;
  } finally {
    connection.release();
  }
}

async function findNextEligibleTask(projectId) {
  const [rows] = await pool.execute(
    `SELECT t.*
     FROM tasks t
     WHERE t.project_id = ?
       AND t.status IN ('TODO', 'BLOCKED')
       AND NOT EXISTS (
         SELECT 1
         FROM task_dependencies td
         JOIN tasks dep ON dep.id = td.depends_on_task_id
         WHERE td.task_id = t.id
           AND dep.status <> 'DONE'
       )
     ORDER BY FIELD(t.priority, 'URGENT', 'HIGH', 'MEDIUM', 'LOW'), t.created_at, t.id
     LIMIT 1`,
    [projectId]
  );
  return rows[0] || null;
}

async function runNextTask(projectId) {
  const task = await findNextEligibleTask(projectId);
  if (!task) {
    throw new AppError(404, 'No eligible task is currently ready to run.', 'NO_ELIGIBLE_TASK');
  }
  return runTask(task.id);
}

async function approveTask(taskId, reviewerId) {
  const task = await getTaskContext(taskId);
  if (task.status !== 'REVIEW') {
    throw new AppError(409, 'Only tasks in REVIEW status can be approved.', 'TASK_NOT_IN_REVIEW');
  }

  const [artifacts] = await pool.execute(
    'SELECT * FROM artifacts WHERE task_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
    [taskId]
  );

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let reviewId = null;
    if (artifacts.length) {
      const [reviewResult] = await connection.execute(
        `INSERT INTO reviews (artifact_id, reviewer_id, status, comment, reviewed_at)
         VALUES (?, ?, 'ACCEPTED', ?, NOW())`,
        [artifacts[0].id, reviewerId, 'Accepted after human review.']
      );
      reviewId = reviewResult.insertId;
    }

    await connection.execute('UPDATE tasks SET status = ? WHERE id = ?', ['DONE', taskId]);
    await connection.commit();
    return { task: { ...task, status: 'DONE' }, reviewId };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getProjectDashboard(projectId) {
  const [projectRows] = await pool.execute('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!projectRows.length) throw new AppError(404, 'Project not found.', 'PROJECT_NOT_FOUND');

  const [[taskStats]] = await pool.execute(
    `SELECT
       COUNT(*) AS total,
       SUM(status = 'DONE') AS done,
       SUM(status = 'REVIEW') AS review,
       SUM(status = 'IN_PROGRESS') AS in_progress,
       SUM(status = 'BLOCKED') AS blocked
     FROM tasks WHERE project_id = ?`,
    [projectId]
  );

  const [[runStats]] = await pool.execute(
    `SELECT COUNT(*) AS total_runs,
            SUM(r.status = 'SUCCESS') AS successful_runs,
            ROUND(AVG(r.latency_ms), 0) AS avg_latency_ms
     FROM agent_runs r
     JOIN tasks t ON t.id = r.task_id
     WHERE t.project_id = ?`,
    [projectId]
  );

  const [recentRuns] = await pool.execute(
    `SELECT
       r.id, r.status, r.started_at, r.finished_at, r.latency_ms,
       t.id AS task_id, t.title AS task_title,
       a.id AS agent_id, a.name AS agent_name, a.role AS agent_role
     FROM agent_runs r
     JOIN tasks t ON t.id = r.task_id
     JOIN agents a ON a.id = r.agent_id
     WHERE t.project_id = ?
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT 8`,
    [projectId]
  );

  return { project: projectRows[0], taskStats, runStats, recentRuns };
}

module.exports = {
  AppError,
  approveTask,
  findDuplicateTask,
  findNextEligibleTask,
  getBlockingDependencies,
  getProjectDashboard,
  getTaskContext,
  jaccardSimilarity,
  recommendAssignee,
  runNextTask,
  runTask,
  scoreAgents,
  tokenize
};
