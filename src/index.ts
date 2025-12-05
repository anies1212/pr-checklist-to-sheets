import * as core from "@actions/core";
import * as github from "@actions/github";

import { ChecklistItem, PrChecklistSource } from "./types";
import { readMembersConfig } from "./config";
import { parseChecklistBlock, buildSideBySideRows } from "./checklist";
import { appendToSheet } from "./sheets";
import {
  getLatestTagDateIso,
  fetchMergedPrsSince,
  ensureTriggerLabel,
  upsertLinkSection,
} from "./github";

async function run(): Promise<void> {
  try {
    const { payload, repo } = github.context;
    const pr = payload.pull_request;

    if (!pr) {
      core.info("Not a pull_request event, skipping");
      return;
    }

    // Check trigger label
    const triggerLabel = core.getInput("trigger-label");
    if (!ensureTriggerLabel(triggerLabel, pr.labels)) {
      core.info(
        `Trigger label "${triggerLabel}" not present on PR #${pr.number}, skipping`
      );
      return;
    }

    // Read inputs
    const body = pr.body ?? "";
    const checklistStartMarker =
      core.getInput("checklist-start-marker") || "<!-- checklist -->";
    const checklistEndMarker =
      core.getInput("checklist-end-marker") || "<!-- checklist end -->";
    const membersConfigPath =
      core.getInput("members-config-path") || "config/members.json";

    // Load members config
    const members = readMembersConfig(membersConfigPath);

    // Initialize GitHub API client
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error("GITHUB_TOKEN not set; cannot fetch PR history");
    }
    const octokit = github.getOctokit(token);

    // Get latest tag date for PR filtering
    const latestTagDate = await getLatestTagDateIso(
      octokit,
      repo.owner,
      repo.repo
    );

    // Fetch merged PRs since last tag
    const mergedPrs = await fetchMergedPrsSince(
      octokit,
      repo.owner,
      repo.repo,
      latestTagDate
    );

    // Build list of PR sources (merged + current)
    const currentPrSource: PrChecklistSource = {
      number: pr.number,
      body,
      author: pr.user?.login || "",
      url:
        pr.html_url ||
        `https://github.com/${repo.owner}/${repo.repo}/pull/${pr.number}`,
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

    // Parse checklist items from all PRs
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

    // Build spreadsheet data
    const values = buildSideBySideRows(allItems, members);

    // Write to Google Sheets
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

    // Update PR body with sheet link
    const appendLink =
      core.getInput("append-pr-link").toLowerCase() === "true";

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
        core.info(
          "PR body already contains sheet link section, no update needed"
        );
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
