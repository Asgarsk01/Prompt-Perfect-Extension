// Import required libraries
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Load environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Validate that required environment variables are present
if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is required but not found in environment variables');
}

if (!supabaseServiceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required but not found in environment variables');
}

// Debug: Verify key is loaded (show first 20 chars only for security)
if (supabaseServiceKey && supabaseServiceKey.length > 0) {
} else {
}

// Create and configure the Supabase client with service role key
// Service role key bypasses RLS and has full database access - use carefully!
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        // Configure auth settings
        autoRefreshToken: true,
        persistSession: false, // Server doesn't need to persist sessions
        detectSessionInUrl: false
    }
});

// Export the client for use throughout the application
module.exports = supabase;
