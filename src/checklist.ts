import * as core from "@actions/core";
import { ChecklistItem, Member } from "./types";

/**
 * Parse checklist items from PR body between markers
 */
export function parseChecklistBlock(
  body: string,
  startMarker: string,
  endMarker: string,
  prUrl: string,
  author: string
): ChecklistItem[] {
  const regex = new RegExp(
    startMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "\\s*([\\s\\S]*?)" +
      endMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "m"
  );
  const match = body.match(regex);

  if (!match) {
    return [];
  }

  const lines = match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const items: ChecklistItem[] = [];
  for (const line of lines) {
    // Match lines starting with "- " (simple list item without checkbox)
    const parsed = line.match(/^-\s+(.+)$/);
    if (!parsed) {
      core.info(`Skipping unparsable line: ${line}`);
      continue;
    }

    const [, note] = parsed;
    items.push({
      note: note.trim(),
      prUrl,
      author,
    });
  }

  return items;
}

/**
 * Convert column index to Excel-style column letter (0 -> A, 1 -> B, 26 -> AA, etc.)
 */
export function columnToLetter(column: number): string {
  let letter = "";
  let temp = column;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

/**
 * Build side-by-side rows for spreadsheet with member columns
 */
export function buildSideBySideRows(
  items: ChecklistItem[],
  members: Member[]
): (string | boolean)[][] {
  const longest = items.length;
  const dataStartRow = 3; // Row 3 in 1-indexed (after 2 header rows)
  const dataEndRow = dataStartRow + longest - 1;

  // Row 1: Member display names with completion status formula in adjacent cell
  const memberNameRow: (string | boolean)[] = [];
  members.forEach((member, memberIndex) => {
    const checkboxCol = columnToLetter(memberIndex * 4);
    const completionFormula = longest > 0
      ? `=IF(COUNTIF(${checkboxCol}${dataStartRow}:${checkboxCol}${dataEndRow},TRUE)=${longest},"✓ Done!","")`
      : "";
    memberNameRow.push(member.name, completionFormula, "", "");
  });

  // Row 2: Column headers for each member
  const headerRow: (string | boolean)[] = [];
  members.forEach(() => {
    headerRow.push("✓", "PR", "Owner", "Description");
  });

  const rows: (string | boolean)[][] = [memberNameRow, headerRow];

  // Data rows: each item repeated for each member with checkbox
  for (let i = 0; i < longest; i++) {
    const row: (string | boolean)[] = [];
    const item = items[i];
    members.forEach(() => {
      if (item) {
        row.push(false, item.prUrl, item.author, item.note);
      } else {
        row.push("", "", "", "");
      }
    });
    rows.push(row);
  }

  return rows;
}
