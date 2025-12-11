import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import path from "path";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Multer memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Supabase client
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Please set SUPABASE_URL and SUPABASE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Helpers
 */
const uploadToBucket = async (bucketName, fileBuffer, fileName, mimeType) => {
  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(fileName, fileBuffer, { contentType: mimeType, upsert: true });

  if (error) throw error;

  const { data: publicData } = supabase.storage.from(bucketName).getPublicUrl(fileName);
  return publicData.publicUrl;
};

/**
 * Health
 */
app.get("/", (req, res) => res.json({ message: "Video API running 🎬" }));

/**
 * GET /videos - get all videos (recent first)
 */
app.get("/videos", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("videos_metadata")
      .select("*")
      .order("id", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ videos: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /videos/:id - single video
 */
app.get("/videos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { data, error } = await supabase
      .from("videos_metadata")
      .select("*")
      .eq("id", id)
      .single();

    if (error) return res.status(404).json({ error: error.message });
    res.json({ video: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /videos/related?limit=5&category=viral
 */
app.get("/videos/related", async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 5;
    const category = req.query.category || null;

    let query = supabase
      .from("videos_metadata")
      .select("*")
      .limit(limit);

    if (category) {
      query = query.eq("category", category);
    }

    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });

    res.json({ videos: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /upload/video - upload actual video file to 'videos' bucket
 * form field name: 'video'
 */
app.post("/upload/video", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No video file uploaded" });

    const fileExt = path.extname(req.file.originalname) || ".mp4";
    const fileName = `video_${Date.now()}${fileExt}`;

    const publicUrl = await uploadToBucket("videos", req.file.buffer, fileName, req.file.mimetype);
    res.json({ fileName, video_url: publicUrl });
  } catch (err) {
    console.error("upload/video error:", err);
    res.status(500).json({ error: err.message || "Upload failed" });
  }
});

/**
 * POST /upload/thumbnail - upload thumbnail to 'thumbnails' bucket
 * form field name: 'thumbnail'
 */
app.post("/upload/thumbnail", upload.single("thumbnail"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No thumbnail uploaded" });

    const fileExt = path.extname(req.file.originalname) || ".jpg";
    const fileName = `thumb_${Date.now()}${fileExt}`;

    const publicUrl = await uploadToBucket("thumbnails", req.file.buffer, fileName, req.file.mimetype);
    res.json({ fileName, thumbnail_url: publicUrl });
  } catch (err) {
    console.error("upload/thumbnail error:", err);
    res.status(500).json({ error: err.message || "Upload failed" });
  }
});

/**
 * POST /videos - create metadata record with duration and views
 * body: { title, description, category, video_url, thumbnail_url, duration, views }
 */
app.post("/videos", async (req, res) => {
  try {
    const { title, description, category, video_url, thumbnail_url, duration, views } = req.body;
    if (!title || !video_url || !thumbnail_url) {
      return res.status(400).json({ error: "title, video_url, thumbnail_url required" });
    }

    const { data, error } = await supabase
      .from("videos_metadata")
      .insert([{
        title,
        description,
        category,
        video_url,
        thumbnail_url,
        duration: duration || 0,
        views: views || 0
      }])
      .select();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ message: "Video metadata created", video: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /videos/:id/view - increment view count
 */
app.post("/videos/:id/view", async (req, res) => {
  const videoId = Number(req.params.id);

  const { data, error } = await supabase.rpc("increase_view", {
    video_id_input: videoId,
  });

  if (error) return res.status(500).json({ error: error.message });

  res.json({ views: data });
});

/**
 * GET /videos/most-viewed - top videos by views
 */
app.get("/videos/most-viewed", async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const { data, error } = await supabase
      .from("videos_metadata")
      .select("*")
      .order("views", { ascending: false })
      .limit(limit);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ videos: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /videos/trending - videos from last N days ordered by views
 */
app.get("/videos/trending", async (req, res) => {
  try {
    const days = Number(req.query.days) || 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("videos_metadata")
      .select("*")
      .gt("created_at", since)
      .order("views", { ascending: false })
      .limit(50);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ videos: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Likes: simple toggle (demo)
 */
app.post("/videos/:videoId/toggle-like", async (req, res) => {
  try {
    const videoId = Number(req.params.videoId);
    const userId = req.body.user_id;
    if (!userId) return res.status(400).json({ error: "user_id required in body (demo)" });

    const { data: existing, error: selectError } = await supabase
      .from("liked_videos")
      .select("*")
      .eq("user_id", userId)
      .eq("video_id", videoId)
      .single();

    if (selectError && selectError.code !== "PGRST116") {
      return res.status(500).json({ error: selectError.message });
    }

    let liked = true;
    if (!existing) {
      const { data, error } = await supabase.from("liked_videos").insert([{ user_id: userId, video_id: videoId }]).select();
      if (error) return res.status(500).json({ error: error.message });
    } else {
      liked = false;
      const { error } = await supabase.from("liked_videos").delete().eq("user_id", userId).eq("video_id", videoId);
      if (error) return res.status(500).json({ error: error.message });
    }

    const { count, error: countError } = await supabase
      .from("liked_videos")
      .select("*", { count: "exact", head: true })
      .eq("video_id", videoId);

    if (countError) return res.status(500).json({ error: countError.message });

    res.json({ liked, likes_count: count });
  } catch (err) {
    console.error("toggle-like error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => console.log(`🎥 Video API running at http://localhost:${port}`));
