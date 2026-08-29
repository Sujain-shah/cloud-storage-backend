const express = require("express");

const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// Protected route
router.get("/profile", authMiddleware, (req, res) => {

  res.status(200).json({

    message: "Protected route accessed successfully",

    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.user_metadata.name
    }

  });

});

module.exports = router;