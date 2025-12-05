# PR Checklist to Sheets Action

GitHub Action that reads checklist items from pull request bodies, collects them into a Google Sheets tab, and posts the sheet link back to the PR.

## Checklist format

Use HTML comment markers to define the checklist section in your PR body:

```markdown
## Checklist
<!-- checklist -->
- このページをこう改修したのでここを確認してください
- このページがこうなので、こうしてください
<!-- checklist end -->
```

Each line starting with `- ` inside the markers will be captured as a checklist item.

## Inputs

- `google-service-account-key` (required): Base64-encoded service account JSON.
- `sheet-id` (required): Spreadsheet ID.
- `sheet-range` (default `A1`): Starting cell within the generated sheet tab (tab name is auto-generated).
- `checklist-start-marker` (default `<!-- checklist -->`): HTML comment marker for checklist start.
- `checklist-end-marker` (default `<!-- checklist end -->`): HTML comment marker for checklist end.
- `append-pr-link` (default `true`): If true, adds a section with the sheet link to the PR body.
- `sheet-link-text` (default `Checklist synced to Google Sheets`): Custom link label.
- `trigger-label` (optional): Label name to filter on in the workflow.

## Behavior

- Finds the latest tag in the repository and collects every merged PR since that tag, plus the current PR.
- For each PR, reads checklist items within the HTML comment markers and captures:
  - PR URL (`github.com/<owner>/<repo>/pull/<number>`)
  - PR author login
  - Checklist item text (line content after `- `)
- Builds a simple table with columns: `該当PR`, `オーナー`, `チェック内容`.
- Creates a new sheet tab named with the current date (`YYYY-MM-DD`; if it already exists, `-2`, `-3`, … is appended) and writes the table starting from the configured start cell.
- Posts a link to the spreadsheet tab back to the PR body (idempotent section keyed by the sheet ID).

## Usage (workflow)

```yaml
name: Sync checklist to Sheets
on:
  pull_request_target:
    types: [opened, edited, synchronize, reopened, labeled]

jobs:
  sync-checklist:
    runs-on: ubuntu-latest
    if: github.event.action != 'labeled' || github.event.label.name == 'export-checklist'
    steps:
      - uses: actions/checkout@v4
      - uses: anies1212/pr-checklist-to-sheets@main
        with:
          google-service-account-key: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_KEY }}
          sheet-id: ${{ secrets.SHEET_ID }}
          sheet-range: "A1"
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
