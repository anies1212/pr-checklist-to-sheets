import * as core from "@actions/core";
import * as github from "@actions/github";

import { ChecklistItem, PrChecklistSource, GoogleAuthConfig } from "./types";
import { readMembersConfig } from "./config";
import { parseChecklistBlock, buildSideBySideRows } from "./checklist";
import { appendToSheet } from "./sheets";
import {
  getLatestTagDateIso,
  getRefDateIso,
  fetchMergedPrsBetween,
  upsertLinkSection,
} from "./github";

async function run(): Promise<void> {
  try {
    core.info("=== PR Checklist to Sheets: Starting ===");

    const { payload, repo } = github.context;
    const pr = payload.pull_request;

    if (!pr) {
      core.info("Not a pull_request event, skipping");
      return;
    }

    core.info(`Processing PR #${pr.number}: ${pr.title}`);

    // Read inputs
    core.info("Step 1: Reading configuration...");
    const body = pr.body ?? "";
    const checklistStartMarker =
      core.getInput("checklist-start-marker") || "<!-- checklist -->";
    const checklistEndMarker =
      core.getInput("checklist-end-marker") || "<!-- checklist end -->";
    const membersConfigPath =
      core.getInput("members-config-path") || "members.yaml";

    core.info(`  - Members config: ${membersConfigPath}`);
    core.info(`  - Checklist markers: "${checklistStartMarker}" to "${checklistEndMarker}"`);

    // Load members config
    const members = readMembersConfig(membersConfigPath);
    core.info(`  - Loaded ${members.length} members: ${members.map((m) => m.name).join(", ")}`);

    // Initialize GitHub API client
    core.info("Step 2: Initializing GitHub API client...");
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error("GITHUB_TOKEN not set; cannot fetch PR history");
    }
    const octokit = github.getOctokit(token);

    // Get ref inputs for PR filtering
    const fromRef = core.getInput("from-ref");
    const toRef = core.getInput("to-ref");

    // Determine the "since" date for PR filtering
    core.info("Step 3: Determining PR date range...");
    let sinceDate: string;
    if (fromRef) {
      core.info(`  - Using from-ref: ${fromRef}`);
      sinceDate = await getRefDateIso(octokit, repo.owner, repo.repo, fromRef);
    } else {
      core.info("  - No from-ref specified, using latest tag...");
      sinceDate = await getLatestTagDateIso(octokit, repo.owner, repo.repo);
    }
    core.info(`  - Fetching PRs merged since: ${sinceDate}`);

    // Determine the "until" date if to-ref is specified
    let untilDate: string | undefined;
    if (toRef) {
      core.info(`  - Using to-ref: ${toRef}`);
      untilDate = await getRefDateIso(octokit, repo.owner, repo.repo, toRef);
      core.info(`  - Fetching PRs merged until: ${untilDate}`);
    }

    // Fetch merged PRs in date range
    core.info("Step 4: Fetching merged PRs...");
    const mergedPrs = await fetchMergedPrsBetween(
      octokit,
      repo.owner,
      repo.repo,
      sinceDate,
      untilDate
    );
    core.info(`  - Found ${mergedPrs.length} merged PRs`);

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

    core.info(`  - Total PRs to process: ${allSources.length}`);

    // Parse checklist items from all PRs
    core.info("Step 5: Parsing checklist items...");
    const allItems: ChecklistItem[] = [];
    for (const source of allSources) {
      const items = parseChecklistBlock(
        source.body,
        checklistStartMarker,
        checklistEndMarker,
        source.url,
        source.author
      );
      if (items.length > 0) {
        core.info(`  - PR #${source.number}: ${items.length} items found`);
      }
      allItems.push(...items);
    }

    core.info(`  - Total checklist items: ${allItems.length}`);

    if (allItems.length === 0) {
      core.info("No checklist items found, skipping");
      return;
    }

    // Build spreadsheet data
    core.info("Step 6: Building spreadsheet data...");
    const values = buildSideBySideRows(allItems, members);
    core.info(`  - Generated ${values.length} rows (including headers)`);

    // Write to Google Sheets
    core.info("Step 7: Connecting to Google Sheets...");
    const sheetId = core.getInput("sheet-id", { required: true });
    const sheetRange = core.getInput("sheet-range") || "A1";
    const startCell = sheetRange.includes("!")
      ? sheetRange.split("!")[1] || "A1"
      : sheetRange;

    core.info(`  - Target spreadsheet: ${sheetId}`);
    core.info(`  - Start cell: ${startCell}`);

    // Determine authentication method
    const serviceAccountKey = core.getInput("google-service-account-key");
    const workloadIdentityProvider = core.getInput("workload-identity-provider");
    const serviceAccountEmail = core.getInput("service-account-email");
    const googleClientId = core.getInput("google-client-id");
    const googleClientSecret = core.getInput("google-client-secret");
    const googleRefreshToken = core.getInput("google-refresh-token");

    let authConfig: GoogleAuthConfig;

    if (serviceAccountKey) {
      authConfig = {
        type: "service-account",
        keyBase64: serviceAccountKey,
      };
      core.info("  - Auth method: Service Account Key");
    } else if (googleClientId && googleClientSecret && googleRefreshToken) {
      authConfig = {
        type: "oauth",
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        refreshToken: googleRefreshToken,
      };
      core.info("  - Auth method: OAuth Refresh Token");
    } else if (workloadIdentityProvider && serviceAccountEmail) {
      authConfig = {
        type: "oidc",
        workloadIdentityProvider,
        serviceAccountEmail,
      };
      core.info("  - Auth method: OIDC (Workload Identity Federation)");
    } else {
      throw new Error(
        "Authentication not configured. Provide one of: " +
          "'google-service-account-key', " +
          "'google-client-id' + 'google-client-secret' + 'google-refresh-token', or " +
          "'workload-identity-provider' + 'service-account-email'."
      );
    }

    core.info("Step 8: Writing to Google Sheets...");
    const { sheetTitle, createdSheetId } = await appendToSheet(
      sheetId,
      startCell,
      values,
      authConfig,
      members.length
    );

    core.info(`  - Created new sheet tab: "${sheetTitle}"`);
    core.info(`  - Written ${values.length} rows`);

    // Update PR body with sheet link
    const appendLink =
      core.getInput("append-pr-link").toLowerCase() === "true";

    if (appendLink) {
      core.info("Step 9: Updating PR body with sheet link...");
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
        core.info("  - PR body updated with sheet link");
      } else {
        core.info("  - PR body already contains sheet link, no update needed");
      }
    }

    core.info("=== PR Checklist to Sheets: Completed successfully ===");
  } catch (error) {
    core.error("=== PR Checklist to Sheets: Failed ===");
    if (error instanceof Error) {
      core.error(`Error: ${error.message}`);
      if (error.stack) {
        core.debug(error.stack);
      }
      core.setFailed(error.message);
    } else {
      core.error(`Error: ${String(error)}`);
      core.setFailed(String(error));
    }
  }
}

run();
