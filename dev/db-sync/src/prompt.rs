use std::io::{self, IsTerminal};

use anyhow::{bail, Result};

use crate::args::Side;
use crate::color::{
    category_rank, paint, table_category, BOLD, CYAN, DIM, GREEN, MAGENTA, RED, YELLOW,
};
use crate::diff::{Conflict, DbDiff, TableDiff};
use crate::merge::MergeChoices;
use crate::select::{select_one, Choice};
use crate::util::display_value;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MenuChoice {
    ReviewItems,
    WholeLocal,
    WholeRemote,
    Abort,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ItemChoice {
    Local,
    Remote,
    LocalRest,
    RemoteRest,
    Quit,
}

pub fn parse_menu_choice(raw: &str) -> Option<MenuChoice> {
    match raw.trim() {
        "1" | "i" | "I" => Some(MenuChoice::ReviewItems),
        "2" | "l" | "L" => Some(MenuChoice::WholeLocal),
        "3" | "r" | "R" => Some(MenuChoice::WholeRemote),
        "q" | "Q" => Some(MenuChoice::Abort),
        _ => None,
    }
}

pub fn parse_item_choice(raw: &str) -> Option<ItemChoice> {
    match raw.trim() {
        "l" => Some(ItemChoice::Local),
        "r" => Some(ItemChoice::Remote),
        "L" => Some(ItemChoice::LocalRest),
        "R" => Some(ItemChoice::RemoteRest),
        "q" | "Q" => Some(ItemChoice::Quit),
        _ => None,
    }
}

pub fn stdin_is_tty() -> bool {
    io::stdin().is_terminal()
}

pub fn print_summary(diff: &DbDiff) {
    for line in format_summary(diff) {
        eprintln!("{line}");
    }
}

pub fn format_summary(diff: &DbDiff) -> Vec<String> {
    let mut lines = Vec::new();
    lines.push(format!(
        "{} | {} | {} | {}",
        paint(format!("Local-only {}", diff.local_only_rows()), &[GREEN],),
        paint(format!("Remote-only {}", diff.remote_only_rows()), &[CYAN],),
        paint(format!("Conflict {}", diff.conflict_rows()), &[RED],),
        paint(format!("Identical {}", diff.identical_rows()), &[DIM],),
    ));
    lines.push(paint(
        format!(
            "Ready: {} local-only | {} remote-only | {} conflict",
            diff.local_only_rows(),
            diff.remote_only_rows(),
            diff.conflict_rows()
        ),
        if diff.conflict_rows() > 0 {
            &[RED]
        } else {
            &[DIM]
        },
    ));

    let mut sections: Vec<(&str, &str, Vec<String>)> = Vec::new();
    let push_row = |sections: &mut Vec<(&str, &str, Vec<String>)>, name: &str, row: String| {
        let (label, color) = table_category(name);
        if let Some(section) = sections
            .iter_mut()
            .find(|(existing, _, _)| *existing == label)
        {
            section.2.push(row);
        } else {
            sections.push((label, color, vec![row]));
        }
    };

    for table in &diff.tables {
        if table.is_empty() && !table.column_order_differs {
            continue;
        }
        push_row(
            &mut sections,
            &table.schema.name,
            format_table_row(
                &table.schema.name,
                table.local_only.len(),
                table.remote_only.len(),
                table.conflicts.len(),
                table.identical,
                None,
            ),
        );
    }
    for name in &diff.local_only_tables {
        push_row(
            &mut sections,
            name,
            format_table_row(name, 0, 0, 0, 0, Some("local-only table")),
        );
    }
    for name in &diff.remote_only_tables {
        push_row(
            &mut sections,
            name,
            format_table_row(name, 0, 0, 0, 0, Some("remote-only table")),
        );
    }

    sections.sort_by_key(|(label, _, _)| category_rank(label));
    for (label, color, rows) in sections {
        if rows.is_empty() {
            continue;
        }
        lines.push(String::new());
        lines.push(paint(format!("  {label} ({})", rows.len()), &[BOLD, color]));
        lines.extend(rows);
    }

    let order_notes: Vec<&str> = diff
        .tables
        .iter()
        .filter(|table| table.column_order_differs)
        .map(|table| table.schema.name.as_str())
        .collect();
    if !order_notes.is_empty() {
        lines.push(paint(
            format!(
                "note: column order differs (same names): {}",
                order_notes.join(", ")
            ),
            &[YELLOW],
        ));
    }
    lines
}

fn format_table_row(
    name: &str,
    local_only: usize,
    remote_only: usize,
    conflicts: usize,
    identical: usize,
    tag: Option<&str>,
) -> String {
    let plus = paint(format!("+{local_only}"), &[GREEN]);
    let minus = paint(format!("-{remote_only}"), &[CYAN]);
    let bang = paint(
        format!("!{conflicts}"),
        if conflicts > 0 { &[RED] } else { &[DIM] },
    );
    let eq = paint(format!("={identical}"), &[DIM]);
    let suffix = tag
        .map(|value| format!("  {}", paint(value, &[YELLOW])))
        .unwrap_or_default();
    format!("    {name:<28} {plus} {minus} {bang} {eq}{suffix}")
}

pub fn confirm_apply(message: &str) -> Result<bool> {
    let choices = [
        Choice {
            label: "No".into(),
            value: false,
            style: &[DIM],
        },
        Choice {
            label: "Yes".into(),
            value: true,
            style: &[RED],
        },
    ];
    Ok(select_one(&[message.to_string()], &choices, FOOTER)?.unwrap_or(false))
}

const FOOTER: &str = "↑/↓ move  enter select  q abort";

pub fn ask_menu() -> Result<MenuChoice> {
    let choices = [
        Choice {
            label: "Review each conflicting row".into(),
            value: MenuChoice::ReviewItems,
            style: &[CYAN],
        },
        Choice {
            label: "Use entire local .db (overwrite remote)".into(),
            value: MenuChoice::WholeLocal,
            style: &[GREEN],
        },
        Choice {
            label: "Use entire remote .db (overwrite local)".into(),
            value: MenuChoice::WholeRemote,
            style: &[CYAN],
        },
        Choice {
            label: "Abort".into(),
            value: MenuChoice::Abort,
            style: &[RED],
        },
    ];
    Ok(select_one(&[], &choices, FOOTER)?.unwrap_or(MenuChoice::Abort))
}

pub fn review_conflicts(diff: &DbDiff) -> Result<MergeChoices> {
    let mut choices = MergeChoices::default();
    let total = diff.conflict_rows();
    if total == 0 {
        return Ok(choices);
    }
    let mut seen = 0usize;
    for table in &diff.tables {
        for conflict in &table.conflicts {
            seen += 1;
            let header = format_conflict_lines(seen, total, table, conflict);
            let options = [
                Choice {
                    label: "Use local".into(),
                    value: ItemChoice::Local,
                    style: &[GREEN],
                },
                Choice {
                    label: "Use remote".into(),
                    value: ItemChoice::Remote,
                    style: &[CYAN],
                },
                Choice {
                    label: "Use local for the rest".into(),
                    value: ItemChoice::LocalRest,
                    style: &[GREEN],
                },
                Choice {
                    label: "Use remote for the rest".into(),
                    value: ItemChoice::RemoteRest,
                    style: &[CYAN],
                },
                Choice {
                    label: "Abort".into(),
                    value: ItemChoice::Quit,
                    style: &[RED],
                },
            ];
            let choice = select_one(&header, &options, FOOTER)?.unwrap_or(ItemChoice::Quit);
            match choice {
                ItemChoice::Local => {
                    choices.conflicts.insert(
                        (table.schema.name.clone(), conflict.pk.clone()),
                        Side::Local,
                    );
                }
                ItemChoice::Remote => {
                    choices.conflicts.insert(
                        (table.schema.name.clone(), conflict.pk.clone()),
                        Side::Remote,
                    );
                }
                ItemChoice::LocalRest => {
                    choices.conflicts.insert(
                        (table.schema.name.clone(), conflict.pk.clone()),
                        Side::Local,
                    );
                    fill_remaining(&mut choices, diff, Side::Local);
                    return Ok(choices);
                }
                ItemChoice::RemoteRest => {
                    choices.conflicts.insert(
                        (table.schema.name.clone(), conflict.pk.clone()),
                        Side::Remote,
                    );
                    fill_remaining(&mut choices, diff, Side::Remote);
                    return Ok(choices);
                }
                ItemChoice::Quit => bail!("aborted"),
            }
        }
    }
    Ok(choices)
}

fn fill_remaining(choices: &mut MergeChoices, diff: &DbDiff, side: Side) {
    for table in &diff.tables {
        for conflict in &table.conflicts {
            choices
                .conflicts
                .entry((table.schema.name.clone(), conflict.pk.clone()))
                .or_insert(side);
        }
    }
}

fn format_conflict_lines(
    index: usize,
    total: usize,
    table: &TableDiff,
    conflict: &Conflict,
) -> Vec<String> {
    let mut lines = vec![format!(
        "{}  {}",
        paint(
            format!("[{index}/{total}] {}", table.schema.name),
            &[BOLD, MAGENTA]
        ),
        paint(&conflict.display_pk, &[DIM])
    )];
    for col in &conflict.changed {
        let local = conflict
            .local
            .get(col)
            .map(display_value)
            .unwrap_or_else(|| "?".into());
        let remote = conflict
            .remote
            .get(col)
            .map(display_value)
            .unwrap_or_else(|| "?".into());
        lines.push(format!(
            "  {}: {}  |  {}",
            paint(col, &[YELLOW]),
            paint(local, &[GREEN]),
            paint(remote, &[CYAN])
        ));
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_tables_by_category() {
        use crate::diff::{TableDiff, TableSchema};
        let diff = DbDiff {
            tables: vec![TableDiff {
                schema: TableSchema {
                    name: "prop_units".into(),
                    columns: vec![],
                    pk: vec!["id".into()],
                },
                local_only: vec![],
                remote_only: vec![],
                conflicts: vec![],
                identical: 4,
                column_order_differs: true,
            }],
            local_only_tables: vec!["sys_extra".into()],
            remote_only_tables: vec![],
        };
        let text = format_summary(&diff).join("\n");
        assert!(text.contains("Property (1)"));
        assert!(text.contains("System (1)"));
        assert!(text.contains("prop_units"));
        assert!(text.contains("sys_extra"));
        assert!(text.contains("column order differs"));
    }

    #[test]
    fn parses_menu_and_item_keys() {
        assert_eq!(parse_menu_choice("1"), Some(MenuChoice::ReviewItems));
        assert_eq!(parse_menu_choice("2"), Some(MenuChoice::WholeLocal));
        assert_eq!(parse_menu_choice("3"), Some(MenuChoice::WholeRemote));
        assert_eq!(parse_menu_choice("q"), Some(MenuChoice::Abort));
        assert_eq!(parse_item_choice("l"), Some(ItemChoice::Local));
        assert_eq!(parse_item_choice("R"), Some(ItemChoice::RemoteRest));
        assert_eq!(parse_item_choice("nope"), None);
    }
}
