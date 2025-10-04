Robiz Route Ai - AI Career Guide
Introduction
Robiz Route Ai is an AI-powered online learning platform designed for individuals aspiring to start or advance their careers in the technology sector. It offers personalized learning roadmaps tailored to users' skills and goals, leveraging artificial intelligence to guide them through their educational journey.

Key Features
AI Career Counselor: An interactive AI chatbot that answers user queries and provides career guidance.

Structured Learning Stacks: Day-wise curated curriculum for various tech domains like Full Stack Development, AI/ML, and more.

AI-Powered Code Review: Instant feedback on student code submissions using the Google Gemini AI, ensuring timely learning.

User Profile & Gamification: Users can track their learning progress, earn points for completing tasks, and unlock achievements.

Admin Dashboard: A comprehensive interface for administrators to manage users, learning stacks, and pricing plans.

Tech Stack
Frontend: HTML5, Tailwind CSS, Vanilla JavaScript

Backend: Node.js, Express.js

Database: TiDB Cloud (MySQL compatible)

External Services: Google Gemini API, EmailJS

Setup Instructions
Prerequisites
Node.js and npm installed.

A TiDB Cloud account.

A Google Gemini API Key.

Installation
Clone the repository:

git clone <your-repository-url>
cd <your-project-folder>

Install backend dependencies:

npm install

Environment Setup
Create a .env file in the root of your project.

Add the following variables to your .env file with your actual credentials:

GEMINI_API_KEY=YOUR_GEMINI_API_KEY
PORT=3000
DB_HOST=YOUR_TIDB_HOST
DB_PORT=4000
DB_USER=YOUR_TIDB_USER
DB_PASSWORD=YOUR_TIDB_PASSWORD
DB_DATABASE=YOUR_TIDB_DATABASE
ADMIN_EMAIL=your_admin_email@example.com
ADMIN_PASS=your_strong_admin_password

Database Setup
This project is configured to connect with TiDB Cloud.

Create a database named ai_career_guide_db (or the name you specified in .env) in your TiDB Cloud cluster.

Create the necessary tables (users, stacks, user_progress, pricing).

The admin user from your .env file will be created automatically on the first run if it doesn't exist.

Running the Project Locally
Start the development server from the root directory:

npm start

Open your browser and go to http://localhost:8888 to access the application.

Deployment to Netlify
Push your code to a GitHub repository (ensure your .env file is NOT pushed by using .gitignore).

Connect your repository to a new site on Netlify.

Crucial Step: In your Netlify site dashboard, go to Site settings > Build & deploy > Environment variables.

Add all the environment variables from your local .env file one by one (e.g., Key: DB_HOST, Value: your-tidb-host-value).

Trigger a new deploy. Your site should now build and deploy successfully.