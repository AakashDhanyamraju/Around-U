# Around You — UX Design Brief

**For:** UX / product designer
**About:** what the product is, who uses it, and everything it can do today

This brief describes *what* exists and *what* has to be designed. It deliberately
says nothing about layout, navigation patterns, components, or visual direction —
those are yours to decide. Where something today feels like a placeholder, it is
called out as an opportunity rather than a constraint.

---

## 1. The product

**Around You** is a city-discovery app. It answers "what's actually good around
me right now?" — food, events, hidden gems, nightlife, outdoor spots, culture,
and real estate — using content published by local creators rather than
algorithmic aggregation or paid listings.

Two things make it different from a generic feed app:

1. **The content is curated by named local people.** Every piece of content has a
   creator attached — a person with a handle, a bio, a following, and a beat
   (categories they cover). Discovery is as much about finding people worth
   following as it is about finding places.
2. **It is region-scoped, and regions contain communities.** The product is
   organised around a city (Houston is the launch region; the system is built to
   hold many). Inside a region, people form and join **communities** — smaller
   interest or neighbourhood groups with their own posts, discussion, membership
   and leadership.

So there are really two halves of the experience that have to feel like one
product: a **public discovery half** (browse, save, follow) and a **participatory
community half** (join, post, discuss, moderate).

### Platforms

One codebase ships to **iOS, Android, and web**. Every screen must work on a
phone and in a desktop browser. Treat mobile as the primary context — people use
this while deciding where to go — but the web build is not a throwaway; admin and
moderation work in particular is likely to happen on a large screen.

---

## 2. Who uses it

There are four platform-level roles and, separately, three roles a person can
hold inside any given community. They are orthogonal on purpose: the same person
can be a creator for Houston, the head of one community, and an ordinary member
of three others.

### Platform roles

| Role | Who they are | What they can do |
|---|---|---|
| **Visitor** (signed out) | Someone who found the app | Browse everything public. Cannot save, follow, join, post, or comment. |
| **User** | A signed-in resident or visitor | Everything above, plus save posts, follow creators, join communities, post and comment inside communities, react, report content, block people. |
| **Creator** | A vetted local voice, granted the role | Everything a user can do, plus publish public discovery content for the regions they've been granted, and manage their own published posts. |
| **Staff** | Trusted operator | Moderation authority across communities without being a member of them, and access to the reports queue. |
| **Superadmin** | Platform owner | Full control of people, roles, regions, and creator identities. |

### Community roles

Held per-community, ranked: **member → manager → head.**

- **Member** — reads and posts in the community.
- **Manager** — moderation inside that one community: approve joiners, pin,
  remove content, mute, ban.
- **Head** — the owner. Everything a manager can do, plus editing the community
  itself, promoting/demoting managers, transferring ownership, and deleting it.

A person's membership also has a **status**: `active`, `pending` (waiting for
approval to join), or `banned`. And a member can be **muted until** a point in
time — temporarily silenced without being removed.

---

## 3. What the product can do today

Everything listed here is built and working on the server. It all needs a
designed home.

### Discovery (public — no account needed)

- Browse a feed of posts from local creators.
- Filter that feed by category: *Food, Events, Real Estate, Hidden Gems,
  Nightlife, Outdoor, Culture* (plus "All").
- Open a single post: full media, caption, the place it refers to, the creator
  behind it, and **related posts** in the same category.
- Open a creator's profile: their bio, avatar, cover, city, the categories they
  cover, their follower count, and their full body of work.
- Browse posts grouped by **neighbourhood**.

A post carries: an image **or a video**, a caption, a category, a neighbourhood,
an optional named location with latitude/longitude, hashtags, a like count, an
optional attribution to an original source, and a flag marking it as
**sponsored**. Both media types and the sponsored case need to be handled — they
are real, not hypothetical.

### Personal (signed in)

- **Save** posts and revisit them later.
- **Follow** creators, and see who you follow.
- A personal profile view showing your identity, how much you've saved, and who
  you follow.

### Communities

- Browse and **search** the communities in a region.
- See the communities you belong to.
- **Create** a community: name, description, avatar, cover, category, and two
  policy choices — **visibility** (`public` / `private`) and **join policy**
  (`open` / `request` / `invite`).
- **Join** and **leave**. Joining an `open` community is instant; joining a
  `request` community puts you in a pending state until a manager approves you.
- A community has a member count, a post count, and a last-activity timestamp —
  the signals people use to judge whether a group is alive before joining.
- A community can be **archived**.

**Important rule with a UX consequence:** a private community is *invisible* to
non-members. The system does not say "you don't have access" — it behaves as
though the community does not exist. Nothing in the design may leak the existence
of a private community to someone outside it.

### Inside a community

- A stream of posts. Each post has a body, up to several images or a video, an
  author, a comment count, and a reaction count.
- Posts can be **pinned** to the top by a manager or head.
- **Comments**, including **replies to comments** (threading is supported).
- **Emoji reactions** — arbitrary emoji, with per-emoji counts, and an indicator
  of which ones *you* reacted with.
- Authors can edit and delete their own posts and comments; managers and heads
  can remove anyone's.
- A **member list**, showing each person's role and status.

### Creator tools

- A creator sees their own profile and the posts they've published.
- **Publish** a new post — with media upload, and a region picker limited to the
  regions that account has actually been granted.
- Edit and delete their own posts.

### Moderation and safety

- **Report** a post, comment, community post, or user. Reasons are fixed: *spam,
  harassment, hate, violence, sexual content, self-harm, misinformation, other.*
- A **reports queue** — scoped to one community for its managers, platform-wide
  for staff — where each report is reviewed and resolved.
- **Block** another user, and manage your blocks.
- Community moderation actions: approve a pending member, change someone's role,
  mute for a duration, ban, transfer ownership.

Self-harm reports in particular deserve thought — that path should not feel like
filing a bug.

### Administration

- **Operations console:** manage the creator roster and the public post
  catalogue, and view platform statistics.
- **Superadmin console:** an overview dashboard, an **audit log** of privileged
  actions, user search and lookup, creating users, changing platform roles,
  linking a user account to a creator identity, granting and revoking a person's
  access to specific regions, setting someone's home region, force-verifying an
  email, revoking all of someone's sessions, and deleting users.

These are real working surfaces that currently look like developer tooling. They
are used by the people who run the product, possibly daily. Treat them as
products, not as an afterthought.

### Accounts and sign-in

Sign-in is **passwordless**, by design — there is no password anywhere in the
product, and no separate "verify your email" step, because both routes prove
ownership of the address as a side effect:

- **A one-time code sent by email.** Entering a valid code either signs you in or
  creates your account — the product does not ask "do you already have an
  account?", because it doesn't need to know.
- **Continue with Google.**

Two hard constraints here:

- **Nothing may reveal whether an email address is registered.** Requesting a
  code looks identical whether or not the account exists, and every failure
  produces the same generic message. The design cannot contradict this — no
  "we don't recognise that address", no different-looking path for new users.
- **Codes expire and requests are rate-limited.** Someone who asks for too many
  codes is locked out for a while. That state needs a humane treatment.

Signing out on the current device and **signing out everywhere** are both
available.

---

## 4. What needs designing

Roughly in order of how much of the experience each one carries.

1. **Discovery** — the feed, category filtering, and the single-post view.
   Handling both image and video posts, and sponsored posts, honestly.
2. **Creator profiles** — the case for following someone.
3. **Place / neighbourhood exploration.** *Opportunity:* posts carry real
   coordinates and named locations, and the current screen does not use them.
   What geographic discovery should feel like is genuinely open.
4. **Communities** — finding one worth joining, the three join policies, and the
   pending state.
5. **The inside of a community** — the post stream, pinning, threaded comments,
   emoji reactions, and posting.
6. **Membership and community moderation** — the member list, and the actions
   heads and managers take on people.
7. **Creator publishing** — composing and publishing a post, including upload.
8. **Sign-in** — both routes, under the anti-enumeration constraint above.
9. **Saved and personal profile.**
10. **Reporting and blocking** — reachable when someone needs it, invisible when
    they don't.
11. **The reports queue** — for community managers and for staff.
12. **Admin and superadmin consoles.**

### Please cover, everywhere

- **Signed-out vs signed-in.** A large share of the app is browsable without an
  account. Where the wall goes, and how it's framed, is a product decision worth
  your attention — the current one is a placeholder.
- **Empty, loading, and error states.** A brand-new community has no posts. A
  new user has saved nothing. A region may have little content early on. Cold
  start is the normal condition at launch, not an edge case.
- **Permission-shaped variation.** The same screen looks different to a visitor,
  a member, a manager, and staff. The server enforces all of this — the client
  only hides what it must — but each variant still needs to be a designed state.
- **Text that isn't yours.** Names, bios, captions, community descriptions and
  post bodies are all user-written and can be short, long, or absent.

---

## 5. Constraints worth knowing

- **One design, three platforms.** iOS, Android, and web from a single codebase.
- **Timestamps** are stored in UTC and shown in the reader's local time.
- **Nothing is truly deleted.** Removal hides content; it doesn't erase it. If
  the design implies permanence, say so carefully.
- **Media is images and video only.** No audio, no documents.
- **Accessibility is in scope**, on both touch and pointer.
- **Multi-region is built but not yet exercised.** Houston is the only live
  region. Nothing should hard-code a single city, but you do not need to design
  a city-switching experience unless you think the product needs one.

## 6. Not built (don't design around it)

Mentioned only so you don't assume it exists: there is **no** direct messaging,
**no** notification system, **no** events or ticketing feature (the data model
gestures at events; nothing is exposed), **no** likes on discovery posts beyond a
displayed count, **no** onboarding flow, and **no** algorithmic personalisation.

If you think any of these are load-bearing for the experience you're designing,
flag it early — that's a product conversation, not a design workaround.
