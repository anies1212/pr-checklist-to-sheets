import * as core from "@actions/core";
import * as github from "@actions/github";
import { PrChecklistSource } from "./types";

const LINK_SECTION_MARKER = "<!-- checklist-to-sheets -->";

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

/**
 * Fetch all merged PRs since a given date
 */
export async function fetchMergedPrsSince(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  sinceIso: string
): Promise<PrChecklistSource[]> {
  const results: PrChecklistSource[] = [];
  let page = 1;
  const perPage = 50;

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

/**
 * Check if the trigger label is present on the PR
 */
export function ensureTriggerLabel(
  triggerLabel: string,
  labels: { name?: string }[] | undefined
): boolean {
  if (!triggerLabel) return true;
  if (!labels) return false;
  return labels.some((label) => label.name === triggerLabel);
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
