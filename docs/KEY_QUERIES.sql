-- 1. Task board: tasks and their primary assigned agent
SELECT
  t.id,
  t.title,
  t.status,
  t.priority,
  t.required_role,
  a.name AS primary_agent
FROM tasks t
LEFT JOIN task_assignments ta
  ON ta.task_id = t.id
 AND ta.assignment_role = 'PRIMARY'
LEFT JOIN agents a
  ON a.id = ta.agent_id
WHERE t.project_id = 1
ORDER BY FIELD(t.priority, 'URGENT', 'HIGH', 'MEDIUM', 'LOW'), t.id;

-- 2. Tasks blocked by unfinished dependencies
SELECT
  blocked.id AS task_id,
  blocked.title AS blocked_task,
  dep.id AS dependency_id,
  dep.title AS unfinished_dependency,
  dep.status AS dependency_status
FROM tasks blocked
JOIN task_dependencies td
  ON td.task_id = blocked.id
JOIN tasks dep
  ON dep.id = td.depends_on_task_id
WHERE blocked.project_id = 1
  AND dep.status <> 'DONE'
ORDER BY blocked.id, dep.id;

-- 3. Agent performance: aggregate over execution history
SELECT
  a.id,
  a.name,
  a.role,
  COUNT(r.id) AS total_runs,
  SUM(r.status = 'SUCCESS') AS successful_runs,
  ROUND(AVG(r.latency_ms), 0) AS avg_latency_ms
FROM agents a
LEFT JOIN agent_runs r
  ON r.agent_id = a.id
GROUP BY a.id, a.name, a.role
ORDER BY a.id;

-- 4. Full execution trace for one task
SELECT
  t.id AS task_id,
  t.title AS task_title,
  t.status AS task_status,
  arun.id AS run_id,
  a.name AS agent_name,
  arun.status AS run_status,
  arun.latency_ms,
  art.file_name,
  art.artifact_type,
  rev.status AS review_status,
  rev.comment
FROM tasks t
LEFT JOIN agent_runs arun
  ON arun.task_id = t.id
LEFT JOIN agents a
  ON a.id = arun.agent_id
LEFT JOIN artifacts art
  ON art.agent_run_id = arun.id
LEFT JOIN reviews rev
  ON rev.artifact_id = art.id
WHERE t.id = 3
ORDER BY arun.created_at, art.id;

-- 5. Latest AI recommendations with optional recommended agent
SELECT
  rec.id,
  rec.recommendation_type,
  t.title AS task_title,
  a.name AS recommended_agent,
  rec.score,
  rec.reason,
  rec.accepted,
  rec.created_at
FROM ai_recommendations rec
JOIN tasks t
  ON t.id = rec.task_id
LEFT JOIN agents a
  ON a.id = rec.recommended_agent_id
WHERE t.project_id = 1
ORDER BY rec.created_at DESC, rec.id DESC;
