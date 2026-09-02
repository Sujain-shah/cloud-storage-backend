const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");

require("dotenv").config();

const folderRoutes =
    require("./routes/folder");

const fileRoutes =
    require("./routes/file");

const authRoutes =
    require("./routes/auth");

const userRoutes =
    require("./routes/user");

const shareRoutes =
    require("./routes/share");

const pool =
    require("./db");


const app = express();


/* =========================
   MIDDLEWARE
========================= */

app.use(cors());

app.use(express.json());

app.use(cookieParser());


/* =========================
   ROUTES
========================= */

app.use(
    "/api/auth",
    authRoutes
);

app.use(
    "/api/user",
    userRoutes
);

app.use(
    "/api/folders",
    folderRoutes
);

app.use(
    "/api/files",
    fileRoutes
);

app.use(
    "/api/shares",
    shareRoutes
);


/* =========================
   HEALTH CHECK
========================= */

app.get(
    "/",
    (req, res) => {

        res.json({
            message:
                "Cloud Storage API is running"
        });
    }
);


/* =========================
   DATABASE HEALTH CHECK
========================= */

app.get(
    "/api/health/db",

    async (req, res) => {

        try {

            const result =
                await pool.query(
                    "SELECT NOW()"
                );

            return res.json({

                message:
                    "Database connection successful",

                time:
                    result.rows[0].now
            });

        } catch (error) {

            console.error(
                "Database connection error:",
                error
            );

            return res.status(500).json({

                message:
                    "Database connection failed"
            });
        }
    }
);


/* =========================
   START SERVER
========================= */

if (
    require.main === module
) {

    const PORT =
        process.env.PORT || 5000;

    app.listen(
        PORT,
        () => {

            console.log(
                `Server running on http://localhost:${PORT}`
            );
        }
    );
}


/* Export app for Supertest */

module.exports = app;