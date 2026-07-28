#!/usr/bin/env python3
"""Constrain crawler tasks to one result and seed one public benchmark account/platform."""

import json
import secrets
import sqlite3
import sys
from datetime import datetime, timezone


ACCOUNTS = {
    "youtube": ("https://www.youtube.com/@YouTube/shorts", "YouTube"),
    "tiktok": ("https://www.tiktok.com/@tiktok", "TikTok"),
    "facebook": ("https://www.facebook.com/facebook", "Facebook"),
    "instagram": ("https://www.instagram.com/instagram/", "Instagram"),
}


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: configure-crawler-smoke-test.py /path/to/data.db TENANT_ID")
    connection = sqlite3.connect(sys.argv[1])
    tenant_id = sys.argv[2]
    updated = 0
    for record_id, raw_config in connection.execute(
        "select id, config from scheduled_tasks where tenant_id = ?", (tenant_id,)
    ).fetchall():
        config = json.loads(raw_config or "{}")
        config["limit"] = "1"
        config["smokeTest"] = "1"
        connection.execute(
            "update scheduled_tasks set config = ? where id = ?",
            (json.dumps(config, ensure_ascii=False), record_id),
        )
        updated += 1
    created = 0
    for platform, (url, name) in ACCOUNTS.items():
        exists = connection.execute(
            "select 1 from competitor_accounts where tenantId = ? and accountUrl = ? limit 1",
            (tenant_id, url),
        ).fetchone()
        if exists:
            continue
        connection.execute(
            "insert into competitor_accounts (id, tenantId, platform, accountUrl, accountName, handle, avatarUrl, note, lastCrawledAt, lastCrawlCount, createdAt) values (?, ?, ?, ?, ?, ?, '', ?, '', 0, ?)",
            (secrets.token_hex(8)[:15], tenant_id, platform, url, name, name, "crawler smoke test", datetime.now(timezone.utc).isoformat()),
        )
        created += 1
    connection.commit()
    connection.close()
    print(f"tasks_updated={updated}")
    print(f"accounts_created={created}")


if __name__ == "__main__":
    main()
