const PROVIDERS = {
  openai: {
    keyEnv: 'OPENAI_API_KEY',
    baseEnv: 'OPENAI_BASE_URL',
    modelEnv: 'OPENAI_MODEL',
    defaultBase: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini'
  },
  deepseek: {
    keyEnv: 'DEEPSEEK_API_KEY',
    baseEnv: 'DEEPSEEK_BASE_URL',
    modelEnv: 'DEEPSEEK_MODEL',
    defaultBase: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat'
  },
  glm: {
    keyEnv: 'GLM_API_KEY',
    baseEnv: 'GLM_BASE_URL',
    modelEnv: 'GLM_MODEL',
    defaultBase: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash'
  }
};

const ROLE_GUIDANCE = {
  PLANNER: 'Break the task into concrete implementation steps and acceptance criteria.',
  CODER: 'Produce a focused implementation artifact and explain key decisions.',
  TESTER: 'Produce a test plan or test report covering happy paths and failure paths.',
  REVIEWER: 'Review the task critically. State whether it is acceptable and list concrete issues.'
};

function slugify(value) {
  return String(value || 'artifact')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'artifact';
}

function mockArtifact(agent, task) {
  const slug = slugify(task.title);
  const confidence = agent.role === 'REVIEWER' ? 0.9 : 0.86;

  if (agent.role === 'PLANNER') {
    return {
      artifactType: 'DOCUMENT',
      fileName: `${slug}-plan.md`,
      summary: `Created an execution plan for "${task.title}"`,
      content: `# Plan: ${task.title}\n\n## Goal\n${task.description || 'Complete the assigned project task.'}\n\n## Steps\n1. Clarify inputs and acceptance criteria.\n2. Implement the smallest working version.\n3. Verify the result and record evidence.\n4. Hand off to the next specialist agent.\n\n## Definition of done\n- CRUD path works end to end.\n- Evidence is stored in the database.\n- A human reviewer can accept or reject the result.\n`,
      confidence
    };
  }

  if (agent.role === 'CODER') {
    return {
      artifactType: 'CODE',
      fileName: `${slug}.js`,
      summary: `Produced an implementation artifact for "${task.title}"`,
      content: `// Generated mock implementation for: ${task.title}\n// ${task.description || 'Implement the requested task.'}\n\nexport async function execute(input) {\n  if (!input) throw new Error('input is required');\n  return {\n    ok: true,\n    task: ${JSON.stringify(task.title)},\n    message: 'Mock implementation completed successfully'\n  };\n}\n`,
      confidence
    };
  }

  if (agent.role === 'TESTER') {
    return {
      artifactType: 'TEST_REPORT',
      fileName: `${slug}-test-report.md`,
      summary: `Created a test report for "${task.title}"`,
      content: `# Test report: ${task.title}\n\n## Checks\n- [x] Happy path returns a success result.\n- [x] Missing input is rejected.\n- [x] Database state can be verified after execution.\n\n## Result\nPASS (mock mode)\n\n## Notes\nReplace mock checks with real automated tests when live agent mode is enabled.\n`,
      confidence
    };
  }

  return {
    artifactType: 'DOCUMENT',
    fileName: `${slug}-review.md`,
    summary: `Completed a review for "${task.title}"`,
    content: `# Review: ${task.title}\n\n## Decision\nACCEPTED (mock mode)\n\n## Findings\n- The deliverable addresses the task description.\n- The database records the run, artifact and review chain.\n- Re-run with a LIVE reviewer agent for a deeper code review.\n`,
    confidence
  };
}

async function callLiveProvider(agent, task, project) {
  const providerName = String(agent.provider || '').toLowerCase();
  const provider = PROVIDERS[providerName];

  if (!provider) {
    throw new Error(`Unsupported live provider "${agent.provider}".`);
  }

  const apiKey = process.env[provider.keyEnv];
  if (!apiKey) {
    throw new Error(`${provider.keyEnv} is not configured. Use MOCK mode or add the key to .env.`);
  }

  const baseUrl = (process.env[provider.baseEnv] || provider.defaultBase).replace(/\/$/, '');
  const model = agent.model_name || process.env[provider.modelEnv] || provider.defaultModel;
  const started = Date.now();

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: `You are ${agent.name}, a specialized ${agent.role} agent inside a software project orchestration platform. ${ROLE_GUIDANCE[agent.role]} Return a concise Markdown artifact. Do not claim work that was not performed.`
        },
        {
          role: 'user',
          content: `Project: ${project.name}\nProject description: ${project.description || 'N/A'}\nTask: ${task.title}\nTask description: ${task.description || 'N/A'}\nRequired role: ${task.required_role}\n\nProduce the artifact now.`
        }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${providerName} request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${providerName} returned an empty response.`);

  return {
    artifactType: agent.role === 'TESTER' ? 'TEST_REPORT' : agent.role === 'CODER' ? 'CODE' : 'DOCUMENT',
    fileName: `${slugify(task.title)}-${providerName}.md`,
    summary: `Live ${providerName} output for "${task.title}"`,
    content,
    confidence: null,
    model,
    provider: providerName,
    latencyMs: Date.now() - started
  };
}

async function runAgent({ agent, task, project }) {
  if (agent.execution_mode !== 'LIVE') {
    if (Number(process.env.MOCK_DELAY_MS || 250) > 0) {
      await new Promise((resolve) => setTimeout(resolve, Number(process.env.MOCK_DELAY_MS || 250)));
    }
    return {
      ...mockArtifact(agent, task),
      provider: 'mock',
      model: agent.model_name || 'mock-agent-v1'
    };
  }

  return callLiveProvider(agent, task, project);
}

module.exports = { runAgent, mockArtifact, PROVIDERS };
