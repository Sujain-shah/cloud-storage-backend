const express = require("express");
const supabase = require("../supabase");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// Create folder
router.post("/", authMiddleware, async (req, res) => {
    try {
        const { name, parent_id = null } = req.body;

        if (!name) {
            return res.status(400).json({
                message: "Folder name is required"
            });
        }

        const { data, error } = await supabase
            .from("folders")
            .insert([
                {
                    name: name,
                    owner_id: req.user.id,
                    parent_id: parent_id
                }
            ])
            .select();

        if (error) {
            console.error("Create folder error:", error);

            return res.status(400).json({
                message: error.message
            });
        }

        res.status(201).json({
            message: "Folder created successfully",
            folder: data[0]
        });

    } catch (error) {
        console.error("Create folder error:", error);

        res.status(500).json({
            message: "Failed to create folder"
        });
    }
});
// Get all folders of logged-in user
router.get("/", authMiddleware, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("folders")
            .select("*")
            .eq("owner_id", req.user.id)
            .eq("is_deleted", false)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Get folders error:", error);

            return res.status(400).json({
                message: error.message
            });
        }

        res.status(200).json({
            message: "Folders fetched successfully",
            folders: data
        });

    } catch (error) {
        console.error("Get folders error:", error);

        res.status(500).json({
            message: "Failed to fetch folders"
        });
    }
});
router.get("/:folderId", authMiddleware, async (req, res) => {
    try {
        const { folderId } = req.params;

        const { data, error } = await supabase
            .from("folders")
            .select("*")
            .eq("parent_id", folderId)
            .eq("owner_id", req.user.id)
            .eq("is_deleted", false)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Get child folders error:", error);

            return res.status(400).json({
                message: error.message
            });
        }

        res.status(200).json({
            message: "Child folders fetched successfully",
            folders: data
        });

    } catch (error) {
        console.error("Get child folders error:", error);

        res.status(500).json({
            message: "Failed to fetch child folders"
        });
    }
});
// Soft delete folder
router.delete("/:folderId", authMiddleware, async (req, res) => {
    try {
        const { folderId } = req.params;

        const { data, error } = await supabase
            .from("folders")
            .update({
                is_deleted: true
            })
            .eq("id", folderId)
            .eq("owner_id", req.user.id)
            .select();

        if (error) {
            console.error("Delete folder error:", error);

            return res.status(400).json({
                message: error.message
            });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({
                message: "Folder not found"
            });
        }

        res.status(200).json({
            message: "Folder deleted successfully"
        });

    } catch (error) {
        console.error("Delete folder error:", error);

        res.status(500).json({
            message: "Failed to delete folder"
        });
    }
});
module.exports = router;