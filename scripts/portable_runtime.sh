#!/bin/bash
# Shared by the macOS launcher and release packager.

_pr_resolve_tool() {
    local name="$1"
    shift
    local cand
    for cand in "$@"; do
        if [ -x "$cand" ]; then
            printf '%s\n' "$cand"
            return 0
        fi
    done
    cand="$(command -v "$name" 2>/dev/null || true)"
    if [ -n "$cand" ] && [ -x "$cand" ]; then
        printf '%s\n' "$cand"
        return 0
    fi
    return 1
}

_PR_AWK_BIN="$(_pr_resolve_tool awk /usr/bin/awk /bin/awk)" || { printf '%s\n' '[ERROR] Required tool missing: awk' >&2; return 1 2>/dev/null || exit 1; }
_PR_CURL_BIN="$(_pr_resolve_tool curl /usr/bin/curl /bin/curl)" || { printf '%s\n' '[ERROR] Required tool missing: curl' >&2; return 1 2>/dev/null || exit 1; }
_PR_TAR_BIN="$(_pr_resolve_tool tar /usr/bin/tar /bin/tar)" || { printf '%s\n' '[ERROR] Required tool missing: tar' >&2; return 1 2>/dev/null || exit 1; }
_PR_MKTEMP_BIN="$(_pr_resolve_tool mktemp /usr/bin/mktemp /bin/mktemp)" || { printf '%s\n' '[ERROR] Required tool missing: mktemp' >&2; return 1 2>/dev/null || exit 1; }
_PR_UNAME_BIN="$(_pr_resolve_tool uname /usr/bin/uname /bin/uname)" || { printf '%s\n' '[ERROR] Required tool missing: uname' >&2; return 1 2>/dev/null || exit 1; }
_PR_MKDIR_BIN="$(_pr_resolve_tool mkdir /bin/mkdir /usr/bin/mkdir)" || { printf '%s\n' '[ERROR] Required tool missing: mkdir' >&2; return 1 2>/dev/null || exit 1; }
_PR_MV_BIN="$(_pr_resolve_tool mv /bin/mv /usr/bin/mv)" || { printf '%s\n' '[ERROR] Required tool missing: mv' >&2; return 1 2>/dev/null || exit 1; }
_PR_RM_BIN="$(_pr_resolve_tool rm /bin/rm /usr/bin/rm)" || { printf '%s\n' '[ERROR] Required tool missing: rm' >&2; return 1 2>/dev/null || exit 1; }
_PR_RMDIR_BIN="$(_pr_resolve_tool rmdir /bin/rmdir /usr/bin/rmdir)" || { printf '%s\n' '[ERROR] Required tool missing: rmdir' >&2; return 1 2>/dev/null || exit 1; }
_PR_CHMOD_BIN="$(_pr_resolve_tool chmod /bin/chmod /usr/bin/chmod)" || { printf '%s\n' '[ERROR] Required tool missing: chmod' >&2; return 1 2>/dev/null || exit 1; }
_PR_SLEEP_BIN="$(_pr_resolve_tool sleep /bin/sleep /usr/bin/sleep)" || { printf '%s\n' '[ERROR] Required tool missing: sleep' >&2; return 1 2>/dev/null || exit 1; }

if [ -x /usr/bin/shasum ]; then
    _PR_SHA_MODE="shasum"
    _PR_SHA_BIN="/usr/bin/shasum"
elif [ -x /usr/bin/sha256sum ]; then
    _PR_SHA_MODE="sha256sum"
    _PR_SHA_BIN="/usr/bin/sha256sum"
elif command -v shasum >/dev/null 2>&1; then
    _PR_SHA_MODE="shasum"
    _PR_SHA_BIN="$(command -v shasum)"
elif command -v sha256sum >/dev/null 2>&1; then
    _PR_SHA_MODE="sha256sum"
    _PR_SHA_BIN="$(command -v sha256sum)"
else
    printf '%s\n' '[ERROR] Required tool missing: shasum or sha256sum' >&2
    return 1 2>/dev/null || exit 1
fi

get_macos_node_arch() {
    local raw="${1:-}"
    if [ -z "$raw" ]; then
        raw="$("$_PR_UNAME_BIN" -m)"
    fi
    local lower
    lower="$(printf '%s' "$raw" | "$_PR_AWK_BIN" '{print tolower($0)}')"
    case "$lower" in
        arm64|aarch64)
            printf '%s\n' 'arm64'
            ;;
        x86_64|amd64|x64)
            printf '%s\n' 'x64'
            ;;
        *)
            printf '%s\n' 'Only 64-bit macOS (arm64 or x64) is supported.' >&2
            return 1
            ;;
    esac
}

read_macos_runtime_spec() {
    local project_root="$1"
    local arch="$2"
    local manifest_path="$project_root/scripts/node-runtime.json"
    if [ -L "$manifest_path" ] || [ ! -f "$manifest_path" ]; then
        printf '%s\n' "Portable runtime manifest is missing: $manifest_path" >&2
        return 1
    fi

    local parsed
    parsed="$("$_PR_AWK_BIN" -v arch="$arch" '
        function fail(msg) {
            print "INVALID:" msg > "/dev/stderr"
            bad = 1
            exit 1
        }
        {
            text = (NR == 1 ? $0 : text "\n" $0)
        }
        END {
            if (bad) exit 1
            depth = 0
            path_len = 0
            n = length(text)
            pos = 1
            while (pos <= n) {
                rest = substr(text, pos)
                if (match(rest, /^[ \t\r\n]+/)) {
                    pos += RLENGTH
                    continue
                }
                tok = ""
                ttype = ""
                if (substr(rest, 1, 1) == "\"") {
                    if (!match(rest, /^"([^"\\]|\\.)*"/)) fail("unterminated string")
                    tok = substr(rest, 2, RLENGTH - 2)
                    ttype = "STR"
                    pos += RLENGTH
                } else if (match(rest, /^[{}\[\]:,]/)) {
                    tok = substr(rest, 1, 1)
                    ttype = tok
                    pos += 1
                } else if (match(rest, /^[^ \t\r\n{}\[\]:,"]+/)) {
                    tok = substr(rest, 1, RLENGTH)
                    ttype = "LIT"
                    pos += RLENGTH
                } else {
                    fail("unexpected token")
                }

                if (ttype == "{") {
                    did_push = 0
                    if (depth > 0 && mode[depth] == "obj" && expect[depth] == "val") {
                        path_len++
                        path_seg[path_len] = cur_key[depth]
                        did_push = 1
                    }
                    depth++
                    mode[depth] = "obj"
                    expect[depth] = "key"
                    pushed[depth] = did_push
                } else if (ttype == "[") {
                    did_push = 0
                    if (depth > 0 && mode[depth] == "obj" && expect[depth] == "val") {
                        path_len++
                        path_seg[path_len] = cur_key[depth]
                        did_push = 1
                    }
                    depth++
                    mode[depth] = "arr"
                    expect[depth] = "val"
                    pushed[depth] = did_push
                } else if (ttype == "}" || ttype == "]") {
                    if (depth <= 0) fail("unbalanced braces")
                    if (pushed[depth] == 1) path_len--
                    depth--
                    if (depth > 0) expect[depth] = "comma"
                } else if (ttype == ":") {
                    if (depth <= 0 || mode[depth] != "obj" || expect[depth] != "colon") fail("unexpected colon")
                    expect[depth] = "val"
                } else if (ttype == ",") {
                    if (depth <= 0) fail("unexpected comma")
                    expect[depth] = (mode[depth] == "obj" ? "key" : "val")
                } else {
                    if (depth <= 0) fail("unexpected scalar")
                    if (mode[depth] == "obj" && expect[depth] == "key") {
                        if (ttype != "STR") fail("non-string key")
                        cur_key[depth] = tok
                        expect[depth] = "colon"
                    } else if (mode[depth] == "obj" && expect[depth] == "val") {
                        full_key = ""
                        for (i = 1; i <= path_len; i++) {
                            full_key = (full_key == "" ? path_seg[i] : full_key "." path_seg[i])
                        }
                        full_key = (full_key == "" ? cur_key[depth] : full_key "." cur_key[depth])
                        vals[full_key] = tok
                        expect[depth] = "comma"
                    } else if (mode[depth] == "arr" && expect[depth] == "val") {
                        expect[depth] = "comma"
                    } else {
                        fail("unexpected token sequence")
                    }
                }
            }
            if (depth != 0) fail("unclosed container")
            ver = vals["version"]
            lic = tolower(vals["macos.licenseSha256"])
            arch_sha = tolower(vals["macos." arch ".archiveSha256"])
            node_sha = tolower(vals["macos." arch ".nodeSha256"])
            print ver "|" arch_sha "|" node_sha "|" lic
        }
    ' "$manifest_path")" || {
        printf '%s\n' 'Invalid portable Node.js manifest.' >&2
        return 1
    }

    local version archive_sha node_sha license_sha
    IFS='|' read -r version archive_sha node_sha license_sha <<EOF
$parsed
EOF

    if ! printf '%s' "$version" | "$_PR_AWK_BIN" '/^v[0-9]+\.[0-9]+\.[0-9]+$/ { ok=1 } END { exit (ok ? 0 : 1) }'; then
        printf '%s\n' 'Invalid portable Node.js version.' >&2
        return 1
    fi
    local digest
    for digest in "$archive_sha" "$node_sha" "$license_sha"; do
        if ! printf '%s' "$digest" | "$_PR_AWK_BIN" '/^[a-f0-9]{64}$/ { ok=1 } END { exit (ok ? 0 : 1) }'; then
            printf '%s\n' 'Invalid portable Node.js SHA-256 manifest.' >&2
            return 1
        fi
    done

    _PR_SPEC_VERSION="$version"
    _PR_SPEC_DIR="node-${version}-darwin-${arch}"
    _PR_SPEC_URL="https://nodejs.org/dist/${version}/${_PR_SPEC_DIR}.tar.gz"
    _PR_SPEC_ARCHIVE_SHA256="$archive_sha"
    _PR_SPEC_NODE_SHA256="$node_sha"
    _PR_SPEC_LICENSE_SHA256="$license_sha"
}

get_runtime_file_sha256() {
    local target_path="$1"
    if [ "$_PR_SHA_MODE" = "shasum" ]; then
        "$_PR_SHA_BIN" -a 256 "$target_path" | "$_PR_AWK_BIN" '{print tolower($1)}'
    else
        "$_PR_SHA_BIN" "$target_path" | "$_PR_AWK_BIN" '{print tolower($1)}'
    fi
}

assert_runtime_directory() {
    local dir_path="$1"
    if [ -L "$dir_path" ] || { [ -e "$dir_path" ] && [ ! -d "$dir_path" ]; }; then
        printf '%s\n' "Portable runtime requires a regular directory: $dir_path" >&2
        return 1
    fi
}

assert_runtime_file() {
    local file_path="$1"
    local expected_sha="$2"
    if [ -L "$file_path" ]; then
        printf '%s\n' "Portable runtime cannot use a linked file: $file_path" >&2
        return 1
    fi
    if [ ! -f "$file_path" ]; then
        printf '%s\n' "Portable runtime file is missing: $file_path" >&2
        return 1
    fi
    local expected_lower actual_sha
    expected_lower="$(printf '%s' "$expected_sha" | "$_PR_AWK_BIN" '{print tolower($0)}')"
    actual_sha="$(get_runtime_file_sha256 "$file_path")" || return 1
    if [ "$actual_sha" != "$expected_lower" ]; then
        printf '%s\n' "Portable runtime SHA-256 mismatch: $file_path. Extract a fresh release package or remove .runtime and retry." >&2
        return 1
    fi
}

if ! declare -F save_node_runtime_archive >/dev/null 2>&1; then
    save_node_runtime_archive() {
        local uri="$1"
        local destination="$2"
        "$_PR_CURL_BIN" --fail --silent --show-error --proto =https --tlsv1.2 --max-redirs 0 --connect-timeout 30 --max-time 180 -o "$destination" "$uri"
    }
fi

_pr_prepare_runtime_locked() {
    local runtime_root="$1"
    local target_dir="$2"
    local node_file="$3"
    local license_file="$4"
    local tmp_dir="$5"

    assert_runtime_directory "$target_dir" || return 1
    if [ -e "$node_file" ] || [ -L "$node_file" ] || [ -e "$license_file" ] || [ -L "$license_file" ]; then
        assert_runtime_file "$node_file" "$_PR_SPEC_NODE_SHA256" || return 1
        assert_runtime_file "$license_file" "$_PR_SPEC_LICENSE_SHA256" || return 1
        return 0
    fi

    local archive="$tmp_dir/archive.tar.gz"
    local node_tmp="$tmp_dir/node"
    local license_tmp="$tmp_dir/LICENSE"

    printf '%s\n' "[Runtime] Preparing portable Node.js from $_PR_SPEC_URL" >&2
    printf '%s\n' '[Runtime] This stays inside the project; no installation or PATH change is needed.' >&2

    save_node_runtime_archive "$_PR_SPEC_URL" "$archive" || return 1
    assert_runtime_file "$archive" "$_PR_SPEC_ARCHIVE_SHA256" || return 1

    # Extract only these exact entries; never expand paths or symlinks supplied by the archive.
    if ! "$_PR_TAR_BIN" -xOzf "$archive" "${_PR_SPEC_DIR}/bin/node" > "$node_tmp" 2>/dev/null; then
        printf '%s\n' 'Node.js archive is missing bin/node.' >&2
        return 1
    fi
    if ! "$_PR_TAR_BIN" -xOzf "$archive" "${_PR_SPEC_DIR}/LICENSE" > "$license_tmp" 2>/dev/null; then
        printf '%s\n' 'Node.js archive is missing LICENSE.' >&2
        return 1
    fi

    assert_runtime_file "$node_tmp" "$_PR_SPEC_NODE_SHA256" || return 1
    assert_runtime_file "$license_tmp" "$_PR_SPEC_LICENSE_SHA256" || return 1

    "$_PR_CHMOD_BIN" 0755 "$node_tmp" || return 1
    "$_PR_CHMOD_BIN" 0644 "$license_tmp" || return 1

    assert_runtime_directory "$target_dir" || return 1
    "$_PR_MKDIR_BIN" -p "$target_dir" || return 1
    "$_PR_MV_BIN" "$license_tmp" "$license_file" || return 1
    "$_PR_MV_BIN" "$node_tmp" "$node_file" || return 1
}

get_portable_node() {
    if [ "$#" -lt 1 ]; then
        printf '%s\n' 'Usage: get_portable_node <project_root> [arm64|x64] [--offline]' >&2
        return 1
    fi
    local project_root="$1"
    shift

    local arch=""
    local offline=0
    if [ "${AG_PORTABLE_OFFLINE:-0}" = "1" ]; then
        offline=1
    fi
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --offline)
                offline=1
                ;;
            *)
                if [ -n "$arch" ]; then
                    printf '%s\n' "Unexpected argument to get_portable_node: $1" >&2
                    return 1
                fi
                arch="$1"
                ;;
        esac
        shift
    done

    if [ -z "$arch" ]; then
        arch="$(get_macos_node_arch)" || return 1
    else
        arch="$(get_macos_node_arch "$arch")" || return 1
    fi

    read_macos_runtime_spec "$project_root" "$arch" || return 1

    local runtime_root="$project_root/.runtime"
    local target_dir="$runtime_root/$_PR_SPEC_DIR"
    local node_file="$target_dir/node"
    local license_file="$target_dir/LICENSE"

    assert_runtime_directory "$runtime_root" || return 1
    assert_runtime_directory "$target_dir" || return 1

    if [ -e "$node_file" ] || [ -L "$node_file" ] || [ -e "$license_file" ] || [ -L "$license_file" ]; then
        assert_runtime_file "$node_file" "$_PR_SPEC_NODE_SHA256" || return 1
        assert_runtime_file "$license_file" "$_PR_SPEC_LICENSE_SHA256" || return 1
        printf '%s\n' "$node_file"
        return 0
    fi

    if [ "$offline" -eq 1 ]; then
        printf '%s\n' 'Portable runtime is missing. Extract the complete macOS release ZIP.' >&2
        return 1
    fi

    "$_PR_MKDIR_BIN" -p "$runtime_root" || return 1
    local lock_dir="$runtime_root/download.lock.d"
    if [ -L "$lock_dir" ] || { [ -e "$lock_dir" ] && [ ! -d "$lock_dir" ]; }; then
        printf '%s\n' 'Portable runtime download lock cannot be a linked directory.' >&2
        return 1
    fi

    local attempts=0
    while ! "$_PR_MKDIR_BIN" "$lock_dir" 2>/dev/null; do
        if [ -L "$lock_dir" ] || { [ -e "$lock_dir" ] && [ ! -d "$lock_dir" ]; }; then
            printf '%s\n' 'Portable runtime download lock cannot be a linked directory.' >&2
            return 1
        fi
        attempts=$((attempts + 1))
        if [ "$attempts" -ge 120 ]; then
            printf '%s\n' "Timed out waiting for portable runtime lock: $lock_dir" >&2
            return 1
        fi
        "$_PR_SLEEP_BIN" 0.5
    done

    local tmp_dir=""
    local status=0
    tmp_dir="$("$_PR_MKTEMP_BIN" -d "$runtime_root/.tmp.XXXXXX")" || status=1
    if [ "$status" -eq 0 ]; then
        _pr_prepare_runtime_locked "$runtime_root" "$target_dir" "$node_file" "$license_file" "$tmp_dir" || status=1
    fi
    if [ -n "$tmp_dir" ] && [ -d "$tmp_dir" ]; then
        "$_PR_RM_BIN" -rf "$tmp_dir" || true
    fi
    "$_PR_RMDIR_BIN" "$lock_dir" 2>/dev/null || true

    if [ "$status" -ne 0 ]; then
        return 1
    fi

    assert_runtime_file "$node_file" "$_PR_SPEC_NODE_SHA256" || return 1
    assert_runtime_file "$license_file" "$_PR_SPEC_LICENSE_SHA256" || return 1
    printf '%s\n' "$node_file"
}
