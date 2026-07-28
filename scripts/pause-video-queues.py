#!/usr/bin/env python3
"""Pause scheduled crawls and queued video pipeline work in a PocketBase SQLite DB."""

import json
import sqlite3
import sys


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: pause-video-queues.py /path/to/data.db")
    connection = sqlite3.connect(sys.argv[1])
    connection.execute("update scheduled_tasks set enabled = 0")
    active_states = {
        "queued", "downloading", "analyzing", "ops_queued",
        "ops_processing", "download_retrying",
    }
    paused = 0
    for record_id, raw_analysis in connection.execute("select id, aiAnalysis from trend_videos").fetchall():
        try:
            analysis = json.loads(raw_analysis or "{}")
        except (TypeError, json.JSONDecodeError):
            continue
        current = str(analysis.get("downloadStatus") or analysis.get("videoFetchStatus") or "")
        if current not in active_states:
            continue
        analysis.update({
            "pipelinePaused": True,
            "pausedFromStatus": current,
            "downloadStatus": "paused",
            "videoFetchStatus": "paused",
        })
        connection.execute(
            "update trend_videos set aiAnalysis = ? where id = ?",
            (json.dumps(analysis, ensure_ascii=False), record_id),
        )
        paused += 1
    connection.commit()
    enabled = connection.execute("select count(*) from scheduled_tasks where enabled = 1").fetchone()[0]
    connection.close()
    print(f"scheduled_enabled={enabled}")
    print(f"paused_records={paused}")


if __name__ == "__main__":
    main()
