// server.js
import dotenv from "dotenv";
dotenv.config(); // 1) load .env before anything else

import express from "express";
import cors from "cors";
import { google } from "googleapis";

const PORT = process.env.PORT || 5000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

// 2) pull in the exact names from your .env
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  GOOGLE_ACCESS_TOKEN, // must match your .env key
  GOOGLE_REFRESH_TOKEN, // must match your .env key
} = process.env;

// 3) sanity-check
for (let key of [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "GOOGLE_REFRESH_TOKEN",
]) {
  if (!process.env[key]) {
    console.error(`❌ Missing env var ${key}`);
    process.exit(1);
  }
}

const app = express();
app.use(cors({ origin: FRONTEND_ORIGIN }));

// 4) set up OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

// 5) set credentials from your .env
oauth2Client.setCredentials({
  // You can include an expired access_token if you like—it’ll auto-refresh.
  access_token: GOOGLE_ACCESS_TOKEN,
  refresh_token: GOOGLE_REFRESH_TOKEN,
});

app.get("/", (req, res) => res.send("✅ Express is live on 5000"));

app.get("/api/fetch-text", async (req, res) => {
  const fileId = req.query.fileId;
  if (!fileId) return res.status(400).send("Missing fileId");

  try {
    const drive = google.drive({ version: "v3", auth: oauth2Client });
    const { data: stream } = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );
    stream.pipe(res).on("error", (e) => {
      console.error("Stream error", e);
      res.status(500).send("Error reading file");
    });
  } catch (e) {
    console.error("Google API error:", e);
    res.status(e.code || 500).send(e.message || "Google API error");
  }
});
app.get("/api/fetch-folder", async (req, res) => {
  const folderId = req.query.folderId;
  if (!folderId) return res.status(400).send("Missing folderId");

  try {
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // Get root folder metadata
    const folderMeta = await drive.files.get({
      fileId: folderId,
      fields: "id, name, mimeType",
    });

    // Fetch direct children
    const childrenRes = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "files(id, name, mimeType)",
      pageSize: 100,
    });

    // Prepare list of children with possible nested children
    const childrenWithSub = await Promise.all(
      childrenRes.data.files.map(async (child) => {
        if (child.mimeType === "application/vnd.google-apps.folder") {
          const subRes = await drive.files.list({
            q: `'${child.id}' in parents and trashed=false`,
            fields: "files(id, name, mimeType)",
            pageSize: 100,
          });

          return {
            ...child,
            children: subRes.data.files,
          };
        } else {
          return child;
        }
      })
    );

    const result = {
      id: folderMeta.data.id,
      name: folderMeta.data.name,
      mimeType: folderMeta.data.mimeType,
      children: childrenWithSub,
    };

    res.json(result);
  } catch (err) {
    console.error("Google API error:", err.response?.data || err.message);
    res.status(err.response?.status || 500).send("Google API error");
  }
});
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
