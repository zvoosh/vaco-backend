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

// Collect all project keys (category/project or category/filename) without signing URLs.
async function collectAllProjectKeys(bucket, folderId) {
  const [, , catMeta] = await bucket.getFiles({
    prefix: `${folderId}/`,
    delimiter: "/",
    autoPaginate: false,
  });
  const categoryPrefixes = catMeta.prefixes || [];

  const allKeys = await Promise.all(
    categoryPrefixes.map(async (catPrefix) => {
      const [catFiles, , projMeta] = await bucket.getFiles({
        prefix: catPrefix,
        delimiter: "/",
        autoPaginate: false,
      });
      const projectPrefixes = projMeta.prefixes || [];
      const catName = catPrefix.slice(`${folderId}/`.length).replace(/\/$/, "");

      if (projectPrefixes.length > 0) {
        return projectPrefixes.map((p) => ({
          type: "folder",
          prefix: p,
          name: p.slice(`${folderId}/`.length).replace(/\/$/, ""),
        }));
      }

      return catFiles
        .filter((f) => !f.name.endsWith("/"))
        .map((f) => ({
          type: "file",
          file: f,
          name: `${catName}/${f.name.split("/").pop().replace(/\.[^.]+$/, "")}`,
        }));
    })
  );

  return allKeys.flat();
}

// Paginated project previews — returns signed URLs only for the requested slice.
// Query params: folderId, offset (default 0), limit (default 10)
app.get("/api/fetch-project-previews", async (req, res) => {
  const folderId = decodeURIComponent(req.query.folderId);
  const offset = parseInt(req.query.offset ?? "0", 10);
  const limit = parseInt(req.query.limit ?? "10", 10);
  const bucket = storage.bucket(bucketName);
  const expires = Date.now() + 1000 * 60 * 60;

  try {
    const allKeys = await collectAllProjectKeys(bucket, folderId);
    const total = allKeys.length;
    const slice = allKeys.slice(offset, offset + limit);

    const items = await Promise.all(
      slice.map(async (key) => {
        let file;
        if (key.type === "folder") {
          const [files] = await bucket.getFiles({ prefix: key.prefix, maxResults: 1 });
          file = files.find((f) => !f.name.endsWith("/"));
        } else {
          file = key.file;
        }
        if (!file) return null;
        const [url] = await file.getSignedUrl({ action: "read", expires });
        return { name: key.name, url };
      })
    );

    res.json({ items: items.filter(Boolean), total, offset, limit });
  } catch (err) {
    console.error("Error fetching project previews:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

export default app;
