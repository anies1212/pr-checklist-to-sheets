import http from "http";
import { google } from "googleapis";
import open from "open";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const REDIRECT_PORT = 3000;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("Error: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required.\n");
    console.error("Usage:");
    console.error("  GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npm run get-token\n");
    console.error("Or export them first:");
    console.error("  export GOOGLE_CLIENT_ID=xxx");
    console.error("  export GOOGLE_CLIENT_SECRET=yyy");
    console.error("  npm run get-token");
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("\n=== Google OAuth Refresh Token Generator ===\n");
  console.log("Opening browser for authentication...\n");
  console.log("If the browser doesn't open automatically, visit this URL:\n");
  console.log(authUrl);
  console.log("\n");

  // Create a temporary server to receive the callback
  const server = http.createServer(async (req, res) => {
    if (!req.url?.startsWith("/callback")) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<h1>Authentication failed</h1><p>Error: ${error}</p>`);
      console.error(`Authentication failed: ${error}`);
      server.close();
      process.exit(1);
    }

    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>No authorization code received</h1>");
      server.close();
      process.exit(1);
    }

    try {
      const { tokens } = await oauth2Client.getToken(code);

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <html>
          <head><title>Success</title></head>
          <body style="font-family: sans-serif; padding: 40px; text-align: center;">
            <h1 style="color: green;">Authentication Successful!</h1>
            <p>You can close this window and return to the terminal.</p>
          </body>
        </html>
      `);

      console.log("=== Authentication Successful ===\n");
      console.log("Refresh Token (save this to your GitHub Secrets as GOOGLE_REFRESH_TOKEN):\n");
      console.log("-----------------------------------------------------------");
      console.log(tokens.refresh_token);
      console.log("-----------------------------------------------------------\n");

      if (!tokens.refresh_token) {
        console.warn("Warning: No refresh token was returned.");
        console.warn("This may happen if you've already authorized this app before.");
        console.warn("Try revoking access at https://myaccount.google.com/permissions and try again.\n");
      }

      server.close();
      process.exit(0);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<h1>Error exchanging code for tokens</h1><p>${err}</p>`);
      console.error("Error exchanging code for tokens:", err);
      server.close();
      process.exit(1);
    }
  });

  server.listen(REDIRECT_PORT, () => {
    console.log(`Listening on http://localhost:${REDIRECT_PORT}...\n`);
    open(authUrl).catch(() => {
      console.log("Could not open browser automatically. Please open the URL above manually.");
    });
  });
}

main();
