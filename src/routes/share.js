const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcrypt");

const supabase = require("../supabase");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();


/* ========================================
   HELPER: VALIDATE RESOURCE
======================================== */

async function getOwnedResource(resourceType, resourceId, userId) {
    const table =
        resourceType === "file" ? "files" : "folders";

    const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq("id", resourceId)
        .eq("owner_id", userId)
        .eq("is_deleted", false)
        .single();

    if (error || !data) {
        return null;
    }

    return data;
}


/* ========================================
   SHARE RESOURCE WITH USER
   POST /api/shares

   Body:
   {
       "resource_type": "file",
       "resource_id": "...",
       "grantee_user_id": "...",
       "role": "viewer"
   }
======================================== */

router.post("/", authMiddleware, async (req, res) => {
    try {
        const {
            resource_type,
            resource_id,
            grantee_user_id,
            role
        } = req.body;

        if (
            !resource_type ||
            !resource_id ||
            !grantee_user_id ||
            !role
        ) {
            return res.status(400).json({
                message:
                    "resource_type, resource_id, grantee_user_id and role are required"
            });
        }

        if (
            resource_type !== "file" &&
            resource_type !== "folder"
        ) {
            return res.status(400).json({
                message:
                    "resource_type must be file or folder"
            });
        }

        if (
            role !== "viewer" &&
            role !== "editor"
        ) {
            return res.status(400).json({
                message:
                    "role must be viewer or editor"
            });
        }

        if (grantee_user_id === req.user.id) {
            return res.status(400).json({
                message:
                    "You cannot share a resource with yourself"
            });
        }

        // Verify resource ownership
        const resource = await getOwnedResource(
            resource_type,
            resource_id,
            req.user.id
        );

        if (!resource) {
            return res.status(404).json({
                message:
                    "Resource not found or you do not own it"
            });
        }

        // Verify recipient exists
        const { data: grantee, error: granteeError } =
            await supabase
                .from("users")
                .select("id, email, name")
                .eq("id", grantee_user_id)
                .single();

        if (granteeError || !grantee) {
            return res.status(404).json({
                message: "User to share with not found"
            });
        }

        // Create or update share
        const { data, error } = await supabase
            .from("shares")
            .upsert(
                {
                    resource_type,
                    resource_id,
                    grantee_user_id,
                    role,
                    created_by: req.user.id
                },
                {
                    onConflict:
                        "resource_type,resource_id,grantee_user_id"
                }
            )
            .select()
            .single();

        if (error) {
            console.error("Create share error:", error);

            return res.status(400).json({
                message: error.message
            });
        }

        return res.status(201).json({
            message: "Resource shared successfully",
            share: data,
            shared_with: grantee
        });

    } catch (error) {
        console.error("Create share error:", error);

        return res.status(500).json({
            message: "Failed to share resource"
        });
    }
});

/* ========================================
   ACCESS PUBLIC SHAREABLE LINK
   GET /api/shares/public/:token

   Optional password:
   Header:
   x-share-password: your-password
======================================== */

router.get(
    "/public/:token",
    async (req, res) => {
        try {
            const { token } = req.params;

            const { data: linkShare, error } =
                await supabase
                    .from("link_shares")
                    .select("*")
                    .eq("token", token)
                    .single();

            if (error || !linkShare) {
                return res.status(404).json({
                    message:
                        "Shareable link not found"
                });
            }

            // Check expiry
            if (
                linkShare.expires_at &&
                new Date(
                    linkShare.expires_at
                ) < new Date()
            ) {
                return res.status(410).json({
                    message:
                        "This shareable link has expired"
                });
            }

            // Check password
            if (linkShare.password_hash) {

                const password =
                    req.headers[
                    "x-share-password"
                    ];

                if (!password) {
                    return res.status(401).json({
                        message:
                            "Password required"
                    });
                }

                const validPassword =
                    await bcrypt.compare(
                        password,
                        linkShare.password_hash
                    );

                if (!validPassword) {
                    return res.status(401).json({
                        message:
                            "Incorrect password"
                    });
                }
            }

            const table =
                linkShare.resource_type === "file"
                    ? "files"
                    : "folders";

            const { data: resource, error: resourceError } =
                await supabase
                    .from(table)
                    .select("*")
                    .eq("id", linkShare.resource_id)
                    .eq("is_deleted", false)
                    .single();

            if (resourceError || !resource) {
                return res.status(404).json({
                    message:
                        "Shared resource no longer exists"
                });
            }

            // If shared resource is a file,
            // generate secure signed URL
            let signed_url = null;

            if (
                linkShare.resource_type === "file"
            ) {

                const {
                    data: signedData,
                    error: signedError
                } =
                    await supabase.storage
                        .from("files")
                        .createSignedUrl(
                            resource.storage_key,
                            60 * 10
                        );

                if (!signedError) {
                    signed_url =
                        signedData.signedUrl;
                }
            }

            return res.status(200).json({
                message:
                    "Shared resource accessed successfully",

                resource_type:
                    linkShare.resource_type,

                resource,

                signed_url,

                link: {
                    expires_at:
                        linkShare.expires_at,

                    password_protected:
                        !!linkShare.password_hash,

                    role:
                        linkShare.role
                }
            });

        } catch (error) {

            console.error(
                "Access public link error:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to access shared resource"
            });
        }
    }
);
/* ========================================
   GET ALL SHARES FOR A RESOURCE
   GET /api/shares/:resourceType/:resourceId
======================================== */

router.get(
    "/:resourceType/:resourceId",
    authMiddleware,
    async (req, res) => {
        try {
            const {
                resourceType,
                resourceId
            } = req.params;

            if (
                resourceType !== "file" &&
                resourceType !== "folder"
            ) {
                return res.status(400).json({
                    message:
                        "resourceType must be file or folder"
                });
            }

            // Only owner can see sharing list
            const resource = await getOwnedResource(
                resourceType,
                resourceId,
                req.user.id
            );

            if (!resource) {
                return res.status(404).json({
                    message:
                        "Resource not found or you do not own it"
                });
            }

            const { data, error } = await supabase
                .from("shares")
                .select(`
                    id,
                    resource_type,
                    resource_id,
                    role,
                    created_at,
                    grantee_user_id,
                    users!shares_grantee_user_id_fkey (
                        id,
                        name,
                        email
                    )
                `)
                .eq("resource_type", resourceType)
                .eq("resource_id", resourceId)
                .order("created_at", {
                    ascending: false
                });

            if (error) {
                console.error(
                    "Get shares error:",
                    error
                );

                return res.status(400).json({
                    message: error.message
                });
            }

            return res.status(200).json({
                message:
                    "Shares fetched successfully",
                shares: data
            });

        } catch (error) {
            console.error(
                "Get shares error:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to fetch shares"
            });
        }
    }
);


/* ========================================
   REVOKE USER SHARE
   DELETE /api/shares/:shareId
======================================== */

router.delete(
    "/:shareId",
    authMiddleware,
    async (req, res) => {
        try {
            const { shareId } = req.params;

            // Get share first
            const { data: share, error: shareError } =
                await supabase
                    .from("shares")
                    .select("*")
                    .eq("id", shareId)
                    .single();

            if (shareError || !share) {
                return res.status(404).json({
                    message: "Share not found"
                });
            }

            // Verify owner
            const resource = await getOwnedResource(
                share.resource_type,
                share.resource_id,
                req.user.id
            );

            if (!resource) {
                return res.status(403).json({
                    message:
                        "You are not allowed to revoke this share"
                });
            }

            const { error } = await supabase
                .from("shares")
                .delete()
                .eq("id", shareId);

            if (error) {
                return res.status(400).json({
                    message: error.message
                });
            }

            return res.status(200).json({
                message:
                    "Share revoked successfully"
            });

        } catch (error) {
            console.error(
                "Revoke share error:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to revoke share"
            });
        }
    }
);


/* ========================================
   CREATE PUBLIC SHAREABLE LINK
   POST /api/shares/link

   Body:
   {
       "resource_type": "file",
       "resource_id": "...",
       "expires_at": "2026-12-31T23:59:59Z",
       "password": "optional-password"
   }
======================================== */

router.post(
    "/link",
    authMiddleware,
    async (req, res) => {
        try {
            const {
                resource_type,
                resource_id,
                expires_at = null,
                password = null
            } = req.body;

            if (
                !resource_type ||
                !resource_id
            ) {
                return res.status(400).json({
                    message:
                        "resource_type and resource_id are required"
                });
            }

            if (
                resource_type !== "file" &&
                resource_type !== "folder"
            ) {
                return res.status(400).json({
                    message:
                        "resource_type must be file or folder"
                });
            }

            // Verify ownership
            const resource = await getOwnedResource(
                resource_type,
                resource_id,
                req.user.id
            );

            if (!resource) {
                return res.status(404).json({
                    message:
                        "Resource not found or you do not own it"
                });
            }

            // Validate expiry
            if (expires_at) {
                const expiryDate =
                    new Date(expires_at);

                if (
                    Number.isNaN(
                        expiryDate.getTime()
                    )
                ) {
                    return res.status(400).json({
                        message:
                            "Invalid expires_at date"
                    });
                }

                if (
                    expiryDate <= new Date()
                ) {
                    return res.status(400).json({
                        message:
                            "expires_at must be in the future"
                    });
                }
            }

            let password_hash = null;

            if (password) {
                if (password.length < 4) {
                    return res.status(400).json({
                        message:
                            "Password must be at least 4 characters"
                    });
                }

                password_hash =
                    await bcrypt.hash(password, 10);
            }

            const token =
                crypto.randomBytes(32)
                    .toString("hex");

            const { data, error } = await supabase
                .from("link_shares")
                .insert([
                    {
                        resource_type,
                        resource_id,
                        token,
                        role: "viewer",
                        password_hash,
                        expires_at,
                        created_by: req.user.id
                    }
                ])
                .select()
                .single();

            if (error) {
                console.error(
                    "Create link error:",
                    error
                );

                return res.status(400).json({
                    message: error.message
                });
            }

            return res.status(201).json({
                message:
                    "Shareable link created successfully",

                link_share: {
                    id: data.id,
                    resource_type:
                        data.resource_type,
                    resource_id:
                        data.resource_id,
                    expires_at:
                        data.expires_at,
                    created_at:
                        data.created_at,
                    password_protected:
                        !!data.password_hash
                },

                share_url:
                    `http://localhost:5000/api/shares/public/${token}`
            });

        } catch (error) {
            console.error(
                "Create link error:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to create shareable link"
            });
        }
    }
);




/* ========================================
   REVOKE PUBLIC SHAREABLE LINK
   DELETE /api/shares/link/:linkShareId
======================================== */

router.delete(
    "/link/:linkShareId",
    authMiddleware,
    async (req, res) => {
        try {

            const { linkShareId } =
                req.params;

            const {
                data: linkShare,
                error: linkError
            } = await supabase
                .from("link_shares")
                .select("*")
                .eq("id", linkShareId)
                .single();

            if (linkError || !linkShare) {
                return res.status(404).json({
                    message:
                        "Shareable link not found"
                });
            }

            const resource =
                await getOwnedResource(
                    linkShare.resource_type,
                    linkShare.resource_id,
                    req.user.id
                );

            if (!resource) {
                return res.status(403).json({
                    message:
                        "You are not allowed to revoke this link"
                });
            }

            const { error } =
                await supabase
                    .from("link_shares")
                    .delete()
                    .eq("id", linkShareId);

            if (error) {
                return res.status(400).json({
                    message: error.message
                });
            }

            return res.status(200).json({
                message:
                    "Shareable link revoked successfully"
            });

        } catch (error) {

            console.error(
                "Revoke link error:",
                error
            );

            return res.status(500).json({
                message:
                    "Failed to revoke shareable link"
            });
        }
    }
);


module.exports = router;