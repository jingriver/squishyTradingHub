# Squishy Trading Hub

## Project Overview
Squishy Trading Hub is a web application designed as a social marketplace for trading collectible items (like Smiski, Needoh, and Mofusand). Users can create trade listings, share posts with images, save posts to custom boards, authenticate via Google OAuth, and engage in mock trade matching and chat interactions.

**Technologies Used:**
- **Backend:** Node.js, Express
- **Database:** SQLite3 (via the `sqlite3` package)
- **Frontend:** HTML, Vanilla JavaScript, CSS
- **Authentication:** Google OAuth2
- **File Uploads:** `multer` (saving to the local `/uploads` directory)

**Architecture:**
- `server.js`: The main Express application handling API routes, Google OAuth flow, file uploads, session management, and static file serving.
- `app.js`: Vanilla JavaScript frontend application managing UI state (views, tabs, modals), API requests, and direct DOM manipulation.
- `db.js`: Database setup and utility functions. It initializes the SQLite database (`data.db`), creates necessary tables (listings, posts, boards, users, etc.), and handles mock data seeding.
- `index.html` & `styles.css`: The frontend layout, structure, and styling.

## Building and Running

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Configuration (Google OAuth):**
   - Create a `.env` file in the root directory (you can copy `.env.example`).
   - Go to the [Google Cloud Console](https://console.cloud.google.com/).
   - Create a new project.
   - Configure the "OAuth consent screen" (use "External" for testing).
   - Go to "Credentials" -> "Create Credentials" -> "OAuth client ID".
   - Set the Application type to "Web application".
   - Add `http://localhost:8000/auth/google/callback` to the **Authorized redirect URIs**.
   - Copy the **Client ID** and **Client Secret** into your `.env` file:
     ```env
     GOOGLE_CLIENT_ID=your_client_id_here
     GOOGLE_CLIENT_SECRET=your_client_secret_here
     ```

3. **Run the Server:**
   ```bash
   npm start
   ```
   *or*
   ```bash
   node server.js
   ```
   The server will typically be available at `http://localhost:8000`.

## Development Conventions
- **Frontend Approach:** Vanilla JavaScript is used without heavy frameworks. The UI relies on hiding/showing views and modals using CSS classes (`.active`, `[aria-hidden="true"]`) and data attributes.
- **Database Management:** The application uses a local SQLite database (`data.db`). It is designed to automatically initialize itself and seed default testing data if tables are empty.
- **File Storage:** Uploaded post images are stored locally in the `/uploads` directory, which is dynamically created if it doesn't exist.
