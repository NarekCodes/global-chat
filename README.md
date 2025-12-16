# Real-Time Chat Application

A simple, single-room real-time chat application built with Node.js, Express, Socket.IO, and Vanilla JavaScript.

## Features
- **Real-time Messaging**: Messages appear instantly for all connected users.
- **In-Memory Storage**: Chat history is stored in memory (cleared on server restart).
- **Responsive Design**: Clean and modern UI that works on different screen sizes.
- **No Database**: Lightweight and easy to run.

## Prerequisites
- [Node.js](https://nodejs.org/) installed on your machine.

## Installation

1. Navigate to the project directory:
   ```bash
   cd /Users/user/Desktop/test2
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Running the Application

1. Start the server:
   ```bash
   node server.js
   ```

2. Open your web browser and go to:
   ```
   http://localhost:3000
   ```

3. Open multiple tabs or windows to test the real-time chat capabilities!

## Project Structure
- `server.js`: The backend server handling connections and messages.
- `public/`: Contains the frontend assets.
  - `index.html`: The HTML structure of the chat interface.
  - `style.css`: The styling of the application.
  - `client.js`: The client-side logic for connecting to the server.
