const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const authRoutes = require("./routes/auth");
const fileRoutes = require("./routes/file");
const folderRoutes = require("./routes/folder");
const shareRoutes = require("./routes/share");

const app = express();

const PORT = process.env.PORT || 5000;

/* =========================
   MIDDLEWARE
========================= */

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
    ],
    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],
  })
);

app.use(express.json());

app.use(
  express.urlencoded({
    extended: true,
  })
);

/* =========================
   ROUTES
========================= */

app.get("/", (req, res) => {
  res.json({
    message: "Cloud Storage API is running",
  });
});

app.use("/api/auth", authRoutes);

app.use("/api/files", fileRoutes);

app.use("/api/folders", folderRoutes);

app.use("/api/shares", shareRoutes);

/* =========================
   START SERVER
========================= */

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(
      `Server running on http://localhost:${PORT}`
    );
  });
}

module.exports = app;