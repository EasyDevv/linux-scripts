function ssh-auth --description 'Load the SSH key configured for a host and connect'
    if test (count $argv) -eq 0
        printf 'Usage: ssh-auth <host> [--key-only]\n' >&2
        return 2
    end

    set -l host $argv[1]
    set -l key_only 0

    switch "$host"
        case -h --help
            printf 'Usage: ssh-auth <host> [--key-only]\n'
            printf '       ssh-auth list\n'
            printf 'Load the effective IdentityFile from ~/.ssh/config.\n'
            printf 'Connect to the host unless --key-only is specified.\n'
            return 0
        case list
            if test (count $argv) -ne 1
                printf 'Usage: ssh-auth list\n' >&2
                return 2
            end

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
            end < "$config_file"

            if test (count $hosts) -eq 0
                printf 'No named SSH hosts found in %s.\n' "$config_file" >&2
                return 1
            end

            printf '%s\n' $hosts
            return 0
    end

    if test (count $argv) -gt 2
        printf 'Usage: ssh-auth <host> [--key-only]\n' >&2
        return 2
    end

    if test (count $argv) -eq 2
        if test "$argv[2]" = --key-only
            set key_only 1
        else
            printf 'Unknown option: %s\n' "$argv[2]" >&2
            printf 'Usage: ssh-auth <host> [--key-only]\n' >&2
            return 2
        end
    end

    if string match -q -- '-*' "$host"
        printf 'Host must be a config host, not an option: %s\n' "$host" >&2
        return 2
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
    if test $agent_status -eq 2
        set -l agent_setup (command ssh-agent -c)
        set -l agent_start_status $status
        if test $agent_start_status -ne 0
            printf 'Could not start ssh-agent.\n' >&2
            return 1
        end
        eval $agent_setup
        set agent_lines
    else if test $agent_status -ne 0; and test $agent_status -ne 1
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
    end

    if test $key_only -eq 1
        if test (count $identity_files_to_add) -eq 0
            printf 'SSH key already loaded for %s.\n' "$host"
        else
            printf 'SSH key loaded for %s.\n' "$host"
        end
        return 0
    end

    command ssh "$host"
end
