# Around You — PRD

## Concept
"Around You" is a community discovery app surfacing ground-level happenings in Houston — food spots, hidden gems, events, real estate insights, and culture — sourced from a curated set of local creators (e.g. Morteza Safataj). The aesthetic is warm, editorial, and Pinterest-inspired.

## MVP Scope (v1)
- **Auth**: Email + password (sign up, sign in, email verification, password reset).
- **Discover feed**: Pinterest-style 2-column masonry of posts with creator overlay, image, category chip & caption preview. Horizontal sticky category chips (All, Food, Events, Real Estate, Hidden Gems, Nightlife, Outdoor, Culture).
- **Post detail**: Hero image, caption, neighborhood + location card, creator card with follow CTA, related posts in same category.
- **Locations tab**: Houston cityscape hero with decorative pins + neighborhood list grouped by post count.
- **Saved tab**: User's bookmarked posts (masonry).
- **Profile tab**: User info, stats (saved/following), followed creators list, admin shortcut, sign-out.
- **Creator profile**: Cover/avatar/bio, follower count, follow toggle, recent posts grid.
- **Admin/Submission screen** (`/admin`): Add new creator or new post (used to manually capture scraped content for now).

## Tech
- **Frontend**: Expo SDK 54, Expo Router, React Native, expo-image, expo-linear-gradient, @expo-google-fonts (Bricolage Grotesque + Inter).
- **Backend**: FastAPI + asyncpg + Postgres (Supabase). All endpoints under `/api`.
- **Auth**: `/api/auth/register` and `/api/auth/login` issue a 30-day opaque session token stored in `expo-secure-store` / localStorage.
- **Email**: AWS SES for verification and password-reset links.
- **Media**: Cloudinary signed direct uploads.
- **Cache**: Redis for the feed and login rate limiting (optional — degrades to no-ops).

## Data Model
- `users`: user_id, email, name, picture, password_hash, email_verified, is_admin, last_login_at, created_at, updated_at, deleted_at
- `user_sessions`: session_token, user_id, user_agent, expires_at, created_at
- `email_tokens`: token, user_id, purpose, expires_at, used_at, created_at
- `creators`: creator_id, handle, name, bio, avatar, cover, city, categories, followers, + soft-delete columns
- `posts`: post_id, creator_id, image, caption, category, neighborhood, location_name, lat, lng, likes, media_type, video_url, hashtags, source, original_url, is_sponsored, + soft-delete columns
- `bookmarks`: user_id, post_id, created_at (composite PK)
- `follows`: user_id, creator_id, created_at (composite PK)

## Future
- Real Instagram scraping (replace manual admin entry with scheduled scraper service).
- Multi-city (NYC, LA, Miami).
- Real interactive map (react-native-maps in dev build).
- Push notifications for new posts from followed creators.
- Creator-side: monetization via "Boost a post" or sponsored picks (revenue lever).
