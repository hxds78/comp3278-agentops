# AgentOps — Multi-AI Project Control

A database-driven web app for coordinating multiple AI agents on software-project tasks. The platform records projects, task dependencies, agent runs, artifacts, human reviews and AI recommendations in MySQL.

This project is designed for the COMP3278 final project: it is a real web app with a MySQL database, complete CRUD operations, an ER model, key SQL queries, seed data and a reproducible local demo.

## What the app does

- Create and manage projects.
- Create tasks with required specialist roles and task dependencies.
- Register Mock or Live AI agents.
- Recommend the best available agent for a task.
- Detect likely duplicate tasks by text similarity.
- Generate a risk score for a task.
- Run the next eligible task through an agent.
- Store agent run status, latency, model name and raw output.
- Store generated artifacts and show their contents.
- Record human review/approval decisions.
- Display an execution dashboard and run history.

## Tech stack

- Node.js + Express
- MySQL 8+
- Vanilla HTML/CSS/JavaScript
- `mysql2`
- `express-session`
- `bcryptjs`
- Deterministic Mock agents by default
- Optional OpenAI-compatible Live providers: OpenAI, DeepSeek, GLM

## Project structure

```text
.
├── database/
│   ├── schema.sql          # Tables, keys and indexes
│   └── seed.sql            # Demo users, project, tasks, agents and runs
├── docs/
│   ├── ER_DIAGRAM.md       # Mermaid ER diagram
│   └── KEY_QUERIES.sql     # Queries used in the presentation
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── scripts/
│   └── setup-db.js
├── src/
│   ├── agent-runtime.js    # Mock and optional Live agent adapters
│   ├── db.js
│   └── orchestrator.js     # Recommendations, dependencies, runs, reviews
├── tests/
│   └── orchestrator.test.js
├── .env.example
├── package.json
└── server.js
```

## Prerequisites

- Node.js 20+
- npm
- MySQL 8+
- A MySQL account that can create databases

Check versions:

```bash
node --version
npm --version
mysql --version
```

## Installation

```bash
npm install
```

## Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` for your local MySQL account:

```env
PORT=3000
SESSION_SECRET=replace-with-a-long-random-string
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=agentops
AGENT_MODE=mock
```

Do not commit `.env`.

## Database setup

Start MySQL first. On macOS with Homebrew:

```bash
brew services start mysql
```

Create the database, tables and demo data:

```bash
npm run db:setup
```

This command:

1. Creates the `agentops` database if it does not exist.
2. Drops and recreates the project tables.
3. Loads the demo users, project, agents, tasks, dependencies, runs, artifacts and reviews.

The main database definition is in `database/schema.sql`; the initial data is in `database/seed.sql`.

## Run the application

```bash
npm start
```

Open:

```text
http://localhost:3000
```

Demo account:

```text
Email:    alice@example.com
Password: password123
```

A second seeded account is `bob@example.com` with the same demo password.

## Demo workflow

1. Sign in as Alice.
2. Open the seeded **AgentOps Demo Project**.
3. Open **Tasks**.
4. Create a task or run the next eligible task.
5. Click **Recommend agent** to generate an assignee and risk recommendation.
6. Click **Run agent** to execute the task through the selected specialist.
7. Open **Run history** and inspect the agent run and generated artifact.
8. Approve a task in `REVIEW` status to mark it `DONE`.
9. Confirm in MySQL that task status, runs, artifacts and reviews changed.

The project is intentionally human-in-the-loop: after a non-reviewer task finishes, it enters `REVIEW`; a human must approve it before dependent tasks can run.

## Mock mode vs Live mode

### Mock mode — default and recommended for grading

Mock agents require no API key and return deterministic artifacts. This means a marker can reproduce the app and demo without network access or paid AI services.

### Live mode — optional

Register an agent in the UI with `execution_mode = LIVE` and provider `openai`, `deepseek` or `glm`. Then add the corresponding key to `.env`.

OpenAI:

```env
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

DeepSeek:

```env
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

Zhipu GLM:

```env
GLM_API_KEY=
GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
GLM_MODEL=glm-4-flash
```

If a Live provider is selected without a key, the run fails clearly and the error is stored in `agent_runs`. The core Mock workflow remains independent of external services.

## Main database tables

| Table | Purpose |
|---|---|
| `users` | Human users and reviewers |
| `projects` | Software project workspaces |
| `tasks` | Project tasks and current state |
| `task_dependencies` | Self-referencing task dependency graph |
| `agents` | Planner, coder, tester and reviewer agents |
| `task_assignments` | Agents assigned to tasks |
| `agent_runs` | Execution history, latency, status and raw output |
| `artifacts` | Files or Markdown output produced by agents |
| `reviews` | Human review decisions |
| `ai_recommendations` | Assignee, risk and duplicate-task recommendations |

See `docs/ER_DIAGRAM.md` for the ER diagram, and `docs/RELATIONSHIPS_AND_TESTING.md` for the complete relationship matrix and end-to-end test procedure.

## API overview

### Authentication

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Projects and tasks

- `GET /api/projects`
- `POST /api/projects`
- `PATCH /api/projects/:projectId`
- `DELETE /api/projects/:projectId`
- `GET /api/projects/:projectId/tasks`
- `POST /api/projects/:projectId/tasks`
- `PATCH /api/tasks/:taskId`
- `DELETE /api/tasks/:taskId`
- `POST /api/projects/:projectId/run-next`

### Agents and orchestration

- `GET /api/agents`
- `POST /api/agents`
- `PATCH /api/agents/:agentId`
- `DELETE /api/agents/:agentId`
- `POST /api/tasks/:taskId/recommend`
- `POST /api/tasks/:taskId/run`
- `POST /api/tasks/:taskId/approve`

### Activity

- `GET /api/projects/:projectId/dashboard`
- `GET /api/projects/:projectId/runs`
- `GET /api/projects/:projectId/recommendations`
- `GET /api/projects/:projectId/artifacts`

Full request examples are not required to run the UI; the browser frontend uses these endpoints directly.

## Tests

```bash
npm test
```

The unit test checks the text similarity function used for duplicate-task detection. The main end-to-end check is the demo workflow above against the real MySQL database.

## Reproducibility checklist

- [x] Schema creation script
- [x] Seed data with a populated demo database
- [x] Mock mode without API keys
- [x] `.env.example`
- [x] Exact installation and run commands
- [x] Test account
- [x] Sample project and tasks
- [x] CRUD endpoints
- [x] Key SQL file for presentation
- [x] ER diagram source

## Limitations and next steps

- The session store is in-memory and is suitable for local demonstration only.
- Project access currently uses a single owner; production use would add project membership roles.
- Mock artifacts are deterministic examples, not full software implementations.
- Live provider responses depend on the provider, key, model and network.
- A production version should add automated integration tests, rate limiting, CSRF protection and a persistent session store.

## Course alignment

- **Submission materials / reproducibility (30%)**: source, schema, seed data, README, setup scripts and Mock mode.
- **Introduction (10%)**: multi-agent software project coordination.
- **ER diagram (10%)**: users, projects, tasks, dependencies, agents, runs, artifacts and reviews.
- **Key SQL (15%)**: joins, dependency blocking, agent performance and full execution trace.
- **Video (25%)**: live CRUD and database changes while agents run.
- **Organization / participation (10%)**: run history, artifact viewer and a repeatable 5-minute demo flow.
