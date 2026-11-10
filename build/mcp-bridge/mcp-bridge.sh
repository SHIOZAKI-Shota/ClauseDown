#!/bin/sh
sock="$1"

fail() {
    id=$(printf '%s' "$2" | sed -E -n 's/.*"id"[[:space:]]*:[[:space:]]*([0-9]+|"[^"]*").*/\1/p')
    [ -n "$id" ] && printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32000,"message":"%s"}}\n' "$id" "$1"
}

while IFS= read -r line || [ -n "$line" ]; do
    [ -z "$line" ] && continue
    out=$(printf '%s' "$line" | curl -s --unix-socket "$sock" \
        -H 'Content-Type: application/json' \
        -H 'Accept: application/json, text/event-stream' \
        --data-binary @- -w '\n%{http_code}' http://clausedown/mcp 2>/dev/null)
    if [ $? -ne 0 ]; then
        fail 'ClauseDown が起動していないか、設定の「外部の AI からつなぐ（MCP）」がオフです' "$line"
        continue
    fi
    status=$(printf '%s\n' "$out" | tail -n 1)
    body=$(printf '%s\n' "$out" | sed '$d')
    case "$status" in
        2??) [ -n "$body" ] && printf '%s\n' "$body" ;;
        *) fail "ClauseDown がエラーを返しました（HTTP $status）" "$line" ;;
    esac
done
