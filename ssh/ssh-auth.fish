function ssh-auth --description 'Load the SSH key configured for a host'
    if test (count $argv) -eq 0
        __ssh_auth_usage >&2
        return 2
    end

    switch "$argv[1]"
        case -h --help
            __ssh_auth_usage
            printf '       ssh-auth list\n'
            printf 'Load the effective IdentityFile from ~/.ssh/config into a user-session agent.\n'
            printf 'Does not open an SSH session unless --connect is specified.\n'
            return 0
        case list
            if test (count $argv) -ne 1
                printf 'Usage: ssh-auth list\n' >&2
                return 2
            end
            __ssh_auth_list
            return $status
    end

    set -l host
    set -l connect 0
    set -l key_only 0

    for arg in $argv
        switch "$arg"
            case --connect
                set connect 1
            case --key-only
                set key_only 1
            case -h --help
                __ssh_auth_usage
                return 0
            case '-*'
                printf 'Unknown option: %s\n' "$arg" >&2
                __ssh_auth_usage >&2
                return 2
            case '*'
                if test -n "$host"
                    printf 'Unexpected argument: %s\n' "$arg" >&2
                    __ssh_auth_usage >&2
                    return 2
                end
                set host $arg
        end
    end

    if test -z "$host"
        __ssh_auth_usage >&2
        return 2
    end

    if test $connect -eq 1; and test $key_only -eq 1
        printf 'Use either --connect or --key-only, not both.\n' >&2
        return 2
    end

    if string match -q -- '-*' "$host"
        printf 'Host must be a config host, not an option: %s\n' "$host" >&2
        return 2
    end

    if not __ssh_auth_ensure_agent
        return 1
    end

    set -l config_lines (command ssh -G "$host" 2>/dev/null)
    if test $status -ne 0
        printf 'Could not resolve SSH configuration for host: %s\n' "$host" >&2
        return 1
    end

    set -l identity_files
    for line in $config_lines
        if string match -q -- 'identityfile *' "$line"
            set -l identity_file (string replace 'identityfile ' '' -- "$line")
            set identity_file (string replace -r '^~/' "$HOME/" -- "$identity_file")
            if test -f "$identity_file"; and not contains -- "$identity_file" $identity_files
                set -a identity_files "$identity_file"
            end
        end
    end

    if test (count $identity_files) -eq 0
        printf 'No usable IdentityFile found for host: %s\n' "$host" >&2
        return 1
    end

    set -l agent_lines (command ssh-add -l 2>/dev/null)
    set -l agent_status $status
    if test $agent_status -ne 0; and test $agent_status -ne 1
        printf 'Could not inspect ssh-agent.\n' >&2
        return 1
    end

    set -l agent_fingerprints
    for line in $agent_lines
        set -l fields (string split -n ' ' -- "$line")
        if test (count $fields) -ge 2
            set -a agent_fingerprints $fields[2]
        end
    end

    set -l identity_files_to_add
    for identity_file in $identity_files
        set -l fingerprint_lines (command ssh-keygen -lf "$identity_file" 2>/dev/null)
        if test $status -ne 0
            set -a identity_files_to_add "$identity_file"
            continue
        end

        set -l fingerprint_fields (string split -n ' ' -- "$fingerprint_lines[1]")
        set -l fingerprint $fingerprint_fields[2]
        if test -z "$fingerprint"; or not contains -- "$fingerprint" $agent_fingerprints
            set -a identity_files_to_add "$identity_file"
        end
    end

    if test (count $identity_files_to_add) -gt 0
        if not command ssh-add -- $identity_files_to_add
            printf 'Could not add the SSH key for host: %s\n' "$host" >&2
            return 1
        end
        printf 'SSH key loaded for %s.\n' "$host"
    else
        printf 'SSH key already loaded for %s.\n' "$host"
    end

    if test $connect -eq 1
        command ssh "$host"
        return $status
    end

    return 0
end

function __ssh_auth_usage
    printf 'Usage: ssh-auth <host> [--connect]\n'
end

function __ssh_auth_runtime_dir
    if set -q XDG_RUNTIME_DIR; and test -n "$XDG_RUNTIME_DIR"
        printf '%s\n' "$XDG_RUNTIME_DIR/ssh-auth"
    else
        printf '%s\n' "$HOME/.cache/ssh-auth"
    end
end

function __ssh_auth_agent_usable
    command ssh-add -l >/dev/null 2>&1
    set -l agent_status $status
    test $agent_status -eq 0 -o $agent_status -eq 1
end

function __ssh_auth_use_socket --argument-names sock
    if test -z "$sock"; or not test -S "$sock"
        return 1
    end
    set -gx SSH_AUTH_SOCK "$sock"
    __ssh_auth_agent_usable
end

function __ssh_auth_write_env --argument-names env_file
    printf 'SSH_AUTH_SOCK=%s\n' "$SSH_AUTH_SOCK" >"$env_file"
    if set -q SSH_AGENT_PID; and test -n "$SSH_AGENT_PID"
        printf 'SSH_AGENT_PID=%s\n' "$SSH_AGENT_PID" >>"$env_file"
    end
    command chmod 600 -- "$env_file"
end

function __ssh_auth_load_env --argument-names env_file
    if not test -r "$env_file"
        return 1
    end
    while read -l line
        if string match -q 'SSH_AUTH_SOCK=*' -- "$line"
            set -gx SSH_AUTH_SOCK (string replace 'SSH_AUTH_SOCK=' '' -- "$line")
        else if string match -q 'SSH_AGENT_PID=*' -- "$line"
            set -gx SSH_AGENT_PID (string replace 'SSH_AGENT_PID=' '' -- "$line")
        end
    end <"$env_file"
    return 0
end

function __ssh_auth_ensure_agent
    if __ssh_auth_agent_usable
        return 0
    end

    if set -q XDG_RUNTIME_DIR; and __ssh_auth_use_socket "$XDG_RUNTIME_DIR/ssh-agent.socket"
        return 0
    end

    set -l runtime (__ssh_auth_runtime_dir)
    if not command mkdir -p -m 700 -- "$runtime"
        printf 'Could not create ssh-auth runtime directory.\n' >&2
        return 1
    end
    command chmod 700 -- "$runtime"

    set -l sock "$runtime/agent.sock"
    set -l env_file "$runtime/agent.env"

    if test -r "$env_file"
        __ssh_auth_load_env "$env_file"
        if __ssh_auth_agent_usable
            return 0
        end
    end

    if __ssh_auth_use_socket "$sock"
        __ssh_auth_write_env "$env_file"
        return 0
    end

    if test -e "$sock"
        command rm -f -- "$sock"
    end

    set -l agent_setup (command ssh-agent -a "$sock" -c)
    if test $status -ne 0
        printf 'Could not start ssh-agent.\n' >&2
        return 1
    end
    eval $agent_setup
    if not __ssh_auth_agent_usable
        printf 'Could not start ssh-agent.\n' >&2
        return 1
    end
    __ssh_auth_write_env "$env_file"
    return 0
end

function __ssh_auth_list
    set -l config_file "$HOME/.ssh/config"
    if not test -r "$config_file"
        printf 'SSH config not found or unreadable: %s\n' "$config_file" >&2
        return 1
    end

    set -l hosts
    while read -l line
        if not string match -q -r '^[[:space:]]*[Hh][Oo][Ss][Tt][[:space:]]+' "$line"
            continue
        end

        set -l host_line (string replace -r '[[:space:]]+#.*$' '' -- "$line")
        set host_line (string replace -r '^[[:space:]]*[Hh][Oo][Ss][Tt][[:space:]]+' '' -- "$host_line")
        set host_line (string trim -- "$host_line")

        for host_pattern in (string split -r '\s+' -- "$host_line")
            if test -z "$host_pattern"; or string match -q -r '[*?!]' -- "$host_pattern"
                continue
            end
            if not contains -- "$host_pattern" $hosts
                set -a hosts "$host_pattern"
            end
        end
    end <"$config_file"

    if test (count $hosts) -eq 0
        printf 'No named SSH hosts found in %s.\n' "$config_file" >&2
        return 1
    end

    printf '%s\n' $hosts
    return 0
end
