# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Squishy Trading Hub is a trading platform for squishy toy collectors, styled like a Gen-Z social app. Users can list items for trade, post photos of their collections, match with trading partners, and organize saves into boards.

## Quick Start

```bash
# Install dependencies
npm install

# Start the server (runs on http://localhost:8000)
npm start
```

## Architecture

**Stack:** Node.js + Express (backend), vanilla JavaScript (frontend), SQLite (database)

**Files:**
- `server.js` - Express server with all API routes and OAuth flow
- `app.js` - Frontend client-side logic, UI rendering, event handlers
- `db.js` - Database initialization, wrapper functions for sqlite3
- `index.html` - Single-page UI with multiple views (landing, online, shop, profile)
- `styles.css` - All styling

**Database Schema:**
- `users` - Google OAuth authenticated users
- `sessions` - Session tokens (7-day TTL)
- `user_profiles` - User display names, bios, tags
- `listings` - Trade listings with "wants" descriptions
- `posts` - Feed posts with items array (JSON), optional image
- `boards` / `board_posts` - Save organization (many-to-many)

**Key API Endpoints:**
- `GET/POST /api/listings` - Trade listings CRUD
- `GET/POST /api/posts` - Feed posts (POST accepts multipart/form-data for images)
- `GET/PUT /api/profile` - Profile read/update (PUT requires auth)
- `GET/POST /api/boards` and `/api/boards/:id/posts` - Board management
- `GET /api/session` - Check authentication status
- `POST /api/match` - Get random match for chat
- `POST /api/chat` - Send message, get mock reply
- `/auth/google*` - Google OAuth flow

**Frontend Structure:**
- Single-page app with tab-based navigation between views
- Touch swipe navigation between landing/online/shop/profile views
- Multiple modals for actions (add post, add listing, match, checkout, save to board)
- Image upload via drag-drop or file picker with preview

## Environment Variables

```bash
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:8000/auth/google/callback
BASE_URL=http://localhost:8000  # Optional: override for reverse proxy setups
PORT=8000  # Optional: override server port
```

OAuth variables can be omitted—the app functions without authentication, but OAuth endpoints will return errors.

## Notes

- Image uploads stored in `/uploads`, max 4MB
- Database auto-initializes with sample data on first run
- No tests in this codebase
- Uses CommonJS modules (`require`/`module.exports`)
