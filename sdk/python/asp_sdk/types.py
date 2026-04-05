"""
Pydantic models for the Agent Settlement Protocol SDK.

These models mirror the TypeScript types in sdk/src/types.ts and the API
server's response shapes. They are the single source of truth for validation
and serialisation within the Python SDK.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Domain primitives
# ---------------------------------------------------------------------------

JobStatus = Literal["open", "funded", "submitted", "completed", "rejected", "expired"]
"""All possible on-chain/off-chain states a job can be in."""

TERMINAL_JOB_STATUSES: frozenset[str] = frozenset({"completed", "rejected", "expired"})
"""States from which no further transitions are possible."""


# ---------------------------------------------------------------------------
# Storage-level records
# ---------------------------------------------------------------------------


class JobRecord(BaseModel):
    """Full job record as stored and returned by the API server."""

    job_id: str = Field(alias="jobId")
    agent_id: str = Field(alias="agentId")
    tx_hash: str = Field(alias="txHash")
    status: JobStatus
    provider_address: str = Field(alias="providerAddress")
    evaluator_address: str = Field(alias="evaluatorAddress", default="")
    # Human-readable amount, e.g. "5.00"
    budget: str
    deadline_minutes: int = Field(alias="deadlineMinutes")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    deliverable: Optional[str] = Field(None, alias="deliverable")

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# API response shapes
# ---------------------------------------------------------------------------


class AgentInfo(BaseModel):
    """Response from POST /v1/agents."""

    agent_id: str = Field(alias="agentId")
    address: str
    api_key: str = Field(alias="apiKey")

    model_config = {"populate_by_name": True}


class BalanceInfo(BaseModel):
    """Response from GET /v1/agents/:id/balance."""

    eth_balance: str = Field(alias="ethBalance")
    usdc_balance: str = Field(alias="usdcBalance")

    model_config = {"populate_by_name": True}


class JobResult(BaseModel):
    """Response from POST /v1/jobs and POST /v1/jobs/:id/reject (synchronous)."""

    job_id: str = Field(alias="jobId")
    tx_hash: str = Field(alias="txHash")
    basescan_url: str = Field(alias="basescanUrl")
    status: JobStatus

    model_config = {"populate_by_name": True}


class AsyncJobResult(BaseModel):
    """
    Response from POST /v1/jobs/:id/fund, /submit, /complete (HTTP 202 async).

    The transaction has been enqueued but not yet confirmed on-chain.
    Poll GET /v1/jobs/:id (or use watch_job) to track the final status.
    """

    job_id: str = Field(alias="jobId")
    status: Literal["processing"]

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Internal API error body shape
# ---------------------------------------------------------------------------


class _ApiErrorBody(BaseModel):
    """Internal model used only to parse non-2xx response bodies."""

    error: Optional[str] = None
    code: Optional[str] = None
    message: Optional[str] = None
