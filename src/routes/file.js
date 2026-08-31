const express = require("express");
const multer = require("multer");

const supabase = require("../supabase");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

/* =========================
   MULTER CONFIGURATION
========================= */

const storage = multer.memoryStorage();

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10 MB
    }
});


/* =========================
   UPLOAD FILE
========================= */

router.post(
    "/upload",
    authMiddleware,
    upload.single("file"),
    async (req, res) => {
        try {
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

            const storageKey =
                `${req.user.id}/${fileName}`;

            // Upload file to Supabase Storage
            const { error: uploadError } =
                await supabase.storage
                    .from("files")
                    .upload(
                        storageKey,
                        req.file.buffer,
                        {
                            contentType: req.file.mimetype,
                            upsert: false
                        }
                    );

            if (uploadError) {
                console.error(
                    "Storage upload error:",
                    uploadError
                );

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

            // Remove storage file if database insert fails
            if (dbError) {
                console.error(
                    "Database error:",
                    dbError
                );

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
            console.error(
                "File upload error:",
                error
            );

            res.status(500).json({
                message: "Failed to upload file"
            });
        }
    }
);


/* =========================
   GET ROOT FILES
========================= */

router.get(
    "/",
    authMiddleware,
    async (req, res) => {
        try {
            const { data, error } =
                await supabase
                    .from("files")
                    .select("*")
                    .eq("owner_id", req.user.id)
                    .is("folder_id", null)
                    .eq("is_deleted", false)
                    .order("created_at", {
                        ascending: false
                    });

            if (error) {
                console.error(
                    "Get root files error:",
                    error
                );

                return res.status(400).json({
                    message: error.message
                });
            }

            res.status(200).json({
                message: "Root files fetched successfully",
                files: data
            });

        } catch (error) {
            console.error(
                "Get root files error:",
                error
            );

            res.status(500).json({
                message: "Failed to fetch root files"
            });
        }
    }
);


/* =========================
   GET FILES INSIDE FOLDER
========================= */

router.get(
    "/folder/:folderId",
    authMiddleware,
    async (req, res) => {
        try {
            const { folderId } = req.params;

            // Verify folder belongs to logged-in user
            const { data: folder, error: folderError } =
                await supabase
                    .from("folders")
                    .select("id")
                    .eq("id", folderId)
                    .eq("owner_id", req.user.id)
                    .eq("is_deleted", false)
                    .single();

            if (folderError || !folder) {
                return res.status(404).json({
                    message: "Folder not found"
                });
            }

            // Get files inside folder
            const { data, error } =
                await supabase
                    .from("files")
                    .select("*")
                    .eq("folder_id", folderId)
                    .eq("owner_id", req.user.id)
                    .eq("is_deleted", false)
                    .order("created_at", {
                        ascending: false
                    });

            if (error) {
                console.error(
                    "Get folder files error:",
                    error
                );

                return res.status(400).json({
                    message: error.message
                });
            }

            res.status(200).json({
                message: "Folder files fetched successfully",
                files: data
            });

        } catch (error) {
            console.error(
                "Get folder files error:",
                error
            );

            res.status(500).json({
                message: "Failed to fetch folder files"
            });
        }
    }
);


/* =========================
   RENAME FILE
========================= */

router.patch(
    "/:fileId",
    authMiddleware,
    async (req, res) => {
        try {
            const { fileId } = req.params;
            const { name } = req.body;

            if (!name || !name.trim()) {
                return res.status(400).json({
                    message: "File name is required"
                });
            }

            const { data, error } =
                await supabase
                    .from("files")
                    .update({
                        name: name.trim()
                    })
                    .eq("id", fileId)
                    .eq("owner_id", req.user.id)
                    .eq("is_deleted", false)
                    .select()
                    .single();

            if (error || !data) {
                return res.status(404).json({
                    message: "File not found"
                });
            }

            res.status(200).json({
                message: "File renamed successfully",
                file: data
            });

        } catch (error) {
            console.error(
                "Rename file error:",
                error
            );

            res.status(500).json({
                message: "Failed to rename file"
            });
        }
    }
);


/* =========================
   SOFT DELETE FILE
========================= */

router.delete(
    "/:fileId",
    authMiddleware,
    async (req, res) => {
        try {
            const { fileId } = req.params;

            const { data, error } =
                await supabase
                    .from("files")
                    .update({
                        is_deleted: true
                    })
                    .eq("id", fileId)
                    .eq("owner_id", req.user.id)
                    .eq("is_deleted", false)
                    .select()
                    .single();

            if (error || !data) {
                return res.status(404).json({
                    message: "File not found"
                });
            }

            res.status(200).json({
                message: "File deleted successfully"
            });

        } catch (error) {
            console.error(
                "Delete file error:",
                error
            );

            res.status(500).json({
                message: "Failed to delete file"
            });
        }
    }
);


module.exports = router;