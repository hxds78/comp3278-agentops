# AgentOps ER Diagram

```mermaid
erDiagram
    USERS ||--o{ PROJECTS : owns
    USERS ||--o{ TASKS : creates
    USERS ||--o{ REVIEWS : writes

    PROJECTS ||--o{ TASKS : contains
    TASKS ||--o{ TASK_DEPENDENCIES : depends
    TASKS ||--o{ TASK_DEPENDENCIES : blocks

    TASKS ||--o{ TASK_ASSIGNMENTS : assigned
    AGENTS ||--o{ TASK_ASSIGNMENTS : receives

    TASKS ||--o{ AGENT_RUNS : executes
    AGENTS ||--o{ AGENT_RUNS : runs

    AGENT_RUNS ||--o{ ARTIFACTS : produces
    TASKS ||--o{ ARTIFACTS : owns
    ARTIFACTS ||--o{ REVIEWS : reviewed

    TASKS ||--o{ AI_RECOMMENDATIONS : suggests
    AGENTS o|--o{ AI_RECOMMENDATIONS : recommended

    USERS {
        bigint id PK
        varchar username UK
        varchar email UK
        varchar password_hash
        enum role
        timestamp created_at
    }

    PROJECTS {
        bigint id PK
        bigint owner_id FK
        varchar name
        text description
        enum status
        timestamp created_at
    }

    TASKS {
        bigint id PK
        bigint project_id FK
        bigint created_by FK
        varchar title
        text description
        enum required_role
        enum status
        enum priority
        decimal estimated_hours
        timestamp created_at
        timestamp updated_at
    }

    TASK_DEPENDENCIES {
        bigint task_id PK,FK
        bigint depends_on_task_id PK,FK
    }

    AGENTS {
        bigint id PK
        varchar name UK
        enum role
        varchar provider
        varchar model_name
        enum execution_mode
        enum status
        timestamp created_at
    }

    TASK_ASSIGNMENTS {
        bigint id PK
        bigint task_id FK
        bigint agent_id FK
        enum assignment_role
        timestamp assigned_at
    }

    AGENT_RUNS {
        bigint id PK
        bigint task_id FK
        bigint agent_id FK
        enum status
        datetime started_at
        datetime finished_at
        int latency_ms
        text input_summary
        text output_summary
        json raw_output
        text error_message
        varchar model_name
        timestamp created_at
    }

    ARTIFACTS {
        bigint id PK
        bigint task_id FK
        bigint agent_run_id FK
        enum artifact_type
        varchar file_name
        varchar file_path
        longtext content
        timestamp created_at
    }

    REVIEWS {
        bigint id PK
        bigint artifact_id FK
        bigint reviewer_id FK
        enum status
        text comment
        datetime reviewed_at
    }

    AI_RECOMMENDATIONS {
        bigint id PK
        bigint task_id FK
        enum recommendation_type
        bigint recommended_agent_id FK
        decimal score
        text reason
        boolean accepted
        timestamp created_at
    }
```

## Relationship notes

- `task_dependencies` is a self-referencing many-to-many relationship between tasks.
- `task_assignments` models multiple agents participating in one task.
- `agent_runs` is the execution history; `tasks.status` is the current task state.
- `artifacts.content` stores the generated Markdown/code text so the UI can display it without requiring an external file service.
- `ai_recommendations` preserves AI scoring and the human acceptance decision for auditability.
