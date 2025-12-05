import * as core from "@actions/core";
import * as github from "@actions/github";
import { google } from "googleapis";

type ChecklistItem = {
  note: string;
  prUrl: string;
  author: string;
};

const LINK_SECTION_MARKER = "<!-- checklist-to-sheets -->";

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

function buildRows(items: ChecklistItem[]): string[][] {
  const headerRow: string[] = ["該当PR", "オーナー", "チェック内容"];
  const rows: string[][] = [headerRow];

  for (const item of items) {
    rows.push([item.prUrl, item.author, item.note]);
  }

  return rows;
}

async function appendToSheet(
  sheetId: string,
  rangeStart: string,
  values: string[][],
  keyB64: string
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

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${sheetTitle}!${rangeStart}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  const createdSheetId =
    addSheetResponse.data.replies?.[0]?.addSheet?.properties?.sheetId;

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

    const values = buildRows(allItems);
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
      key
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
