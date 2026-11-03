#!/usr/bin/env bash
set -Eeuo pipefail

# Manages only the dedicated shop alias file. Refuse to overwrite changes made
# independently on the shared host. The caller keeps state until release commit.
mode="${1:?mode required}"
desired="${2:?source required}"
target="${3:?target required}"
previous="${4:-}"
state="${5:?state directory required}"

install_atomic() {
  local source="$1" staged
  staged="$(mktemp "${target}.tmp.XXXXXX")"
  if ! install -m 0644 "$source" "$staged" || ! mv -- "$staged" "$target"; then
    rm -- "$staged" 2>/dev/null || true
    return 1
  fi
}

restore() {
  [[ -f "$state/changed" ]] || return 0
  if [[ ! -f "$target" ]] || ! cmp -s "$target" "$desired"; then
    printf 'Alias route changed independently; refusing to overwrite it during rollback.\n' >&2
    return 1
  fi
  if [[ -f "$state/original" ]]; then
    install_atomic "$state/original"
  else
    rm -- "$target"
  fi
  nginx -t && systemctl reload nginx
  rm -- "$state/changed"
}

case "$mode" in
  apply)
    [[ -f "$desired" && ! -L "$target" ]] || exit 1
    if [[ -f "$target" ]] && cmp -s "$target" "$desired"; then exit 0; fi
    if [[ ! -e "$target" ]]; then
      existing_config="$(nginx -T 2>/dev/null)" || { printf 'Could not inspect Nginx configuration.\n' >&2; exit 1; }
      if printf '%s\n' "$existing_config" | grep -E '^[[:space:]]*server_name[[:space:]]' | grep -F 'xn--d1agbwq9e.xn--p1ai' >/dev/null; then
        printf 'The SIDZEN alias already belongs to another Nginx server; refusing to add a conflicting route.\n' >&2
        exit 1
      fi
    fi
    if [[ -e "$target" ]]; then
      if [[ ! -f "$previous" ]] || ! cmp -s "$target" "$previous"; then
        printf 'Alias route is independently managed; refusing to overwrite it.\n' >&2
        exit 1
      fi
      cp -p -- "$target" "$state/original"
    fi
    install_atomic "$desired"
    touch "$state/changed"
    if ! nginx -t || ! systemctl reload nginx; then
      printf 'Nginx validation or reload failed; restoring the previous alias route.\n' >&2
      restore || printf 'Automatic Nginx alias rollback failed; inspect the host configuration.\n' >&2
      exit 1
    fi
    ;;
  restore) restore ;;
  *) exit 2 ;;
esac
