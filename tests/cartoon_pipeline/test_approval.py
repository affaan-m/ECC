import pytest

from cartoon_pipeline.approval import ApprovalRequiredError, approval_from_environment


def test_approval_is_rejected_outside_github_environment() -> None:
    with pytest.raises(ApprovalRequiredError):
        approval_from_environment(
            {
                "CARTOON_HUMAN_APPROVED": "true",
                "GITHUB_RUN_ID": "123",
            }
        )


def test_approval_requires_all_protected_job_markers() -> None:
    with pytest.raises(ApprovalRequiredError):
        approval_from_environment(
            {
                "GITHUB_ACTIONS": "true",
                "GITHUB_RUN_ID": "123",
            }
        )


def test_approval_rejects_non_numeric_workflow_run_ids() -> None:
    with pytest.raises(ApprovalRequiredError):
        approval_from_environment(
            {
                "GITHUB_ACTIONS": "true",
                "CARTOON_HUMAN_APPROVED": "true",
                "GITHUB_RUN_ID": "run-123",
            }
        )
