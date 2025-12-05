# PR Checklist to Sheets Action

GitHub Action that reads checklist items from pull request bodies, collects them into a Google Sheets tab with checkboxes for each team member, and posts the sheet link back to the PR.

## Checklist format

Use HTML comment markers to define the checklist section in your PR body:

```markdown
## Checklist
<!-- checklist -->
- Please verify this page modification
- Please check this feature works correctly
<!-- checklist end -->
```

Each line starting with `- ` inside the markers will be captured as a checklist item.

## Members config

Create a `config/members.json` (or `.yaml`) file to define team members. Each member gets their own set of columns in the spreadsheet:

```json
{
  "members": [
    { "id": "alice", "displayName": "Alice" },
    { "id": "bob", "displayName": "Bob" },
    { "id": "charlie", "displayName": "Charlie" }
  ]
}
```

Or in YAML format (`config/members.yaml`):

```yaml
members:
  - id: alice
    displayName: Alice
  - id: bob
    displayName: Bob
  - id: charlie
    displayName: Charlie
```

## Output format

The action generates a table with the following structure:

| Alice  |        |       |             | Bob    |        |       |             |
|--------|--------|-------|-------------|--------|--------|-------|-------------|
| ✓      | PR     | Owner | Description | ✓      | PR     | Owner | Description |
| ☐      | PR URL | author| Item text   | ☐      | PR URL | author| Item text   |

- Each member has 4 columns: checkbox (✓), PR URL, Owner, and Description
- The checkbox column uses Google Sheets checkboxes (FALSE by default)
- When all checkboxes are checked, "✓ Done!" appears next to the member name and the header turns green

## Inputs

- `google-service-account-key` (required): Base64-encoded service account JSON.
- `sheet-id` (required): Spreadsheet ID.
- `sheet-range` (default `A1`): Starting cell within the generated sheet tab (tab name is auto-generated).
- `checklist-start-marker` (default `<!-- checklist -->`): HTML comment marker for checklist start.
- `checklist-end-marker` (default `<!-- checklist end -->`): HTML comment marker for checklist end.
- `members-config-path` (default `config/members.json`): Path to JSON/YAML file containing members list.
- `append-pr-link` (default `true`): If true, adds a section with the sheet link to the PR body.
- `sheet-link-text` (default `Checklist synced to Google Sheets`): Custom link label.
- `trigger-label` (optional): Label name to filter on in the workflow.

## Behavior

- Finds the latest tag in the repository and collects every merged PR since that tag, plus the current PR.
- For each PR, reads checklist items within the HTML comment markers and captures:
  - PR URL (`github.com/<owner>/<repo>/pull/<number>`)
  - PR author login
  - Checklist item text (line content after `- `)
- Builds a side-by-side table with 4 columns per member (`✓`, `PR`, `Owner`, `Description`).
- Creates a new sheet tab named with the current date (`YYYY-MM-DD`; if it already exists, `-2`, `-3`, … is appended) and writes the table starting from the configured start cell.
- Posts a link to the spreadsheet tab back to the PR body (idempotent section keyed by the sheet ID).

## Usage (workflow)

```yaml
name: Sync checklist to Sheets
on:
  pull_request_target:
    types: [labeled]

jobs:
  sync-checklist:
    runs-on: ubuntu-latest
    if: github.event.label.name == 'export-checklist'
    steps:
      - uses: actions/checkout@v4
      - uses: anies1212/pr-checklist-to-sheets@main
        with:
          google-service-account-key: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_KEY }}
          sheet-id: ${{ secrets.SHEET_ID }}
          sheet-range: "A1"
          members-config-path: "config/members.json"
          trigger-label: "export-checklist"
```

## Notes

- If no matching checklist items are found, the action exits successfully without updating Sheets or the PR body.
- Ensure the service account has edit access to the spreadsheet.
- Each run creates a new sheet tab (date-named) instead of appending to existing data.

## E2E workflow (demo)

- Workflow: `.github/workflows/e2e-checklist.yml`
- Trigger: add the label `e2e-checklist` to a PR.
- Secrets needed: `GOOGLE_SERVICE_ACCOUNT_KEY` (base64 service account JSON that can edit the demo sheet).
- Sheet used for demo: https://docs.google.com/spreadsheets/d/1lRArNs_BEebnOVl3qpPt94kHM-qZeQIOfcbgRZSXpF4/edit

Example PR body for the demo:

```markdown
## Checklist
<!-- checklist -->
- API response verification
- UI behavior verification
<!-- checklist end -->
```

## License

MIT. See [LICENSE](LICENSE).
