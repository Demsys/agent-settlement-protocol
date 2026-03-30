"""
Typed exception hierarchy for the ASP Python SDK.
Mirrors sdk/src/errors.ts.
"""


class ASPError(Exception):
    """Base class for all ASP SDK errors."""

    def __init__(self, message: str, code: str = "ASP_ERROR", status: int = 0) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


class JobNotFoundError(ASPError):
    def __init__(self, job_id: str) -> None:
        super().__init__(f"Job {job_id} not found", code="JOB_NOT_FOUND", status=404)
        self.job_id = job_id


class InvalidStateError(ASPError):
    def __init__(self, message: str) -> None:
        super().__init__(message, code="INVALID_STATE", status=409)


class InsufficientFundsError(ASPError):
    def __init__(self, message: str) -> None:
        super().__init__(message, code="INSUFFICIENT_USDC", status=402)


class WatchTimeoutError(ASPError):
    def __init__(self, job_id: str, timeout: float) -> None:
        super().__init__(
            f"Job {job_id} did not reach a terminal state within {timeout}s",
            code="WATCH_TIMEOUT",
        )
        self.job_id = job_id
