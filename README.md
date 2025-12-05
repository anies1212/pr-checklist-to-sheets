# PR Checklist to Sheets Action

GitHub Action that reads reviewer-specific checklist blocks from pull requests, builds a reviewer-by-reviewer checklist table in a fresh Google Sheets tab, and posts the sheet link back to the PR.

## Checklist format

- Add fenced code blocks per reviewer: ` ```<prefix>-<reviewerId> `.
- The default prefix is `checklist`. Reviewer IDs come from `config/reviewers.json` (or YAML).
- Each line: `- [x] コメント本文`（日付なしでシンプルに書く）

Example PR body snippet:

```
## チェックリスト
```checklist-seina
- [x] API レスポンス確認
- [ ] UI 動作確認
```
```checklist-wakahara
- [ ] テストケース追加
```
```

The action reads `reviewerId` from config; display names are used as column headers.

## Reviewer config

`config/reviewers.json` (or `.yaml`) example:

```json
{
  "reviewers": [
    { "id": "john", "displayName": "John" },
    { "id": "daniel", "displayName": "Daniel" }
  ]
}
```

See also `config/reviewers.example.yaml`.

## Inputs

- `google-service-account-key` (required): Base64-encoded service account JSON.
- `sheet-id` (required): Spreadsheet ID.
- `sheet-range` (default `A1`): Starting cell within the generated sheet tab (tab name is auto-generated).
- `checklist-tag-prefix` (default `checklist`): Fence prefix; block name is `<prefix>-<id>`.
- `reviewers-config-path` (default `config/reviewers.json`): YAML/JSON with a `reviewers` array (`{ id, displayName? }`).
- `append-pr-link` (default `true`): If true, adds a section with the sheet link to the PR body.
- `sheet-link-text` (default `Checklist synced to Google Sheets`): Custom link label.
- `trigger-label` (optional): Label name to filter on in the workflow.

## Behavior

- Finds the latest tag in the repository and collects every merged PR since that tag, plus the current PR.
- For each PR, reads checklist blocks per reviewer and captures:
  - ✅ state (TRUE/FALSE)
  - PR URL (`github.com/<owner>/<repo>/pull/<number>`)
  - PR author login
  - Note text (line content after `- [ ]`)
- Builds side-by-side rows: four columns per reviewer (`✓`, `該当PR`, `オーナー`, `<displayName>`). Completion counts are shown in the first header row (e.g., `3/5チェック完了`).
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

- If no matching checklist blocks are found, the action exits successfully without updating Sheets or the PR body.
- Ensure the service account has edit access to the spreadsheet.
- Each run creates a new sheet tab (date-named) instead of appending to existing data.

## E2E workflow (demo)

- Workflow: `.github/workflows/e2e-checklist.yml`
- Trigger: add the label `e2e-checklist` to a PR.
- Secrets needed: `GOOGLE_SERVICE_ACCOUNT_KEY` (base64 service account JSON that can edit the demo sheet).
- Sheet used for demo: https://docs.google.com/spreadsheets/d/1lRArNs_BEebnOVl3qpPt94kHM-qZeQIOfcbgRZSXpF4/edit

Example PR body for the demo:

```
## チェックリスト
```checklist-seina
- [x] API response verification
- [ ] UI behavior verification
```
```checklist-wakahara
- [ ] Add test cases
```
```

## License

MIT. See [LICENSE](LICENSE).
