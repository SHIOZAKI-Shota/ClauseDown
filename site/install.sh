#!/bin/sh
set -eu

REPO="SHIOZAKI-Shota/ClauseDown"
API="https://api.github.com/repos/$REPO/releases/latest"

say() { printf '%s\n' "$*"; }
fail() {
    printf 'エラー：%s\n' "$*" >&2
    exit 1
}

asset_url() {
    curl -fsSL "$API" | grep -o '"browser_download_url": *"[^"]*"' | sed 's/.*"\(https[^"]*\)"/\1/' | grep -E -e "$1" | head -n 1
}

install_mac() {
    [ "$(uname -m)" = "arm64" ] || fail "Intel Mac 版はありません。Apple シリコンの Mac で実行してください。"
    url=$(asset_url '-arm64-mac\.zip$') || true
    [ -n "$url" ] || fail "最新版の macOS 版が見つかりませんでした。"
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    say "ダウンロードしています：${url##*/}"
    curl -fL --progress-bar -o "$tmp/app.zip" "$url"
    ditto -xk "$tmp/app.zip" "$tmp/out"
    dest="/Applications"
    [ -w "$dest" ] || dest="$HOME/Applications"
    mkdir -p "$dest"
    if pgrep -xq ClauseDown; then
        say "起動中の ClauseDown を終了します。"
        osascript -e 'quit app "ClauseDown"' >/dev/null 2>&1 || true
        sleep 2
    fi
    rm -rf "$dest/ClauseDown.app"
    mv "$tmp/out/ClauseDown.app" "$dest/"
    xattr -dr com.apple.quarantine "$dest/ClauseDown.app" 2>/dev/null || true
    say "インストールしました：$dest/ClauseDown.app"
    say "起動するには：open -a ClauseDown"
}

install_win() {
    url=$(asset_url 'ClauseDown-Setup-[0-9.]+\.exe$') || true
    [ -n "$url" ] || fail "最新版の Windows 版が見つかりませんでした。"
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    say "ダウンロードしています：${url##*/}"
    curl -fL --progress-bar -o "$tmp/setup.exe" "$url"
    say "インストールしています…"
    MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*" "$tmp/setup.exe" /S
    say "インストールしました。スタートメニューから ClauseDown を起動してください。"
}

main() {
    command -v curl >/dev/null 2>&1 || fail "curl が見つかりません。"
    case "$(uname -s)" in
        Darwin) install_mac ;;
        MINGW* | MSYS* | CYGWIN*) install_win ;;
        *) fail "この OS 向けの版はありません（Windows・macOS のみ）。" ;;
    esac
}

main "$@"
