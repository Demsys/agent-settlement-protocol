"""
ASPClient — HTTP wrapper around the Agent Settlement Protocol REST API.

Usage:
    from asp_sdk import ASPClient

    client, agent_id, address = ASPClient.create_agent("my-agent")
    job = client.create_job(provider_address="0x...", budget="5.00")
    client.fund_job(job.job_id)
    result = client.watch_job(job.job_id)   # blocks until completed/rejected/expired
"""

from __future__ import annotations

import time
from typing import Tuple

import httpx

from .errors import (
    ASPError,
    InsufficientFundsError,
    InvalidStateError,
    JobNotFoundError,
    WatchTimeoutError,
)
from .types import (
    AgentInfo,
    AsyncJobResult,
    BalanceInfo,
    JobRecord,
    JobResult,
    TERMINAL_JOB_STATUSES,
    _ApiErrorBody,
)

DEFAULT_BASE_URL = "https://agent-settlement-protocol-production.up.railway.app"
DEFAULT_TIMEOUT  = 30.0   # seconds per HTTP request
DEFAULT_POLL_INTERVAL = 3.0   # seconds between watch_job polls
DEFAULT_WATCH_TIMEOUT = 300.0  # 5 minutes


class ASPClient:
    """
    Client bound to a single agent API key.

    Use the static factory ``ASPClient.create_agent()`` to provision a new
    agent and get back a ready-to-use client in one call.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._http = httpx.Client(
            base_url=self._base_url,
            headers={"x-api-key": api_key, "Content-Type": "application/json"},
            timeout=timeout,
        )

    # ------------------------------------------------------------------
    # Static factories
    # ------------------------------------------------------------------

    @staticmethod
    def create_agent(
        name: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> Tuple["ASPClient", str, str]:
        """
        Register a new agent and return ``(client, agent_id, address)``.

        The ``api_key`` is embedded in the returned client.
        Store ``agent_id`` and ``address`` — the API key is never re-exposed.
        """
        with httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout) as http:
            resp = http.post("/v1/agents", json={"name": name})
        _raise_for_status(resp)
        data = AgentInfo.model_validate(resp.json())
        client = ASPClient(api_key=data.api_key, base_url=base_url, timeout=timeout)
        return client, data.agent_id, data.address

    # ------------------------------------------------------------------
    # Jobs
    # ------------------------------------------------------------------

    def create_job(
        self,
        provider_address: str,
        budget: str,
        deadline_minutes: int = 60,
        evaluator_address: str | None = None,
    ) -> JobResult:
        """Open a job on-chain. Synchronous — returns tx hash.

        Args:
            provider_address:   Ethereum address of the provider agent.
            budget:             Budget in USDC (e.g. "5.00").
            deadline_minutes:   Job deadline in minutes. Defaults to 60.
            evaluator_address:  Optional explicit evaluator address (0x…).
                                Omit to auto-assign from the staker pool.
        """
        body: dict = {
            "providerAddress": provider_address,
            "budget": budget,
            "deadlineMinutes": deadline_minutes,
        }
        if evaluator_address is not None:
            body["evaluatorAddress"] = evaluator_address
        resp = self._http.post("/v1/jobs", json=body)
        _raise_for_status(resp)
        return JobResult.model_validate(resp.json())

    def fund_job(self, job_id: str) -> AsyncJobResult:
        """Fund the job escrow. Async (HTTP 202) — use watch_job() for result."""
        resp = self._http.post(f"/v1/jobs/{job_id}/fund")
        _raise_for_status(resp)
        return AsyncJobResult.model_validate(resp.json())

    def submit_work(self, job_id: str, deliverable: str) -> AsyncJobResult:
        """Provider submits a deliverable. Async (HTTP 202)."""
        resp = self._http.post(f"/v1/jobs/{job_id}/submit", json={"deliverable": deliverable})
        _raise_for_status(resp)
        return AsyncJobResult.model_validate(resp.json())

    def complete_job(self, job_id: str, reason: str = "") -> AsyncJobResult:
        """Evaluator approves — releases payment to provider. Async (HTTP 202)."""
        resp = self._http.post(f"/v1/jobs/{job_id}/complete", json={"reason": reason})
        _raise_for_status(resp)
        return AsyncJobResult.model_validate(resp.json())

    def reject_job(self, job_id: str, reason: str = "") -> JobResult:
        """Evaluator rejects — refunds client. Synchronous."""
        resp = self._http.post(f"/v1/jobs/{job_id}/reject", json={"reason": reason})
        _raise_for_status(resp)
        return JobResult.model_validate(resp.json())

    def get_job(self, job_id: str) -> JobRecord:
        """Fetch current job state (auto-synced from chain)."""
        resp = self._http.get(f"/v1/jobs/{job_id}")
        _raise_for_status(resp)
        return JobRecord.model_validate(resp.json())

    def list_jobs(self) -> list[JobRecord]:
        """List all jobs belonging to this agent."""
        resp = self._http.get("/v1/jobs")
        _raise_for_status(resp)
        return [JobRecord.model_validate(j) for j in resp.json()]

    def watch_job(
        self,
        job_id: str,
        poll_interval: float = DEFAULT_POLL_INTERVAL,
        timeout: float = DEFAULT_WATCH_TIMEOUT,
    ) -> JobRecord:
        """
        Block until the job reaches a terminal state (completed/rejected/expired).

        Polls GET /v1/jobs/:id every ``poll_interval`` seconds.
        Raises ``WatchTimeoutError`` if ``timeout`` seconds elapse first.
        """
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            job = self.get_job(job_id)
            if job.status in TERMINAL_JOB_STATUSES:
                return job
            time.sleep(poll_interval)
        raise WatchTimeoutError(job_id, timeout)

    # ------------------------------------------------------------------
    # Balances
    # ------------------------------------------------------------------

    def get_balance(self, agent_id: str) -> BalanceInfo:
        """Fetch ETH and USDC balances for any agent wallet."""
        resp = self._http.get(f"/v1/agents/{agent_id}/balance")
        _raise_for_status(resp)
        return BalanceInfo.model_validate(resp.json())

    # ------------------------------------------------------------------
    # Context manager support
    # ------------------------------------------------------------------

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "ASPClient":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


# ---------------------------------------------------------------------------
# Internal helper
# ---------------------------------------------------------------------------

def _raise_for_status(resp: httpx.Response) -> None:
    """Convert non-2xx responses to typed ASP exceptions."""
    if resp.is_success:
        return
    try:
        body = _ApiErrorBody.model_validate(resp.json())
        code    = body.code    or "ASP_ERROR"
        message = body.error   or body.message or resp.text
    except Exception:
        code    = "ASP_ERROR"
        message = resp.text

    if resp.status_code == 404:
        raise JobNotFoundError(message)
    if resp.status_code == 409:
        raise InvalidStateError(message)
    if resp.status_code == 402:
        raise InsufficientFundsError(message)
    raise ASPError(message, code=code, status=resp.status_code)
