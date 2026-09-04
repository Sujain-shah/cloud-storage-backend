const express = require("express");
const multer = require("multer");

const supabase = require("../supabase");
const authMiddleware = require("../middleware/authMiddleware");
const pool = require("../db");

const router = express.Router();


/* =========================
   MULTER CONFIGURATION
========================= */

const storage = multer.memoryStorage();

const upload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024
    }
});


/* =========================
   PAGINATION HELPER
========================= */

function getPagination(query) {

    const page =
        Number.parseInt(query.page, 10) || 1;

    const limit =
        Number.parseInt(query.limit, 10) || 20;

    if (
        page < 1 ||
        limit < 1 ||
        limit > 100
    ) {
        return null;
    }

    return {
        page,
        limit,
        offset: (page - 1) * limit
    };
}


/* =========================
   PAGINATED FILE HELPER
========================= */

async function paginatedFiles(
    req,
    res,
    {
        folderId,
        deleted = false,
        message
    }
) {

    const pagination =
        getPagination(req.query);

    if (!pagination) {

        return res.status(400).json({
            message:
                "page must be >= 1 and limit must be between 1 and 100"
        });
    }

    const {
        page,
        limit,
        offset
    } = pagination;

    let query =
        supabase
            .from("files")
            .select(
                `
                id,
                name,
                mime_type,
                size_bytes,
                storage_key,
                owner_id,
                folder_id,
                is_deleted,
                created_at,
                updated_at
                `,
                {
                    count: "exact"
                }
            )
            .eq(
                "owner_id",
                req.user.id
            )
            .eq(
                "is_deleted",
                deleted
            );

    if (folderId === null) {

        query =
            query.is(
                "folder_id",
                null
            );

    } else if (folderId) {

        query =
            query.eq(
                "folder_id",
                folderId
            );
    }

    const {
        data,
        error,
        count
    } =
        await query
            .order(
                "created_at",
                {
                    ascending: false
                }
            )
            .range(
                offset,
                offset + limit - 1
            );

    if (error) {

        return res.status(400).json({
            message: error.message
        });
    }

    const total =
        count || 0;

    return res.status(200).json({

        message,

        files: data,

        pagination: {

            total,

            page,

            limit,

            totalPages:
                Math.ceil(
                    total / limit
                ),

            hasMore:
                offset +
                data.length <
                total
        }
    });
}


/* =========================
   UPLOAD FILE
========================= */

router.post(
    "/upload",
    authMiddleware,
    upload.single("file"),

    async (req, res) => {

        try {

            const {
                folder_id = null
            } =
                req.body;

            if (!req.file) {

                return res.status(400).json({
                    message:
                        "File is required"
                });
            }


            /* Verify folder */

            if (folder_id) {

                const {
                    data: folder,
                    error
                } =
                    await supabase
                        .from("folders")
                        .select("id")
                        .eq(
                            "id",
                            folder_id
                        )
                        .eq(
                            "owner_id",
                            req.user.id
                        )
                        .eq(
                            "is_deleted",
                            false
                        )
                        .single();

                if (
                    error ||
                    !folder
                ) {

                    return res.status(404).json({
                        message:
                            "Folder not found"
                    });
                }
            }


            const fileName =
                `${Date.now()}-${req.file.originalname}`;

            const storageKey =
                `${req.user.id}/${fileName}`;


            /* Upload to Supabase Storage */

            const {
                error: uploadError
            } =
                await supabase.storage
                    .from("files")
                    .upload(
                        storageKey,
                        req.file.buffer,
                        {
                            contentType:
                                req.file.mimetype,

                            upsert: false
                        }
                    );

            if (uploadError) {

                return res.status(400).json({
                    message:
                        uploadError.message
                });
            }


            /* Save metadata */

            const {
                data: fileData,
                error: dbError
            } =
                await supabase
                    .from("files")
                    .insert([
                        {
                            name:
                                req.file.originalname,

                            mime_type:
                                req.file.mimetype,

                            size_bytes:
                                req.file.size,

                            storage_key:
                                storageKey,

                            owner_id:
                                req.user.id,

                            folder_id
                        }
                    ])
                    .select()
                    .single();


            if (dbError) {

                await supabase.storage
                    .from("files")
                    .remove([
                        storageKey
                    ]);

                return res.status(400).json({
                    message:
                        dbError.message
                });
            }


            return res.status(201).json({

                message:
                    "File uploaded successfully",

                file:
                    fileData
            });

        } catch (error) {

            console.error(
                "File upload error:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to upload file"
            });
        }
    }
);


/* =====================================================
   DAY 6 - POSTGRESQL FULL-TEXT SEARCH

   GET /api/files/search?q=document&page=1&limit=20
===================================================== */

router.get(
    "/search",
    authMiddleware,

    async (req, res) => {

        try {

            const q =
                typeof req.query.q === "string"
                    ? req.query.q.trim()
                    : "";


            if (!q) {

                return res.status(400).json({
                    message:
                        "Search query q is required"
                });
            }


            const pagination =
                getPagination(
                    req.query
                );


            if (!pagination) {

                return res.status(400).json({
                    message:
                        "page must be >= 1 and limit must be between 1 and 100"
                });
            }


            const {
                page,
                limit,
                offset
            } =
                pagination;


            const searchSql = `

                SELECT
                    resource_type,
                    id,
                    name,
                    mime_type,
                    size_bytes,
                    folder_id,
                    parent_id,
                    created_at,
                    updated_at,
                    rank

                FROM (

                    SELECT

                        'file'
                            AS resource_type,

                        id,

                        name,

                        mime_type,

                        size_bytes,

                        folder_id,

                        NULL::uuid
                            AS parent_id,

                        created_at,

                        updated_at,

                        ts_rank(
                            search_vector,

                            websearch_to_tsquery(
                                'simple',
                                $1
                            )
                        )
                            AS rank

                    FROM files

                    WHERE
                        owner_id = $2

                        AND
                        is_deleted = false

                        AND
                        search_vector @@
                        websearch_to_tsquery(
                            'simple',
                            $1
                        )


                    UNION ALL


                    SELECT

                        'folder'
                            AS resource_type,

                        id,

                        name,

                        NULL::text
                            AS mime_type,

                        NULL::bigint
                            AS size_bytes,

                        NULL::uuid
                            AS folder_id,

                        parent_id,

                        created_at,

                        updated_at,

                        ts_rank(
                            search_vector,

                            websearch_to_tsquery(
                                'simple',
                                $1
                            )
                        )
                            AS rank

                    FROM folders

                    WHERE
                        owner_id = $2

                        AND
                        is_deleted = false

                        AND
                        search_vector @@
                        websearch_to_tsquery(
                            'simple',
                            $1
                        )

                ) results

                ORDER BY
                    rank DESC,
                    created_at DESC

                LIMIT $3
                OFFSET $4
            `;


            const countSql = `

                SELECT
                    COUNT(*)::int
                        AS total

                FROM (

                    SELECT id

                    FROM files

                    WHERE
                        owner_id = $2

                        AND
                        is_deleted = false

                        AND
                        search_vector @@
                        websearch_to_tsquery(
                            'simple',
                            $1
                        )


                    UNION ALL


                    SELECT id

                    FROM folders

                    WHERE
                        owner_id = $2

                        AND
                        is_deleted = false

                        AND
                        search_vector @@
                        websearch_to_tsquery(
                            'simple',
                            $1
                        )

                ) results
            `;


            const [
                results,
                countResult
            ] =
                await Promise.all([

                    pool.query(
                        searchSql,
                        [
                            q,
                            req.user.id,
                            limit,
                            offset
                        ]
                    ),

                    pool.query(
                        countSql,
                        [
                            q,
                            req.user.id
                        ]
                    )
                ]);


            const total =
                countResult
                    .rows[0]
                    .total;


            return res.status(200).json({

                message:
                    "Search completed successfully",

                query:
                    q,

                results:
                    results.rows,

                pagination: {

                    total,

                    page,

                    limit,

                    totalPages:
                        Math.ceil(
                            total / limit
                        ),

                    hasMore:
                        offset +
                        results.rows.length <
                        total
                }
            });

        } catch (error) {

            console.error(
                "Search error:",
                error
            );

            return res.status(500).json({
                message:
                    "Search failed"
            });
        }
    }
);


/* =========================
   GET DELETED FILES
========================= */

router.get(
    "/trash",
    authMiddleware,

    async (req, res) => {

        try {

            return await paginatedFiles(
                req,
                res,
                {
                    folderId:
                        undefined,

                    deleted:
                        true,

                    message:
                        "Deleted files fetched successfully"
                }
            );

        } catch (error) {

            console.error(
                "Get deleted files error:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to fetch deleted files"
            });
        }
    }
);


/* =========================
   GET ROOT FILES
   PAGINATION + LAZY LOADING
========================= */

router.get(
    "/",
    authMiddleware,

    async (req, res) => {

        try {

            return await paginatedFiles(
                req,
                res,
                {
                    folderId:
                        null,

                    deleted:
                        false,

                    message:
                        "Root files fetched successfully"
                }
            );

        } catch (error) {

            console.error(
                "Get root files error:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to fetch root files"
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

            const {
                folderId
            } =
                req.params;


            const {
                data: folder,
                error
            } =
                await supabase
                    .from("folders")
                    .select("id")
                    .eq(
                        "id",
                        folderId
                    )
                    .eq(
                        "owner_id",
                        req.user.id
                    )
                    .eq(
                        "is_deleted",
                        false
                    )
                    .single();


            if (
                error ||
                !folder
            ) {

                return res.status(404).json({
                    message:
                        "Folder not found"
                });
            }


            return await paginatedFiles(
                req,
                res,
                {
                    folderId,

                    deleted:
                        false,

                    message:
                        "Folder files fetched successfully"
                }
            );

        } catch (error) {

            console.error(
                "Get folder files error:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to fetch folder files"
            });
        }
    }
);


/* =========================
   DOWNLOAD FILE
========================= */

router.get(
    "/:fileId/download",
    authMiddleware,

    async (req, res) => {

        try {

            const {
                data: file,
                error
            } =
                await supabase
                    .from("files")
                    .select("*")
                    .eq(
                        "id",
                        req.params.fileId
                    )
                    .eq(
                        "owner_id",
                        req.user.id
                    )
                    .eq(
                        "is_deleted",
                        false
                    )
                    .single();


            if (
                error ||
                !file
            ) {

                return res.status(404).json({
                    message:
                        "File not found"
                });
            }


            const {
                data,
                error: downloadError
            } =
                await supabase.storage
                    .from("files")
                    .download(
                        file.storage_key
                    );


            if (downloadError) {

                return res.status(400).json({
                    message:
                        downloadError.message
                });
            }


            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${file.name}"`
            );

            res.setHeader(
                "Content-Type",
                file.mime_type ||
                "application/octet-stream"
            );


            return res.send(
                Buffer.from(
                    await data.arrayBuffer()
                )
            );

        } catch (error) {

            console.error(
                "File download error:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to download file"
            });
        }
    }
);


/* =========================
   PREVIEW FILE
========================= */

router.get(
    "/:fileId/preview",
    authMiddleware,
    async (req, res) => {
        try {
            const { fileId } = req.params;

            // First get the file
            const { data: file, error: fileError } =
                await supabase
                    .from("files")
                    .select("*")
                    .eq("id", fileId)
                    .eq("is_deleted", false)
                    .single();

            if (fileError || !file) {
                return res.status(404).json({
                    message: "File not found"
                });
            }

            // Check whether current user is the owner
            const isOwner =
                file.owner_id === req.user.id;

            // If not owner, check whether file is shared with them
            if (!isOwner) {
                const {
                    data: share,
                    error: shareError
                } = await supabase
                    .from("shares")
                    .select("id, role")
                    .eq("resource_type", "file")
                    .eq("resource_id", fileId)
                    .eq("grantee_user_id", req.user.id)
                    .single();

                if (shareError || !share) {
                    return res.status(403).json({
                        message:
                            "You do not have permission to view this file"
                    });
                }
            }

            // Generate signed preview URL
            const {
                data,
                error: signedUrlError
            } = await supabase.storage
                .from("files")
                .createSignedUrl(
                    file.storage_key,
                    60 * 10
                );

            if (signedUrlError) {
                return res.status(400).json({
                    message: signedUrlError.message
                });
            }

            return res.status(200).json({
                message:
                    "Preview URL generated successfully",
                preview_url:
                    data.signedUrl,
                url:
                    data.signedUrl,
                expires_in:
                    "10 minutes"
            });

        } catch (error) {
            console.error(
                "File preview error:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to generate preview URL"
            });
        }
    }
);


/* =========================
   MOVE FILE
========================= */

router.patch(
    "/:fileId/move",
    authMiddleware,

    async (req, res) => {

        try {

            const {
                folder_id = null
            } =
                req.body;


            if (folder_id) {

                const {
                    data: folder,
                    error
                } =
                    await supabase
                        .from("folders")
                        .select("id")
                        .eq(
                            "id",
                            folder_id
                        )
                        .eq(
                            "owner_id",
                            req.user.id
                        )
                        .eq(
                            "is_deleted",
                            false
                        )
                        .single();


                if (
                    error ||
                    !folder
                ) {

                    return res.status(404).json({
                        message:
                            "Destination folder not found"
                    });
                }
            }


            const {
                data,
                error
            } =
                await supabase
                    .from("files")
                    .update({
                        folder_id,
                        updated_at:
                            new Date()
                                .toISOString()
                    })
                    .eq(
                        "id",
                        req.params.fileId
                    )
                    .eq(
                        "owner_id",
                        req.user.id
                    )
                    .eq(
                        "is_deleted",
                        false
                    )
                    .select()
                    .single();


            if (
                error ||
                !data
            ) {

                return res.status(404).json({
                    message:
                        "File not found"
                });
            }


            return res.status(200).json({

                message:
                    "File moved successfully",

                file:
                    data
            });

        } catch (error) {

            console.error(
                "Move file error:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to move file"
            });
        }
    }
);


/* =========================
   RENAME FILE
========================= */

router.put(
    "/:fileId",
    authMiddleware,

    async (req, res) => {

        try {

            const name =
                typeof req.body.name === "string"
                    ? req.body.name.trim()
                    : "";


            if (!name) {

                return res.status(400).json({
                    message:
                        "New file name is required"
                });
            }


            const {
                data,
                error
            } =
                await supabase
                    .from("files")
                    .update({
                        name,

                        updated_at:
                            new Date()
                                .toISOString()
                    })
                    .eq(
                        "id",
                        req.params.fileId
                    )
                    .eq(
                        "owner_id",
                        req.user.id
                    )
                    .eq(
                        "is_deleted",
                        false
                    )
                    .select()
                    .single();


            if (
                error ||
                !data
            ) {

                return res.status(404).json({
                    message:
                        "File not found"
                });
            }


            return res.status(200).json({

                message:
                    "File renamed successfully",

                file:
                    data
            });

        } catch (error) {

            console.error(
                "Rename file error:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to rename file"
            });
        }
    }
);


/* =========================
   RESTORE FILE
========================= */

router.patch(
    "/:fileId/restore",
    authMiddleware,

    async (req, res) => {

        try {

            const {
                data,
                error
            } =
                await supabase
                    .from("files")
                    .update({
                        is_deleted:
                            false,

                        updated_at:
                            new Date()
                                .toISOString()
                    })
                    .eq(
                        "id",
                        req.params.fileId
                    )
                    .eq(
                        "owner_id",
                        req.user.id
                    )
                    .eq(
                        "is_deleted",
                        true
                    )
                    .select()
                    .single();


            if (
                error ||
                !data
            ) {

                return res.status(404).json({
                    message:
                        "Deleted file not found"
                });
            }


            return res.status(200).json({

                message:
                    "File restored successfully",

                file:
                    data
            });

        } catch (error) {

            console.error(
                "Restore file error:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to restore file"
            });
        }
    }
);


/* =========================
   DELETE FILE
========================= */

router.delete(
    "/:fileId",
    authMiddleware,

    async (req, res) => {

        try {

            const {
                data,
                error
            } =
                await supabase
                    .from("files")
                    .update({
                        is_deleted:
                            true,

                        updated_at:
                            new Date()
                                .toISOString()
                    })
                    .eq(
                        "id",
                        req.params.fileId
                    )
                    .eq(
                        "owner_id",
                        req.user.id
                    )
                    .eq(
                        "is_deleted",
                        false
                    )
                    .select()
                    .single();


            if (
                error ||
                !data
            ) {

                return res.status(404).json({
                    message:
                        "File not found"
                });
            }


            return res.status(200).json({
                message:
                    "File deleted successfully"
            });

        } catch (error) {

            console.error(
                "Delete file error:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to delete file"
            });
        }
    }
);

/* =========================
   DELETE FILE PERMANENTLY
========================= */

router.delete(
    "/:fileId/permanent",
    authMiddleware,

    async (req, res) => {
        try {

            // Get deleted file first
            const {
                data: file,
                error: findError
            } =
                await supabase
                    .from("files")
                    .select("*")
                    .eq(
                        "id",
                        req.params.fileId
                    )
                    .eq(
                        "owner_id",
                        req.user.id
                    )
                    .eq(
                        "is_deleted",
                        true
                    )
                    .single();


            if (
                findError ||
                !file
            ) {
                return res.status(404).json({
                    message:
                        "Deleted file not found"
                });
            }


            // Delete actual file from Supabase Storage
            const {
                error: storageError
            } =
                await supabase.storage
                    .from("files")
                    .remove([
                        file.storage_key
                    ]);


            if (storageError) {
                return res.status(400).json({
                    message:
                        storageError.message
                });
            }


            // Delete file metadata permanently
            const {
                error: deleteError
            } =
                await supabase
                    .from("files")
                    .delete()
                    .eq(
                        "id",
                        req.params.fileId
                    )
                    .eq(
                        "owner_id",
                        req.user.id
                    );


            if (deleteError) {
                return res.status(400).json({
                    message:
                        deleteError.message
                });
            }


            return res.status(200).json({
                message:
                    "File deleted permanently"
            });

        } catch (error) {

            console.error(
                "Permanent delete error:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to permanently delete file"
            });

        }
    }
);

module.exports = router;