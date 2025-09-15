import express from "express";
import { Storage } from "@google-cloud/storage";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const port = 3001;

app.use(cors());

const storage = new Storage({
  keyFilename: "./gcs-key.json", // Path to your service account JSON
});
const bucketName = process.env.GCS_BUCKET_NAME;

app.get("/files/:folderPrefix", async (req, res) => {
  const { folderPrefix } = req.params;

  try {
    const [files] = await storage.bucket(bucketName).getFiles({
      prefix: `${folderPrefix}/`, // Include trailing slash
    });

    const fileData = files
      .filter((file) => !file.name.endsWith("/")) // exclude "empty folder" markers
      .map((file) => ({
        name: file.name,
        url: `https://storage.googleapis.com/${bucketName}/${file.name}`,
      }));

    res.json(fileData);
  } catch (err) {
    console.error("Error fetching nested files:", err);
    res.status(500).send("Failed to retrieve nested contents");
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
