const express = require("express");

const supabase = require("../supabase");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const pool = require("../db");

const router = express.Router();


// ==============================
// SIGNUP
// ==============================

router.post("/signup", async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Validation
        if (!name || !email || !password) {
            return res.status(400).json({
                message: "Name, email and password are required"
            });
        }

        // Password validation
        if (password.length < 6) {
            return res.status(400).json({
                message: "Password must be at least 6 characters long"
            });
        }

        // Create user in Supabase Auth
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    name: name
                }
            }
        });

        if (error) {
            console.error("Supabase signup error:", error);

            return res.status(400).json({
                message: error.message
            });
        }

        // Safety check
        if (!data.user) {
            return res.status(400).json({
                message: "User could not be created"
            });
        }

        // Create user in PostgreSQL users table
        const existingUser = await pool.query(
            "SELECT id FROM users WHERE id = $1",
            [data.user.id]
        );

        if (existingUser.rows.length === 0) {
            await pool.query(
                `
                INSERT INTO users (id, email, name)
                VALUES ($1, $2, $3)
                `,
                [
                    data.user.id,
                    email,
                    name
                ]
            );
        }

        return res.status(201).json({
            message: "User created successfully",
            user: {
                id: data.user.id,
                email: data.user.email,
                name: name
            }
        });

    } catch (error) {
        console.error("Signup error:", error);

        return res.status(500).json({
            message: "Signup failed"
        });
    }
});


// ==============================
// LOGIN
// ==============================

router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validation
        if (!email || !password) {
            return res.status(400).json({
                message: "Email and password are required"
            });
        }

        // Login using Supabase Auth
        const { data, error } =
            await supabase.auth.signInWithPassword({
                email,
                password
            });

        if (error) {
            return res.status(401).json({
                message: error.message
            });
        }

        return res.status(200).json({
            message: "Login successful",

            user: {
                id: data.user.id,
                email: data.user.email,
                name: data.user.user_metadata?.name || null
            },

            session: {
                access_token: data.session.access_token,
                token_type: data.session.token_type,
                expires_in: data.session.expires_in,
                expires_at: data.session.expires_at,
                refresh_token: data.session.refresh_token
            }
        });

    } catch (error) {
        console.error("Login error:", error);

        return res.status(500).json({
            message: "Login failed"
        });
    }
});


// ==============================
// LOGOUT
// ==============================

router.post("/logout", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                message: "Authorization token required"
            });
        }

        const token = authHeader.split(" ")[1];

        const { error } =
            await supabase.auth.admin.signOut(token);

        if (error) {
            return res.status(400).json({
                message: error.message
            });
        }

        return res.status(200).json({
            message: "Logout successful"
        });

    } catch (error) {
        console.error("Logout error:", error);

        return res.status(500).json({
            message: "Logout failed"
        });
    }
});


// ==============================
// GOOGLE LOGIN
// ==============================

router.get("/google", async (req, res) => {
    try {
        const supabaseOAuth =
            createOAuthClient(req, res);

        const { data, error } =
            await supabaseOAuth.auth.signInWithOAuth({
                provider: "google",

                options: {
                    redirectTo:
                        "http://localhost:5000/api/auth/google/callback"
                }
            });

        if (error) {
            console.error(
                "Google login error:",
                error
            );

            return res.status(400).json({
                message: error.message
            });
        }

        return res.redirect(data.url);

    } catch (error) {
        console.error(
            "Google login error:",
            error
        );

        return res.status(500).json({
            message: "Google login failed"
        });
    }
});


// ==============================
// GOOGLE CALLBACK
// ==============================

router.get("/google/callback", async (req, res) => {
    try {
        const { code } = req.query;

        if (!code) {
            return res.status(400).json({
                message: "Authorization code not received"
            });
        }

        const { data, error } =
            await supabase.auth.exchangeCodeForSession(code);

        if (error) {
            console.error("Google callback error:", error);

            return res.status(400).json({
                message: error.message
            });
        }

        if (!data.user) {
            return res.status(400).json({
                message: "Google user not found"
            });
        }

        // Get user details from Google/Supabase
        const userId = data.user.id;

        const email = data.user.email;

        const name =
            data.user.user_metadata?.full_name ||
            data.user.user_metadata?.name ||
            "Google User";

        // ========================================
        // INSERT GOOGLE USER INTO USERS TABLE
        // ========================================

        const existingUser = await pool.query(
            "SELECT id FROM users WHERE id = $1",
            [userId]
        );

        if (existingUser.rows.length === 0) {
            await pool.query(
                `
                INSERT INTO users (id, email, name)
                VALUES ($1, $2, $3)
                `,
                [
                    userId,
                    email,
                    name
                ]
            );
        }

        // ========================================
        // SUCCESS RESPONSE
        // ========================================

        return res.status(200).json({
            message: "Google login successful",

            user: {
                id: userId,
                email: email,
                name: name
            },

            session: {
                access_token: data.session.access_token,

                refresh_token: data.session.refresh_token,

                expires_in: data.session.expires_in,

                expires_at: data.session.expires_at
            }
        });

    } catch (error) {

        console.error(
            "Google callback error:",
            error
        );

        return res.status(500).json({
            message: "Google authentication failed"
        });

    }
});

function createOAuthClient(req, res) {
    const cookieStorage = {
        getItem: async (key) => {
            return req.cookies?.[key] || null;
        },

        setItem: (key, value) => {
            res.cookie(key, value, {
                httpOnly: true,
                sameSite: "lax",
                secure: false,
                path: "/"
            });
        },

        removeItem: (key) => {
            res.clearCookie(key, {
                path: "/"
            });
        }
    };

    return createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        {
            auth: {
                flowType: "pkce",
                persistSession: true,
                detectSessionInUrl: false,
                storage: cookieStorage
            }
        }
    );
}

module.exports = router;