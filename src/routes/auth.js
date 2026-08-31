const express = require("express");
const supabase = require("../supabase");
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
        const { error } = await supabase.auth.signOut();

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


module.exports = router;