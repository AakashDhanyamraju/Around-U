# Around You — PRD

## Concept
"Around You" is a community discovery app surfacing ground-level happenings in Houston — food spots, hidden gems, events, real estate insights, and culture — sourced from a curated set of local creators (e.g. Morteza Safataj). The aesthetic is warm, editorial, and Pinterest-inspired.

## MVP Scope (v1)
- **Auth**: Emergent-managed Google OAuth.
- **Discover feed**: Pinterest-style 2-column masonry of posts with creator overlay, image, category chip & caption preview. Horizontal sticky category chips (All, Food, Events, Real Estate, Hidden Gems, Nightlife, Outdoor, Culture).
- **Post detail**: Hero image, caption, neighborhood + location card, creator card with follow CTA, related posts in same category.
- **Locations tab**: Houston cityscape hero with decorative pins + neighborhood list grouped by post count.
- **Saved tab**: User's bookmarked posts (masonry).
- **Profile tab**: User info, stats (saved/following), followed creators list, admin shortcut, sign-out.
- **Creator profile**: Cover/avatar/bio, follower count, follow toggle, recent posts grid.
- **Admin/Submission screen** (`/admin`): Add new creator or new post (used to manually capture scraped content for now).

## Tech
- **Frontend**: Expo SDK 54, Expo Router, React Native, expo-image, expo-linear-gradient, @expo-google-fonts (Playfair Display + Manrope), expo-web-browser for OAuth.
- **Backend**: FastAPI + Motor + MongoDB. All endpoints under `/api`.
- **Auth**: Emergent OAuth → backend `/api/auth/session` upserts user, stores 7-day session token in `expo-secure-store` / localStorage.

## Data Model
- `users`: user_id, email, name, picture, created_at
- `user_sessions`: session_token, user_id, expires_at (TTL)
- `creators`: creator_id, handle, name, bio, avatar, cover, city, categories, followers
- `posts`: post_id, creator_id, image, caption, category, neighborhood, location_name, lat, lng, likes, created_at
- `bookmarks`: user_id, post_id
- `follows`: user_id, creator_id

## Future
- Real Instagram scraping (replace manual admin entry with scheduled scraper service).
- Multi-city (NYC, LA, Miami).
- Real interactive map (react-native-maps in dev build).
- Push notifications for new posts from followed creators.
- Creator-side: monetization via "Boost a post" or sponsored picks (revenue lever).
