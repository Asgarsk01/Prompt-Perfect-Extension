// Import required libraries
const express = require('express');
require('dotenv').config();
const supabase = require('./supabaseClient');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Create Express application
const app = express();

// Gemini AI Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const AI_MODEL = "gemini-flash-lite-latest";

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
            return res.status(400).json({
                error: 'Registration failed',
                details: error.message
            });
        }

        // Check if user was created successfully
        if (!data.user) {
            return res.status(500).json({
                error: 'User registration failed'
            });
        }


        // Create user record in public.users table
        try {

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
                // Don't fail the registration, just log the error
            } else {
            }
        } catch (insertErr) {
        }


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


        // Use Supabase Auth to sign in the user
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        // Check if login failed
        if (error) {
            return res.status(401).json({
                error: 'Login failed',
                details: error.message
            });
        }

        // Check if session was created successfully
        if (!data.session) {
            return res.status(401).json({
                error: 'Login failed: Could not create session'
            });
        }


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
                }
            }
        } catch (err) {
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
        res.status(500).json({
            error: 'Internal server error during login'
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


        // Check if user exists
        const { data: userData, error: userFetchError } = await supabase
            .from('users')
            .select('id, email, has_unlimited_access')
            .eq('id', userId)
            .maybeSingle();

        if (userFetchError) {
            return res.status(500).json({
                error: 'Failed to fetch user data'
            });
        }

        if (!userData) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        // Check if user already has unlimited access
        if (userData.has_unlimited_access) {
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
            return res.status(500).json({
                error: 'Failed to validate coupon code'
            });
        }

        // Check if coupon exists
        if (!couponData) {
            return res.status(404).json({
                error: 'Invalid coupon code',
                success: false
            });
        }

        // Check if coupon is active
        if (!couponData.is_active) {
            return res.status(400).json({
                error: 'This coupon code is no longer active',
                success: false
            });
        }


        // Update user to grant unlimited access
        const { error: updateError } = await supabase
            .from('users')
            .update({
                has_unlimited_access: true
            })
            .eq('id', userId);

        if (updateError) {
            return res.status(500).json({
                error: 'Failed to grant unlimited access'
            });
        }


        // Return success response
        res.status(200).json({
            success: true,
            message: 'Coupon redeemed successfully! You now have unlimited access.',
            has_unlimited_access: true,
            coupon_code: coupon_code
        });

    } catch (error) {
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


        // =============================================================================
        // CREDIT MANAGEMENT LOGIC
        // =============================================================================

        // Fetch user data from the database
        let { data: userData, error: userFetchError } = await supabase
            .from('users')
            .select('id, email, credits_remaining, has_unlimited_access, last_credit_reset')
            .eq('id', userId)
            .maybeSingle();

        if (userFetchError) {
            return res.status(500).json({
                error: 'Failed to fetch user data'
            });
        }

        // If user doesn't exist in public.users, try to create them
        // This will only succeed if the user exists in auth.users (foreign key constraint)
        if (!userData) {

            // Get user email from auth.users using admin API
            // Since we're using service role key, we can query auth schema
            let userEmail = 'user@example.com';
            let userName = 'User';

            try {
                // Try to get user info from auth - if this fails, user doesn't exist
                const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(userId);
                if (!authError && authUser?.user) {
                    userEmail = authUser.user.email || userEmail;
                    userName = authUser.user.user_metadata?.name || authUser.user.email?.split('@')[0] || userName;
                }
            } catch (e) {
            }

            // Try to create the user record
            // If the user exists in auth.users, this will succeed
            // If not, we'll get a foreign key constraint error
            const { data: newUserData, error: createError } = await supabase
                .from('users')
                .insert([
                    {
                        id: userId,
                        email: userEmail,
                        name: userName,
                        credits_remaining: 8,
                        has_unlimited_access: false,
                        last_credit_reset: new Date().toISOString()
                    }
                ])
                .select('id, email, credits_remaining, has_unlimited_access, last_credit_reset')
                .single();

            if (createError) {
                // Foreign key constraint violation means user doesn't exist in auth.users
                if (createError.code === '23503' || createError.message?.includes('foreign key')) {
                    return res.status(404).json({
                        error: 'User not found. Please log in again to refresh your session.'
                    });
                }
                // Duplicate key error - user exists with same email but possibly different ID
                if (createError.code === '23505') {
                    // Try to find user by email
                    const { data: existingUserByEmail, error: emailError } = await supabase
                        .from('users')
                        .select('id, email, credits_remaining, has_unlimited_access, last_credit_reset')
                        .eq('email', userEmail)
                        .maybeSingle();

                    if (existingUserByEmail) {
                        // User exists but with different ID - this is a data inconsistency
                        // For now, use the existing user's data
                        userData = existingUserByEmail;
                    } else {
                        // Try once more by the requested userId (race condition)
                        const { data: retryData } = await supabase
                            .from('users')
                            .select('id, email, credits_remaining, has_unlimited_access, last_credit_reset')
                            .eq('id', userId)
                            .maybeSingle();
                        if (retryData) {
                            userData = retryData;
                        } else {
                            return res.status(500).json({
                                error: 'Failed to create user record. User email exists with different ID.'
                            });
                        }
                    }
                } else {
                    return res.status(500).json({
                        error: 'Failed to create user record'
                    });
                }
            } else {
                userData = newUserData;
            }
        }


        // Check if credits need to be reset (24 hours have passed)
        let currentCredits = userData.credits_remaining;
        let hasUnlimitedAccess = userData.has_unlimited_access;

        if (userData.last_credit_reset) {
            const lastReset = new Date(userData.last_credit_reset);
            const now = new Date();
            const hoursSinceReset = (now - lastReset) / (1000 * 60 * 60);

            // If more than 24 hours have passed, reset credits
            if (hoursSinceReset >= 24) {

                const { error: resetError } = await supabase
                    .from('users')
                    .update({
                        credits_remaining: 8,
                        last_credit_reset: new Date().toISOString()
                    })
                    .eq('id', userId);

                if (resetError) {
                    return res.status(500).json({
                        error: 'Failed to reset user credits'
                    });
                }

                currentCredits = 8;
            }
        }

        // Check if user has unlimited access
        if (hasUnlimitedAccess) {
        } else {
            // Check if user has credits remaining
            if (currentCredits <= 0) {
                return res.status(402).json({
                    error: 'No credits remaining. Please wait 24 hours for them to reset.',
                    credits_remaining: 0,
                    next_reset: userData.last_credit_reset
                        ? new Date(new Date(userData.last_credit_reset).getTime() + 24 * 60 * 60 * 1000).toISOString()
                        : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                });
            }

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

        // Try to map the platform, checking both original case and lowercase
        const mappedPlatform = platformMapping[platform] || platformMapping[platform.toLowerCase()] || platform;

        // Query the prompt_guides table for the specified platform
        const { data, error } = await supabase
            .from('prompt_guides')
            .select('guide_data')
            .eq('platform', mappedPlatform)
            .maybeSingle();

        if (error) {
            return res.status(500).json({
                error: 'Database query failed'
            });
        }

        // Check if a guide was found
        if (!data) {
            return res.status(404).json({
                error: 'Guide not found for the specified platform'
            });
        }


        // Construct the meta-prompt (system prompt) from the guide data
        const guide_data = data.guide_data;

        // =============================================================================
        // PROMPT COMPLEXITY DETECTION - Determines enhancement strategy
        // =============================================================================

        function detectPromptComplexity(userPrompt) {
            // =============================================================================
            // PREPROCESSING - Clean up common patterns before analysis
            // =============================================================================

            // Strip conversational prefixes
            const conversationalPrefixes = /^(hey|hi|hello|please|can you|could you|would you|i need you to|i want you to|help me|assist me|i need|i want)\s*/i;
            const cleanedPrompt = userPrompt.replace(conversationalPrefixes, '').trim();

            const words = cleanedPrompt.split(/\s+/).filter(w => w.length > 0);
            const wordCount = words.length;
            const promptLower = cleanedPrompt.toLowerCase();
            const originalLower = userPrompt.toLowerCase();

            // =============================================================================
            // EDGE CASE DETECTORS
            // =============================================================================

            // SHORT BUT CLEAR: "[language/tool] [topic]" pattern (e.g., "python fibonacci", "react hooks")
            const shortButClearPattern = /^(python|javascript|java|react|node|sql|html|css|typescript|go|rust|git|docker|aws|linux|bash|c\+\+|c#|ruby|php|swift|kotlin)\s+\w+/i;
            const isShortButClear = shortButClearPattern.test(cleanedPrompt) ||
                /^(explain|what is|how to|how do i|difference between|compare)\s+\w+/i.test(cleanedPrompt);

            // QUESTION FORMAT: Technical questions are often clear
            const isTechnicalQuestion = /^(how|what|why|when|where|which|can i|should i)\s+.*(code|function|error|bug|work|use|implement|create)/i.test(cleanedPrompt);

            // FILLER WORD DENSITY: High filler = vague even if long
            const fillerWords = (originalLower.match(/\b(something|thing|stuff|really|very|just|like|kind of|sort of|basically|actually|maybe|probably|cool|nice|good|great|amazing|awesome)\b/g) || []).length;
            const fillerDensity = wordCount > 0 ? fillerWords / wordCount : 0;
            const hasHighFillerDensity = fillerDensity > 0.2; // More than 20% filler words

            // MULTI-PART REQUEST: Multiple distinct tasks
            const multiPartIndicators = (originalLower.match(/\b(and also|and then|also|as well as|plus|additionally)\b/g) || []).length;
            const hasMultipleTasks = multiPartIndicators >= 2 || (originalLower.match(/\band\b/g) || []).length >= 3;

            // USER CONSTRAINTS: Explicit limits the AI should preserve
            const hasExplicitConstraints = /(without|don't|do not|don't|no |never|under \d+|less than|at most|maximum|brief|short|concise|simple|basic)/i.test(originalLower);

            // CODE/ERROR CONTEXT: User provided actual code or error message
            const hasCodeContext = /[{}\[\]();]|function\s*\(|=>|error:|exception:|undefined|null|true|false/i.test(userPrompt);

            // =============================================================================
            // DETECTION LOGIC
            // =============================================================================

            // Indicators of a clear, direct request
            const hasDirectTask = /(write|create|build|make|generate|code|develop|design|implement|explain|show|give|list|find|fix|debug|convert|translate)/.test(promptLower);
            const hasSpecificSubject = /(function|program|script|app|website|api|class|method|component|page|form|button|table|list|array|string|number|file|database|server|client)/.test(promptLower);
            const hasLanguageOrTool = /(python|javascript|java|react|node|sql|html|css|typescript|go|rust|c\+\+|angular|vue|express|django|flask|spring|mongodb|postgres|redis)/.test(promptLower);

            // Indicators of vagueness
            const isVeryShort = wordCount <= 3; // Reduced from 5 to 3
            const lacksContext = !/(for|using|with|that|which|to|in|on|about|from)/.test(promptLower);
            const isAmbiguous = /(something|thing|stuff|help|assist|do this|do that)/.test(promptLower) && wordCount < 10;

            // Indicators of already detailed prompt
            const hasMultipleSentences = (userPrompt.match(/[.!?]/g) || []).length >= 2;
            const hasStructure = /(step|first|then|also|include|should|must|requirements?|specifications?|criteria|constraints?)/.test(promptLower);
            const isLong = wordCount >= 30;

            // =============================================================================
            // DECISION TREE (order matters!)
            // =============================================================================

            // EDGE CASE 1: Short but clear technical queries (e.g., "python fibonacci")
            if (isShortButClear && wordCount >= 2 && wordCount <= 6) {
                return 'simple';
            }

            // EDGE CASE 2: Technical questions are usually clear
            if (isTechnicalQuestion && wordCount <= 15) {
                return 'simple';
            }

            // EDGE CASE 3: Has code/error context = user is being specific
            if (hasCodeContext && hasDirectTask) {
                return 'simple';
            }

            // EDGE CASE 4: Long but full of filler = still vague
            if (hasHighFillerDensity && !hasSpecificSubject && !hasLanguageOrTool) {
                return 'vague';
            }

            // EDGE CASE 5: Multi-part requests need moderate expansion
            if (hasMultipleTasks && wordCount < 25) {
                return 'moderate';
            }

            // EDGE CASE 6: User has explicit constraints - respect them (light touch)
            if (hasExplicitConstraints && hasDirectTask) {
                return 'simple'; // Don't add stuff they explicitly don't want
            }

            // STANDARD: Clear, direct request (5-20 words with task + subject)
            if (hasDirectTask && (hasSpecificSubject || hasLanguageOrTool) && wordCount >= 4 && wordCount <= 20) {
                return 'simple';
            }

            // STANDARD: Already well-structured, just needs polishing
            if (isLong || (hasMultipleSentences && hasStructure)) {
                return 'detailed';
            }

            // STANDARD: Very short or ambiguous
            if (isVeryShort || (lacksContext && isAmbiguous)) {
                return 'vague';
            }

            // Default to moderate enhancement
            return 'moderate';
        }

        const promptComplexity = detectPromptComplexity(prompt);

        // =============================================================================
        // BUILD META-PROMPT BASED ON COMPLEXITY
        // =============================================================================

        let system_prompt_content = '';

        if (promptComplexity === 'simple') {
            // LIGHT TOUCH: Don't over-engineer simple, clear prompts
            system_prompt_content = `You are a helpful writing assistant. Your job is to LIGHTLY refine the user's prompt.

IMPORTANT RULES FOR SIMPLE PROMPTS:
1. The user's intent is already clear - DO NOT over-expand it.
2. Only fix grammar, spelling, or awkward phrasing.
3. Add at most 1-2 small clarifications if genuinely helpful.
4. Keep the enhanced prompt SHORT and CONCISE (similar length to original).
5. DO NOT add test cases, specifications, or elaborate requirements unless explicitly asked.
6. DO NOT turn a simple request into a complex specification.

GOAL: Make the prompt slightly clearer, not longer.

OUTPUT RULES:
- Return ONLY the refined prompt text.
- No labels, no explanations, no introductions.
- Start directly with the enhanced prompt.`;

        } else if (promptComplexity === 'detailed') {
            // POLISH ONLY: User already provided detail, just clean it up
            system_prompt_content = `You are a prompt polishing assistant. The user has provided a detailed prompt that is already well-structured.

YOUR TASK:
1. Improve clarity and flow without changing the core meaning.
2. Fix any grammar or spelling issues.
3. Slightly reorganize if it improves readability.
4. DO NOT significantly expand or add new requirements.
5. Preserve the user's original specifications and structure.

GOAL: Polish, don't inflate.

OUTPUT RULES:
- Return ONLY the polished prompt text.
- No labels, no explanations.
- Maintain similar length to the original.`;

        } else if (promptComplexity === 'vague') {
            // FULL EXPANSION: Vague prompts need significant help
            system_prompt_content = `You are an expert prompt engineer. The user has provided a vague or incomplete prompt that needs expansion.

YOUR TASK:
1. Infer the user's likely intent from context.
2. Add necessary context, constraints, and specifications.
3. Structure the prompt clearly with specific requirements.
4. Make it actionable and complete.

`;
            // Add principles for vague prompts
            if (guide_data.guide && guide_data.guide.principles) {
                system_prompt_content += "KEY PRINCIPLES TO APPLY:\n";
                const topPrinciples = guide_data.guide.principles.slice(0, 3);
                topPrinciples.forEach((principle, index) => {
                    system_prompt_content += `${index + 1}. ${principle.title}: ${principle.content}\n`;
                });
                system_prompt_content += "\n";
            }

            system_prompt_content += `OUTPUT RULES:
- Return ONLY the enhanced prompt text.
- No labels like "Enhanced Prompt:" or explanations.
- Start directly with the improved prompt.`;

        } else {
            // MODERATE: Balanced enhancement (default)
            system_prompt_content = `You are a prompt refinement assistant. Improve the user's prompt with balanced enhancements.

GUIDELINES:
1. Clarify ambiguous parts without over-expanding clear parts.
2. Add helpful context where missing.
3. Improve structure if needed.
4. Keep enhancements proportional to what's actually needed.

`;
            // Add just 2 key principles
            if (guide_data.guide && guide_data.guide.principles) {
                system_prompt_content += "KEY PRINCIPLES:\n";
                const topPrinciples = guide_data.guide.principles.slice(0, 2);
                topPrinciples.forEach((principle, index) => {
                    system_prompt_content += `${index + 1}. ${principle.title}\n`;
                });
                system_prompt_content += "\n";
            }

            system_prompt_content += `OUTPUT RULES:
- Return ONLY the refined prompt.
- No labels, no meta-commentary.
- Aim for clarity, not maximum length.`;
        }

        // Initialize the Gemini model with system instruction
        const model = genAI.getGenerativeModel({
            model: AI_MODEL,
            systemInstruction: system_prompt_content
        });

        // Make the API call to enhance the prompt
        let enhancedPrompt = "";
        try {
            const result = await model.generateContent(prompt);
            enhancedPrompt = result.response.text();
        } catch (apiError) {
            return res.status(500).json({
                error: 'AI model request failed',
                details: apiError.message
            });
        }

        // Clean up any unwanted prefixes that the AI might add
        enhancedPrompt = enhancedPrompt.replace(/^(Refined Prompt:|Enhanced Prompt:|Improved Prompt:|Here's your enhanced prompt:|Here is your enhanced prompt:)\s*/i, '').trim();

        // =============================================================================
        // CREDIT DEDUCTION LOGIC
        // =============================================================================

        // Deduct credit if user doesn't have unlimited access
        if (!hasUnlimitedAccess) {

            const { error: deductError } = await supabase
                .from('users')
                .update({
                    credits_remaining: currentCredits - 1,
                    last_used_at: new Date().toISOString()
                })
                .eq('id', userId);

            if (deductError) {
                // Note: We still return the enhanced prompt even if credit deduction fails
                // But we log the error for monitoring
            } else {
            }
        }

        // Return the enhanced prompt with credit information
        res.json({
            enhanced_prompt: enhancedPrompt,
            credits_remaining: hasUnlimitedAccess ? 'unlimited' : currentCredits - 1,
            has_unlimited_access: hasUnlimitedAccess
        });

    } catch (error) {
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// Get the port from environment variables or default to 3001
const PORT = process.env.PORT || 3001;

// Start the server
app.listen(PORT, () => {
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
    process.exit(0);
});

process.on('SIGINT', () => {
    process.exit(0);
});
