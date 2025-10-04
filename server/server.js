const express = require('express');
const cors = require('cors');
const mysql = require('mysql');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch'); // node-fetch package-ah import panrom
// .env file-ah load panrom
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });


const app = express();
app.use(cors());
app.use(express.json());

// client/html folder-la irundhu static files-ah serve panrom
const clientPath = path.join(__dirname, '..', 'client', 'html');
app.use(express.static(clientPath));


// --- Database Connection ---
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: {
        ca: fs.readFileSync(path.join(__dirname, '..', 'isrgrootx1.pem'))
    }
});

const saltRounds = 10;
const runQuery = (query, params) => {
    return new Promise((resolve, reject) => {
        db.query(query, params, (err, results) => {
            if (err) return reject(err);
            resolve(results);
        });
    });
};

// --- App start aagum podhu admin user-ah create panra function ---
const setupAdminUser = async () => {
    try {
        const adminEmail = process.env.ADMIN_EMAIL;
        const adminPass = process.env.ADMIN_PASS;

        if (!adminEmail || !adminPass) {
            console.log("Admin credentials not found in .env file. Skipping admin setup.");
            return;
        }

        const [existingAdmin] = await runQuery('SELECT * FROM users WHERE email = ?', [adminEmail]);
        
        if (!existingAdmin) {
            const hashedPassword = await bcrypt.hash(adminPass, saltRounds);
            await runQuery('INSERT INTO users (name, email, password, status) VALUES (?, ?, ?, ?)', ['Admin', adminEmail, hashedPassword, 'Active']);
            console.log('Admin user created successfully.');
        } else {
            // .env file-la irukura password veraiya irundha update panrom
            const isMatch = await bcrypt.compare(adminPass, existingAdmin.password);
            if (!isMatch) {
                const hashedPassword = await bcrypt.hash(adminPass, saltRounds);
                await runQuery('UPDATE users SET password = ? WHERE email = ?', [hashedPassword, adminEmail]);
                console.log('Admin password updated to match .env file.');
            }
        }
    } catch (error) {
        console.error('Error setting up admin user:', error);
    }
};

db.connect(err => {
    if (err) {
        console.error('Error connecting to database:', err);
        return;
    }
    console.log('Connected to TiDB Cloud!');
    setupAdminUser(); // DB connect aanadhuku aprom admin setup-ah run panrom
});


// --- DB-la irundhu vara JSON details-ah parse panra helper function ---
const parseStackDetails = (stacks) => {
    return stacks.map(stack => {
        try {
            if (typeof stack.details === 'string') {
                stack.details = JSON.parse(stack.details);
            }
        } catch (e) {
            console.error(`Could not parse details for stack ID ${stack.id}:`, e);
            // Frontend crash aagama irukka, oru default structure-ah kudukrom
            stack.details = { modules: [], image: '' };
        }
        return stack;
    });
};

// --- Gemini API Call for AI Code Review ---
const getGeminiCodeReview = async (codeContent, taskDescription) => {
    const API_KEY = process.env.GEMINI_API_KEY;
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;
    
    // AI-ku theliva puriyura maari prompt-ah maathrom
    const systemPrompt = `You are an expert code reviewer. Your task is to evaluate a user's code submission against a given task.
    The required task was: "${taskDescription}".
    The user submitted the following code:
    \`\`\`
    ${codeContent}
    \`\`\`
    Analyze the user's code.
    - If it correctly and completely solves the task, your response MUST start with "approved:". Your feedback should be positive and encouraging.
    - If the code is incorrect, incomplete, or has errors, your response MUST start with "rejected:". Your feedback must clearly explain what is wrong and provide specific hints or corrections to help the user solve the task.

    Example for approval: "approved: Great job! This code perfectly meets all the requirements of the task."
    Example for rejection: "rejected: Almost there! You've missed the closing </body> tag. Please add it and try again."`;

    if (!codeContent || codeContent.trim() === '') {
        return {
            status: "rejected",
            feedback: "Your code is empty. Please provide a solution to get feedback."
        };
    }

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: systemPrompt }] }]
            })
        });

        if (!response.ok) {
            const errorBody = await response.json();
            console.error("Gemini API Error:", errorBody);
            throw new Error(`API Error: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (!result.candidates || !result.candidates[0].content || !result.candidates[0].content.parts[0].text) {
             console.error("Invalid Gemini Response:", result);
             throw new Error("Received an invalid response from AI.");
        }

        const text = result.candidates[0].content.parts[0].text;

        // AI response-la irundhu status and feedback-ah pirikrom
        let status = 'rejected';
        let feedback = text;

        if (text.toLowerCase().startsWith('approved:')) {
            status = 'approved';
            feedback = text.substring('approved:'.length).trim();
        } else if (text.toLowerCase().startsWith('rejected:')) {
            status = 'rejected';
            feedback = text.substring('rejected:'.length).trim();
        }
        
        return { status, feedback };

    } catch (error) {
        console.error("Error fetching Gemini response:", error);
        return {
            status: 'rejected',
            feedback: 'Sorry, the AI reviewer is currently unavailable. Please try again later.'
        };
    }
};

// --- Chatbot API Endpoint ---
app.post('/api/chat', async (req, res) => {
    const { history, prompt } = req.body;
    const API_KEY = process.env.GEMINI_API_KEY;
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;

    try {
        const payload = { contents: [...history, { role: "user", parts: [{ text: prompt }] }] };
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.statusText}`);
        }
        
        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        res.json({ text });

    } catch (error) {
        console.error("Chat API error:", error);
        res.status(500).json({ text: "Sorry, I'm having trouble connecting right now." });
    }
});


// --- Authentication Routes ---
app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const query = 'INSERT INTO users (name, email, password) VALUES (?, ?, ?)';
        await runQuery(query, [name, email, hashedPassword]);
        res.status(201).json({ message: 'User created successfully! Please login.' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Email already exists.' });
        }
        res.status(500).json({ message: 'Server error during signup.' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const query = 'SELECT * FROM users WHERE email = ?';
        const users = await runQuery(query, [email]);

        if (users.length === 0) {
            return res.status(404).json({ message: 'User not found. Please sign up.' });
        }

        const user = users[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        const updateLoginQuery = 'UPDATE users SET last_login = NOW() WHERE id = ?';
        await runQuery(updateLoginQuery, [user.id]);

        const isAdmin = email === process.env.ADMIN_EMAIL;

        res.json({
            message: 'Login successful!',
            userId: user.id,
            userName: user.name,
            isAdmin
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error during login.' });
    }
});

// --- Stacks/Courses Routes (for users) ---
app.get('/api/stacks', async (req, res) => {
    try {
        const stacks = await runQuery('SELECT * FROM stacks');
        res.json(parseStackDetails(stacks));
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch stacks.' });
    }
});

app.get('/api/progress/:userId/:stackId', async (req, res) => {
    try {
        const { userId, stackId } = req.params;
        const query = 'SELECT module_id, day, task_index FROM user_progress WHERE user_id = ? AND stack_id = ?';
        const progress = await runQuery(query, [userId, stackId]);
        res.json({ progress });
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch user progress.' });
    }
});


app.post('/api/submit-task', async (req, res) => {
    const { userId, stackId, moduleId, day, taskIndex, codeContent } = req.body;

    try {
        // Task description-ah eduthu AI kitta anuprom
        const stacksResult = await runQuery('SELECT details FROM stacks WHERE id = ?', [stackId]);
        if (stacksResult.length === 0) return res.status(404).json({ message: "Stack not found." });
        
        const stack = parseStackDetails(stacksResult)[0]; 
        const task = stack?.details?.modules
            ?.find(m => m.id === moduleId)?.curriculum
            ?.find(d => d.day == day)?.tasks[taskIndex];

        if (!task) return res.status(404).json({ message: "Task not found." });

        const feedbackResponse = await getGeminiCodeReview(codeContent, task.description);

        if (feedbackResponse.status === 'approved') {
            const taskPoints = task.points || 10;

            const insertProgressQuery = 'INSERT IGNORE INTO user_progress (user_id, stack_id, module_id, day, task_index) VALUES (?, ?, ?, ?, ?)';
            await runQuery(insertProgressQuery, [userId, stackId, moduleId, day, taskIndex]);

            const updateUserPointsQuery = 'UPDATE users SET points = points + ? WHERE id = ?';
            await runQuery(updateUserPointsQuery, [taskPoints, userId]);
        }

        res.json(feedbackResponse);

    } catch (error) {
        console.error("Task submission error:", error);
        res.status(500).json({ 
            status: 'rejected',
            feedback: 'An internal error occurred while processing your submission. Please try again.' 
        });
    }
});


// --- Profile Page Route ---
app.get('/api/profile/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const users = await runQuery('SELECT id, name, email, points FROM users WHERE id = ?', [userId]);
        if (users.length === 0) return res.status(404).json({ message: 'User not found' });
        const user = users[0];

        const allStacksRaw = await runQuery('SELECT * FROM stacks');
        const allStacks = parseStackDetails(allStacksRaw); 
        const userProgress = await runQuery('SELECT stack_id, COUNT(*) as completed_tasks FROM user_progress WHERE user_id = ? GROUP BY stack_id', [userId]);

        const progressMap = new Map(userProgress.map(p => [p.stack_id, p.completed_tasks]));

        const courses = allStacks.map(stack => {
            const totalTasks = (stack.details.modules || []).reduce((total, mod) =>
                total + (mod.curriculum || []).reduce((modTotal, day) => modTotal + (day.tasks || []).length, 0), 0);
            
            const completedTasks = progressMap.get(stack.id) || 0;
            
            return {
                id: stack.id,
                name: stack.name,
                totalTasks,
                completedTasks,
            };
        });
        
        const pending_courses = courses.filter(c => c.completedTasks > 0 && c.completedTasks < c.totalTasks);
        const completed_courses = courses.filter(c => c.totalTasks > 0 && c.completedTasks === c.totalTasks);

        res.json({
            ...user,
            pending_courses,
            completed_courses
        });

    } catch (error) {
        console.error("Profile fetch error:", error);
        res.status(500).json({ message: 'Failed to fetch profile data.' });
    }
});


// --- ADMIN ROUTES ---
app.get('/api/admin/dashboard', async (req, res) => {
    try {
        const [totalUsers] = await runQuery('SELECT COUNT(*) as count FROM users');
        const [totalStacks] = await runQuery('SELECT COUNT(*) as count FROM stacks');
        const [totalRevenue] = await runQuery('SELECT SUM(price) as total FROM pricing');
        const userStats = await runQuery("SELECT status, COUNT(*) as count FROM users GROUP BY status");

        res.json({
            totalUsers: totalUsers.count,
            totalStacks: totalStacks.count,
            totalRevenue: totalRevenue.total || 0,
            userStats
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch dashboard stats' });
    }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await runQuery('SELECT id, name, email, status, last_login, created_at FROM users');
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch users' });
    }
});

app.post('/api/admin/users/update-status', async (req, res) => {
    try {
        const { userIds, status } = req.body;
        const query = 'UPDATE users SET status = ? WHERE id IN (?)';
        await runQuery(query, [status, userIds]);
        res.json({ message: `Users status updated to ${status}` });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update user status' });
    }
});

app.post('/api/admin/users/delete', async (req, res) => {
    try {
        const { userIds } = req.body;
        await runQuery('DELETE FROM user_progress WHERE user_id IN (?)', [userIds]);
        await runQuery('DELETE FROM users WHERE id IN (?)', [userIds]);
        res.json({ message: 'Selected users have been deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to delete users' });
    }
});

app.get('/api/admin/stacks', async (req, res) => {
    try {
        const stacks = await runQuery('SELECT * FROM stacks');
        res.json(parseStackDetails(stacks));
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch stacks' });
    }
});

app.post('/api/admin/stacks', async (req, res) => {
    try {
        const { id, name, description, details } = req.body;
        const query = 'INSERT INTO stacks (id, name, description, details) VALUES (?, ?, ?, ?)';
        await runQuery(query, [id, name, description, JSON.stringify(details)]);
        res.status(201).json({ message: 'Course created successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to create course' });
    }
});

app.put('/api/admin/stacks/:id', async (req, res) => {
    try {
        const { name, description, details } = req.body;
        const { id } = req.params;
        const query = 'UPDATE stacks SET name = ?, description = ?, details = ? WHERE id = ?';
        await runQuery(query, [name, description, JSON.stringify(details), id]);
        res.json({ message: 'Course updated successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update course' });
    }
});

app.delete('/api/admin/stacks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await runQuery('DELETE FROM stacks WHERE id = ?', [id]);
        await runQuery('DELETE FROM user_progress WHERE stack_id = ?', [id]);
        res.json({ message: 'Course deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to delete course' });
    }
});

app.post('/api/admin/stacks/duplicate', async (req, res) => {
    try {
        const { id } = req.body;
        const [originalStack] = await runQuery('SELECT * FROM stacks WHERE id = ?', [id]);
        if (!originalStack) {
            return res.status(404).json({ message: 'Original course not found.' });
        }
        
        const newId = `${originalStack.id}-copy-${Date.now()}`;
        const newName = `${originalStack.name} (Copy)`;
        const query = 'INSERT INTO stacks (id, name, description, details) VALUES (?, ?, ?, ?)';
        await runQuery(query, [newId, newName, originalStack.description, originalStack.details]);

        res.status(201).json({ message: 'Course duplicated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to duplicate course' });
    }
});

app.get('/api/admin/pricing', async (req, res) => {
    try {
        const plans = await runQuery('SELECT * FROM pricing');
        res.json(plans);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch pricing plans' });
    }
});

app.post('/api/admin/pricing', async (req, res) => {
    try {
        const { name, price, type, features } = req.body;
        const query = 'INSERT INTO pricing (name, price, type, features) VALUES (?, ?, ?, ?)';
        await runQuery(query, [name, price, type, JSON.stringify(features)]);
        res.status(201).json({ message: 'Pricing plan created successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to create pricing plan' });
    }
});

app.put('/api/admin/pricing/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        const { id } = req.params;
        const query = 'UPDATE pricing SET status = ? WHERE id = ?';
        await runQuery(query, [status, id]);
        res.json({ message: 'Plan status updated' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update plan status' });
    }
});

app.delete('/api/admin/pricing/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const query = 'DELETE FROM pricing WHERE id = ?';
        await runQuery(query, [id]);
        res.json({ message: 'Plan deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to delete plan' });
    }
});

// Vera endha GET request-kum home.html-ah anuppurom
app.get('*', (req, res) => {
    res.sendFile(path.join(clientPath, 'home.html'));
});

// serverless-http-kaga export panrom
module.exports = app;

