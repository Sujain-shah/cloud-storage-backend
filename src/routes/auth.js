const express = require("express");
const supabase = require("../supabase");

const router = express.Router();

// Signup
router.post("/signup", async (req, res) => {
    try {
        const { name, email, password } = req.body;

        console.log("Received body:", req.body);

        if (!name || !email || !password) {
            return res.status(400).json({
                message: "Name, email and password are required"
            });
        }

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
            console.log("Supabase error:", error);

            return res.status(400).json({
                message: error.message
            });
        }
        const { error: dbError } = await supabase
            .from("users")
            .insert([
                {
                    id: data.user.id,
                    email: data.user.email,
                    name: name
                }
            ]);

        if (dbError) {
            console.error("Database user creation error:", dbError);

            return res.status(400).json({
                message: dbError.message
            });
        }

        res.status(201).json({
            message: "User created successfully",
            user: data.user
        });

    } catch (error) {
        console.error("Signup error:", error);

        res.status(500).json({
            message: "Signup failed"
        });
    }
});


// Login
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                message: "Email and password are required"
            });
        }

        const { data, error } =
            await supabase.auth.signInWithPassword({
                email,
                password
            });

        if (error) {
            return res.status(400).json({
                message: error.message
            });
        }

        res.status(200).json({
            message: "Login successful",
            user: data.user,
            session: data.session
        });

    } catch (error) {
        console.error("Login error:", error);

        res.status(500).json({
            message: "Login failed"
        });
    }
});

module.exports = router;