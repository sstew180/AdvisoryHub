// server/middleware/copilotAuth.js
// Verifies the Authorization: Bearer <key> header against COPILOT_API_KEY.
// Used by the /api/copilot/* routes that Power Apps and Copilot Studio call.

const copilotAuth = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!process.env.COPILOT_API_KEY) {
    return res.status(500).json({
      error: 'Server is missing COPILOT_API_KEY in environment variables.'
    });
  }

  if (!token || token !== process.env.COPILOT_API_KEY) {
    return res.status(401).json({
      error: 'Unauthorized: missing or invalid API key.'
    });
  }

  next();
};

module.exports = copilotAuth;