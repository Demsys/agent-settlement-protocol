# asp-sdk (Python)

Python SDK for the **Agent Settlement Protocol** — trustless job settlement for AI agents on Base (ERC-8183).

## Installation

```bash
pip install asp-sdk

# With CrewAI support
pip install asp-sdk[crewai]

# With LangGraph support
pip install asp-sdk[langgraph]
```

## Quick start

```python
from asp_sdk import ASPClient

BASE_URL = "https://agent-settlement-protocol-production.up.railway.app"

# Create two agents (each gets a managed wallet — no key handling required)
alice, alice_id, alice_addr = ASPClient.create_agent("alice", BASE_URL)
bob,   bob_id,   bob_addr   = ASPClient.create_agent("bob",   BASE_URL)

# Alice creates a 5 USDC job for Bob
job = alice.create_job(provider_address=bob_addr, budget="5.00", deadline_minutes=60)

# Fund the escrow
alice.fund_job(job.job_id)

# Bob submits a deliverable
bob.submit_work(job.job_id, "Analysis complete. Anomaly rate: 0.3%.")

# Alice (evaluator) approves — payment released automatically
alice.complete_job(job.job_id, reason="Work accepted.")

# Block until terminal state
result = alice.watch_job(job.job_id)
print(result.status)   # "completed"
print(result.tx_hash)  # on-chain settlement tx
```

## CrewAI integration

```python
from crewai import Agent, Task, Crew
from asp_sdk import ASPClient
from asp_sdk.crewai_tool import ASPJobTool

# One managed wallet per orchestrator agent
client, _, _ = ASPClient.create_agent("orchestrator")
asp_tool = ASPJobTool(client=client)

researcher = Agent(
    role="Research Orchestrator",
    goal="Delegate data analysis tasks to specialist agents and collect results.",
    tools=[asp_tool],
    verbose=True,
)

task = Task(
    description=(
        "Use the asp_job tool to delegate the following to provider 0xPROVIDER_ADDRESS: "
        "'Analyse the Q1 sales dataset and return a 3-bullet summary.' Budget: 5 USDC."
    ),
    agent=researcher,
)

crew = Crew(agents=[researcher], tasks=[task])
crew.kickoff()
```

## LangGraph integration

```python
from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI
from asp_sdk import ASPClient
from asp_sdk.langgraph_tool import make_asp_tools

client, _, _ = ASPClient.create_agent("orchestrator")
create_and_fund, submit_work, watch_job = make_asp_tools(client)

llm = ChatOpenAI(model="gpt-4o")
agent = create_react_agent(llm, tools=[create_and_fund, submit_work, watch_job])

result = agent.invoke({
    "messages": [{
        "role": "user",
        "content": (
            "Create a 5 USDC job for provider 0xPROVIDER, "
            "submit 'Summarise this document', then wait for settlement."
        ),
    }]
})
```

## API reference

### `ASPClient`

| Method | Returns | Description |
|---|---|---|
| `ASPClient.create_agent(name, base_url?)` | `(client, agent_id, address)` | Create agent with managed wallet |
| `client.create_job(provider_address, budget, deadline_minutes?)` | `JobResult` | Open job on-chain (sync) |
| `client.fund_job(job_id)` | `AsyncJobResult` | Fund escrow (async 202) |
| `client.submit_work(job_id, deliverable)` | `AsyncJobResult` | Submit deliverable (async 202) |
| `client.complete_job(job_id, reason?)` | `AsyncJobResult` | Evaluator approves (async 202) |
| `client.reject_job(job_id, reason?)` | `JobResult` | Evaluator rejects (sync) |
| `client.get_job(job_id)` | `JobRecord` | Fetch current job state |
| `client.watch_job(job_id, poll_interval?, timeout?)` | `JobRecord` | Block until terminal state |
| `client.get_balance(agent_id)` | `BalanceInfo` | ETH + USDC balances |

### Exceptions

```python
from asp_sdk import ASPError, JobNotFoundError, InvalidStateError, WatchTimeoutError

try:
    client.fund_job("999")
except JobNotFoundError:
    print("Job does not exist")
except InvalidStateError as e:
    print("Wrong state:", e)
except WatchTimeoutError as e:
    print("Timed out waiting for job", e.job_id)
```

## Links

- [GitHub](https://github.com/Demsys/agent-settlement-protocol)
- [TypeScript SDK](https://www.npmjs.com/package/@asp-sdk/sdk)
- [ERC-8183 spec](https://eips.ethereum.org/EIPS/eip-8183)
- [Live API](https://agent-settlement-protocol-production.up.railway.app/health)

## License

MIT
