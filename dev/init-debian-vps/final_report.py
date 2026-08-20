#!/usr/bin/env python3
"""Static init-vps completion report. No secrets."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ReportSection:
    title: str
    role: str
    paths: tuple[str, ...]
    units: tuple[str, ...] = ()
    listens: tuple[str, ...] = ()
    nft_drop: bool = False


SECTIONS: tuple[ReportSection, ...] = (
    ReportSection(
        title="nftables",
        role="커널 문지기. IPv4 SSH 22와 HTTPS 80/443, IPv4 STUN 3478/udp만 허용한다. 공개 SSH source /32는 OVH Edge Firewall이 관리하고, wt0 전체 accept는 넣지 않는다.",
        paths=("/etc/nftables.conf",),
        units=("nftables",),
    ),
    ReportSection(
        title="CrowdSec",
        role=(
            "외부 공격 판별과 차단. Caddy/SSH/audit 로그를 읽고 "
            "nftables 바운서와 Caddy AppSec으로 막는다. "
            "LAPI는 127.0.0.1:8180 (8080은 NetBird). "
            "wt0 소스는 NetBird passthrough라 이 층에서 막지 않는다."
        ),
        paths=(
            "/etc/crowdsec/config.yaml",
            "/etc/crowdsec/acquis.d/appsec.yaml",
            "/etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml.local",
            "/etc/systemd/system/crowdsec-firewall-bouncer.service.d/nft-drop.conf",
            "/usr/local/sbin/vps-crowdsec-nft-drop",
        ),
        units=("crowdsec", "crowdsec-firewall-bouncer"),
        listens=("127.0.0.1:8180", "127.0.0.1:7422"),
        nft_drop=True,
    ),
    ReportSection(
        title="Caddy",
        role=(
            "공개 HTTPS 문. 관리 API만 인터넷에 두고 대시보드는 wt0. "
            "CrowdSec AppSec 모듈이 요청을 한 번 더 본다. appsec_fail_open."
        ),
        paths=(
            "/usr/local/bin/caddy",
            "/etc/caddy/Caddyfile",
            "/etc/caddy/Caddyfile.bak-stock",
            "/etc/systemd/system/caddy.service.d/crowdsec-bin.conf",
            "/usr/local/sbin/vps-caddy-rollback",
        ),
        units=("caddy",),
    ),
    ReportSection(
        title="NetBird",
        role="오버레이 ACL. 공개면은 관리 API. 대시보드와 사내 앱은 wt0만. Default full-mesh와 protocol-all은 끄고 포트 정책만 둔다.",
        paths=(
            "/opt/netbird/config.yaml",
            "/etc/systemd/system/netbird-podman.service",
            "/etc/systemd/system/netbird.service",
        ),
        units=("netbird-podman", "netbird"),
        listens=("127.0.0.1:8080", "127.0.0.1:8081"),
    ),
    ReportSection(
        title="auditd",
        role="중요한 파일/계정 변경을 커널이 기록한다. vps_ew 사건만 Discord로 간다.",
        paths=(
            "/etc/audit/rules.d/10-vps-early-warning.rules",
            "/etc/audit/plugins.d/vps-alert.conf",
            "/usr/local/sbin/vps-audit-plugin",
        ),
        units=("auditd",),
    ),
    ReportSection(
        title="Falco",
        role=(
            "런타임 이상 행동. modern eBPF로 프로세스/컨테이너 시스템콜을 본다. "
            "헬스는 127.0.0.1:8765만. Discord에는 WARNING 이상만."
        ),
        paths=(
            "/etc/falco/config.d/vps-early-warning.yaml",
            "/etc/falco/falco_rules.local.yaml",
            "/usr/local/sbin/vps-falco-alert",
        ),
        units=("falco-modern-bpf",),
        listens=("127.0.0.1:8765",),
    ),
    ReportSection(
        title="경보버스",
        role="정책을 통과한 보안 이벤트만 Discord로 보낸다. 일반 SSH preauth 거절은 집계하고, 성공 로그인/CrowdSec decision/authorized_keys·sshd·nftables 변경/SSH·NetBird 동시 장애를 즉시 알린다. 웹훅은 보고서에 없음.",
        paths=(
            "/usr/local/sbin/vps-alert",
            "/usr/local/sbin/vps-journal-watch",
            "/etc/systemd/system/vps-journal-watch.service",
            "/etc/systemd/journald.conf.d/vps-early-warning.conf",
            "/etc/vps-alert/.env.sender",
        ),
        units=("vps-journal-watch",),
        listens=("127.0.0.1:8766",),
    ),
)

def probe_request() -> dict[str, list[str]]:
    paths: list[str] = []
    units: list[str] = []
    listens: list[str] = []
    for section in SECTIONS:
        paths.extend(section.paths)
        units.extend(section.units)
        listens.extend(section.listens)
    return {
        "paths": sorted(set(paths)),
        "units": sorted(set(units)),
        "listens": sorted(set(listens)),
    }


def _flag(ok: bool) -> str:
    return "ok" if ok else "missing"


def section_ok(section: ReportSection, facts: dict[str, Any]) -> bool:
    paths = facts.get("paths") or {}
    units = facts.get("units") or {}
    listens = facts.get("listens") or {}
    if any(not paths.get(path) for path in section.paths):
        return False
    if any(not units.get(unit) for unit in section.units):
        return False
    if any(not listens.get(addr) for addr in section.listens):
        return False
    if section.nft_drop and not facts.get("nft_drop"):
        return False
    return True


def render_report(meta: dict[str, Any], facts: dict[str, Any]) -> str:
    early = bool(meta.get("early_warning"))
    rows: list[tuple[str, str]] = []
    all_ok = True
    for section in SECTIONS:
        if not early and section.title not in {"nftables", "NetBird", "Caddy"}:
            rows.append((section.title, "skipped"))
            continue
        ok = section_ok(section, facts)
        rows.append((section.title, "ok" if ok else "missing"))
        all_ok = all_ok and ok
    result = "PASS" if all_ok else "FAIL"
    lines = [
        "# init-vps 보고서",
        "",
        f"결과 **{result}**",
        (
            f"대상 {meta.get('target', '-')} · {meta.get('generated', '-')}"
        ),
        (
            f"공인 {facts.get('public_ip') or meta.get('public_ip') or '-'} · "
            f"오버레이 {facts.get('wt0_ip') or meta.get('overlay_ip') or '-'}"
        ),
        f"도메인 {meta.get('domain', '-')}",
        "공개 SSH 22 유지 · 앱 미배포",
        "",
        "| 층 | 상태 |",
        "|---|---|",
    ]
    for title, status in rows:
        lines.append(f"| {title} | {status} |")
    caddy_dir = str(facts.get("caddy_dir") or "")
    if caddy_dir:
        lines.append(f"| /etc/caddy | {caddy_dir} |")
    lines.append("")
    for section in SECTIONS:
        lines.append(f"## {section.title}")
        lines.append("")
        lines.append("역할")
        lines.append(section.role)
        lines.append("")
        lines.append("추가된 경로")
        paths = facts.get("paths") or {}
        if not early and section.title not in {"nftables", "NetBird", "Caddy"}:
            lines.append("- skipped")
            lines.append("")
            continue
        for path in section.paths:
            lines.append(f"- {_flag(bool(paths.get(path)))}  {path}")
        if section.units or section.listens or section.nft_drop:
            lines.append("")
            lines.append("상태")
            units = facts.get("units") or {}
            listens = facts.get("listens") or {}
            for unit in section.units:
                lines.append(f"- {_flag(bool(units.get(unit)))}  {unit}")
            for addr in section.listens:
                lines.append(f"- {_flag(bool(listens.get(addr)))}  {addr}")
            if section.nft_drop:
                lines.append(f"- {_flag(bool(facts.get('nft_drop')))}  nft drop")
        lines.append("")
    lines.append("비밀값(웹훅, 바운서 키, PAT)은 쓰지 않음.")
    lines.append("")
    text = "\n".join(lines)
    lowered = text.lower()
    if "discord.com/api/webhooks" in lowered or "caddy_crowdsec_key=" in lowered:
        raise ValueError("report would contain a secret")
    return text
