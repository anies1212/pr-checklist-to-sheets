# PR Checklist to Sheets Action

GitHub Action that reads reviewer-specific checklist blocks from pull requests, builds a reviewer-by-reviewer checklist table in a fresh Google Sheets tab, and posts the sheet link back to the PR.

## Checklist format

- Add fenced code blocks per reviewer: ` ```<prefix>-<reviewerId> `.
- The default prefix is `checklist`. Reviewer IDs come from `config/reviewers.json` (or YAML).
- Each line: `- [x] コメント本文` (任意で `9月7日 | コメント` のように日付や区切りを含めてもOK。全て note 列に入ります)

Example PR body snippet:

```
## チェックリスト
```checklist-seina
- [x] 9月7日 | API レスポンス確認
- [ ] 9月8日 | UI 動作確認
```
```checklist-wakahara
- [ ] 9月7日 | テストケース追加
```
```

The action reads `reviewerId` from config; display names are used as column headers.

## Reviewer config

`config/reviewers.json` (or `.yaml`) example:

```json
{
  "reviewers": [
    { "id": "seina", "displayName": "せいな" },
    { "id": "wakahara", "displayName": "わかはら" }
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
      - uses: ./.github/actions/pr-checklist-to-sheets
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

## License

MIT. See [LICENSE](LICENSE).
