#!/bin/bash
# 测试新加坡机到 Google Gemini API 的直连延迟（各 N 次）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="https://generativelanguage.googleapis.com/"
N="${1:-20}"

test_path() {
  local ok=0 fail=0 total=0
  for _ in $(seq 1 "$N"); do
    t=$(curl -s -o /dev/null -w "%{http_code} %{time_total}" --max-time 15 "$URL")
    code=$(echo "$t" | awk '{print $1}')
    sec=$(echo "$t" | awk '{print $2}')
    if [[ "$code" == "000" ]]; then
      ((fail++))
    else
      ((ok++))
      total=$(echo "$total + $sec" | bc)
    fi
  done
  local avg="n/a"
  if [[ "$ok" -gt 0 ]]; then
    avg=$(echo "scale=3; $total / $ok" | bc)
  fi
  echo "新加坡直连: 成功=$ok 失败=$fail 平均=${avg}s (${N} 次)"
}

test_path
