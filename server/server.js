const express = require('express');
const cors = require('cors');
const mysql = require('mysql');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3000; // Render-kaga PORT variable-ah add panrom

app.use(cors());
app.use(express.json());

const clientPath = path.join(__dirname, '..', 'client', 'html');
app.use(express.static(clientPath));

// --- Database Connection ---
const dbConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: {
        ca: fs.readFileSync(path.join(__dirname, '..', 'isrgrootx1.pem'))
    }
};

const db = mysql.createConnection(dbConfig);


const saltRounds = 10;
const runQuery = (query, params) => {
    return new Promise((resolve, reject) => {
        db.query(query, params, (err, results) => {
            if (err) return reject(err);
            resolve(results);
        });
    });
};

const setupAdminUser = async () => {
    try {
        const adminEmail = process.env.ADMIN_EMAIL;
        const adminPass = process.env.ADMIN_PASS;

        if (!adminEmail || !adminPass) {
            console.log("Admin credentials not found. Skipping admin setup.");
            return;
        }

        const [existingAdmin] = await runQuery('SELECT * FROM users WHERE email = ?', [adminEmail]);
        
        if (!existingAdmin) {
            const hashedPassword = await bcrypt.hash(adminPass, saltRounds);
            await runQuery('INSERT INTO users (name, email, password, status) VALUES (?, ?, ?, ?)', ['Admin', adminEmail, hashedPassword, 'Active']);
            console.log('Admin user created successfully.');
        } else {
            const isMatch = await bcrypt.compare(adminPass, existingAdmin.password);
            if (!isMatch) {
                const hashedPassword = await bcrypt.hash(adminPass, saltRounds);
                await runQuery('UPDATE users SET password = ? WHERE email = ?', [hashedPassword, adminEmail]);
                console.log('Admin password updated.');
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
    setupAdminUser();
});

const parseStackDetails = (stacks) => {
    return stacks.map(stack => {
        try {
            if (typeof stack.details === 'string') {
                stack.details = JSON.parse(stack.details);
            }
        } catch (e) {
            console.error(`Could not parse details for stack ID ${stack.id}:`, e);
            stack.details = { modules: [], image: '' };
        }
        return stack;
    });
};

const getGeminiCodeReview = async (codeContent, taskDescription) => {
    const API_KEY = process.env.GEMINI_API_KEY;
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;
    
    const systemPrompt = `You are an expert code reviewer. Your task is to evaluate a user's code submission against a given task.
    The required task was: "${taskDescription}".
    The user submitted the following code:
    \`\`\`
    ${codeContent}
    \`\`\`
    Analyze the user's code.
    - If it correctly and completely solves the task, your response MUST start with "approved:". Your feedback should be positive and encouraging.
    - If the code is incorrect, incomplete, or has errors, your response MUST start with "rejected:". Your feedback must clearly explain what is wrong and provide specific hints or corrections to help the user solve the task.`;

    if (!codeContent || codeContent.trim() === '') {
        return { status: "rejected", feedback: "Your code is empty." };
    }

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: systemPrompt }] }] })
        });

        if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
        
        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) throw new Error("Invalid AI response.");

        let status = text.toLowerCase().startsWith('approved:') ? 'approved' : 'rejected';
        let feedback = text.substring(text.indexOf(':') + 1).trim();
        
        return { status, feedback };

    } catch (error) {
        console.error("Error fetching Gemini response:", error);
        return { status: 'rejected', feedback: 'AI reviewer unavailable.' };
    }
};

// --- START OF API ROUTES ---

// Chatbot route
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
        if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        res.json({ text });
    } catch (error) {
        console.error("Chat API error:", error);
        res.status(500).json({ text: "Sorry, I'm having trouble connecting right now." });
    }
});

// Signup route
app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        await runQuery('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [name, email, hashedPassword]);
        res.status(201).json({ message: 'User created successfully! Please login.' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Email already exists.' });
        }
        res.status(500).json({ message: 'Server error during signup.' });
    }
});

// Login route is already below

// User progress route
app.get('/api/progress/:userId/:stackId', async (req, res) => {
    try {
        const { userId, stackId } = req.params;
        const progress = await runQuery('SELECT module_id, day, task_index FROM user_progress WHERE user_id = ? AND stack_id = ?', [userId, stackId]);
        res.json({ progress });
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch user progress.' });
    }
});

// Task submission route
app.post('/api/submit-task', async (req, res) => {
    const { userId, stackId, moduleId, day, taskIndex, codeContent } = req.body;
    try {
        const stacksResult = await runQuery('SELECT details FROM stacks WHERE id = ?', [stackId]);
        if (stacksResult.length === 0) return res.status(404).json({ message: "Stack not found." });
        const stack = parseStackDetails(stacksResult)[0];
        const task = stack?.details?.modules?.find(m => m.id === moduleId)?.curriculum?.find(d => d.day == day)?.tasks[taskIndex];
        if (!task) return res.status(404).json({ message: "Task not found." });
        const feedbackResponse = await getGeminiCodeReview(codeContent, task.description);
        if (feedbackResponse.status === 'approved') {
            const taskPoints = task.points || 10;
            await runQuery('INSERT IGNORE INTO user_progress (user_id, stack_id, module_id, day, task_index) VALUES (?, ?, ?, ?, ?)', [userId, stackId, moduleId, day, taskIndex]);
            await runQuery('UPDATE users SET points = points + ? WHERE id = ?', [taskPoints, userId]);
        }
        res.json(feedbackResponse);
    } catch (error) {
        console.error("Task submission error:", error);
        res.status(500).json({ status: 'rejected', feedback: 'An internal error occurred.' });
    }
});

// Profile route
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
            const totalTasks = (stack.details.modules || []).reduce((total, mod) => total + (mod.curriculum || []).reduce((modTotal, day) => modTotal + (day.tasks || []).length, 0), 0);
            const completedTasks = progressMap.get(stack.id) || 0;
            return { id: stack.id, name: stack.name, totalTasks, completedTasks };
        });
        const pending_courses = courses.filter(c => c.completedTasks > 0 && c.completedTasks < c.totalTasks);
        const completed_courses = courses.filter(c => c.totalTasks > 0 && c.completedTasks === c.totalTasks);
        res.json({ ...user, pending_courses, completed_courses });
    } catch (error) {
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
        res.json({ totalUsers: totalUsers.count, totalStacks: totalStacks.count, totalRevenue: totalRevenue.total || 0, userStats });
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
        await runQuery('UPDATE users SET status = ? WHERE id IN (?)', [status, userIds]);
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
        res.json({ message: 'Selected users deleted' });
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
        await runQuery('INSERT INTO stacks (id, name, description, details) VALUES (?, ?, ?, ?)', [id, name, description, JSON.stringify(details)]);
        res.status(201).json({ message: 'Course created' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to create course' });
    }
});

app.put('/api/admin/stacks/:id', async (req, res) => {
    try {
        const { name, description, details } = req.body;
        const { id } = req.params;
        await runQuery('UPDATE stacks SET name = ?, description = ?, details = ? WHERE id = ?', [name, description, JSON.stringify(details), id]);
        res.json({ message: 'Course updated' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update course' });
    }
});

app.delete('/api/admin/stacks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await runQuery('DELETE FROM stacks WHERE id = ?', [id]);
        await runQuery('DELETE FROM user_progress WHERE stack_id = ?', [id]);
        res.json({ message: 'Course deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to delete course' });
    }
});

app.post('/api/admin/stacks/duplicate', async (req, res) => {
    try {
        const { id } = req.body;
        const [originalStack] = await runQuery('SELECT * FROM stacks WHERE id = ?', [id]);
        if (!originalStack) return res.status(404).json({ message: 'Course not found.' });
        const newId = `${originalStack.id}-copy-${Date.now()}`;
        const newName = `${originalStack.name} (Copy)`;
        await runQuery('INSERT INTO stacks (id, name, description, details) VALUES (?, ?, ?, ?)', [newId, newName, originalStack.description, originalStack.details]);
        res.status(201).json({ message: 'Course duplicated' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to duplicate course' });
    }
});

app.get('/api/admin/pricing', async (req, res) => {
    try {
        const plans = await runQuery('SELECT * FROM pricing');
        res.json(plans);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch plans' });
    }
});

app.post('/api/admin/pricing', async (req, res) => {
    try {
        const { name, price, type, features } = req.body;
        await runQuery('INSERT INTO pricing (name, price, type, features) VALUES (?, ?, ?, ?)', [name, price, type, JSON.stringify(features)]);
        res.status(201).json({ message: 'Plan created' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to create plan' });
    }
});

app.put('/api/admin/pricing/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        const { id } = req.params;
        await runQuery('UPDATE pricing SET status = ? WHERE id = ?', [status, id]);
        res.json({ message: 'Plan status updated' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update plan status' });
    }
});

app.delete('/api/admin/pricing/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await runQuery('DELETE FROM pricing WHERE id = ?', [id]);
        res.json({ message: 'Plan deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to delete plan' });
    }
});

// --- END OF API ROUTES ---

app.get('/api/stacks', async (req, res) => {
    try {
        const stacks = await runQuery('SELECT * FROM stacks');
        res.json(parseStackDetails(stacks));
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch stacks.' });
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

// Matra ella page requests-kum home.html-ah anuppurom
app.get('*', (req, res) => {
    res.sendFile(path.join(clientPath, 'home.html'));
});


// Render hosting-kaga intha maathram miga mukkiyam
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});


