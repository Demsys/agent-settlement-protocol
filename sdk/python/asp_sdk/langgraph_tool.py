"""
LangGraph / LangChain tools for the Agent Settlement Protocol.

Three composable tools that map to the ERC-8183 lifecycle stages,
designed to be used as nodes in a LangGraph StateGraph.

Usage:
    from asp_sdk.langgraph_tool import make_asp_tools
    from asp_sdk import ASPClient

    client, _, _ = ASPClient.create_agent("orchestrator")
    create_and_fund, submit_work, watch_job = make_asp_tools(client)

    # Bind to a LangChain LLM:
    llm_with_tools = llm.bind_tools([create_and_fund, submit_work, watch_job])
"""

from __future__ import annotations

from typing import TYPE_CHECKING

try:
    from langchain_core.tools import tool  # type: ignore[import]
    _LANGCHAIN_AVAILABLE = True
except ImportError:
    _LANGCHAIN_AVAILABLE = False

from .client import ASPClient

if TYPE_CHECKING:
    pass


def make_asp_tools(client: ASPClient) -> tuple:  # type: ignore[type-arg]
    """
    Return three LangChain/LangGraph StructuredTools bound to ``client``.

    Install dependencies with:
        pip install asp-sdk[langgraph]
    """
    if not _LANGCHAIN_AVAILABLE:
        raise ImportError(
            "langchain-core is not installed. Run: pip install asp-sdk[langgraph]"
        )

    @tool
    def asp_create_and_fund_job(
        provider_address: str,
        budget: str,
        deadline_minutes: int = 60,
    ) -> str:
        """
        Create an ERC-8183 job and fund the escrow.
        Returns the job_id to pass to asp_submit_work.

        Args:
            provider_address: Ethereum address of the provider agent.
            budget: Budget in USDC as a decimal string, e.g. '5.00'.
            deadline_minutes: Job deadline (5–10080 minutes).
        """
        job = client.create_job(
            provider_address=provider_address,
            budget=budget,
            deadline_minutes=deadline_minutes,
        )
        client.fund_job(job.job_id)
        return f"job_id:{job.job_id} tx:{job.tx_hash}"

    @tool
    def asp_submit_work(job_id: str, deliverable: str) -> str:
        """
        Submit a deliverable for an existing funded job.
        The deliverable hash is stored on-chain.

        Args:
            job_id: Job ID returned by asp_create_and_fund_job.
            deliverable: Work output or IPFS CID to submit.
        """
        client.submit_work(job_id, deliverable)
        return f"Deliverable submitted for job {job_id}. Awaiting evaluator."

    @tool
    def asp_watch_job(job_id: str, timeout_seconds: float = 300.0) -> str:
        """
        Wait for a job to reach a terminal state (completed/rejected/expired).
        Returns a human-readable settlement summary.

        Args:
            job_id: Job ID to watch.
            timeout_seconds: Maximum seconds to wait (default 300).
        """
        record = client.watch_job(job_id, timeout=timeout_seconds)
        if record.status == "completed":
            return (
                f"Job #{record.job_id} COMPLETED. "
                f"{record.budget} USDC released to provider {record.provider_address}. "
                f"On-chain tx: {record.tx_hash}"
            )
        return f"Job #{record.job_id} ended with status '{record.status}'."

    return asp_create_and_fund_job, asp_submit_work, asp_watch_job
