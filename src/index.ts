import * as core from "@actions/core";
import * as github from "@actions/github";
import { google } from "googleapis";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

type Member = {
  id: string;
  displayName?: string;
};

type ChecklistItem = {
  note: string;
  prUrl: string;
  author: string;
};

const LINK_SECTION_MARKER = "<!-- checklist-to-sheets -->";

function readMembersConfig(configPath: string): Member[] {
  const fullPath = path.resolve(process.cwd(), configPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Members config not found at ${fullPath}`);
  }

  const content = fs.readFileSync(fullPath, "utf8");
  const ext = path.extname(fullPath).toLowerCase();
  let parsed: unknown;

  if (ext === ".yml" || ext === ".yaml") {
    parsed = yaml.load(content);
  } else {
    parsed = JSON.parse(content);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { members?: unknown }).members)
  ) {
    throw new Error("Config must be an object with a members array");
  }

  const members = (parsed as { members: Member[] }).members.filter((m) => !!m);

  if (!members.length) {
    throw new Error("Members list is empty");
  }

  members.forEach((member) => {
    if (!member.id) {
      throw new Error("Each member must have an id");
    }
  });

  return members;
}

function parseChecklistBlock(
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

function buildSideBySideRows(
  items: ChecklistItem[],
  members: Member[]
): (string | boolean)[][] {
  const longest = items.length;

  // Row 1: Member display names (with empty cells for spacing)
  const memberNameRow: (string | boolean)[] = [];
  members.forEach((member) => {
    memberNameRow.push(member.displayName || member.id, "", "", "");
  });

  // Row 2: Column headers for each member
  const headerRow: (string | boolean)[] = [];
  members.forEach(() => {
    headerRow.push("✓", "該当PR", "オーナー", "チェック内容");
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

async function appendToSheet(
  sheetId: string,
  rangeStart: string,
  values: (string | boolean)[][],
  keyB64: string,
  memberCount: number
) {
  const keyJson = Buffer.from(keyB64, "base64").toString("utf8");
  const creds = JSON.parse(keyJson);

  const client = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth: client });

  const dateTitle = new Date().toISOString().slice(0, 10);
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const existingTitles =
    spreadsheet.data.sheets
      ?.map((s) => s.properties?.title)
      .filter((title): title is string => !!title) || [];

  let sheetTitle = dateTitle;
  let suffix = 1;
  while (existingTitles.includes(sheetTitle)) {
    suffix += 1;
    sheetTitle = `${dateTitle}-${suffix}`;
  }

  const addSheetResponse = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: { title: sheetTitle },
          },
        },
      ],
    },
  });

  const createdSheetId =
    addSheetResponse.data.replies?.[0]?.addSheet?.properties?.sheetId;

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${sheetTitle}!${rangeStart}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  // Add checkbox data validation to checkbox columns (every 4th column starting from 0)
  // Skip header rows (row 0 and 1), start from row 2 (index 2)
  if (createdSheetId !== undefined && values.length > 2) {
    const checkboxRequests = [];
    const dataRowCount = values.length - 2; // Exclude 2 header rows

    for (let memberIndex = 0; memberIndex < memberCount; memberIndex++) {
      const columnIndex = memberIndex * 4; // Each member has 4 columns, checkbox is the first

      checkboxRequests.push({
        setDataValidation: {
          range: {
            sheetId: createdSheetId,
            startRowIndex: 2, // Skip 2 header rows
            endRowIndex: 2 + dataRowCount,
            startColumnIndex: columnIndex,
            endColumnIndex: columnIndex + 1,
          },
          rule: {
            condition: {
              type: "BOOLEAN",
            },
            showCustomUi: true,
          },
        },
      });
    }

    if (checkboxRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: checkboxRequests,
        },
      });
    }
  }

  return { sheetTitle, createdSheetId };
}

function upsertLinkSection(body: string, link: string, text: string): string {
  const section = `${LINK_SECTION_MARKER}\n[${text}](${link})\n${LINK_SECTION_MARKER}`;
  if (body.includes(LINK_SECTION_MARKER)) {
    const regex = new RegExp(
      `${LINK_SECTION_MARKER}[\\s\\S]*?${LINK_SECTION_MARKER}`
    );
    return body.replace(regex, section);
  }
  return `${body}\n\n${section}`;
}

function ensureTriggerLabel(
  triggerLabel: string,
  labels: { name?: string }[] | undefined
): boolean {
  if (!triggerLabel) return true;
  if (!labels) return false;
  return labels.some((label) => label.name === triggerLabel);
}

async function getLatestTagDateIso(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string
): Promise<string> {
  const { data: tags } = await octokit.rest.repos.listTags({
    owner,
    repo,
    per_page: 1,
  });

  if (!tags.length) {
    core.info("No tags found; fetching all PRs");
    return new Date(0).toISOString();
  }

  const latestTag = tags[0];
  const commitSha = latestTag.commit.sha;
  const commit = await octokit.rest.repos.getCommit({
    owner,
    repo,
    ref: commitSha,
  });

  const date =
    commit.data.commit.committer?.date || commit.data.commit.author?.date;

  if (!date) {
    throw new Error(`Could not resolve date for tag ${latestTag.name}`);
  }

  return new Date(date).toISOString();
}

type PrChecklistSource = {
  number: number;
  body: string;
  author: string;
  url: string;
  mergedAt?: string | null;
};

async function fetchMergedPrsSince(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  sinceIso: string
): Promise<PrChecklistSource[]> {
  const results: PrChecklistSource[] = [];
  let page = 1;
  const perPage = 50;

  // Search merged PRs since the tag date
  while (true) {
    const search = await octokit.rest.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} is:pr is:merged merged:>=${sinceIso}`,
      sort: "updated",
      order: "desc",
      per_page: perPage,
      page,
    });

    const items = search.data.items || [];
    if (!items.length) break;

    for (const item of items) {
      const prNumber = item.number;
      const pr = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });

      results.push({
        number: prNumber,
        body: pr.data.body || "",
        author: pr.data.user?.login || "",
        url: pr.data.html_url,
        mergedAt: pr.data.merged_at,
      });
    }

    if (items.length < perPage) break;
    page += 1;
  }

  return results;
}

async function run(): Promise<void> {
  try {
    const { payload, repo } = github.context;
    const pr = payload.pull_request;
    if (!pr) {
      core.info("Not a pull_request event, skipping");
      return;
    }

    const triggerLabel = core.getInput("trigger-label");
    if (!ensureTriggerLabel(triggerLabel, pr.labels)) {
      core.info(
        `Trigger label "${triggerLabel}" not present on PR #${pr.number}, skipping`
      );
      return;
    }

    const body = pr.body ?? "";
    const checklistStartMarker = core.getInput("checklist-start-marker") || "<!-- checklist -->";
    const checklistEndMarker = core.getInput("checklist-end-marker") || "<!-- checklist end -->";
    const membersConfigPath = core.getInput("members-config-path") || "config/members.json";
    const members = readMembersConfig(membersConfigPath);

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error("GITHUB_TOKEN not set; cannot fetch PR history");
    }
    const octokit = github.getOctokit(token);

    const latestTagDate = await getLatestTagDateIso(
      octokit,
      repo.owner,
      repo.repo
    );

    const mergedPrs = await fetchMergedPrsSince(
      octokit,
      repo.owner,
      repo.repo,
      latestTagDate
    );

    // Include current PR even if not merged yet
    const currentPrSource: PrChecklistSource = {
      number: pr.number,
      body,
      author: pr.user?.login || "",
      url: pr.html_url || `https://github.com/${repo.owner}/${repo.repo}/pull/${pr.number}`,
    };

    const allSources: PrChecklistSource[] = [];
    const seen = new Set<number>();
    for (const source of mergedPrs) {
      if (!seen.has(source.number)) {
        seen.add(source.number);
        allSources.push(source);
      }
    }
    if (!seen.has(currentPrSource.number)) {
      allSources.push(currentPrSource);
    }

    const allItems: ChecklistItem[] = [];
    for (const source of allSources) {
      const items = parseChecklistBlock(
        source.body,
        checklistStartMarker,
        checklistEndMarker,
        source.url,
        source.author
      );
      allItems.push(...items);
    }

    if (allItems.length === 0) {
      core.info("No checklist items found, skipping");
      return;
    }

    const values = buildSideBySideRows(allItems, members);
    const sheetId = core.getInput("sheet-id", { required: true });
    const sheetRange = core.getInput("sheet-range") || "A1";
    const startCell = sheetRange.includes("!")
      ? sheetRange.split("!")[1] || "A1"
      : sheetRange;
    const key = core.getInput("google-service-account-key", { required: true });

    const { sheetTitle, createdSheetId } = await appendToSheet(
      sheetId,
      startCell,
      values,
      key,
      members.length
    );
    core.info(
      `Created sheet "${sheetTitle}" with ${values.length} rows in spreadsheet ${sheetId}`
    );

    const appendLink = core.getInput("append-pr-link").toLowerCase() === "true";
    if (appendLink) {
      const sheetLinkText =
        core.getInput("sheet-link-text") || "Checklist synced to Google Sheets";
      const sheetUrlBase = `https://docs.google.com/spreadsheets/d/${sheetId}`;
      const sheetUrl =
        createdSheetId !== undefined
          ? `${sheetUrlBase}/edit#gid=${createdSheetId}`
          : sheetUrlBase;
      const nextBody = upsertLinkSection(body, sheetUrl, sheetLinkText);

      if (nextBody !== body) {
        await octokit.rest.pulls.update({
          owner: repo.owner,
          repo: repo.repo,
          pull_number: pr.number,
          body: nextBody,
        });
        core.info("Updated PR body with sheet link");
      } else {
        core.info("PR body already contains sheet link section, no update needed");
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed(String(error));
    }
  }
}

run();
