"""
AutoGen tools for the Agent Settlement Protocol.

Three composable tools that map to the ERC-8183 lifecycle stages.
Compatible with both AutoGen v0.4+ (autogen_agentchat / autogen_core)
and AutoGen v0.2 (legacy autogen package).

Usage — AutoGen v0.4 (AssistantAgent):
    from asp_sdk import ASPClient
    from asp_sdk.autogen_tool import make_autogen_tools
    from autogen_agentchat.agents import AssistantAgent
    from autogen_ext.models.openai import OpenAIChatCompletionClient

    client, _, _ = ASPClient.create_agent("orchestrator")
    tools = make_autogen_tools(client)

    agent = AssistantAgent(
        name="asp_agent",
        model_client=OpenAIChatCompletionClient(model="gpt-4o"),
        tools=tools,
    )

Usage — AutoGen v0.2 (ConversableAgent):
    from asp_sdk import ASPClient
    from asp_sdk.autogen_tool import make_autogen_tools
    from autogen import ConversableAgent

    client, _, _ = ASPClient.create_agent("orchestrator")
    tools = make_autogen_tools(client)

    assistant = ConversableAgent(name="asp_assistant", llm_config={...})
    user_proxy = ConversableAgent(name="user_proxy", human_input_mode="NEVER")

    for fn in tools:
        user_proxy.register_function(
            function_map={fn.__name__: fn}
        )
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

from .client import ASPClient
from .types import TERMINAL_JOB_STATUSES

if TYPE_CHECKING:
    pass


# ---------------------------------------------------------------------------
# Version detection helpers — all imports stay inside functions so that
# importing this module never fails when neither AutoGen version is installed.
# ---------------------------------------------------------------------------


def _try_import_function_tool() -> type | None:
    """
    Return autogen_core's FunctionTool class if AutoGen v0.4 is installed,
    otherwise None. This lets us wrap callables with proper schema generation
    without breaking on v0.2 environments.
    """
    try:
        from autogen_core.tools import FunctionTool  # type: ignore[import]
        return FunctionTool
    except ImportError:
        return None


def _autogen_v04_available() -> bool:
    """True when the autogen-agentchat v0.4+ package is present."""
    try:
        import autogen_agentchat  # type: ignore[import]  # noqa: F401
        return True
    except ImportError:
        return False


def _autogen_v02_available() -> bool:
    """True when the legacy autogen v0.2 package is present."""
    try:
        import autogen  # type: ignore[import]  # noqa: F401
        return True
    except ImportError:
        return False


# ---------------------------------------------------------------------------
# Standalone callables — usable without any AutoGen installation.
# Docstrings are written for LLM consumption: AutoGen forwards them verbatim
# to the model as tool descriptions.
# ---------------------------------------------------------------------------


def _make_create_and_fund_job(client: ASPClient):  # type: ignore[return]
    def asp_create_and_fund_job(
        provider_address: str,
        budget: str,
        deadline_minutes: int = 60,
    ) -> str:
        """
        Create an ERC-8183 escrow job and fund it in a single step.
        Returns the job_id needed to call asp_submit_work afterward.

        Args:
            provider_address: Ethereum wallet address of the provider agent
                              that will perform the work (e.g. '0x1234...abcd').
            budget: Budget in USDC as a decimal string (e.g. '5.00').
                    The funds are locked in escrow until the job is settled.
            deadline_minutes: Number of minutes before the job expires if not
                              completed. Must be between 5 and 10080 (one week).
                              Defaults to 60.
        """
        job = client.create_job(
            provider_address=provider_address,
            budget=budget,
            deadline_minutes=deadline_minutes,
        )
        client.fund_job(job.job_id)
        return f"job_id:{job.job_id} tx:{job.tx_hash}"

    return asp_create_and_fund_job


def _make_submit_work(client: ASPClient):  # type: ignore[return]
    def asp_submit_work(job_id: str, deliverable: str) -> str:
        """
        Submit a deliverable for an existing funded ERC-8183 job.
        The deliverable string (or its IPFS CID) is recorded on-chain.
        Call asp_watch_job afterward to wait for evaluator settlement.

        Args:
            job_id: Job identifier returned by asp_create_and_fund_job
                    (format: 'job_id:<uuid>').
            deliverable: Work output to submit. Can be free-form text, a URL,
                         or an IPFS CID pointing to richer content.
        """
        # Strip the 'job_id:' prefix that asp_create_and_fund_job returns,
        # so the LLM can pass the raw return value without reformatting.
        clean_id = job_id.removeprefix("job_id:").split(" ")[0]

        # Poll until the job is funded before submitting, because the fund
        # transaction is async (HTTP 202) and may not yet be confirmed.
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            record = client.get_job(clean_id)
            if record.status == "funded":
                break
            if record.status in TERMINAL_JOB_STATUSES:
                return (
                    f"Job {clean_id} ended unexpectedly with status "
                    f"'{record.status}' before work could be submitted."
                )
            time.sleep(3)

        client.submit_work(clean_id, deliverable)
        return f"Deliverable submitted for job {clean_id}. Awaiting evaluator."

    return asp_submit_work


def _make_watch_job(client: ASPClient):  # type: ignore[return]
    def asp_watch_job(job_id: str, timeout_seconds: float = 300.0) -> str:
        """
        Wait for an ERC-8183 job to reach a terminal state and return a
        human-readable settlement summary. Terminal states are:
        'completed' (payment released), 'rejected' (funds refunded), or
        'expired' (deadline passed, funds refunded).

        Args:
            job_id: Job identifier returned by asp_create_and_fund_job
                    (format: 'job_id:<uuid>' or plain UUID).
            timeout_seconds: Maximum seconds to wait before raising a timeout
                             error. Defaults to 300 (5 minutes).
        """
        clean_id = job_id.removeprefix("job_id:").split(" ")[0]
        record = client.watch_job(clean_id, timeout=timeout_seconds)

        if record.status == "completed":
            return (
                f"Job #{record.job_id} COMPLETED. "
                f"{record.budget} USDC released to provider "
                f"{record.provider_address}. "
                f"On-chain tx: {record.tx_hash}"
            )
        return f"Job #{record.job_id} ended with status '{record.status}'."

    return asp_watch_job


# ---------------------------------------------------------------------------
# Public factory
# ---------------------------------------------------------------------------


def make_autogen_tools(client: ASPClient) -> list:
    """
    Return a list of AutoGen-compatible tool definitions bound to ``client``.

    Compatible with both AutoGen v0.4+ (autogen_agentchat / autogen_core) and
    AutoGen v0.2 (legacy autogen). When AutoGen v0.4 is installed the tools are
    wrapped in ``FunctionTool`` objects so that AssistantAgent can infer their
    JSON schema automatically. When only v0.2 is available, plain callables are
    returned — pass them to ``ConversableAgent.register_function()`` directly.
    When neither version is installed the plain callables are still returned so
    that the tools remain usable in any custom pipeline.

    Install dependencies with:
        pip install asp-sdk[autogen]

    Tools returned (in order):
        - asp_create_and_fund_job(provider_address, budget, deadline_minutes) -> str
        - asp_submit_work(job_id, deliverable) -> str
        - asp_watch_job(job_id, timeout_seconds) -> str

    Raises:
        ImportError: Only if AutoGen is absent AND the caller explicitly
                     requires wrapped FunctionTool objects (see ``require_autogen``
                     parameter).
    """
    create_fn = _make_create_and_fund_job(client)
    submit_fn = _make_submit_work(client)
    watch_fn  = _make_watch_job(client)

    FunctionTool = _try_import_function_tool()

    if FunctionTool is not None:
        # AutoGen v0.4: wrap each callable so AssistantAgent gets proper schema.
        # FunctionTool introspects the function's type hints and docstring to
        # build the JSON schema — no manual schema declaration needed.
        return [
            FunctionTool(create_fn, description=create_fn.__doc__ or ""),
            FunctionTool(submit_fn, description=submit_fn.__doc__ or ""),
            FunctionTool(watch_fn,  description=watch_fn.__doc__  or ""),
        ]

    # AutoGen v0.2 or standalone use: return plain callables.
    # For v0.2, the caller registers them via:
    #   agent.register_function(function_map={"asp_create_and_fund_job": fn})
    return [create_fn, submit_fn, watch_fn]


# ---------------------------------------------------------------------------
# v0.2 convenience helper
# ---------------------------------------------------------------------------


def register_autogen_v02_tools(
    executor_agent: object,
    client: ASPClient,
) -> None:
    """
    Register all ASP tools on an AutoGen v0.2 ``ConversableAgent`` in one call.

    This is a convenience wrapper around the v0.2 ``register_function()`` API.
    The ``executor_agent`` is typically a ``UserProxyAgent`` with
    ``human_input_mode="NEVER"``.

    Args:
        executor_agent: A ``ConversableAgent`` (or subclass) instance from
                        autogen v0.2. Must expose a ``register_function`` method.
        client: A configured ``ASPClient`` instance.

    Raises:
        ImportError: If the legacy ``autogen`` package is not installed.
        AttributeError: If ``executor_agent`` does not have ``register_function``.
    """
    if not _autogen_v02_available():
        raise ImportError(
            "AutoGen v0.2 is not installed. "
            "Run: pip install autogen  (note: not autogen-agentchat)"
        )

    tools = make_autogen_tools(client)
    # In v0.2, register_function accepts a dict mapping name → callable.
    function_map = {fn.__name__: fn for fn in tools}
    # register_function is an instance method on ConversableAgent.
    executor_agent.register_function(function_map=function_map)  # type: ignore[union-attr]
