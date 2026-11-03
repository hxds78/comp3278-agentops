SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS ai_recommendations;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS artifacts;
DROP TABLE IF EXISTS agent_runs;
DROP TABLE IF EXISTS task_assignments;
DROP TABLE IF EXISTS task_dependencies;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS agents;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('ADMIN', 'MEMBER') NOT NULL DEFAULT 'MEMBER',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE projects (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  owner_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  status ENUM('PLANNING', 'ACTIVE', 'COMPLETED', 'ARCHIVED') NOT NULL DEFAULT 'PLANNING',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_projects_owner
    FOREIGN KEY (owner_id) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE agents (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  role ENUM('PLANNER', 'CODER', 'TESTER', 'REVIEWER') NOT NULL,
  provider VARCHAR(100) NOT NULL DEFAULT 'mock',
  model_name VARCHAR(100) NOT NULL DEFAULT 'mock-agent-v1',
  execution_mode ENUM('MOCK', 'LIVE') NOT NULL DEFAULT 'MOCK',
  status ENUM('AVAILABLE', 'BUSY', 'OFFLINE') NOT NULL DEFAULT 'AVAILABLE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE tasks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  required_role ENUM('PLANNER', 'CODER', 'TESTER', 'REVIEWER') NOT NULL,
  status ENUM('TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE', 'CANCELLED') NOT NULL DEFAULT 'TODO',
  priority ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') NOT NULL DEFAULT 'MEDIUM',
  estimated_hours DECIMAL(5,2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tasks_project
    FOREIGN KEY (project_id) REFERENCES projects(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_tasks_creator
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  INDEX idx_tasks_project_status (project_id, status)
) ENGINE=InnoDB;

CREATE TABLE task_dependencies (
  task_id BIGINT UNSIGNED NOT NULL,
  depends_on_task_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (task_id, depends_on_task_id),
  CONSTRAINT chk_no_self_dependency CHECK (task_id <> depends_on_task_id),
  CONSTRAINT fk_task_dep_task
    FOREIGN KEY (task_id) REFERENCES tasks(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_task_dep_depends_on
    FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE task_assignments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id BIGINT UNSIGNED NOT NULL,
  agent_id BIGINT UNSIGNED NOT NULL,
  assignment_role ENUM('PRIMARY', 'SUPPORT', 'REVIEWER') NOT NULL DEFAULT 'PRIMARY',
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_task_agent_role (task_id, agent_id, assignment_role),
  CONSTRAINT fk_task_assignment_task
    FOREIGN KEY (task_id) REFERENCES tasks(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_task_assignment_agent
    FOREIGN KEY (agent_id) REFERENCES agents(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE agent_runs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id BIGINT UNSIGNED NOT NULL,
  agent_id BIGINT UNSIGNED NOT NULL,
  status ENUM('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'QUEUED',
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  latency_ms INT UNSIGNED NULL,
  input_summary TEXT,
  output_summary TEXT,
  raw_output JSON NULL,
  error_message TEXT NULL,
  model_name VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_agent_runs_task
    FOREIGN KEY (task_id) REFERENCES tasks(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_agent_runs_agent
    FOREIGN KEY (agent_id) REFERENCES agents(id)
    ON DELETE RESTRICT,
  INDEX idx_agent_runs_task (task_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE artifacts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id BIGINT UNSIGNED NOT NULL,
  agent_run_id BIGINT UNSIGNED NOT NULL,
  artifact_type ENUM('CODE', 'DOCUMENT', 'TEST_REPORT', 'LOG', 'OTHER') NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NULL,
  content LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_artifacts_task
    FOREIGN KEY (task_id) REFERENCES tasks(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_artifacts_run
    FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id)
    ON DELETE CASCADE,
  INDEX idx_artifacts_task (task_id)
) ENGINE=InnoDB;

CREATE TABLE reviews (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  artifact_id BIGINT UNSIGNED NOT NULL,
  reviewer_id BIGINT UNSIGNED NOT NULL,
  status ENUM('PENDING', 'ACCEPTED', 'CHANGES_REQUESTED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  comment TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL,
  CONSTRAINT fk_reviews_artifact
    FOREIGN KEY (artifact_id) REFERENCES artifacts(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_reviews_reviewer
    FOREIGN KEY (reviewer_id) REFERENCES users(id)
    ON DELETE RESTRICT,
  INDEX idx_reviews_artifact (artifact_id)
) ENGINE=InnoDB;

CREATE TABLE ai_recommendations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id BIGINT UNSIGNED NOT NULL,
  recommendation_type ENUM('ASSIGNEE', 'NEXT_TASK', 'RISK', 'DUPLICATE') NOT NULL,
  recommended_agent_id BIGINT UNSIGNED NULL,
  score DECIMAL(5,2) NULL,
  reason TEXT,
  accepted BOOLEAN NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ai_rec_task
    FOREIGN KEY (task_id) REFERENCES tasks(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ai_rec_agent
    FOREIGN KEY (recommended_agent_id) REFERENCES agents(id)
    ON DELETE SET NULL,
  INDEX idx_ai_rec_task (task_id, recommendation_type)
) ENGINE=InnoDB;
