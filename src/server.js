const express = require("express");
const folderRoutes = require("./routes/folder");
const fileRoutes = require("./routes/file");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/user");
const pool = require("./db");

const app = express();

const PORT = process.env.PORT || 5000;


// Middleware
app.use(cors());
app.use(express.json());


// Routes
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/folders", folderRoutes);
app.use("/api/files", fileRoutes);


// Basic health check
app.get("/", (req, res) => {
  res.json({
    message: "Cloud Storage API is running"
  });
});


// Database health check
app.get("/api/health/db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.json({
      message: "Database connection successful",
      time: result.rows[0].now
    });

  } catch (error) {
    console.error("Database connection error:", error);

    res.status(500).json({
      message: "Database connection failed"
    });
  }
});


// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});