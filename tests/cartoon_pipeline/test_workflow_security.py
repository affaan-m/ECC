import re
from pathlib import Path

import yaml

ROOT = Path(__file__).parents[2]


def _workflow(path: str) -> dict:
    data = yaml.safe_load((ROOT / path).read_text(encoding="utf-8"))
    return data.get("on", data.get(True)), data


def test_daily_workflow_runs_at_1400_utc_and_has_read_only_repository_access() -> None:
    triggers, workflow = _workflow(
        ".github/workflows/daily-cartoon-publish.yml"
    )

    assert triggers["schedule"] == [{"cron": "0 14 * * *"}]
    assert workflow["permissions"] == {"contents": "read"}
    assert workflow["jobs"]["publish"]["environment"]["name"] == "cartoon-production"
    assert workflow["jobs"]["generate"]["env"]["PYTHONPATH"] == "src"


def test_daily_workflow_references_credentials_only_through_github_secrets() -> None:
    content = (
        ROOT / ".github/workflows/daily-cartoon-publish.yml"
    ).read_text(encoding="utf-8")

    assert "${{ secrets.YOUTUBE_CLIENT_SECRET }}" in content
    assert "${{ secrets.DAILYMOTION_CLIENT_SECRET }}" in content
    for name in (
        "YOUTUBE_CLIENT_ID",
        "YOUTUBE_CLIENT_SECRET",
        "YOUTUBE_REFRESH_TOKEN",
        "DAILYMOTION_CLIENT_ID",
        "DAILYMOTION_CLIENT_SECRET",
        "DAILYMOTION_PROFILE_ID",
    ):
        assert re.search(
            rf"^\s+{name}: \$\{{\{{ secrets\.{name} \}}\}}$",
            content,
            re.MULTILINE,
        )
    assert "pull_request:" not in content


def test_provider_secrets_are_scoped_only_to_the_publish_command() -> None:
    _, workflow = _workflow(".github/workflows/daily-cartoon-publish.yml")
    publish_job = workflow["jobs"]["publish"]
    publish_step = next(
        step
        for step in publish_job["steps"]
        if step["name"] == "Publish to enabled providers"
    )

    assert "env" not in publish_job
    assert publish_step["env"]["YOUTUBE_CLIENT_SECRET"] == (
        "${{ secrets.YOUTUBE_CLIENT_SECRET }}"
    )
    assert publish_step["env"]["DAILYMOTION_CLIENT_SECRET"] == (
        "${{ secrets.DAILYMOTION_CLIENT_SECRET }}"
    )
    assert all("env" not in step for step in publish_job["steps"][:-1])


def test_security_workflow_uses_supported_specialized_scanners() -> None:
    content = (ROOT / ".github/workflows/ci-agentshield.yml").read_text(
        encoding="utf-8"
    )

    assert "affaan-m/agentshield@" in content
    assert "zizmorcore/zizmor-action@" in content
    assert "inputs: .github/workflows" in content
    assert "bandit==1.9.4" in content
    assert "python -m bandit -r src/cartoon_pipeline -ll" in content
    assert "contents: read" in content
