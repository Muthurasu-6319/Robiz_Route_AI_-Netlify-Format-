// server/server.js

// -----------------------------------------------------------------------------
// SETUP
// -----------------------------------------------------------------------------
const express = require('express');
const path = require('path');
const mysql = require('mysql');
const bcrypt = require('bcrypt');
const cors = require('cors');
const fetch = require('node-fetch'); // Make sure to install node-fetch: npm install node-fetch@2
const fs = require('fs'); // TiDB Cloud SSL/TLS kōsaṁ

const app = express();
const PORT = process.env.PORT || 3000; // Hōsṭiṅg kōsaṁ PORT-ni mārputalu cēyāli

// -----------------------------------------------------------------------------
// MIDDLEWARE
// -----------------------------------------------------------------------------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'client', 'html')));
app.use(express.static(path.join(__dirname, '..', 'client')));

// -----------------------------------------------------------------------------
// DATABASE CONNECTION (MODIFIED FOR TIDB CLOUD)
// -----------------------------------------------------------------------------
const db = mysql.createPool({
    connectionLimit: 10,
    host: 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com',
    port: 4000,
    user: '4RdRyRGHpMek4m9.root',
    password: 'JZaaDLqIEZiCla7I',
    database: 'ai_career_guide_db',
    multipleStatements: true,
    // TiDB Cloud kōsaṁ SSL/TLS avasaraṁ
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
    }
});

db.getConnection((err, connection) => {
    if (err) {
        console.error('Error connecting to TiDB Cloud:', err.stack);
        return;
    }
    console.log('TiDB Cloud Database connected successfully!');
    if (connection) {
        seedInitialStacksData(connection);
        connection.release();
    }
});


// -----------------------------------------------------------------------------
// AUTHENTICATION & USER ROUTES
// -----------------------------------------------------------------------------
const ADMIN_EMAIL = 'admin@aicareer.com';
const ADMIN_PASS = 'admin@aicareer#6319';

app.post('/api/signup', (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ message: 'Please enter all fields.' });
    }
    db.query('SELECT email FROM users WHERE email = ?', [email], async (error, results) => {
        if (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server error.' });
        }
        if (results.length > 0) {
            return res.status(409).json({ message: 'This email is already registered.' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        db.query('INSERT INTO users SET ?', { name, email, password: hashedPassword, status: 'Active' }, (err, result) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ message: 'Server error during registration.' });
            }
            res.status(201).json({ message: 'You have registered successfully!' });
        });
    });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'Please enter all fields.' });
    }

    if (email === ADMIN_EMAIL && password === ADMIN_PASS) {
        return res.json({ message: 'Admin login successful!', isAdmin: true });
    }

    db.query('SELECT * FROM users WHERE email = ?', [email], async (error, results) => {
        if (error) return res.status(500).json({ message: 'Server error during login.' });
        if (results.length === 0) return res.status(404).json({ message: 'User not found.' });

        const user = results[0];
        if (user.status !== 'Active') {
            return res.status(403).json({ message: `Your account is ${user.status}. Please contact support.` });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: 'Incorrect password.' });

        db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

        res.json({ message: 'Login successful!', isAdmin: false, userName: user.name, userId: user.id });
    });
});

// -----------------------------------------------------------------------------
// USER-FACING API ROUTES (Stacks, Progress, Profile)
// -----------------------------------------------------------------------------
app.get('/api/stacks', (req, res) => {
    db.query('SELECT id, name, description, details FROM stacks', (err, results) => {
        if (err) {
            console.error("Error fetching stacks:", err);
            return res.status(500).json({ message: 'Failed to fetch learning stacks.' });
        }
        try {
            const stacks = results.map(stack => ({
                ...stack,
                details: JSON.parse(stack.details)
            }));
            res.json(stacks);
        } catch (parseError) {
            console.error("Error parsing stack details:", parseError);
            return res.status(500).json({ message: 'Error processing course data.' });
        }
    });
});

app.get('/api/progress/:userId/:stackId', (req, res) => {
    const { userId, stackId } = req.params;
    const query = 'SELECT module_id, day, task_index FROM user_progress WHERE user_id = ? AND stack_id = ?';
    db.query(query, [userId, stackId], (err, results) => {
        if (err) {
            console.error("Error fetching progress:", err);
            return res.status(500).json({ message: 'Failed to fetch progress.' });
        }
        res.json({ progress: results || [] });
    });
});

app.get('/api/profile/:userId', (req, res) => {
    const { userId } = req.params;
    const userQuery = 'SELECT name, email, points FROM users WHERE id = ?;';
    const stacksQuery = 'SELECT id, name, details FROM stacks;';
    const progressQuery = 'SELECT stack_id FROM user_progress WHERE user_id = ?;';

    db.query(userQuery + stacksQuery + progressQuery, [userId, userId], (err, results) => {
        if (err) {
            console.error("Profile API Error:", err);
            return res.status(500).json({ message: 'Could not load profile data.' });
        }
        
        const [userResults, allStacks, userProgress] = results;

        if (userResults.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }

        const getTotalTasksInStack = (stack) => {
            try {
                const details = JSON.parse(stack.details);
                let totalTasks = 0;
                if (details.modules) {
                    details.modules.forEach(module => {
                        if (module.curriculum) {
                            module.curriculum.forEach(day => {
                                if (day.tasks && Array.isArray(day.tasks)) {
                                    totalTasks += day.tasks.length;
                                }
                            });
                        }
                    });
                }
                return totalTasks;
            } catch (e) {
                console.error(`Error parsing details for stack ${stack.id}:`, e);
                return 0;
            }
        };

        const courseDetails = allStacks.map(stack => {
            const totalTasks = getTotalTasksInStack(stack);
            const completedTasks = userProgress.filter(p => p.stack_id === stack.id).length;
            return {
                name: stack.name,
                totalTasks,
                completedTasks
            };
        });
        
        const pending_courses = courseDetails.filter(course => course.completedTasks < course.totalTasks);
        const completed_courses = courseDetails.filter(course => course.totalTasks > 0 && course.completedTasks === course.totalTasks);
        
        res.json({
            ...userResults[0],
            pending_courses,
            completed_courses
        });
    });
});

async function getGeminiCodeReview(code, taskTitle) {
    const API_KEY = 'AIzaSyC_c5SS9TTLA8dUGMnH-iNhjq12upZL8VA'; 
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;
    
    const prompt = `You are an expert AI code reviewer for our learning platform.
    A student has submitted the following code for the task: "${taskTitle}".
    
    Student's Code:
    \`\`\`
    ${code}
    \`\`\`

    Your task is to:
    1.  Analyze the code for correctness, best practices, and completion of the task requirements.
    2.  Provide constructive, friendly, and encouraging feedback in Markdown format. Start with a summary. Mention what was done well and what can be improved.
    3.  **Crucially**, you MUST conclude your entire response on a new line with ONLY "STATUS: APPROVED" if the code is correct and complete, or "STATUS: REJECTED" if it has significant errors or is incomplete. Do not add any text after this status line.`;

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        if (!response.ok) throw new Error(`API Error: ${response.status} ${response.statusText}`);
        const result = await response.json();
        
        if (!result.candidates || result.candidates.length === 0) {
            console.error("Gemini Response Blocked:", result);
            return "The AI response was blocked, possibly due to safety settings. Please check your code for any sensitive content or try modifying it.\n\nSTATUS: REJECTED";
        }
        return result.candidates[0].content.parts[0].text;
    } catch (error) {
        console.error("Gemini API Error:", error);
        return "AI reviewer unavailable. Please try again later.\n\nSTATUS: REJECTED";
    }
}


app.post('/api/submit-task', async (req, res) => {
    const { userId, stackId, moduleId, day, taskIndex, codeContent } = req.body;
    if (!userId || !stackId || !moduleId || !day || taskIndex === undefined || !codeContent) {
        return res.status(400).json({ message: 'Missing required fields.' });
    }

    db.query('SELECT details FROM stacks WHERE id = ?', [stackId], async (err, results) => {
        if(err || results.length === 0) return res.status(500).json({ message: 'Could not find course data.' });

        const details = JSON.parse(results[0].details);
        const module = details.modules.find(m => m.id === moduleId);
        const dayData = module.curriculum.find(d => d.day == day);
        const task = dayData.tasks[taskIndex];
        
        const aiFeedback = await getGeminiCodeReview(codeContent, task.title);
        const isApproved = aiFeedback.includes("STATUS: APPROVED");
        const status = isApproved ? 'approved' : 'rejected';

        if (isApproved) {
            const progressQuery = 'INSERT IGNORE INTO user_progress (user_id, stack_id, module_id, day, task_index) VALUES (?, ?, ?, ?, ?)';
            db.query(progressQuery, [userId, stackId, moduleId, day, taskIndex]);
            const pointsQuery = 'UPDATE users SET points = points + ? WHERE id = ?';
            db.query(pointsQuery, [task.points || 10, userId]);
        }
        res.json({ success: true, status: status, feedback: aiFeedback });
    });
});


// -----------------------------------------------------------------------------
// ADMIN API ROUTES
// -----------------------------------------------------------------------------
app.get('/api/admin/dashboard', (req, res) => {
    const q1 = 'SELECT COUNT(*) as count FROM users;';
    const q2 = 'SELECT COUNT(*) as count FROM stacks;';
    const q3 = 'SELECT SUM(price) as total FROM pricing WHERE status = "enabled";';
    const q4 = 'SELECT status, COUNT(*) as count FROM users GROUP BY status;';
    db.query(q1 + q2 + q3 + q4, (err, results) => {
        if (err) {
             console.error("Dashboard API Error:", err);
             return res.status(500).json({ message: 'Failed to fetch dashboard stats.' });
        }
        const [totalUsers, totalStacks, totalRevenue, userStats] = results;
        res.json({ totalUsers: totalUsers[0].count, totalStacks: totalStacks[0].count, totalRevenue: totalRevenue[0].total || 0, userStats: userStats, });
    });
});
app.get('/api/admin/users', (req, res) => {
    db.query('SELECT id, name, email, status, plan, last_login, created_at FROM users', (err, users) => {
        if (err) { console.error("Fetch Users API Error:", err); return res.status(500).json({ message: 'Failed to fetch users.' }); }
        res.json(users);
    });
});
app.post('/api/admin/users/update-status', (req, res) => {
    const { userIds, status } = req.body;
    if (!userIds || !status || userIds.length === 0) return res.status(400).json({ message: 'Invalid request.' });
    db.query('UPDATE users SET status = ? WHERE id IN (?)', [status, userIds], (err, result) => {
        if (err) return res.status(500).json({ message: 'Failed to update user status.' });
        res.json({ message: `Successfully updated ${result.affectedRows} users.` });
    });
});
app.post('/api/admin/users/delete', (req, res) => {
    const { userIds } = req.body;
    if (!userIds || userIds.length === 0) return res.status(400).json({ message: 'Invalid request.' });
    db.query('DELETE FROM users WHERE id IN (?)', [userIds], (err, result) => {
        if (err) return res.status(500).json({ message: 'Failed to delete users.' });
        res.json({ message: `Successfully deleted ${result.affectedRows} users.` });
    });
});
app.get('/api/admin/stacks', (req, res) => {
    db.query('SELECT id, name, description, details FROM stacks', (err, results) => {
        if (err) return res.status(500).json({ message: 'Failed to fetch stacks.' });
        try {
            const stacks = results.map(stack => ({...stack, details: JSON.parse(stack.details) }));
            res.json(stacks);
        } catch(e) { return res.status(500).json({ message: 'Error parsing stack details.' }); }
    });
});
app.post('/api/admin/stacks', (req, res) => {
    const { id, name, description, details } = req.body;
    const newStack = { id, name, description, details: JSON.stringify(details) };
    db.query('INSERT INTO stacks SET ?', newStack, (err) => {
        if (err) {
            console.error("Error creating stack:", err);
            return res.status(500).json({ message: 'Failed to create stack.' });
        }
        res.status(201).json({ message: 'Stack created successfully.' });
    });
});
app.put('/api/admin/stacks/:id', (req, res) => {
    const { name, description, details } = req.body;
    const updatedStack = { name, description, details: JSON.stringify(details) };
    db.query('UPDATE stacks SET ? WHERE id = ?', [updatedStack, req.params.id], (err) => {
        if (err) return res.status(500).json({ message: 'Failed to update stack.' });
        res.json({ message: 'Stack updated successfully.' });
    });
});
app.delete('/api/admin/stacks/:id', (req, res) => {
    db.query('DELETE FROM stacks WHERE id = ?', [req.params.id], (err) => {
        if (err) {
            console.error("Error deleting stack:", err);
            return res.status(500).json({ message: 'Failed to delete stack.' });
        }
        res.json({ message: 'Stack deleted successfully.' });
    });
});
app.get('/api/admin/pricing', (req, res) => {
    db.query('SELECT * FROM pricing', (err, plans) => {
        if (err) return res.status(500).json({ message: 'Failed to fetch pricing plans.' });
        res.json(plans);
    });
});
app.post('/api/admin/pricing', (req, res) => {
    const { name, price, type, features } = req.body;
    const newPlan = { name, price, type, features: JSON.stringify(features), status: 'enabled' };
    db.query('INSERT INTO pricing SET ?', newPlan, (err) => {
        if (err) return res.status(500).json({ message: 'Failed to create plan.' });
        res.status(201).json({ message: 'Pricing plan created successfully.' });
    });
});
app.put('/api/admin/pricing/:id/status', (req, res) => {
    const { status } = req.body;
    db.query('UPDATE pricing SET status = ? WHERE id = ?', [status, req.params.id], (err) => {
        if (err) return res.status(500).json({ message: 'Failed to update plan status.' });
        res.json({ message: 'Plan status updated.' });
    });
});
app.delete('/api/admin/pricing/:id', (req, res) => {
     db.query('DELETE FROM pricing WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ message: 'Failed to delete plan.' });
        res.json({ message: 'Pricing plan deleted.' });
    });
});

// -----------------------------------------------------------------------------
// DATABASE SEEDING FUNCTION
// -----------------------------------------------------------------------------
function seedInitialStacksData(connection) {
    const stacksData = [
        // Course 1: HTML
        {
            id: 'html', name: 'HTML', description: 'Phase 1: Build a strong foundation in the structure of web pages.',
            details: {
                image: 'https://placehold.co/600x400/E44D26/FFFFFF?text=HTML5',
                modules: [
                    { id: 'html-beginner', title: 'HTML (Days 1-7)', introVideoId: 'MDLn5-zSQQI', curriculum: [
                        { day: 1, tasks: [{ title: 'Create "Hello World" Page', description: 'Topics: `<!DOCTYPE>`, `<html>`, `<head>`, `<body>`. Task: Create a simple HTML page.', points: 5, solution: `<!DOCTYPE html>\n<html>\n<head><title>Hello</title></head>\n<body>Hello World</body>\n</html>` }] },
                        { day: 2, tasks: [{ title: 'Create a Resume Page', description: 'Topics: `<h1>`-`<h6>`, `<p>`, `<b>`, `<i>`. Task: Use text formatting tags.', points: 10, solution: `<h1>My Name</h1>\n<p><b>Web Developer</b></p>` }] },
                        { day: 3, tasks: [{ title: 'Create "Favorite Foods" Page', description: 'Topics: `<a>`, `<img>`, `<ul>`, `<ol>`. Task: Use links, images, and lists.', points: 10, solution: `<a href="#">Link</a>\n<img src="food.jpg" alt="Food">\n<ul><li>Pizza</li></ul>` }] },
                        { day: 4, tasks: [{ title: 'Create a Student Marksheet', description: 'Topics: `<table>`, `<tr>`, `<td>`, `<th>`. Task: Use a table to show marks.', points: 15, solution: `<table>\n<tr><th>Subject</th><th>Marks</th></tr>\n<tr><td>Math</td><td>90</td></tr>\n</table>` }] },
                        { day: 5, tasks: [{ title: 'Create a Sign-up Form', description: 'Topics: `<form>`, `<input>`, `<button>`. Task: Build a simple sign-up form.', points: 15, solution: `<form><input type="text" placeholder="Name"><button>Sign Up</button></form>` }] },
                        { day: 6, tasks: [{ title: 'Create a News Article Webpage', description: 'Topics: `<header>`, `<footer>`, `<section>`. Task: Use semantic tags.', points: 20, solution: `<header><h1>News</h1></header>\n<section><p>Article content...</p></section>` }] },
                        { day: 7, tasks: [{ title: 'Embed a YouTube Video', description: 'Topics: `<audio>`, `<video>`, `<iframe>`. Task: Embed a video and add music.', points: 15, solution: `<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>` }] },
                    ]}
                ]
            }
        },
        // Course 2: CSS
        {
            id: 'css', name: 'CSS', description: 'Phase 2: Learn to style and design beautiful, responsive websites.',
            details: {
                image: 'https://placehold.co/600x400/264DE4/FFFFFF?text=CSS3',
                modules: [
                    { id: 'css-beginner', title: 'CSS (Days 8-14)', introVideoId: 'OEV8gHsKqLQ', curriculum: [
                        { day: 8, tasks: [{ title: 'Apply Colors and Fonts to Resume', description: 'Topics: CSS linking, Colors, Fonts. Task: Style your resume page.', points: 10, solution: `body { color: blue; font-family: Arial; }` }] },
                        { day: 9, tasks: [{ title: 'Style Signup Form', description: 'Topics: Selectors (class, id). Task: Use selectors to style the form.', points: 15, solution: `#signup-form { background-color: #f0f0f0; }` }] },
                        { day: 10, tasks: [{ title: 'Create a Product Card', description: 'Topics: Box Model, Display. Task: Use margin, padding, border.', points: 15, solution: `.card { padding: 16px; border: 1px solid #ccc; }` }] },
                        { day: 11, tasks: [{ title: 'Create a Sticky Navigation Bar', description: 'Topics: Positioning. Task: Make a nav bar that sticks to the top.', points: 20, solution: `nav { position: sticky; top: 0; }` }] },
                        { day: 12, tasks: [{ title: 'Create a Responsive Gallery', description: 'Topics: Flexbox. Task: Use flexbox to build a gallery.', points: 20, solution: `.gallery { display: flex; flex-wrap: wrap; }` }] },
                        { day: 13, tasks: [{ title: 'Build a 3x3 Photo Gallery', description: 'Topics: CSS Grid. Task: Use grid to build a photo gallery.', points: 20, solution: `.grid-gallery { display: grid; grid-template-columns: repeat(3, 1fr); }` }] },
                        { day: 14, tasks: [{ title: 'Create a Button with Hover Effects', description: 'Topics: Transitions & Animations. Task: Animate a button on hover.', points: 15, solution: `button:hover { background-color: blue; transform: scale(1.1); }` }] },
                    ]}
                ]
            }
        },
        // Course 3: JavaScript
        {
            id: 'javascript', name: 'JavaScript', description: 'Phase 3: Add interactivity and logic to your web applications.',
            details: {
                image: 'https://placehold.co/600x400/F7DF1E/000000?text=JavaScript',
                modules: [
                     { id: 'js-beginner', title: 'JS (Days 15-30)', introVideoId: 'W6NZfCO5SIk', curriculum: [
                        { day: 15, tasks: [{ title: 'Create a Simple Calculator', description: 'Topics: Variables, Data Types, Operators. Task: Function for sum, diff, etc.', points: 15, solution: `function add(a, b) { return a + b; }` }] },
                        { day: 16, tasks: [{ title: 'Check if Number is Odd/Even', description: 'Topics: Conditions. Task: Write a program to check odd/even.', points: 10, solution: `function isEven(num) { return num % 2 === 0; }` }] },
                        { day: 17, tasks: [{ title: 'Print Multiplication Table', description: 'Topics: Loops. Task: Use a loop to print a multiplication table.', points: 15, solution: `for(let i = 1; i <= 10; i++) { console.log(5 * i); }` }] },
                        { day: 18, tasks: [{ title: 'Check for Palindrome', description: 'Topics: Functions. Task: Create a function to check for palindrome.', points: 20, solution: `function isPalindrome(str) { return str === str.split('').reverse().join(''); }` }] },
                        { day: 19, tasks: [{ title: 'Filter Student Names', description: 'Topics: Arrays. Task: Print names starting with "A".', points: 15, solution: `const students = ['Ann', 'Bob']; students.filter(s => s.startsWith('A'));` }] },
                        { day: 20, tasks: [{ title: 'Store and Display Student Details', description: 'Topics: Objects, JSON. Task: Use an object for student details.', points: 15, solution: `const student = { name: 'John', age: 20 }; console.log(student.name);` }] },
                        { day: 21, tasks: [{ title: 'Change Background Color on Click', description: 'Topics: DOM. Task: Change body background on button click.', points: 20, solution: `document.querySelector('button').addEventListener('click', () => { document.body.style.backgroundColor = 'red'; });` }] },
                        { day: 22, tasks: [{ title: 'Build a To-Do List App', description: 'Topics: Events. Task: Build a to-do list with add/delete.', points: 25, solution: `// Complex logic, solution omitted for brevity` }] },
                        { day: 23, tasks: [{ title: 'Validate Signup Form', description: 'Topics: Form Validation. Task: Validate email format, password length.', points: 25, solution: `// Complex logic, solution omitted for brevity` }] },
                        { day: 24, tasks: [{ title: 'Save User Details in Local Storage', description: 'Topics: Web Storage. Task: Save form details in local storage.', points: 20, solution: `localStorage.setItem('user', JSON.stringify({name: 'John'}));` }] },
                        { day: 25, tasks: [{ title: 'Rewrite Code with ES6', description: 'Topics: ES6. Task: Use template literals, destructuring.', points: 20, solution: "const name = 'John'; console.log(`Hello, ${name}`);" }] },
                        { day: 26, tasks: [{ title: 'Fetch Random User Data', description: 'Topics: Async/Await. Task: Fetch data from a public API.', points: 25, solution: `async function getUsers() { const res = await fetch('...'); }` }] },
                        { day: 27, tasks: [{ title: 'Display Weather Data from API', description: 'Topics: Fetch API. Task: Display weather data from an API.', points: 25, solution: `// Complex logic, solution omitted for brevity` }] },
                        { day: 28, tasks: [{ title: 'Handle Invalid Inputs', description: 'Topics: Error Handling. Task: Handle errors in the calculator project.', points: 20, solution: `try { /* code */ } catch(e) { console.error(e); }` }] },
                        { day: 29, tasks: [{ title: 'Split Calculator into Modules', description: 'Topics: Modules. Task: Split project into multiple files.', points: 20, solution: `// Complex logic, solution omitted for brevity` }] },
                        { day: 30, tasks: [{ title: 'Mini Project: Weather App', description: 'Build a weather app using Fetch API.', points: 50, solution: `// Complex logic, solution omitted for brevity` }] },
                    ]},
                ]
            }
        },
        {
            id: 'react', name: 'React.js', description: 'Phase 4: Build modern, component-based user interfaces.',
            details: {
                image: 'https://placehold.co/600x400/61DAFB/000000?text=React',
                modules: [
                    { id: 'react-beginner', title: 'React.js (Days 31-45)', introVideoId: 'SqcY0GlETPk', curriculum: [
                        { day: 31, tasks: [{ title: 'Create "Hello React" App', description: 'Topics: CRA, JSX. Task: Setup a React app.', points: 15, solution: `function App() { return <h1>Hello React</h1>; }` }] },
                        { day: 32, tasks: [{ title: 'Build a Reusable "Card" Component', description: 'Topics: Components, Props. Task: Create a Card component.', points: 20, solution: `function Card(props) { return <div>{props.children}</div>; }` }] },
                        { day: 33, tasks: [{ title: 'Create a Counter App', description: 'Topics: State, useState. Task: Build a counter.', points: 20, solution: `const [count, setCount] = useState(0);` }] },
                        { day: 34, tasks: [{ title: 'Create a Form with Live Preview', description: 'Topics: Events. Task: Update a preview as you type.', points: 25, solution: `<input onChange={(e) => setValue(e.target.value)} />` }] },
                        { day: 35, tasks: [{ title: 'Show Login/Logout Button Dynamically', description: 'Topics: Conditional Rendering. Task: Show buttons based on state.', points: 20, solution: `{ isLoggedIn ? <Logout /> : <Login /> }` }] },
                        { day: 36, tasks: [{ title: 'Display a List of Students', description: 'Topics: Lists & Keys. Task: Display a list dynamically.', points: 20, solution: `students.map(student => <li key={student.id}>{student.name}</li>)` }] },
                        { day: 37, tasks: [{ title: 'Fetch API Data', description: 'Topics: useEffect. Task: Fetch and display API data.', points: 25, solution: `useEffect(() => { fetch(...); }, []);` }] },
                        { day: 38, tasks: [{ title: 'Create a Login Form', description: 'Topics: Forms. Task: Create a login form with validation.', points: 25, solution: `// Complex logic, solution omitted for brevity` }] },
                        { day: 39, tasks: [{ title: 'Build a Multi-page App', description: 'Topics: React Router. Task: App with Home, About, Contact pages.', points: 30, solution: `// Complex logic, solution omitted for brevity` }] },
                        { day: 40, tasks: [{ title: 'Theme Switcher (Dark/Light)', description: 'Topics: Context API. Task: Create a theme switcher.', points: 30, solution: `// Complex logic, solution omitted for brevity` }] },
                        { day: 45, tasks: [{ title: 'Mini Project: Movie Search App', description: 'Build a movie search app using an API and React.', points: 60, solution: `// Complex logic, solution omitted for brevity` }] },
                    ]}
                ]
            }
        },
        {
            id: 'nodejs', name: 'Node.js & Express', description: 'Phase 5: Develop powerful and scalable backend services.',
            details: {
                image: 'https://placehold.co/600x400/339933/FFFFFF?text=Node.js',
                modules: [
                     { id: 'node-beginner', title: 'Node.js (Days 46-60)', introVideoId: 'f2EqECiTBL8', curriculum: [
                        { day: 46, tasks: [{ title: 'Create Simple Node.js Server', description: 'Topics: Node, npm. Task: Create a basic http server.', points: 20, solution: `const http = require('http'); http.createServer(...).listen(3000);` }] },
                        { day: 47, tasks: [{ title: 'Build a Math Utility Module', description: 'Topics: Modules. Task: Create a module with add, subtract functions.', points: 20, solution: `exports.add = (a, b) => a + b;` }] },
                        { day: 48, tasks: [{ title: 'Save Form Data to a File', description: 'Topics: File System. Task: Use fs.writeFile to save data.', points: 25, solution: `const fs = require('fs'); fs.writeFileSync('data.txt', 'hello');` }] },
                        { day: 49, tasks: [{ title: 'Create an Express Server with Routes', description: 'Topics: Express. Task: Setup Express server.', points: 25, solution: `const app = express(); app.get('/', (req, res) => res.send('Hello'));` }] },
                        { day: 50, tasks: [{ title: 'Create Logger Middleware', description: 'Topics: Middleware. Task: Create a logger for requests.', points: 25, solution: `app.use((req, res, next) => { console.log(req.method); next(); });` }] },
                        { day: 51, tasks: [{ title: 'Build CRUD API for "Students"', description: 'Topics: REST API. Task: Create CRUD routes.', points: 30, solution: `// Complex logic, solution omitted for brevity` }] },
                        { day: 52, tasks: [{ title: 'Connect Node.js with MongoDB', description: 'Topics: MongoDB. Task: Connect to a MongoDB database.', points: 30, solution: `mongoose.connect('...');` }] },
                        { day: 53, tasks: [{ title: 'Create Student Schema & Model', description: 'Topics: Mongoose. Task: Create a Mongoose schema and model.', points: 30, solution: `const studentSchema = new mongoose.Schema({ name: String });` }] },
                        { day: 54, tasks: [{ title: 'Secure API with JWT', description: 'Topics: JWT. Task: Secure routes with login and token.', points: 35, solution: `// Complex logic, solution omitted for brevity` }] },
                        { day: 60, tasks: [{ title: 'Final Project: Full Stack Blog', description: 'Build a full stack blog with React, Node, and MongoDB.', points: 100, solution: `// Complex logic, solution omitted for brevity` }] },
                    ]},
                ]
            }
        },
    ];

    connection.query('SELECT COUNT(*) as count FROM stacks', (err, results) => {
        if (err) return;
        if (results[0].count === 0) {
            console.log("Seeding initial stacks data with detailed 60-day curriculum...");
            const query = 'INSERT INTO stacks (id, name, description, details) VALUES ?';
            const values = stacksData.map(s => [s.id, s.name, s.description, JSON.stringify(s.details)]);
            connection.query(query, [values], (seedErr) => {
                if(seedErr) console.error("Error seeding data:", seedErr);
            });
        }
    });
}

// -----------------------------------------------------------------------------
// SERVER START
// -----------------------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

