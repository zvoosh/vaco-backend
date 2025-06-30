// auth.js
import dotenv from "dotenv";
dotenv.config();        // ← load .env into process.env

import { google } from "googleapis";
import open from "open";
import readline from "readline";

// pull in the exact names from your .env
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
} = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
  throw new Error(
    "Missing env var: one of GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET or GOOGLE_REDIRECT_URI"
  );
}

// use those same vars here
const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];
const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent",
});

console.log("🔗 Open this URL to authorize access:");
console.log(authUrl);

// open in browser
await open(authUrl);

// prompt for code
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
rl.question("📥 Paste the code from the URL here: ", async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log("\n✅ ACCESS TOKEN:", tokens.access_token);
    console.log("🔁 REFRESH TOKEN:", tokens.refresh_token);
    console.log("⏳ EXPIRY (ms):", tokens.expiry_date);
  } catch (err) {
    console.error("❌ Error getting tokens:", err);
  }
});
