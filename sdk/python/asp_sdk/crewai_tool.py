"""
CrewAI Tool for the Agent Settlement Protocol.

Provides a single tool that executes the full ERC-8183 job lifecycle
(create → fund → submit → watch) in one agent action.

Usage:
    from asp_sdk.crewai_tool import ASPJobTool
    from asp_sdk import ASPClient

    client, agent_id, _ = ASPClient.create_agent("orchestrator")
    tool = ASPJobTool(client=client)

    # Inside a CrewAI agent:
    result = tool.run(
        provider_address="0x...",
        deliverable="Analyse this dataset and return a summary.",
        budget="5.00",
        deadline_minutes=60,
    )
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Optional, Type

from pydantic import BaseModel, Field

from .client import ASPClient
from .types import JobRecord

try:
    from crewai.tools import BaseTool as CrewAIBaseTool  # type: ignore[import]
    _CREWAI_AVAILABLE = True
except ImportError:
    _CREWAI_AVAILABLE = False
    CrewAIBaseTool = object  # type: ignore[assignment,misc]

if TYPE_CHECKING:
    pass


class _ASPJobInput(BaseModel):
    provider_address: str = Field(description="Ethereum address of the provider agent wallet")
    deliverable: str      = Field(description="Task description or deliverable to submit")
    budget: str           = Field(default="5.00", description="Budget in USDC (e.g. '5.00')")
    deadline_minutes: int = Field(default=60, description="Job deadline in minutes (5–10080)")


class ASPJobTool(CrewAIBaseTool):  # type: ignore[misc]
    """
    CrewAI tool that delegates a task to another agent via the Agent Settlement
    Protocol and waits for cryptoeconomic settlement.

    One tool call covers the full ERC-8183 lifecycle:
    create job → fund escrow → submit deliverable → watch until completion.

    Raises if crewai is not installed. Install with:
        pip install asp-sdk[crewai]
    """

    name: str = "asp_job"
    description: str = (
        "Delegate a task to a provider agent via the Agent Settlement Protocol. "
        "Funds are held in escrow and released only on verified completion. "
        "Args: provider_address (str), deliverable (str), budget (str USDC), "
        "deadline_minutes (int)."
    )
    args_schema: Type[BaseModel] = _ASPJobInput

    # Injected at construction — not a Pydantic field so CrewAI doesn't try
    # to serialise the client object.
    _asp_client: ASPClient

    def __init__(self, client: ASPClient, **kwargs: object) -> None:
        if not _CREWAI_AVAILABLE:
            raise ImportError(
                "crewai is not installed. Run: pip install asp-sdk[crewai]"
            )
        super().__init__(**kwargs)
        object.__setattr__(self, "_asp_client", client)

    def _run(
        self,
        provider_address: str,
        deliverable: str,
        budget: str = "5.00",
        deadline_minutes: int = 60,
        watch_timeout: float = 300.0,
    ) -> str:
        client = object.__getattribute__(self, "_asp_client")

        job = client.create_job(
            provider_address=provider_address,
            budget=budget,
            deadline_minutes=deadline_minutes,
        )
        client.fund_job(job.job_id)

        import time
        from .types import TERMINAL_JOB_STATUSES
        # Wait for funded before submitting
        deadline_ts = time.monotonic() + 120
        while time.monotonic() < deadline_ts:
            record = client.get_job(job.job_id)
            if record.status == "funded":
                break
            if record.status in TERMINAL_JOB_STATUSES:
                return f"Job {job.job_id} ended unexpectedly with status '{record.status}'"
            time.sleep(3)

        client.submit_work(job.job_id, deliverable)
        result: JobRecord = client.watch_job(job.job_id, timeout=watch_timeout)

        if result.status == "completed":
            return (
                f"Task completed successfully. "
                f"Job #{result.job_id} settled on-chain (tx: {result.tx_hash}). "
                f"Payment of {result.budget} USDC released to provider."
            )
        return (
            f"Task ended with status '{result.status}' for job #{result.job_id}."
        )
