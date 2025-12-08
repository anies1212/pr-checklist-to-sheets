import * as core from "@actions/core";
import * as github from "@actions/github";
import { PrChecklistSource } from "./types";

const LINK_SECTION_MARKER = "<!-- checklist-to-sheets -->";

const DEFAULT_LOOKBACK_DAYS = 30;

/**
 * Get the date of a git ref (commit hash, tag, or branch)
 */
export async function getRefDateIso(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  ref: string
): Promise<string> {
  const commit = await octokit.rest.repos.getCommit({
    owner,
    repo,
    ref,
  });

  const date =
    commit.data.commit.committer?.date || commit.data.commit.author?.date;

  if (!date) {
    throw new Error(`Could not resolve date for ref ${ref}`);
  }

  return new Date(date).toISOString();
}

/**
 * Get the date of the latest tag in the repository
 */
export async function getLatestTagDateIso(
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
    // No tags found, fall back to last N days
    const fallbackDate = new Date();
    fallbackDate.setDate(fallbackDate.getDate() - DEFAULT_LOOKBACK_DAYS);
    core.info(`No tags found; fetching PRs from last ${DEFAULT_LOOKBACK_DAYS} days`);
    return fallbackDate.toISOString();
  }

  const latestTag = tags[0];
  core.info(`  - Latest tag: ${latestTag.name}`);
  return getRefDateIso(octokit, owner, repo, latestTag.commit.sha);
}

const PARALLEL_BATCH_SIZE = 10;

/**
 * Fetch all merged PRs between two dates
 */
export async function fetchMergedPrsBetween(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  sinceIso: string,
  untilIso?: string
): Promise<PrChecklistSource[]> {
  const allPrNumbers: number[] = [];
  let page = 1;
  const perPage = 50;

  // Build date range query
  let dateQuery = `merged:>=${sinceIso}`;
  if (untilIso) {
    dateQuery = `merged:${sinceIso}..${untilIso}`;
  }

  // First, collect all PR numbers from search results
  while (true) {
    const search = await octokit.rest.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} is:pr is:merged ${dateQuery}`,
      sort: "updated",
      order: "desc",
      per_page: perPage,
      page,
    });

    const items = search.data.items || [];
    if (!items.length) break;

    allPrNumbers.push(...items.map((item) => item.number));

    if (items.length < perPage) break;
    page += 1;
  }

  if (allPrNumbers.length === 0) {
    return [];
  }

  core.info(`Found ${allPrNumbers.length} merged PRs, fetching details in parallel...`);

  // Fetch PR details in parallel batches
  const results: PrChecklistSource[] = [];

  for (let i = 0; i < allPrNumbers.length; i += PARALLEL_BATCH_SIZE) {
    const batch = allPrNumbers.slice(i, i + PARALLEL_BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(async (prNumber) => {
        const pr = await octokit.rest.pulls.get({
          owner,
          repo,
          pull_number: prNumber,
        });

        return {
          number: prNumber,
          body: pr.data.body || "",
          author: pr.data.user?.login || "",
          url: pr.data.html_url,
          mergedAt: pr.data.merged_at,
        };
      })
    );

    results.push(...batchResults);
  }

  return results;
}

/**
 * Update or insert the sheet link section in PR body
 */
export function upsertLinkSection(body: string, link: string, text: string): string {
  const section = `${LINK_SECTION_MARKER}\n[${text}](${link})\n${LINK_SECTION_MARKER}`;
  if (body.includes(LINK_SECTION_MARKER)) {
    const regex = new RegExp(
      `${LINK_SECTION_MARKER}[\\s\\S]*?${LINK_SECTION_MARKER}`
    );
    return body.replace(regex, section);
  }
  return `${body}\n\n${section}`;
}
