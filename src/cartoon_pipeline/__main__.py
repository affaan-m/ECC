from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date
from pathlib import Path

from cartoon_pipeline.approval import approval_from_environment
from cartoon_pipeline.config import load_content_policy, load_platforms
from cartoon_pipeline.episode_io import load_episode
from cartoon_pipeline.generate import generate_daily_episode
from cartoon_pipeline.ledger import PublicationLedger
from cartoon_pipeline.pipeline import PublicationPipeline, Publisher
from cartoon_pipeline.publishers.dailymotion import DailymotionPublisher
from cartoon_pipeline.publishers.oauth import OAuthTokenProvider
from cartoon_pipeline.publishers.youtube import YouTubePublisher

_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_POLICY = _ROOT / "config" / "content_policy.yaml"
_DEFAULT_PLATFORMS = _ROOT / "config" / "platforms.yaml"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="cartoon-pipeline")
    commands = parser.add_subparsers(dest="command", required=True)
    generate = commands.add_parser("generate", help="Generate today's cartoon assets")
    generate.add_argument("--output", type=Path, default=Path("build/cartoon"))
    generate.add_argument("--policy", type=Path, default=_DEFAULT_POLICY)
    generate.add_argument("--date", type=date.fromisoformat)
    publish = commands.add_parser("publish", help="Publish an approved episode")
    publish.add_argument("--episode", type=Path, required=True)
    publish.add_argument("--policy", type=Path, default=_DEFAULT_POLICY)
    publish.add_argument("--platforms", type=Path, default=_DEFAULT_PLATFORMS)
    args = parser.parse_args(argv)
    try:
        if args.command == "generate":
            manifest = generate_daily_episode(args.output, args.policy, args.date)
            print(json.dumps({"manifest": str(manifest)}))
            return 0
        return _publish(args)
    except (ValueError, RuntimeError, PermissionError) as exc:
        print(f"cartoon-pipeline: {exc}", file=sys.stderr)
        return 1


def _publish(args: argparse.Namespace) -> int:
    approval = approval_from_environment()
    episode = load_episode(args.episode)
    policy = load_content_policy(args.policy)
    platform_config = load_platforms(args.platforms)
    publishers = _build_publishers(platform_config)
    ledger_path = os.environ.get("CARTOON_LEDGER_PATH")
    if not ledger_path:
        raise RuntimeError("CARTOON_LEDGER_PATH must point to persistent storage")
    pipeline = PublicationPipeline(
        publishers=publishers,
        ledger=PublicationLedger(Path(ledger_path)),
        policy=policy,
    )
    receipts = pipeline.publish(episode, approval)
    print(
        json.dumps(
            [
                {
                    "platform": receipt.platform,
                    "remote_id": receipt.remote_id,
                    "status": receipt.status,
                    "error": receipt.error,
                }
                for receipt in receipts
            ],
            ensure_ascii=True,
        )
    )
    return 0 if all(receipt.status in {"published", "submitted", "already_published"} for receipt in receipts) else 1


def _build_publishers(platforms: dict[str, dict]) -> list[Publisher]:
    publishers: list[Publisher] = []
    for name, options in platforms.items():
        if not options["enabled"]:
            continue
        if name == "tiktok":
            if options.get("direct_post_enabled") is not True:
                raise RuntimeError("TikTok is enabled without an approved direct-post flow")
            raise RuntimeError(
                "TikTok publishing needs an interactive per-episode consent integration"
            )
        token = OAuthTokenProvider.from_environment(name)
        if name == "youtube":
            publishers.append(
                YouTubePublisher(
                    token,
                    privacy_status=options.get("privacy_status", "private"),
                    category_id=str(options.get("category_id", "1")),
                )
            )
        elif name == "dailymotion":
            profile_env = options.get("profile_id_env")
            profile_id = os.environ.get(profile_env, "") if isinstance(profile_env, str) else ""
            if not profile_id:
                raise RuntimeError("DAILYMOTION_PROFILE_ID is required when Dailymotion is enabled")
            publishers.append(
                DailymotionPublisher(
                    token,
                    profile_id=profile_id,
                    visibility=options.get("visibility", "private"),
                    category=options.get("category", "kids"),
                )
            )
        else:
            raise RuntimeError(f"Unsupported enabled platform: {name}")
    return publishers


if __name__ == "__main__":
    raise SystemExit(main())
