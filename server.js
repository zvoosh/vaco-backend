import express from "express";
import { Storage } from "@google-cloud/storage";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
dotenv.config();

const app = express();
const port = 3009;

app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:5173", // lokalni development
      "https://limegreen-tapir-365119.hostingersite.com", // tvoj frontend domain
    ],
  }),
);

const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid token" });
  }
};
app.use("/files/:folderPrefix", authenticate);

const storage = new Storage({
  credentials: JSON.parse(process.env.GCS_CREDENTIALS),
});

const bucketName = process.env.GCS_BUCKET_NAME;

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

app.get("/api/fetch-folder", async (req, res) => {
  const folderId = decodeURIComponent(req.query.folderId);

  try {
    const [files] = await storage.bucket(bucketName).getFiles({
      prefix: `${folderId}/`,
    });

    const fileData = await Promise.all(
      files
        .filter((file) => !file.name.endsWith("/"))
        .map(async (file) => {
          const [url] = await file.getSignedUrl({
            action: "read",
            expires: Date.now() + 1000 * 60 * 60, // 1 sat
          });
          return { name: file.name, url };
        }),
    );

    res.json(fileData);
  } catch (err) {
    console.error("Error fetching nested files:", err);
    res.status(500).send({ error: err.message });
  }
});
app.get("/api/fetch-folder-content", async (req, res) => {
  const folderId = decodeURIComponent(req.query.folderId);

  try {
    const [files] = await storage.bucket(bucketName).getFiles({
      prefix: `${folderId}/`,
    });

    const folderMap = {};

    for (const file of files) {
      if (file.name.endsWith("/")) continue;

      const relativePath = file.name.slice(`${folderId}/`.length);
      const parts = relativePath.split("/");
      const subFolder = parts[0]; // corporateThumbnails, eventThumbnails...
      const fileName = parts[1]; // thumbnail.jpg

      if (!fileName) continue; // preskoči ako nema fajla

      if (!folderMap[subFolder]) {
        folderMap[subFolder] = { name: subFolder, files: [] };
      }

      const [signedUrl] = await file.getSignedUrl({
        action: "read",
        expires: Date.now() + 1000 * 60 * 60,
      });

      folderMap[subFolder].files.push(signedUrl);
    }

    res.json(Object.values(folderMap));
  } catch (err) {
    console.error("Error fetching nested files:", err);
    res.status(500).send("Failed to retrieve nested contents");
  }
});

// Returns one signed URL per project using delimiter-based folder listing.
// Step 1: list category prefixes (CommercialVideo/, CorporateVideo/, ...)
// Step 2: for each category list project prefixes in parallel
// Step 3: for each project get first file and sign URL
// Much faster than listing all files — no autopagination over hundreds of objects.
app.get("/api/fetch-project-previews", async (req, res) => {
  const folderId = decodeURIComponent(req.query.folderId);
  const bucket = storage.bucket(bucketName);
  const expires = Date.now() + 1000 * 60 * 60;

  try {
    // 1. Get category "folders"
    const [, , catMeta] = await bucket.getFiles({
      prefix: `${folderId}/`,
      delimiter: "/",
      autoPaginate: false,
    });
    const categoryPrefixes = catMeta.prefixes || [];

    // 2. For each category, get project "folders" in parallel
    const categoryResults = await Promise.all(
      categoryPrefixes.map(async (catPrefix) => {
        const [, , projMeta] = await bucket.getFiles({
          prefix: catPrefix,
          delimiter: "/",
          autoPaginate: false,
        });
        const projectPrefixes = projMeta.prefixes || [];

        // 3. For each project, get first file and sign URL in parallel
        const projectResults = await Promise.all(
          projectPrefixes.map(async (projPrefix) => {
            const [projFiles] = await bucket.getFiles({
              prefix: projPrefix,
              maxResults: 1,
            });
            const file = projFiles.find((f) => !f.name.endsWith("/"));
            if (!file) return null;

            const [url] = await file.getSignedUrl({ action: "read", expires });

            // name = "CommercialVideo/MaxProtext"
            const relative = projPrefix.slice(`${folderId}/`.length).replace(/\/$/, "");
            return { name: relative, url };
          })
        );

        return projectResults.filter(Boolean);
      })
    );

    res.json(categoryResults.flat());
  } catch (err) {
    console.error("Error fetching project previews:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

export default app;
