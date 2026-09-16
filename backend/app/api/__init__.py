"""
HTTP layer.

The version prefix lives here so every router imports the same constant: when
/api/v2 eventually exists, the two versions differ by which prefix a router is
mounted under, not by a string someone remembered to update in each module.

Liveness and readiness probes are deliberately *not* versioned — container
health checks and deploy smoke tests point at bare /health, and a probe that
moves when the API version changes defeats its own purpose.
"""

API_V1_PREFIX = "/api/v1"

__all__ = ["API_V1_PREFIX"]
