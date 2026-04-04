"""
asp-sdk — Python SDK for the Agent Settlement Protocol (ERC-8183 on Base).

Quick start:
    from asp_sdk import ASPClient

    client, agent_id, address = ASPClient.create_agent("my-agent")
    job = client.create_job(provider_address="0x...", budget="5.00")
    client.fund_job(job.job_id)
    result = client.watch_job(job.job_id)
    print(result.status)  # "completed"
"""

from .client import ASPClient
from .errors import ASPError, InsufficientFundsError, InvalidStateError, JobNotFoundError, WatchTimeoutError
from .types import AgentInfo, AsyncJobResult, BalanceInfo, JobRecord, JobResult

__all__ = [
    "ASPClient",
    "ASPError",
    "InsufficientFundsError",
    "InvalidStateError",
    "JobNotFoundError",
    "WatchTimeoutError",
    "AgentInfo",
    "AsyncJobResult",
    "BalanceInfo",
    "JobRecord",
    "JobResult",
    # AutoGen adapter — imported lazily to avoid requiring autogen at module load
    "make_autogen_tools",
    "register_autogen_v02_tools",
]


def make_autogen_tools(client: "ASPClient") -> list:  # type: ignore[return]
    """Lazily import and delegate to autogen_tool.make_autogen_tools."""
    from .autogen_tool import make_autogen_tools as _make
    return _make(client)


def register_autogen_v02_tools(executor_agent: object, client: "ASPClient") -> None:
    """Lazily import and delegate to autogen_tool.register_autogen_v02_tools."""
    from .autogen_tool import register_autogen_v02_tools as _register
    _register(executor_agent, client)
