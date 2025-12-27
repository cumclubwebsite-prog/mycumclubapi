import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";
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
const esc = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const uploadToBucket = async (bucketName, fileBuffer, fileName, mimeType) => {
  const { error } = await supabase.storage
    .from(bucketName)
    .upload(fileName, fileBuffer, { contentType: mimeType, upsert: true });

  if (error) throw error;

  const { data } = supabase.storage.from(bucketName).getPublicUrl(fileName);
  return data.publicUrl;
};

/**
 * Health
 */
app.get("/", (req, res) => res.json({ message: "Video API running 🎬" }));

/**
 * APIs (UNCHANGED)
 */
app.get("/videos", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = 3;

  try {
    // ✅ 1️⃣ TOTAL COUNT
    const { count, error: countError } = await supabase
      .from("videos_metadata")
      .select("*", { count: "exact", head: true });

    if (countError) {
      return res.status(500).json({ error: countError.message });
    }

    // ✅ 2️⃣ RANDOM SELECTION
    // Approach: first generate random offsets for `limit` rows
    const total = count || 0;
    const randomOffsets = Array.from({ length: limit }, () =>
      Math.floor(Math.random() * total)
    );

    const videoPromises = randomOffsets.map(async (offset) => {
      const { data, error } = await supabase
        .from("videos_metadata")
        .select("*")
        .range(offset, offset);
      if (error) throw error;
      return data[0];
    });

    const videos = await Promise.all(videoPromises);

    res.json({
      page,
      limit,
      totalCount: total,
      hasMore: true, // always true for random
      videos
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk update videos
app.patch("/videos/bulk-update", async (req, res) => {
  const { video_ids, updates } = req.body;

  if (!Array.isArray(video_ids) || video_ids.length === 0) {
    return res.status(400).json({ error: "No video IDs provided" });
  }
  if (!updates || Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No updates provided" });
  }

  try {
    const { data, error } = await supabase
    .from("videos_metadata")
    .update(updates)
    .in("id", video_ids.map(id => Number(id)))
    .select(); // ensures 'data' is an array
  
  res.json({ success: true, updated: data.length });
  
  } catch (err) {
    console.error("Bulk update error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Bulk delete videos
app.post("/videos/bulk-delete", async (req, res) => {
  const { video_ids } = req.body;

  if (!Array.isArray(video_ids) || video_ids.length === 0)
      return res.status(400).json({ error: "No video IDs provided" });

  try {
      const { data, error } = await supabase
          .from("videos_metadata")
          .delete()
          .in("id", video_ids.map(id => Number(id)))
          .select();

      if (error) throw error;

      res.json({ success: true, deleted: data.length });
  } catch (err) {
      console.error("Bulk delete error:", err);
      res.status(500).json({ error: err.message });
  }
});



//second confused
// app.get("/videos", async (req, res) => {
//   const page = Number(req.query.page) || 1;
//   const limit = 5;

//   try {
//     const { count, error: countError } = await supabase
//       .from("videos_metadata")
//       .select("*", { count: "exact", head: true });

//     if (countError) {
//       return res.status(500).json({ error: countError.message });
//     }

//     const total = count || 0;
//     const randomOffsets = Array.from({ length: limit }, () =>
//       Math.floor(Math.random() * total)
//     );

//     const videoPromises = randomOffsets.map(async (offset) => {
//       const { data, error } = await supabase
//         .from("videos_metadata")
//         .select("*")
//         .range(offset, offset);
//       if (error) throw error;
//       return data[0];
//     });

//     const videos = await Promise.all(videoPromises);

//     res.json({
//       page,
//       limit,
//       totalCount: total,
//       hasMore: true,
//       videos
//     });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

//3rd failed
// app.get("/videos", async (req, res) => {
//   const page = Number(req.query.page) || 1;
//   const limit = 5;

//   try {
//     // ✅ 1️⃣ TOTAL COUNT (optional, for UI)
//     const { count, error: countError } = await supabase
//       .from("videos_metadata")
//       .select("*", { count: "exact", head: true });

//     if (countError) {
//       return res.status(500).json({ error: countError.message });
//     }

//     // ✅ 2️⃣ RANDOM SELECTION using precomputed random_value
//     const { data: videos, error: fetchError } = await supabase
//       .from("videos_metadata")
//       .select("*")
//       .order("random_value", { ascending: true }) // use precomputed column
//       .range((page - 1) * limit, page * limit - 1); // pagination support

//     if (fetchError) throw fetchError;

//     res.json({
//       page,
//       limit,
//       totalCount: count || 0,
//       hasMore: count ? page * limit < count : true,
//       videos
//     });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });




app.get("/videos/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { data, error } = await supabase
    .from("videos_metadata")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return res.status(404).json({ error: error.message });
  res.json({ video: data });
});

app.get("/videos/related", async (req, res) => {
  const limit = Number(req.query.limit) || 5;
  const category = req.query.category;

  let query = supabase.from("videos_metadata").select("*").limit(limit);
  if (category) query = query.eq("category", category);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  res.json({ videos: data });
});

app.post("/upload/video", upload.single("video"), async (req, res) => {
  const fileExt = path.extname(req.file.originalname) || ".mp4";
  const fileName = `video_${Date.now()}${fileExt}`;
  const video_url = await uploadToBucket("videos", req.file.buffer, fileName, req.file.mimetype);
  res.json({ fileName, video_url });
});

app.post("/upload/thumbnail", upload.single("thumbnail"), async (req, res) => {
  const fileExt = path.extname(req.file.originalname) || ".jpg";
  const fileName = `thumb_${Date.now()}${fileExt}`;
  const thumbnail_url = await uploadToBucket("thumbnails", req.file.buffer, fileName, req.file.mimetype);
  res.json({ fileName, thumbnail_url });
});

app.post("/videos", async (req, res) => {
  const { title, description, category, video_url, thumbnail_url, duration, views, meta_title, meta_description, meta_keywords } = req.body;

  const { data, error } = await supabase.from("videos_metadata").insert([{
    title,
    description,
    category,
    video_url,
    thumbnail_url,
    duration: duration || 0,
    views: views || 0,
    meta_title: meta_title || title,
    meta_description: meta_description || description || "",
    meta_keywords: meta_keywords || ""
  }]).select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ video: data[0] });
});

/**
 * Sitemap (FRONTEND URL for SEO)
 */
app.get("/sitemap.xml", async (req, res) => {
  const { data } = await supabase.from("videos_metadata").select("id");

  // ✅ Frontend domain URLs for SEO
  const siteUrl = "https://lushfans.netlify.app";

  const urls = data.map(v => `
    <url>
      <loc>${siteUrl}/video/${v.id}</loc>
    </url>
  `).join("");

  res.header("Content-Type", "application/xml");
  res.send(`
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`);
});



/**
 * SEO VIDEO PAGE (MAIN FIX – UPDATED)
 */
app.get("/video/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { data: video } = await supabase
    .from("videos_metadata")
    .select("*")
    .eq("id", id)
    .single();

  if (!video) return res.status(404).send("Video not found");

  // ✅ FRONTEND DOMAIN (your SPA) for SEO and redirect
  const siteUrl = "http://127.0.0.1:4049/newtry";

  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<title>${esc(video.meta_title || video.title)}</title>
<meta name="description" content="${esc(video.meta_description)}">
<meta name="keywords" content="${esc(video.meta_keywords)}">
<meta name="robots" content="index,follow">

<link rel="canonical" href="${siteUrl}/video/${video.id}" />

<!-- OPEN GRAPH -->
<meta property="og:type" content="video.other">
<meta property="og:title" content="${esc(video.meta_title)}">
<meta property="og:description" content="${esc(video.meta_description)}">
<meta property="og:image" content="${video.thumbnail_url}">
<meta property="og:url" content="${siteUrl}/video/${video.id}">

<!-- TWITTER -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(video.meta_title)}">
<meta name="twitter:description" content="${esc(video.meta_description)}">
<meta name="twitter:image" content="${video.thumbnail_url}">

<!-- ✅ VIDEO SCHEMA (JSON-LD for Google) -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "VideoObject",
  "name": "${esc(video.title)}",
  "description": "${esc(video.meta_description)}",
  "thumbnailUrl": ["${video.thumbnail_url}"],
  "contentUrl": "${video.video_url}",
  "embedUrl": "${siteUrl}/video/${video.id}"
}
</script>

<!-- SPA REDIRECT (unchanged for users) -->
<script>
  window.location.replace("${siteUrl}/?v=${video.id}&cat=${video.category}");
</script>
</head>
<body>
<h1>${esc(video.title)}</h1>
<p>${esc(video.description)}</p>

<!-- Fallback link for SEO / users without JS -->
<p><a href="${siteUrl}/?v=${video.id}&cat=${video.category}">Watch Video</a></p>
</body>
</html>
`);
});


/**
 * Download a selected video
 */
app.get("/download/:id", async (req, res) => {
  const id = Number(req.params.id);

  const { data: video, error } = await supabase
    .from("videos_metadata")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !video) {
    return res.status(404).send("Video not found");
  }

  try {
    const fileName = path.basename(video.video_url);

    // 🔥 FORCE DOWNLOAD HEADERS
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );
    res.setHeader("Content-Type", "application/octet-stream");

    // 🔥 STREAM VIDEO THROUGH API
    const response = await axios({
      method: "GET",
      url: video.video_url,
      responseType: "stream",
    });

    response.data.pipe(res);

  } catch (err) {
    console.error(err);
    res.status(500).send("Download failed");
  }
});


app.listen(port, () => console.log(`🎥 Video API running on ${port}`));
