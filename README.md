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
    { "name": "Alice" },
    { "name": "Bob" },
    { "name": "Charlie" }
  ]
}
```

Or in YAML format (`config/members.yaml`):

```yaml
members:
  - name: Alice
  - name: Bob
  - name: Charlie
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

<img width="1286" height="317" alt="Output example" src="https://github.com/user-attachments/assets/99bef070-9c82-46f2-b690-6e1a9acc5c8b" />

## Inputs

### Authentication (choose one method)

**Option 1: Service Account Key**
- `google-service-account-key`: Base64-encoded service account JSON.

**Option 2: OAuth Refresh Token** (for organizations that require user-based authentication)
- `google-client-id`: OAuth 2.0 Client ID
- `google-client-secret`: OAuth 2.0 Client Secret
- `google-refresh-token`: Refresh token obtained from user consent flow

**Option 3: OIDC (Workload Identity Federation)**
- `workload-identity-provider`: Workload Identity Provider resource name (e.g., `projects/123456/locations/global/workloadIdentityPools/my-pool/providers/my-provider`)
- `service-account-email`: Service account email (e.g., `my-sa@my-project.iam.gserviceaccount.com`)

### Other Inputs
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

### Option 1: Using Service Account Key

```yaml
name: Sync checklist to Sheets
on:
  pull_request_target:
    types: [labeled]

permissions:
  contents: read
  pull-requests: write

jobs:
  sync-checklist:
    runs-on: ubuntu-latest
    if: github.event.label.name == 'export-checklist'
    steps:
      - uses: actions/checkout@v4
      - uses: anies1212/pr-checklist-to-sheets@main
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          google-service-account-key: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_KEY }}
          sheet-id: ${{ secrets.SHEET_ID }}
          members-config-path: "config/members.json"
          trigger-label: "export-checklist"
```

### Option 2: Using OIDC (Workload Identity Federation)

This method is more secure as it doesn't require storing service account keys as secrets.

```yaml
name: Sync checklist to Sheets
on:
  pull_request_target:
    types: [labeled]

permissions:
  contents: read
  pull-requests: write
  id-token: write  # Required for OIDC

jobs:
  sync-checklist:
    runs-on: ubuntu-latest
    if: github.event.label.name == 'export-checklist'
    steps:
      - uses: actions/checkout@v4
      - uses: anies1212/pr-checklist-to-sheets@main
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          workload-identity-provider: projects/123456789/locations/global/workloadIdentityPools/github-pool/providers/github-provider
          service-account-email: sheets-writer@my-project.iam.gserviceaccount.com
          sheet-id: ${{ secrets.SHEET_ID }}
          members-config-path: "config/members.json"
          trigger-label: "export-checklist"
```

### Option 3: Using OAuth Refresh Token

This method is required when your organization restricts service account access to spreadsheets and requires user-based authentication.

```yaml
name: Sync checklist to Sheets
on:
  pull_request_target:
    types: [labeled]

permissions:
  contents: read
  pull-requests: write

jobs:
  sync-checklist:
    runs-on: ubuntu-latest
    if: github.event.label.name == 'export-checklist'
    steps:
      - uses: actions/checkout@v4
      - uses: anies1212/pr-checklist-to-sheets@main
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          google-client-id: ${{ secrets.GOOGLE_CLIENT_ID }}
          google-client-secret: ${{ secrets.GOOGLE_CLIENT_SECRET }}
          google-refresh-token: ${{ secrets.GOOGLE_REFRESH_TOKEN }}
          sheet-id: ${{ secrets.SHEET_ID }}
          members-config-path: "config/members.json"
          trigger-label: "export-checklist"
```

#### Obtaining OAuth Credentials

1. Get OAuth 2.0 credentials from your Google Workspace administrator:
   - Client ID (`xxxxx.apps.googleusercontent.com`)
   - Client Secret

2. Get a refresh token using the included helper script:

   ```bash
   # Clone and setup this repository
   git clone https://github.com/anies1212/pr-checklist-to-sheets.git
   cd pr-checklist-to-sheets
   npm install

   # Run the token generator
   GOOGLE_CLIENT_ID=your-client-id GOOGLE_CLIENT_SECRET=your-client-secret npm run get-token
   ```

   This will:
   - Open your browser for Google authentication
   - Ask you to authorize access to Google Sheets
   - Display the refresh token in your terminal

3. Store the credentials as GitHub Secrets:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REFRESH_TOKEN`

#### Setting up Workload Identity Federation

1. Create a Workload Identity Pool in GCP:
   ```bash
   gcloud iam workload-identity-pools create github-pool \
     --location="global" \
     --display-name="GitHub Actions Pool"
   ```

2. Create a Workload Identity Provider:
   ```bash
   gcloud iam workload-identity-pools providers create-oidc github-provider \
     --location="global" \
     --workload-identity-pool="github-pool" \
     --display-name="GitHub Provider" \
     --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
     --issuer-uri="https://token.actions.githubusercontent.com"
   ```

3. Grant the service account permissions to be impersonated:
   ```bash
   gcloud iam service-accounts add-iam-policy-binding sheets-writer@my-project.iam.gserviceaccount.com \
     --role="roles/iam.workloadIdentityUser" \
     --member="principalSet://iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/github-pool/attribute.repository/YOUR_ORG/YOUR_REPO"
   ```

## Notes

- If no matching checklist items are found, the action exits successfully without updating Sheets or the PR body.
- Ensure the service account has edit access to the spreadsheet.
- Each run creates a new sheet tab (date-named) instead of appending to existing data.

## License

MIT. See [LICENSE](LICENSE).
