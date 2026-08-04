#!/usr/bin/env python3
"""解析招聘平台岗位 URL，输出结构化 JSON。

用法:
    python3 parse_job_url.py <岗位URL>

识别平台: BOSS直聘 / 拉勾 / 猎聘 / 前程无忧 / 智联招聘
"""
import json
import re
import sys
from urllib.parse import parse_qs, urlparse

PLATFORMS = {
    "zhipin.com": {"name": "BOSS直聘", "pattern": r"job_detail/([0-9a-zA-Z-]+)\.html"},
    "lagou.com": {"name": "拉勾", "pattern": r"jobs/(\d+)\.html"},
    "liepin.com": {"name": "猎聘", "pattern": r"job/\d+/"},
    "51job.com": {"name": "前程无忧", "pattern": None},
    "zhaopin.com": {"name": "智联招聘", "pattern": None},
}


def parse(url: str) -> dict:
    u = urlparse(url)
    host = (u.netloc or "").lower()

    platform = None
    for key, info in PLATFORMS.items():
        if key in host:
            platform = info
            break

    job_id = None
    if platform and platform.get("pattern"):
        m = re.search(platform["pattern"], url)
        if m:
            job_id = m.group(1)

    q = parse_qs(u.query)
    return {
        "platform": platform["name"] if platform else "unknown",
        "host": host,
        "job_id": job_id,
        "security_id": (q.get("securityId") or [None])[0],
        "url": url,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: parse_job_url.py <岗位URL>", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(parse(sys.argv[1]), ensure_ascii=False, indent=2))
