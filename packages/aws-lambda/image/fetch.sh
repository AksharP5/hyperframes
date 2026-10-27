# Source downloads for the ffmpeg build. One place for the retry policy: curl alone does not retry a reset connection.
SOURCES=${SOURCES:-/build/sources.txt}

retry() {
  local n
  for n in 1 2 3 4 5; do
    "$@" && return 0
    sleep $((n * 3))
  done
  return 1
}

fetch() {
  local name=$1 sum url
  read -r sum url <<<"$(awk -v n="$name" '$1 == n { print $2, $3 }' "$SOURCES")"
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 --connect-timeout 20 --max-time 600 -o "$SRC/$name" "$url"
  echo "$sum  $SRC/$name" | sha256sum -c --quiet
  tar -xf "$SRC/$name" -C "$SRC"
}
