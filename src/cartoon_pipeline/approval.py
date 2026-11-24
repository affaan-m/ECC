from __future__ import annotations

import os
import re
from collections.abc import Mapping
from datetime import datetime

from cartoon_pipeline.models import PublishApproval
from cartoon_pipeline.utc import UTC


class ApprovalRequiredError(PermissionError):
    """Raised when a publish action lacks the protected-environment approval."""


def approval_from_environment(
    environ: Mapping[str, str] | None = None,
) -> PublishApproval:
    values = os.environ if environ is None else environ
    if values.get("GITHUB_ACTIONS") != "true":
        raise ApprovalRequiredError(
            "Publishing is allowed only from the protected GitHub environment"
        )
    if values.get("CARTOON_HUMAN_APPROVED") != "true":
        raise ApprovalRequiredError("A human must approve this episode before publishing")
    run_id = values.get("GITHUB_RUN_ID", "")
    if not re.fullmatch(r"\d{1,20}", run_id):
        raise ApprovalRequiredError("A valid GitHub workflow run is required for approval")
    return PublishApproval(
        run_id=run_id,
        approved_at=datetime.now(UTC),
        source="github_environment",
    )
