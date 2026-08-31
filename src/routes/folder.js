const express = require("express");
const supabase = require("../supabase");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();


// ========================================
// CREATE FOLDER
// POST /api/folders
// ========================================

router.post("/", authMiddleware, async (req, res) => {
    try {
        const { name, parent_id = null } = req.body;

        // Validate folder name
        if (!name || !name.trim()) {
            return res.status(400).json({
                message: "Folder name is required"
            });
        }

        // If parent folder is provided, verify it belongs to the user
        if (parent_id) {
            const { data: parentFolder, error: parentError } = await supabase
                .from("folders")
                .select("id")
                .eq("id", parent_id)
                .eq("owner_id", req.user.id)
                .eq("is_deleted", false)
                .single();

            if (parentError || !parentFolder) {
                return res.status(404).json({
                    message: "Parent folder not found"
                });
            }
        }

        // Create folder
        const { data, error } = await supabase
            .from("folders")
            .insert([
                {
                    name: name.trim(),
                    owner_id: req.user.id,
                    parent_id: parent_id
                }
            ])
            .select()
            .single();

        if (error) {
            console.error("Create folder error:", error);

            return res.status(400).json({
                message: error.message
            });
        }

        return res.status(201).json({
            message: "Folder created successfully",
            folder: data
        });

    } catch (error) {
        console.error("Create folder error:", error);

        return res.status(500).json({
            message: "Failed to create folder"
        });
    }
});


// ========================================
// GET ROOT FOLDERS
// GET /api/folders
// ========================================

router.get("/", authMiddleware, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("folders")
            .select("*")
            .eq("owner_id", req.user.id)
            .is("parent_id", null)
            .eq("is_deleted", false)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Get folders error:", error);

            return res.status(400).json({
                message: error.message
            });
        }

        return res.status(200).json({
            message: "Root folders fetched successfully",
            folders: data
        });

    } catch (error) {
        console.error("Get folders error:", error);

        return res.status(500).json({
            message: "Failed to fetch folders"
        });
    }
});


// ========================================
// GET SINGLE FOLDER
// GET /api/folders/:folderId
// ========================================

router.get("/:folderId", authMiddleware, async (req, res) => {
    try {
        const { folderId } = req.params;

        const { data, error } = await supabase
            .from("folders")
            .select("*")
            .eq("id", folderId)
            .eq("owner_id", req.user.id)
            .eq("is_deleted", false)
            .single();

        if (error || !data) {
            return res.status(404).json({
                message: "Folder not found"
            });
        }

        return res.status(200).json({
            message: "Folder fetched successfully",
            folder: data
        });

    } catch (error) {
        console.error("Get folder error:", error);

        return res.status(500).json({
            message: "Failed to fetch folder"
        });
    }
});


// ========================================
// GET CHILD FOLDERS
// GET /api/folders/:folderId/children
// ========================================

router.get("/:folderId/children", authMiddleware, async (req, res) => {
    try {
        const { folderId } = req.params;

        // Verify parent folder belongs to user
        const { data: parentFolder, error: parentError } = await supabase
            .from("folders")
            .select("id")
            .eq("id", folderId)
            .eq("owner_id", req.user.id)
            .eq("is_deleted", false)
            .single();

        if (parentError || !parentFolder) {
            return res.status(404).json({
                message: "Folder not found"
            });
        }

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

        return res.status(200).json({
            message: "Child folders fetched successfully",
            folders: data
        });

    } catch (error) {
        console.error("Get child folders error:", error);

        return res.status(500).json({
            message: "Failed to fetch child folders"
        });
    }
});


// ========================================
// RENAME FOLDER
// PUT /api/folders/:folderId
// ========================================

router.put("/:folderId", authMiddleware, async (req, res) => {
    try {
        const { folderId } = req.params;
        const { name } = req.body;

        // Validate new name
        if (!name || !name.trim()) {
            return res.status(400).json({
                message: "New folder name is required"
            });
        }

        const { data, error } = await supabase
            .from("folders")
            .update({
                name: name.trim(),
                updated_at: new Date().toISOString()
            })
            .eq("id", folderId)
            .eq("owner_id", req.user.id)
            .eq("is_deleted", false)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({
                message: "Folder not found"
            });
        }

        return res.status(200).json({
            message: "Folder renamed successfully",
            folder: data
        });

    } catch (error) {
        console.error("Rename folder error:", error);

        return res.status(500).json({
            message: "Failed to rename folder"
        });
    }
});


// ========================================
// SOFT DELETE FOLDER
// DELETE /api/folders/:folderId
// ========================================

router.delete("/:folderId", authMiddleware, async (req, res) => {
    try {
        const { folderId } = req.params;

        const { data, error } = await supabase
            .from("folders")
            .update({
                is_deleted: true,
                updated_at: new Date().toISOString()
            })
            .eq("id", folderId)
            .eq("owner_id", req.user.id)
            .eq("is_deleted", false)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({
                message: "Folder not found"
            });
        }

        return res.status(200).json({
            message: "Folder deleted successfully"
        });

    } catch (error) {
        console.error("Delete folder error:", error);

        return res.status(500).json({
            message: "Failed to delete folder"
        });
    }
});


module.exports = router;