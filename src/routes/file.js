const express = require("express");
const multer = require("multer");

const supabase = require("../supabase");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// Multer configuration
const storage = multer.memoryStorage();

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10 MB
    }
});

// Upload file
router.post(
    "/upload",
    authMiddleware,
    upload.single("file"),
    async (req, res) => {
        try {
            console.log("REQ BODY:", req.body);
            const { folder_id = null } = req.body;

            // Check if file exists
            if (!req.file) {
                return res.status(400).json({
                    message: "File is required"
                });
            }

            // If folder_id is provided, verify ownership
            if (folder_id) {
                const { data: folder, error: folderError } =
                    await supabase
                        .from("folders")
                        .select("id")
                        .eq("id", folder_id)
                        .eq("owner_id", req.user.id)
                        .eq("is_deleted", false)
                        .single();

                if (folderError || !folder) {
                    return res.status(404).json({
                        message: "Folder not found"
                    });
                }
            }

            // Create unique storage path
            const fileName = `${Date.now()}-${req.file.originalname}`;

            const storageKey = `${req.user.id}/${fileName}`;

            // Upload file to Supabase Storage
            const { error: uploadError } = await supabase.storage
                .from("files")
                .upload(storageKey, req.file.buffer, {
                    contentType: req.file.mimetype,
                    upsert: false
                });

            if (uploadError) {
                console.error("Storage upload error:", uploadError);

                return res.status(400).json({
                    message: uploadError.message
                });
            }

            // Save file metadata in database
            const { data: fileData, error: dbError } =
                await supabase
                    .from("files")
                    .insert([
                        {
                            name: req.file.originalname,
                            mime_type: req.file.mimetype,
                            size_bytes: req.file.size,
                            storage_key: storageKey,
                            owner_id: req.user.id,
                            folder_id: folder_id
                        }
                    ])
                    .select()
                    .single();

            if (dbError) {
                console.error("Database error:", dbError);

                // Remove uploaded file if database save fails
                await supabase.storage
                    .from("files")
                    .remove([storageKey]);

                return res.status(400).json({
                    message: dbError.message
                });
            }

            res.status(201).json({
                message: "File uploaded successfully",
                file: fileData
            });

        } catch (error) {
            console.error("File upload error:", error);

            res.status(500).json({
                message: "Failed to upload file"
            });
        }
    }
);

module.exports = router;