import express from "express";
import { Storage } from "@google-cloud/storage";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
dotenv.config();

const app = express();
const port = 3009;

app.use(cors());

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
  keyFilename: "./config/vaco-464009-4444823ef57d.json", // Path to your service account JSON
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
    res.status(500).send({error: err.message});
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

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

export default app;