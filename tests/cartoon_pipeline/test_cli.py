from datetime import date, datetime
from pathlib import Path

import pytest

import cartoon_pipeline.__main__ as cli
from cartoon_pipeline.approval import ApprovalRequiredError
from cartoon_pipeline.config import load_content_policy
from cartoon_pipeline.models import Episode, PublishApproval, PublishReceipt
from cartoon_pipeline.publishers.dailymotion import DailymotionPublisher
from cartoon_pipeline.publishers.youtube import YouTubePublisher
from cartoon_pipeline.utc import UTC


class StaticToken:
    def get_access_token(self) -> str:
        return "mock-token"


class CountingPublisher:
    platform = "youtube"

    def publish(self, episode: Episode, approval: PublishApproval) -> PublishReceipt:
        return PublishReceipt(self.platform, "youtube-1")


def make_episode(tmp_path: Path) -> Episode:
    landscape = tmp_path / "landscape.mp4"
    vertical = tmp_path / "vertical.mp4"
    landscape.write_bytes(b"landscape")
    vertical.write_bytes(b"vertical")
    return Episode(
        episode_id="2026-11-23",
        title="The Patient Little Seed",
        description="A gentle story about teamwork and growing a garden.",
        story=("A seed needs help.", "Friends work together.", "A garden grows."),
        episode_date=date(2026, 11, 23),
        landscape_path=landscape,
        vertical_path=vertical,
        audience_min_age=8,
        audience_max_age=15,
        made_for_kids=True,
        original=True,
        rights_cleared=True,
        safety_reviewed=True,
        contains_personal_data=False,
    )


def test_generate_command_calls_generator_and_reports_manifest(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest = Path("build/cartoon/episode.json")
    monkeypatch.setattr(cli, "generate_daily_episode", lambda *args: manifest)

    result = cli.main(["generate", "--date", "2026-11-23"])

    assert result == 0
    assert "episode.json" in capsys.readouterr().out


def test_publish_command_runs_pipeline_and_reports_receipts(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    episode = make_episode(tmp_path)
    approval = PublishApproval("123456", datetime.now(UTC), "github_environment")
    monkeypatch.setenv("CARTOON_LEDGER_PATH", str(tmp_path / "ledger.sqlite3"))
    monkeypatch.setattr(cli, "approval_from_environment", lambda: approval)
    monkeypatch.setattr(cli, "load_episode", lambda path: episode)
    monkeypatch.setattr(
        cli,
        "load_content_policy",
        lambda path: load_content_policy(Path("config/content_policy.yaml")),
    )
    monkeypatch.setattr(cli, "load_platforms", lambda path: {})
    monkeypatch.setattr(cli, "_build_publishers", lambda config: [CountingPublisher()])

    result = cli.main(["publish", "--episode", str(tmp_path / "episode.json")])

    assert result == 0
    assert '"status": "published"' in capsys.readouterr().out


def test_publish_command_fails_without_persistent_ledger(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    episode = make_episode(tmp_path)
    approval = PublishApproval("123456", datetime.now(UTC), "github_environment")
    monkeypatch.delenv("CARTOON_LEDGER_PATH", raising=False)
    monkeypatch.setattr(cli, "approval_from_environment", lambda: approval)
    monkeypatch.setattr(cli, "load_episode", lambda path: episode)
    monkeypatch.setattr(
        cli,
        "load_content_policy",
        lambda path: load_content_policy(Path("config/content_policy.yaml")),
    )
    monkeypatch.setattr(cli, "load_platforms", lambda path: {})
    monkeypatch.setattr(cli, "_build_publishers", lambda config: [CountingPublisher()])

    result = cli.main(["publish", "--episode", str(tmp_path / "episode.json")])

    assert result == 1
    assert "CARTOON_LEDGER_PATH" in capsys.readouterr().err


def test_publish_command_reports_missing_github_approval(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(
        cli,
        "approval_from_environment",
        lambda: (_ for _ in ()).throw(ApprovalRequiredError("approval required")),
    )

    result = cli.main(["publish", "--episode", "episode.json"])

    assert result == 1
    assert "approval required" in capsys.readouterr().err


def test_build_publishers_constructs_only_configured_providers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DAILYMOTION_PROFILE_ID", "profile-1")
    monkeypatch.setattr(
        cli.OAuthTokenProvider,
        "from_environment",
        lambda provider: StaticToken(),
    )

    publishers = cli._build_publishers(
        {
            "youtube": {"enabled": True, "privacy_status": "private"},
            "dailymotion": {
                "enabled": True,
                "profile_id_env": "DAILYMOTION_PROFILE_ID",
                "visibility": "private",
            },
            "tiktok": {"enabled": False},
        }
    )

    assert [type(publisher) for publisher in publishers] == [
        YouTubePublisher,
        DailymotionPublisher,
    ]


def test_build_publishers_refuses_tiktok_without_consent_flow() -> None:
    with pytest.raises(RuntimeError, match="direct-post flow"):
        cli._build_publishers(
            {"tiktok": {"enabled": True, "direct_post_enabled": False}}
        )
