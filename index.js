// Import required libraries
const express = require('express');
require('dotenv').config();
const supabase = require('./supabaseClient');
const ModelClient = require('@azure-rest/ai-inference').default;
const { isUnexpected } = require('@azure-rest/ai-inference');
const { AzureKeyCredential } = require('@azure/core-auth');

// Create Express application
const app = express();

// Azure AI Configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const AI_ENDPOINT = "https://models.github.ai/inference";
const AI_MODEL = "openai/gpt-4.1";

// CORS Configuration - Allow Chrome Extension and all origins
app.use((req, res, next) => {
    // Allow any origin
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Allow specific methods
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    
    // Allow specific headers
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    // Allow credentials
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    next();
});

// Middleware to parse JSON requests
app.use(express.json());

// Middleware to parse URL-encoded requests
app.use(express.urlencoded({ extended: true }));

// Basic health check endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'success',
        message: 'Prompt Perfect Backend Server is running!',
        timestamp: new Date().toISOString()
    });
});

// =============================================================================
// AUTHENTICATION ENDPOINTS
// =============================================================================

// POST endpoint for user registration
app.post('/api/auth/register', async (req, res) => {
    try {
        // Extract name, email, and password from request body
        const { name, email, password } = req.body;
        
        // Validate that email is provided
        if (!email) {
            return res.status(400).json({
                error: 'Email is required in the request body'
            });
        }
        
        // Validate that password is provided
        if (!password) {
            return res.status(400).json({
                error: 'Password is required in the request body'
            });
        }
        
        // Validate that name is provided
        if (!name) {
            return res.status(400).json({
                error: 'Name is required in the request body'
            });
        }
        
        console.log(`📝 Attempting to register user: ${email}`);
        
        // Use Supabase Auth to create a new user
        const { data, error } = await supabase.auth.signUp({
            email: email,
            password: password,
            options: {
                data: {
                    name: name
                }
            }
        });
        
        // Check if registration failed
        if (error) {
            console.error('❌ Registration error:', error.message);
            return res.status(400).json({
                error: 'Registration failed',
                details: error.message
            });
        }
        
        // Check if user was created successfully
        if (!data.user) {
            console.error('❌ User creation failed: No user data returned');
            return res.status(500).json({
                error: 'User registration failed'
            });
        }
        
        console.log(`✅ User registered in auth.users: ${email}`);
        
        // Create user record in public.users table
        try {
            console.log(`🔍 Attempting to insert user into public.users table: ${email}`);
            console.log(`🔍 User ID: ${data.user.id}`);
            
            const { data: insertData, error: insertError } = await supabase
                .from('users')
                .insert([
                    {
                        id: data.user.id,
                        email: email,
                        name: name,
                        credits_remaining: 8,
                        has_unlimited_access: false,
                        last_credit_reset: new Date().toISOString()
                    }
                ])
                .select();
            
            if (insertError) {
                console.error('❌ Failed to create user in public.users table:', insertError);
                console.error('❌ Error details:', JSON.stringify(insertError, null, 2));
                // Don't fail the registration, just log the error
            } else {
                console.log(`✅ User record created in public.users table: ${email}`);
                console.log(`✅ Insert data:`, JSON.stringify(insertData, null, 2));
            }
        } catch (insertErr) {
            console.error('❌ Exception inserting into public.users:', insertErr);
            console.error('❌ Exception details:', JSON.stringify(insertErr, null, 2));
        }
        
        console.log(`✅ User registered successfully: ${email}`);
        
        // Return success response
        res.status(201).json({
            success: true,
            message: 'User registered successfully. Please check your email for verification.',
            user: {
                id: data.user.id,
                email: data.user.email,
                name: data.user.user_metadata?.name || name
            }
        });
        
    } catch (error) {
        console.error('❌ Error in /api/auth/register endpoint:', error);
        res.status(500).json({
            error: 'Internal server error during registration'
        });
    }
});

// POST endpoint for user login
app.post('/api/auth/login', async (req, res) => {
    try {
        // Extract email and password from request body
        const { email, password } = req.body;
        
        // Validate that email is provided
        if (!email) {
            return res.status(400).json({
                error: 'Email is required in the request body'
            });
        }
        
        // Validate that password is provided
        if (!password) {
            return res.status(400).json({
                error: 'Password is required in the request body'
            });
        }
        
        console.log(`🔐 Attempting to log in user: ${email}`);
        
        // Use Supabase Auth to sign in the user
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });
        
        // Check if login failed
        if (error) {
            console.error('❌ Login error:', error.message);
            return res.status(401).json({
                error: 'Login failed',
                details: error.message
            });
        }
        
        // Check if session was created successfully
        if (!data.session) {
            console.error('❌ Login failed: No session data returned');
            return res.status(401).json({
                error: 'Login failed: Could not create session'
            });
        }
        
        console.log(`✅ User logged in successfully: ${email}`);
        
        // Check if user exists in public.users table, create if not
        try {
            const { data: existingUser, error: fetchError } = await supabase
                .from('users')
                .select('id')
                .eq('id', data.user.id)
                .maybeSingle();
            
            if (!existingUser && !fetchError) {
                // User doesn't exist in public.users, create them
                const { error: insertError } = await supabase
                    .from('users')
                    .insert([
                        {
                            id: data.user.id,
                            email: email,
                            name: data.user.user_metadata?.name || email.split('@')[0],
                            credits_remaining: 8,
                            has_unlimited_access: false,
                            last_credit_reset: new Date().toISOString()
                        }
                    ]);
                
                if (!insertError) {
                    console.log(`✅ Created user record in public.users table for: ${email}`);
                }
            }
        } catch (err) {
            console.error('⚠️ Error checking/creating user in public.users:', err.message);
        }
        
        // Return success response with session information
        res.status(200).json({
            success: true,
            message: 'Login successful',
            session: {
                access_token: data.session.access_token,
                refresh_token: data.session.refresh_token,
                expires_at: data.session.expires_at,
                expires_in: data.session.expires_in
            },
            user: {
                id: data.user.id,
                email: data.user.email,
                name: data.user.user_metadata?.name || null,
                created_at: data.user.created_at
            }
        });
        
    } catch (error) {
        console.error('❌ Error in /api/auth/login endpoint:', error);
        res.status(500).json({
            error: 'Internal server error during login'
        });
    }
});

// =============================================================================
// PASSWORD RESET & OTP VERIFICATION ENDPOINTS
// =============================================================================

// POST endpoint for password reset request
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        
        // Validate that email is provided
        if (!email) {
            return res.status(400).json({
                error: 'Email is required in the request body'
            });
        }
        
        console.log(`🔐 Password reset requested for: ${email}`);
        
        // Send password reset email using Supabase Auth
        const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: 'https://prompt-perfect-backend.vercel.app/reset-password'
        });
        
        if (error) {
            console.error('❌ Password reset error:', error.message);
            return res.status(400).json({
                error: 'Failed to send password reset email',
                details: error.message
            });
        }
        
        console.log(`✅ Password reset email sent to: ${email}`);
        
        // Return success response
        res.status(200).json({
            success: true,
            message: 'Password reset email sent successfully. Please check your email inbox.'
        });
        
    } catch (error) {
        console.error('❌ Error in /api/auth/forgot-password endpoint:', error);
        res.status(500).json({
            error: 'Internal server error during password reset request'
        });
    }
});

// POST endpoint for OTP verification
app.post('/api/auth/verify-otp', async (req, res) => {
    try {
        const { email, token, type } = req.body;
        
        // Validate required fields
        if (!email) {
            return res.status(400).json({
                error: 'Email is required in the request body'
            });
        }
        
        if (!token) {
            return res.status(400).json({
                error: 'OTP token is required in the request body'
            });
        }
        
        if (!type) {
            return res.status(400).json({
                error: 'OTP type is required in the request body'
            });
        }
        
        console.log(`🔐 OTP verification requested for: ${email}, type: ${type}`);
        
        // Verify OTP using Supabase Auth
        const { data, error } = await supabase.auth.verifyOtp({
            email: email,
            token: token,
            type: type
        });
        
        if (error) {
            console.error('❌ OTP verification error:', error.message);
            return res.status(400).json({
                error: 'Invalid or expired OTP',
                details: error.message
            });
        }
        
        if (!data.session) {
            console.error('❌ OTP verification failed: No session created');
            return res.status(400).json({
                error: 'OTP verification failed'
            });
        }
        
        console.log(`✅ OTP verified successfully for: ${email}`);
        
        // Check if user exists in public.users table, create if not
        try {
            const { data: existingUser, error: fetchError } = await supabase
                .from('users')
                .select('id')
                .eq('id', data.user.id)
                .maybeSingle();
            
            if (!existingUser && !fetchError) {
                // User doesn't exist in public.users, create them
                const { error: insertError } = await supabase
                    .from('users')
                    .insert([
                        {
                            id: data.user.id,
                            email: email,
                            name: data.user.user_metadata?.name || email.split('@')[0],
                            credits_remaining: 8,
                            has_unlimited_access: false,
                            last_credit_reset: new Date().toISOString()
                        }
                    ]);
                
                if (!insertError) {
                    console.log(`✅ Created user record in public.users table for: ${email}`);
                }
            }
        } catch (err) {
            console.error('⚠️ Error checking/creating user in public.users:', err.message);
        }
        
        // Return success response with session information
        res.status(200).json({
            success: true,
            message: 'OTP verified successfully',
            session: {
                access_token: data.session.access_token,
                refresh_token: data.session.refresh_token,
                expires_at: data.session.expires_at,
                expires_in: data.session.expires_in
            },
            user: {
                id: data.user.id,
                email: data.user.email,
                name: data.user.user_metadata?.name || null,
                created_at: data.user.created_at
            }
        });
        
    } catch (error) {
        console.error('❌ Error in /api/auth/verify-otp endpoint:', error);
        res.status(500).json({
            error: 'Internal server error during OTP verification'
        });
    }
});

// POST endpoint for sending OTP
app.post('/api/auth/send-otp', async (req, res) => {
    try {
        const { email, type } = req.body;
        
        // Validate required fields
        if (!email) {
            return res.status(400).json({
                error: 'Email is required in the request body'
            });
        }
        
        if (!type) {
            return res.status(400).json({
                error: 'OTP type is required in the request body'
            });
        }
        
        console.log(`📧 Sending OTP to: ${email}, type: ${type}`);
        
        // Send OTP using Supabase Auth
        const { data, error } = await supabase.auth.signInWithOtp({
            email: email,
            options: {
                shouldCreateUser: type === 'signup' ? true : false
            }
        });
        
        if (error) {
            console.error('❌ OTP send error:', error.message);
            return res.status(400).json({
                error: 'Failed to send OTP',
                details: error.message
            });
        }
        
        console.log(`✅ OTP sent successfully to: ${email}`);
        
        // Return success response
        res.status(200).json({
            success: true,
            message: 'OTP sent successfully. Please check your email inbox.'
        });
        
    } catch (error) {
        console.error('❌ Error in /api/auth/send-otp endpoint:', error);
        res.status(500).json({
            error: 'Internal server error during OTP sending'
        });
    }
});

// =============================================================================
// COUPON REDEMPTION ENDPOINT
// =============================================================================

// POST endpoint for coupon redemption
app.post('/api/user/redeem-coupon', async (req, res) => {
    try {
        // Extract coupon_code and userId from request body
        const { coupon_code, userId } = req.body;
        
        // Validate that coupon_code is provided
        if (!coupon_code) {
            return res.status(400).json({
                error: 'Coupon code is required in the request body'
            });
        }
        
        // Validate that userId is provided
        if (!userId) {
            return res.status(400).json({
                error: 'User ID is required in the request body'
            });
        }
        
        console.log(`🎫 User ${userId} attempting to redeem coupon: ${coupon_code}`);
        
        // Check if user exists
        const { data: userData, error: userFetchError } = await supabase
            .from('users')
            .select('id, email, has_unlimited_access')
            .eq('id', userId)
            .maybeSingle();
        
        if (userFetchError) {
            console.error('❌ Error fetching user data:', userFetchError);
            return res.status(500).json({
                error: 'Failed to fetch user data'
            });
        }
        
        if (!userData) {
            console.error('❌ User not found:', userId);
            return res.status(404).json({
                error: 'User not found'
            });
        }
        
        // Check if user already has unlimited access
        if (userData.has_unlimited_access) {
            console.log(`ℹ️ User already has unlimited access`);
            return res.status(200).json({
                success: true,
                message: 'You already have unlimited access',
                has_unlimited_access: true
            });
        }
        
        // Validate the coupon code in super_coupons table
        const { data: couponData, error: couponFetchError } = await supabase
            .from('super_coupons')
            .select('id, coupon_code, is_active')
            .eq('coupon_code', coupon_code)
            .maybeSingle();
        
        if (couponFetchError) {
            console.error('❌ Error fetching coupon data:', couponFetchError);
            return res.status(500).json({
                error: 'Failed to validate coupon code'
            });
        }
        
        // Check if coupon exists
        if (!couponData) {
            console.log(`❌ Invalid coupon code: ${coupon_code}`);
            return res.status(404).json({
                error: 'Invalid coupon code',
                success: false
            });
        }
        
        // Check if coupon is active
        if (!couponData.is_active) {
            console.log(`❌ Coupon is inactive: ${coupon_code}`);
            return res.status(400).json({
                error: 'This coupon code is no longer active',
                success: false
            });
        }
        
        console.log(`✅ Valid coupon found: ${coupon_code}`);
        
        // Update user to grant unlimited access
        const { error: updateError } = await supabase
            .from('users')
            .update({
                has_unlimited_access: true
            })
            .eq('id', userId);
        
        if (updateError) {
            console.error('❌ Error updating user access:', updateError);
            return res.status(500).json({
                error: 'Failed to grant unlimited access'
            });
        }
        
        console.log(`🌟 Unlimited access granted to user ${userId}`);
        
        // Return success response
        res.status(200).json({
            success: true,
            message: 'Coupon redeemed successfully! You now have unlimited access.',
            has_unlimited_access: true,
            coupon_code: coupon_code
        });
        
    } catch (error) {
        console.error('❌ Error in /api/user/redeem-coupon endpoint:', error);
        res.status(500).json({
            error: 'Internal server error during coupon redemption'
        });
    }
});

// =============================================================================
// PROMPT ENHANCEMENT ENDPOINT
// =============================================================================

// POST API endpoint for prompt enhancement
app.post('/api/enhance', async (req, res) => {
    try {
        // Extract platform, prompt, and userId from request body
        const { platform, prompt, userId } = req.body;
        
        // Validate that platform is provided
        if (!platform) {
            return res.status(400).json({
                error: 'Platform is required in the request body'
            });
        }
        
        // Validate that prompt is provided
        if (!prompt) {
            return res.status(400).json({
                error: 'Prompt is required in the request body'
            });
        }
        
        // Validate that userId is provided
        if (!userId) {
            return res.status(400).json({
                error: 'User ID is required in the request body'
            });
        }
        
        console.log(`👤 User ${userId} requesting enhancement for platform: ${platform}`);
        
        // =============================================================================
        // CREDIT MANAGEMENT LOGIC
        // =============================================================================
        
        // Fetch user data from the database
        const { data: userData, error: userFetchError } = await supabase
            .from('users')
            .select('id, email, credits_remaining, has_unlimited_access, last_credit_reset')
            .eq('id', userId)
            .maybeSingle();
        
        if (userFetchError) {
            console.error('❌ Error fetching user data:', userFetchError);
            return res.status(500).json({
                error: 'Failed to fetch user data'
            });
        }
        
        if (!userData) {
            console.error('❌ User not found:', userId);
            return res.status(404).json({
                error: 'User not found'
            });
        }
        
        console.log(`📊 User credits: ${userData.credits_remaining}, Unlimited: ${userData.has_unlimited_access}`);
        
        // Check if credits need to be reset (24 hours have passed)
        let currentCredits = userData.credits_remaining;
        let hasUnlimitedAccess = userData.has_unlimited_access;
        
        if (userData.last_credit_reset) {
            const lastReset = new Date(userData.last_credit_reset);
            const now = new Date();
            const hoursSinceReset = (now - lastReset) / (1000 * 60 * 60);
            
            // If more than 24 hours have passed, reset credits
            if (hoursSinceReset >= 24) {
                console.log(`🔄 Resetting credits (${hoursSinceReset.toFixed(2)} hours since last reset)`);
                
                const { error: resetError } = await supabase
                    .from('users')
                    .update({
                        credits_remaining: 8,
                        last_credit_reset: new Date().toISOString()
                    })
                    .eq('id', userId);
                
                if (resetError) {
                    console.error('❌ Error resetting credits:', resetError);
                    return res.status(500).json({
                        error: 'Failed to reset user credits'
                    });
                }
                
                currentCredits = 8;
                console.log(`✅ Credits reset to 8`);
            }
        }
        
        // Check if user has unlimited access
        if (hasUnlimitedAccess) {
            console.log(`🌟 User has unlimited access - proceeding without credit check`);
        } else {
            // Check if user has credits remaining
            if (currentCredits <= 0) {
                console.log(`❌ User has no credits remaining`);
                return res.status(402).json({
                    error: 'No credits remaining. Please wait 24 hours for them to reset.',
                    credits_remaining: 0,
                    next_reset: userData.last_credit_reset 
                        ? new Date(new Date(userData.last_credit_reset).getTime() + 24 * 60 * 60 * 1000).toISOString()
                        : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                });
            }
            
            console.log(`✅ User has ${currentCredits} credits - proceeding with enhancement`);
        }
        
        // Map frontend platform names to database platform names
        const platformMapping = {
            'chatgpt': 'GPT 5',
            'gpt': 'GPT 5',
            'openai': 'GPT 5',
            'claude': 'Claude Sonnet 4',
            'claude.ai': 'Claude Sonnet 4',
            'gemini': 'Gemini 2.5',
            'google': 'Gemini 2.5',
            // Add capitalized versions for compatibility
            'ChatGPT': 'GPT 5',
            'Claude': 'Claude Sonnet 4',
            'Gemini': 'Gemini 2.5'
        };
        
        const mappedPlatform = platformMapping[platform] || platformMapping[platform.toLowerCase()] || platform;
        console.log(`🔍 Searching for guide: ${platform} -> ${mappedPlatform}`);
        
        // Query the prompt_guides table for the specified platform
        const { data, error } = await supabase
            .from('prompt_guides')
            .select('guide_data')
            .eq('platform', mappedPlatform)
            .maybeSingle();
        
        if (error) {
            console.error('Supabase query error:', error);
            return res.status(500).json({
                error: 'Database query failed'
            });
        }
        
        // Check if a guide was found
        if (!data) {
            console.log(`❌ No guide found for platform: ${platform}`);
            return res.status(404).json({
                error: 'Guide not found for the specified platform'
            });
        }
        
        console.log(`✅ Guide found for platform: ${platform}`);
        
        // Construct the meta-prompt (system prompt) from the guide data
        const guide_data = data.guide_data;
        
        // Start with a base instruction
        let system_prompt_content = "You are an expert prompt engineer. Refine the user's prompt based on these key principles:\n\n";
        
        // Helper function: Select relevant principles based on detection patterns
        function selectRelevantPrinciples(userPrompt, allPrinciples) {
            const relevantPrinciples = [];
            const promptLower = userPrompt.toLowerCase();
            
            // Find principles whose detection patterns match the prompt
            allPrinciples.forEach(principle => {
                if (principle.detection_patterns) {
                    const isRelevant = principle.detection_patterns.some(pattern => 
                        promptLower.includes(pattern.toLowerCase())
                    );
                    
                    if (isRelevant) {
                        relevantPrinciples.push({ ...principle, matched: true });
                    }
                }
            });
            
            // Sort by priority if available, otherwise keep order
            // Create a copy to avoid mutating the original array
            const sortedPrinciples = [...allPrinciples].sort((a, b) => {
                const priorityA = a.priority || 999;
                const priorityB = b.priority || 999;
                return priorityA - priorityB;
            });
            
            // If we have few relevant matches, add top priority principles
            if (relevantPrinciples.length < 3) {
                const additionalPrinciples = sortedPrinciples
                    .filter(p => !relevantPrinciples.find(rp => rp.title === p.title))
                    .slice(0, 5 - relevantPrinciples.length);
                relevantPrinciples.push(...additionalPrinciples);
            }
            
            return relevantPrinciples.slice(0, 5);
        }
        
        // Add the most relevant principles (context-aware selection)
        if (guide_data.guide && guide_data.guide.principles) {
            const topPrinciples = selectRelevantPrinciples(prompt, guide_data.guide.principles);
            
            topPrinciples.forEach((principle, index) => {
                system_prompt_content += `${index + 1}. **${principle.title}**\n`;
                system_prompt_content += `   ${principle.content}\n\n`;
            });
        }
        
        // Add key structural elements (top 2)
        if (guide_data.guide && guide_data.guide.structural_elements) {
            system_prompt_content += "Key Structural Guidelines:\n\n";
            const topStructural = guide_data.guide.structural_elements.slice(0, 2);
            topStructural.forEach((element, index) => {
                system_prompt_content += `${index + 1}. **${element.title}**\n`;
                system_prompt_content += `   ${element.content}\n\n`;
            });
        }
        
        // Add anti-patterns to avoid (top 3)
        if (guide_data.guide && guide_data.guide.anti_patterns) {
            system_prompt_content += "Common Mistakes to Avoid:\n\n";
            const topAntiPatterns = guide_data.guide.anti_patterns.slice(0, 3);
            topAntiPatterns.forEach((antiPattern, index) => {
                system_prompt_content += `${index + 1}. **${antiPattern.title}**\n`;
                system_prompt_content += `   ${antiPattern.content}\n\n`;
            });
        }
        
        // Helper function: Detect task type from prompt
        function detectTaskType(userPrompt) {
            const promptLower = userPrompt.toLowerCase();
            
            // Check for code generation
            if (/(code|function|api|debug|fix|script|program|algorithm|implement|bug)/.test(promptLower) ||
                /(javascript|python|java|react|node|sql|html|css)/.test(promptLower)) {
                return 'code_generation';
            }
            
            // Check for formal writing
            if (/(write|email|document|report|letter|memo|proposal|essay|article)/.test(promptLower) ||
                /(formal|professional|business|academic)/.test(promptLower)) {
                return 'formal_writing';
            }
            
            // Check for creative writing
            if (/(story|narrative|poem|creative|fiction|character|plot|dialogue)/.test(promptLower) ||
                /(imagine|invent|brainstorm|ideate)/.test(promptLower)) {
                return 'creative_writing';
            }
            
            // Check for data analysis
            if (/(analyze|data|csv|json|statistics|chart|graph|evaluate|compare)/.test(promptLower) ||
                /(dataset|metrics|insights|trends|visualize)/.test(promptLower)) {
                return 'data_analysis';
            }
            
            // Check for reasoning/analysis
            if (/(reasoning|logic|solve|calculate|math|problem|think|analyze)/.test(promptLower)) {
                return 'reasoning_and_analysis';
            }
            
            return 'general';
        }
        
        // Add task-specific guidelines if applicable
        const taskType = detectTaskType(prompt);
        
        if (taskType !== 'general' && guide_data.guide && guide_data.guide.task_specific_guides && guide_data.guide.task_specific_guides[taskType]) {
            system_prompt_content += "\n## Task-Specific Guidelines:\n\n";
            const taskGuides = guide_data.guide.task_specific_guides[taskType];
            
            taskGuides.forEach((guide, index) => {
                system_prompt_content += `${index + 1}. **${guide.title}**\n`;
                system_prompt_content += `   ${guide.content}\n`;
                
                // Add example if available
                if (guide.example) {
                    system_prompt_content += `   \n   Example Transformation:\n`;
                    system_prompt_content += `   Before: "${guide.example.before}"\n`;
                    system_prompt_content += `   After: "${guide.example.after}"\n`;
                }
                system_prompt_content += `\n`;
            });
        }
        
        // Add a closing instruction
        system_prompt_content += "\nApply these principles to enhance the user's prompt, making it more specific, structured, and effective for the target AI platform.\n\nIMPORTANT: Return ONLY the enhanced prompt text. Do not include any prefixes like 'Refined Prompt:', 'Enhanced Prompt:', or any other labels. Just return the improved prompt directly.";
        
        // Initialize the Azure AI client
        const client = ModelClient(
            AI_ENDPOINT,
            new AzureKeyCredential(GITHUB_TOKEN)
        );
        
        // Make the API call to enhance the prompt
        const response = await client.path("/chat/completions").post({
            body: {
                messages: [
                    { role: "system", content: system_prompt_content },
                    { role: "user", content: prompt }
                ],
                temperature: 1,
                top_p: 1,
                model: AI_MODEL
            }
        });
        
        // Check if the response is unexpected (error)
        if (isUnexpected(response)) {
            console.error('AI model error:', response.body.error);
            return res.status(500).json({
                error: 'AI model request failed',
                details: response.body.error
            });
        }
        
        // Extract the enhanced prompt from the response
        let enhancedPrompt = response.body.choices[0].message.content;
        
        // Clean up any unwanted prefixes that the AI might add
        enhancedPrompt = enhancedPrompt.replace(/^(Refined Prompt:|Enhanced Prompt:|Improved Prompt:|Here's your enhanced prompt:|Here is your enhanced prompt:)\s*/i, '').trim();
        
        // =============================================================================
        // CREDIT DEDUCTION LOGIC
        // =============================================================================
        
        // Deduct credit if user doesn't have unlimited access
        if (!hasUnlimitedAccess) {
            console.log(`💳 Deducting 1 credit from user ${userId}`);
            
            const { error: deductError } = await supabase
                .from('users')
                .update({
                    credits_remaining: currentCredits - 1,
                    last_used_at: new Date().toISOString()
                })
                .eq('id', userId);
            
            if (deductError) {
                console.error('❌ Error deducting credit:', deductError);
                // Note: We still return the enhanced prompt even if credit deduction fails
                // But we log the error for monitoring
            } else {
                console.log(`✅ Credit deducted. Remaining credits: ${currentCredits - 1}`);
            }
        }
        
        // Return the enhanced prompt with credit information
        res.json({
            enhanced_prompt: enhancedPrompt,
            credits_remaining: hasUnlimitedAccess ? 'unlimited' : currentCredits - 1,
            has_unlimited_access: hasUnlimitedAccess
        });
        
    } catch (error) {
        console.error('Error in /api/enhance endpoint:', error);
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// Get the port from environment variables or default to 3001
const PORT = process.env.PORT || 3001;

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Prompt Perfect Backend Server is running on port ${PORT}`);
    console.log(`📡 Health check available at: http://localhost:${PORT}`);
    console.log(`🔐 Auth endpoints available at:`);
    console.log(`   - Registration: http://localhost:${PORT}/api/auth/register`);
    console.log(`   - Login: http://localhost:${PORT}/api/auth/login`);
    console.log(`   - Forgot Password: http://localhost:${PORT}/api/auth/forgot-password`);
    console.log(`   - Send OTP: http://localhost:${PORT}/api/auth/send-otp`);
    console.log(`   - Verify OTP: http://localhost:${PORT}/api/auth/verify-otp`);
    console.log(`🎫 Coupon endpoint available at:`);
    console.log(`   - Redeem Coupon: http://localhost:${PORT}/api/user/redeem-coupon`);
    console.log(`🔧 API endpoint available at: http://localhost:${PORT}/api/enhance`);
    console.log(`⏰ Server started at: ${new Date().toISOString()}`);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received. Shutting down gracefully...');
    process.exit(0);
});
