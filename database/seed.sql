INSERT INTO users (id, username, email, password_hash, role)
VALUES
  (1, 'alice', 'alice@example.com', '$2b$10$HTZKplBLj0dI4LwapgBpZupvQBxeHOlhrTjshMwjNklePyfyZlAaK', 'ADMIN'),
  (2, 'bob', 'bob@example.com', '$2b$10$HTZKplBLj0dI4LwapgBpZupvQBxeHOlhrTjshMwjNklePyfyZlAaK', 'MEMBER');

INSERT INTO projects (id, owner_id, name, description, status)
VALUES
  (1, 1, 'AgentOps Demo Project', 'A sample project showing multiple AI agents collaborating on a software build.', 'ACTIVE');

INSERT INTO agents (id, name, role, provider, model_name, execution_mode, status)
VALUES
  (1, 'Planner Agent', 'PLANNER', 'mock', 'mock-planner-v1', 'MOCK', 'AVAILABLE'),
  (2, 'Coding Agent', 'CODER', 'mock', 'mock-coder-v1', 'MOCK', 'AVAILABLE'),
  (3, 'Testing Agent', 'TESTER', 'mock', 'mock-tester-v1', 'MOCK', 'AVAILABLE'),
  (4, 'Review Agent', 'REVIEWER', 'mock', 'mock-reviewer-v1', 'MOCK', 'AVAILABLE');

INSERT INTO tasks (id, project_id, created_by, title, description, required_role, status, priority, estimated_hours)
VALUES
  (1, 1, 1, 'Analyze requirements', 'Break the project brief into clear deliverables and acceptance criteria.', 'PLANNER', 'DONE', 'HIGH', 2.00),
  (2, 1, 1, 'Design database schema', 'Create the ER model and MySQL schema for projects, tasks, agents and runs.', 'CODER', 'DONE', 'HIGH', 4.00),
  (3, 1, 1, 'Implement login API', 'Implement session-based authentication and password hashing for the web app.', 'CODER', 'TODO', 'HIGH', 6.00),
  (4, 1, 1, 'Test login API', 'Test valid login, invalid password, logout and session persistence.', 'TESTER', 'TODO', 'HIGH', 3.00),
  (5, 1, 1, 'Review login implementation', 'Review the login API artifact and record a human decision.', 'REVIEWER', 'TODO', 'MEDIUM', 2.00),
  (6, 1, 1, 'Write README and setup guide', 'Document installation, database setup, mock mode and live provider configuration.', 'PLANNER', 'TODO', 'MEDIUM', 3.00);

INSERT INTO task_dependencies (task_id, depends_on_task_id)
VALUES
  (2, 1),
  (3, 2),
  (4, 3),
  (5, 4),
  (6, 1);

INSERT INTO task_assignments (id, task_id, agent_id, assignment_role)
VALUES
  (1, 1, 1, 'PRIMARY'),
  (2, 2, 2, 'PRIMARY');

INSERT INTO agent_runs (id, task_id, agent_id, status, started_at, finished_at, latency_ms, input_summary, output_summary, raw_output, model_name)
VALUES
  (1, 1, 1, 'SUCCESS', '2026-11-03 09:00:00', '2026-11-03 09:00:02', 2000, 'Analyze project requirements', 'Produced a requirements checklist', JSON_OBJECT('summary', 'Produced a requirements checklist', 'confidence', 0.91), 'mock-planner-v1'),
  (2, 2, 2, 'SUCCESS', '2026-11-03 09:10:00', '2026-11-03 09:10:04', 4000, 'Design MySQL schema', 'Produced schema.sql', JSON_OBJECT('summary', 'Produced schema.sql', 'confidence', 0.88), 'mock-coder-v1');

INSERT INTO artifacts (id, task_id, agent_run_id, artifact_type, file_name, file_path, content)
VALUES
  (1, 1, 1, 'DOCUMENT', 'requirements.md', 'outputs/requirements.md', '# Requirements\n\n- Authentication\n- Task management\n- Agent run tracking\n- Human review'),
  (2, 2, 2, 'CODE', 'schema.sql', 'outputs/schema.sql', 'CREATE TABLE tasks (...);');

INSERT INTO reviews (id, artifact_id, reviewer_id, status, comment, reviewed_at)
VALUES
  (1, 1, 2, 'ACCEPTED', 'Requirements are clear and complete.', '2026-11-03 09:20:00'),
  (2, 2, 2, 'ACCEPTED', 'Schema covers the required entities and relationships.', '2026-11-03 09:30:00');

INSERT INTO ai_recommendations (id, task_id, recommendation_type, recommended_agent_id, score, reason, accepted)
VALUES
  (1, 3, 'ASSIGNEE', 2, 92.50, 'Coding Agent matches the required role, is available and has a strong success rate.', TRUE),
  (2, 4, 'RISK', NULL, 78.00, 'High priority and depends on an unfinished task.', NULL),
  (3, 3, 'DUPLICATE', NULL, 31.00, 'A similar login-related task does not appear to exist yet.', NULL);
