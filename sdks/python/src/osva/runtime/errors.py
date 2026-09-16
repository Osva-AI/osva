from __future__ import annotations


class RuntimeExecutionError(Exception):
    def __init__(self, message: str, code: str = "AGENT_EXECUTION_FAILED") -> None:
        super().__init__(message)
        self.code = code


class RuntimeCapabilityError(Exception):
    pass


class RuntimeProtocolError(Exception):
    def __init__(self, message: str, code: str = "RUNTIME_PROTOCOL_FAILURE") -> None:
        super().__init__(message)
        self.code = code
