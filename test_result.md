#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  "around you" — Houston community discovery app (Pinterest-style masonry feed, warm light theme).
  Current task: Ingest real Morteza Safataj Instagram-scrape captions and add VIDEO post support.

backend:
  - task: "Post schema: media_type, video_url, hashtags, source, original_url, is_sponsored"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Added new fields to Post + PostCreate models. Defaults: media_type=image, hashtags=[], is_sponsored=false."
  - task: "Seed migration v3 with real Morteza captions + 2 video posts"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "app_meta seed_version gate forces reseed. 21 posts, 7 Morteza real captions, po_seed_000 & po_seed_003 are media_type=video with w3.org sample mp4. Verified via curl: 21 posts, 2 videos."
  - task: "GET /api/posts, /api/posts/{id}, /api/creators return new fields"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Endpoints unchanged structurally; should now include media_type/video_url/hashtags in payloads."

frontend:
  - task: "MediaTile component (autoplay muted loop video on native, poster+play badge on web)"
    implemented: true
    working: "NA"
    file: "frontend/src/components/MediaTile.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Verified on web via screenshot: poster image + center play badge renders for video posts (po_seed_000). Native video playback cannot be validated in web preview/Expo Go — requires a real build."

metadata:
  created_by: "main_agent"
  version: "1.1"
  test_sequence: 1
  run_ui: false

test_plan:
  current_focus:
    - "Seed migration v3 with real Morteza captions + 2 video posts"
    - "GET /api/posts, /api/posts/{id}, /api/creators return new fields"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    -agent: "main"
    -message: "Please test the backend only. Verify: (1) GET /api/posts returns 21 posts and each includes media_type, hashtags, is_sponsored fields; (2) exactly 2 posts have media_type=='video' with a non-empty video_url (po_seed_000, po_seed_003); (3) GET /api/posts/po_seed_000 returns the post with full caption + hashtags array; (4) GET /api/creators returns 4 creators incl cr_morteza; (5) category filter GET /api/posts?category=Events works. No auth needed for these public endpoints."
    -agent: "main"
    -message: "ADMIN DASHBOARD test request (backend + frontend). NEW backend endpoints (all require header 'X-Admin-Secret: 2CqEcj2JlHDJqqEvfK4RywE2I_aaETN_'): PATCH /api/admin/posts/{id} (partial update, e.g. {\"is_sponsored\":true} or {\"caption\":\"x\"}), PATCH /api/admin/creators/{id} (partial update), GET /api/admin/stats (returns total_posts, total_creators, video_count, sponsored_count, by_category[], by_creator[]). Verify each: 401 without/with wrong header, 200 with correct header; PATCH with empty body -> 400; PATCH nonexistent id -> 404; PATCH actually persists the change (GET the post/creator after). FRONTEND: /admin route is now a full dashboard at app/admin/index.tsx with edit screens at app/admin/post/[id].tsx and app/admin/creator/[id].tsx. Flow to test on web (admin key persists only within a session): open /admin -> gate shows -> enter key in testID 'admin-key' -> tap testID 'unlock-btn' -> dashboard appears with tabs (testID tab-overview/tab-posts/tab-creators/tab-add). Overview shows stat cards + bar charts. Posts tab lists 21 posts with edit/delete. Add tab can publish a post (testID 'publish-post') and add a creator (testID 'add-creator'). Editing: tap a post's edit icon -> /admin/post/{id} -> change caption -> Save (testID 'save-post'). IMPORTANT: after any create/edit test, the data should remain consistent; if you created extra test records, call POST /api/admin/cleanup with the correct header to restore the 21-post/4-creator baseline. Wrong/empty admin key in the gate should show 'Invalid admin key.'"


