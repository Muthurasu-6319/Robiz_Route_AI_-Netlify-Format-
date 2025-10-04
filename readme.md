# Robiz Route Ai - AI Career Guide

## Introduction

**Robiz Route Ai** is an AI-powered online learning platform designed for individuals aspiring to start or advance their careers in the technology sector. It offers personalized learning roadmaps tailored to users' skills and goals, leveraging artificial intelligence to guide them through their educational journey.

## Key Features

* **AI Career Counselor:** An interactive AI chatbot that answers user queries and provides career guidance.
* **Structured Learning Stacks:** Day-wise curated curriculum for various tech domains like Full Stack Development, AI/ML, and more.
* **AI-Powered Code Review:** Instant feedback on student code submissions using the Google Gemini AI, ensuring timely learning.
* **User Profile & Gamification:** Users can track their learning progress, earn points for completing tasks, and unlock achievements.
* **Admin Dashboard:** A comprehensive interface for administrators to manage users, learning stacks, and pricing plans.

## Tech Stack

* **Frontend:**
    * HTML5
    * Tailwind CSS
    * Vanilla JavaScript
* **Backend:**
    * Node.js
    * Express.js
* **Database:**
    * TiDB Cloud (MySQL compatible)
* **External Services:**
    * Google Gemini API (for AI chatbot and code review)
    * EmailJS (for contact form functionality)

## Setup Instructions

### Prerequisites

* Node.js and npm installed.
* A TiDB Cloud account.

### Installation

1.  **Clone the repository:**
    ```bash
    git clone <your-repository-url>
    cd <your-project-folder>
    ```

2.  **Install backend dependencies:**
    ```bash
    cd server
    npm install
    ```

### Database Setup

1.  This project is configured to connect with TiDB Cloud.
2.  Create a database named `ai_career_guide_db` in your TiDB Cloud cluster.
3.  Create the following tables. (Note: Column types may need adjustment based on your specific requirements).
    * `users` (id, name, email, password, status, points, last_login, created_at, etc.)
    * `stacks` (id, name, description, details - JSON)
    * `user_progress` (id, user_id, stack_id, module_id, day, task_index)
    * `pricing` (id, name, price, type, features - JSON, status)

4.  Upon the first run of `server.js`, if the `stacks` table is empty, initial course data will be seeded automatically.

## Configuration

For production environments, it is highly recommended to use environment variables for sensitive information instead of hardcoding them.

* **TiDB Cloud Credentials:** Update the `db` connection object in `server/server.js` with your TiDB host, user, password, and database name.
* **Gemini API Key:**
    * For Code Review: Replace the placeholder API key within the `getGeminiCodeReview` function in `server/server.js`.
    * For Chatbot: Replace the placeholder API key in the `Chatbot Logic` section within `client/html/home.html`.
* **EmailJS Credentials:** Update the `service ID`, `template ID`, and `public key` in the `EMAILJS INTEGRATION` section within `client/html/contact.html`.

## Running the Project

1.  Navigate to the `server` directory:
    ```bash
    cd server
    ```

2.  Start the backend server:
    ```bash
    node server.js
    ```

3.  Open your web browser and go to `http://localhost:3000` to access the application.

## Project Structure


 host: 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com',
    port: 4000,
    user: '4RdRyRGHpMek4m9.root',
    password: 'JZaaDLqIEZiCla7I',
    database: 'ai_career_guide_db',