const supabase = require("../supabase");

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Check if Authorization header exists
    if (!authHeader) {
      return res.status(401).json({
        message: "Authorization token is required"
      });
    }

    // Expected format: Bearer ACCESS_TOKEN
    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        message: "Invalid token format"
      });
    }

    // Verify token with Supabase
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({
        message: "Invalid or expired token"
      });
    }

    // Store authenticated user for later routes
    req.user = data.user;

    next();

  } catch (error) {
    console.error("Authentication error:", error);

    res.status(500).json({
      message: "Authentication failed"
    });
  }
};

module.exports = authMiddleware;