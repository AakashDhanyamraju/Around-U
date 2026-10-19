"""Request/response schemas.

Response shapes are deliberately identical to the pre-migration MongoDB API so
the existing frontend screens keep working — only the auth payloads are new.
"""

import re
import unicodedata
from datetime import datetime
from difflib import SequenceMatcher
from typing import List, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.config import settings


# ---------- Auth ----------
# Passwordless only. Google asserts the address; an OTP proves the person can
# read mail at it. Either way the account is verified the moment it exists, which
# is what makes `email_verified` a real invariant rather than a follow-up step.
class OtpRequest(BaseModel):
    email: EmailStr
    # Only used when this turns out to be a sign-up; ignored for existing
    # accounts, whose name is already set.
    name: Optional[str] = Field(default=None, max_length=80)

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = " ".join(v.split())
        return cleaned or None


class OtpRequestResponse(BaseModel):
    # Deliberately does not say whether the address has an account — that would
    # make this endpoint an account-existence oracle.
    detail: str
    expires_in_minutes: int
    # Present only outside production, so the flow is testable without a mailbox.
    dev_code: Optional[str] = None


class OtpVerifyRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=12)
    name: Optional[str] = Field(default=None, max_length=80)

    @field_validator("code")
    @classmethod
    def _clean_code(cls, v: str) -> str:
        # People paste codes with spaces and dashes from their mail client.
        cleaned = "".join(ch for ch in v if ch.isdigit())
        if not cleaned:
            raise ValueError("Enter the numeric code from your email")
        return cleaned

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = " ".join(v.split())
        return cleaned or None


class GoogleAuthRequest(BaseModel):
    """The Supabase access token from a completed Google consent flow.

    Verified server-side against Supabase before it is trusted for anything.
    """

    access_token: str = Field(min_length=10)


class UserResponse(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    email_verified: bool = False
    platform_role: str = "user"
    creator_id: Optional[str] = None
    home_region_id: Optional[str] = None
    created_at: datetime


class AuthResponse(BaseModel):
    user: UserResponse
    session_token: str
    # Lets the client show onboarding on a first sign-in without a second call.
    # There is no separate sign-up endpoint — both paths create on demand.
    created: bool = False


# ---------- Content ----------
class Creator(BaseModel):
    creator_id: str
    handle: str
    name: str
    bio: str
    avatar: str
    cover: Optional[str] = None
    city: str = "Houston"
    categories: List[str] = []
    followers: int = 0


class Post(BaseModel):
    post_id: str
    creator_id: str
    image: str
    caption: str
    category: str
    neighborhood: str
    location_name: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    likes: int = 0
    media_type: str = "image"
    video_url: Optional[str] = None
    hashtags: List[str] = []
    source: Optional[str] = None
    original_url: Optional[str] = None
    is_sponsored: bool = False
    created_at: datetime
    creator: Optional[Creator] = None


class CreatorCreate(BaseModel):
    handle: str = Field(min_length=1)
    name: str = Field(min_length=1)
    bio: str = ""
    avatar: str = ""
    cover: Optional[str] = None
    city: str = "Houston"
    categories: List[str] = []


class CreatorUpdate(BaseModel):
    handle: Optional[str] = None
    name: Optional[str] = None
    bio: Optional[str] = None
    avatar: Optional[str] = None
    cover: Optional[str] = None
    city: Optional[str] = None
    categories: Optional[List[str]] = None


class PostCreate(BaseModel):
    creator_id: str = Field(min_length=1)
    image: str = Field(min_length=1)
    caption: str = ""
    category: str = Field(min_length=1)
    neighborhood: str = Field(min_length=1)
    location_name: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    media_type: str = "image"
    video_url: Optional[str] = None
    hashtags: List[str] = []
    source: Optional[str] = None
    original_url: Optional[str] = None
    is_sponsored: bool = False


class PostUpdate(BaseModel):
    creator_id: Optional[str] = None
    image: Optional[str] = None
    caption: Optional[str] = None
    category: Optional[str] = None
    neighborhood: Optional[str] = None
    location_name: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    media_type: Optional[str] = None
    video_url: Optional[str] = None
    hashtags: Optional[List[str]] = None
    source: Optional[str] = None
    original_url: Optional[str] = None
    is_sponsored: Optional[bool] = None


# ---------- Uploads ----------
class UploadSignatureResponse(BaseModel):
    cloud_name: str
    api_key: str
    timestamp: int
    signature: str
    folder: str
    upload_url: str


# ---------- Regions ----------
class Region(BaseModel):
    region_id: str
    slug: str
    name: str
    state: Optional[str] = None
    country: str = "US"
    timezone: str = "UTC"
    center_lat: Optional[float] = None
    center_lng: Optional[float] = None
    is_active: bool = True


# ---------- Communities ----------
VISIBILITIES = ("public", "private")
JOIN_POLICIES = ("open", "request", "invite")
COMMUNITY_ROLES = ("member", "manager", "head")


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return re.sub(r"-{2,}", "-", cleaned)


class Community(BaseModel):
    community_id: str
    region_id: str
    slug: str
    name: str
    description: str = ""
    avatar: Optional[str] = None
    cover: Optional[str] = None
    category: Optional[str] = None
    visibility: str = "public"
    join_policy: str = "open"
    member_count: int = 0
    post_count: int = 0
    last_activity_at: datetime
    archived_at: Optional[datetime] = None
    created_by: str
    created_at: datetime
    # Populated per-viewer, so the client can render the right CTA without a
    # second round trip. Null for signed-out guests.
    viewer_role: Optional[str] = None
    viewer_status: Optional[str] = None


class CommunityCreate(BaseModel):
    region_id: str = Field(min_length=1)
    name: str = Field(min_length=3, max_length=60)
    description: str = Field(default="", max_length=2000)
    slug: Optional[str] = None
    avatar: Optional[str] = None
    cover: Optional[str] = None
    category: Optional[str] = None
    visibility: str = "public"
    join_policy: str = "open"

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v: str) -> str:
        cleaned = " ".join(v.split())
        if len(cleaned) < 3:
            raise ValueError("Community name must be at least 3 characters")
        return cleaned

    @field_validator("slug")
    @classmethod
    def _clean_slug(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        slug = slugify(v)
        if not slug:
            raise ValueError("Slug must contain at least one letter or number")
        return slug

    @field_validator("visibility")
    @classmethod
    def _check_visibility(cls, v: str) -> str:
        if v not in VISIBILITIES:
            raise ValueError(f"visibility must be one of {', '.join(VISIBILITIES)}")
        return v

    @field_validator("join_policy")
    @classmethod
    def _check_join_policy(cls, v: str) -> str:
        if v not in JOIN_POLICIES:
            raise ValueError(f"join_policy must be one of {', '.join(JOIN_POLICIES)}")
        return v


class CommunityUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=3, max_length=60)
    description: Optional[str] = Field(default=None, max_length=2000)
    avatar: Optional[str] = None
    cover: Optional[str] = None
    category: Optional[str] = None
    visibility: Optional[str] = None
    join_policy: Optional[str] = None

    @field_validator("visibility")
    @classmethod
    def _check_visibility(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VISIBILITIES:
            raise ValueError(f"visibility must be one of {', '.join(VISIBILITIES)}")
        return v

    @field_validator("join_policy")
    @classmethod
    def _check_join_policy(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in JOIN_POLICIES:
            raise ValueError(f"join_policy must be one of {', '.join(JOIN_POLICIES)}")
        return v


class CommunityMember(BaseModel):
    community_id: str
    user_id: str
    role: str
    status: str
    muted_until: Optional[datetime] = None
    joined_at: Optional[datetime] = None
    created_at: datetime
    # Joined from users so a member list is one request.
    name: Optional[str] = None
    picture: Optional[str] = None


class MemberRoleUpdate(BaseModel):
    role: str

    @field_validator("role")
    @classmethod
    def _check_role(cls, v: str) -> str:
        # Ownership transfer is a separate, explicit endpoint — promoting
        # someone to head by accident should not be possible here.
        if v not in ("member", "manager"):
            raise ValueError("role must be either member or manager")
        return v


class MemberModerationRequest(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)
    mute_minutes: Optional[int] = Field(default=None, ge=1, le=60 * 24 * 30)


# ---------- Community posts ----------
class CommunityPost(BaseModel):
    community_post_id: str
    community_id: str
    author_user_id: str
    body: str
    media: List[str] = []
    media_type: str = "none"
    is_pinned: bool = False
    comment_count: int = 0
    reaction_count: int = 0
    created_at: datetime
    author_name: Optional[str] = None
    author_picture: Optional[str] = None
    # Which emoji the caller has already applied, for toggle state.
    viewer_reactions: List[str] = []


class CommunityPostCreate(BaseModel):
    body: str = Field(default="", max_length=5000)
    media: List[str] = []
    media_type: str = "none"

    @field_validator("media_type")
    @classmethod
    def _check_media_type(cls, v: str) -> str:
        if v not in ("none", "image", "video"):
            raise ValueError("media_type must be none, image or video")
        return v

    @model_validator(mode="after")
    def _needs_content(self) -> "CommunityPostCreate":
        if not self.body.strip() and not self.media:
            raise ValueError("A post needs either text or media")
        return self


class CommunityPostUpdate(BaseModel):
    body: Optional[str] = Field(default=None, max_length=5000)
    media: Optional[List[str]] = None
    media_type: Optional[str] = None


# ---------- Comments and reactions ----------
COMMENT_TARGETS = ("community_post", "post", "event")
REACTION_TARGETS = ("community_post", "post", "event", "comment")


class Comment(BaseModel):
    comment_id: str
    target_type: str
    target_id: str
    parent_comment_id: Optional[str] = None
    author_user_id: str
    body: str
    created_at: datetime
    author_name: Optional[str] = None
    author_picture: Optional[str] = None


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    parent_comment_id: Optional[str] = None

    @field_validator("body")
    @classmethod
    def _clean_body(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Comment cannot be empty")
        return cleaned


class ReactionRequest(BaseModel):
    emoji: str = Field(min_length=1, max_length=16)


class ReactionSummary(BaseModel):
    emoji: str
    count: int
    reacted: bool = False


# ---------- Moderation ----------
# Spots and their photos have no community, so `_community_for_target` returns
# None for them and they route to the staff-only queue. That is correct: there
# is no manager with local authority over a place.
REPORT_TARGETS = (
    "community_post",
    "comment",
    "event",
    "user",
    "community",
    "spot",
    "spot_photo",
)
REPORT_REASONS = (
    "spam",
    "harassment",
    "hate",
    "violence",
    "sexual_content",
    "self_harm",
    "misinformation",
    "other",
)


class ReportCreate(BaseModel):
    target_type: str
    target_id: str = Field(min_length=1)
    reason: str
    note: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("target_type")
    @classmethod
    def _check_target(cls, v: str) -> str:
        if v not in REPORT_TARGETS:
            raise ValueError(f"target_type must be one of {', '.join(REPORT_TARGETS)}")
        return v

    @field_validator("reason")
    @classmethod
    def _check_reason(cls, v: str) -> str:
        if v not in REPORT_REASONS:
            raise ValueError(f"reason must be one of {', '.join(REPORT_REASONS)}")
        return v


class Report(BaseModel):
    report_id: str
    target_type: str
    target_id: str
    community_id: Optional[str] = None
    reporter_user_id: str
    reason: str
    note: Optional[str] = None
    status: str
    handled_by: Optional[str] = None
    handled_at: Optional[datetime] = None
    created_at: datetime
    resolution: Optional[str] = None
    resolution_note: Optional[str] = None


# The specific action taken, which `status` is too coarse to record: "I looked
# and it was fine" and "I removed it" are both terminal but are not the same
# decision when the account comes back.
REPORT_RESOLUTIONS = ("hidden", "no_action", "warned", "escalated")


class ReportResolve(BaseModel):
    status: str
    resolution: Optional[str] = None
    note: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("status")
    @classmethod
    def _check_status(cls, v: str) -> str:
        if v not in ("actioned", "dismissed"):
            raise ValueError("status must be either actioned or dismissed")
        return v

    @field_validator("resolution")
    @classmethod
    def _check_resolution(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in REPORT_RESOLUTIONS:
            raise ValueError(
                f"resolution must be one of {', '.join(REPORT_RESOLUTIONS)}"
            )
        return v


# ---------- Superadmin ----------
PLATFORM_ROLES = ("user", "creator", "staff", "superadmin")


class AdminUser(BaseModel):
    """A user as the superadmin portal sees them."""

    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    email_verified: bool = False
    platform_role: str = "user"
    creator_id: Optional[str] = None
    home_region_id: Optional[str] = None
    last_login_at: Optional[datetime] = None
    created_at: datetime


class AdminUserCreate(BaseModel):
    """Pre-creates an account so a role can be assigned before the person's first
    sign-in.

    There is no password field: the account is passwordless like every other, and
    the person signs in with a one-time code or Google whenever they choose. That
    also means creating an account here sends nothing and leaks nothing.
    """

    email: EmailStr
    name: str = Field(min_length=1, max_length=80)
    platform_role: str = "user"

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Name is required")
        return cleaned

    @field_validator("platform_role")
    @classmethod
    def _check_role(cls, v: str) -> str:
        if v not in PLATFORM_ROLES:
            raise ValueError(f"platform_role must be one of {', '.join(PLATFORM_ROLES)}")
        return v


class PlatformRoleUpdate(BaseModel):
    platform_role: str
    note: Optional[str] = Field(default=None, max_length=500)

    @field_validator("platform_role")
    @classmethod
    def _check_role(cls, v: str) -> str:
        if v not in PLATFORM_ROLES:
            raise ValueError(f"platform_role must be one of {', '.join(PLATFORM_ROLES)}")
        return v


class CreatorLinkRequest(BaseModel):
    # None unlinks the account from its creator profile.
    creator_id: Optional[str] = None


class RegionGrantRequest(BaseModel):
    region_id: str = Field(min_length=1)


class HomeRegionRequest(BaseModel):
    region_id: Optional[str] = None


# ---------- Creator publishing ----------
class CreatorPostCreate(BaseModel):
    """A creator publishing into their own region.

    Unlike the admin `PostCreate`, `creator_id` is not accepted from the body —
    it is taken from the authenticated account, so a creator cannot publish
    under someone else's name.
    """

    region_id: str = Field(min_length=1)
    image: str = Field(min_length=1)
    caption: str = ""
    category: str = Field(min_length=1)
    neighborhood: str = Field(min_length=1)
    location_name: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    media_type: str = "image"
    video_url: Optional[str] = None
    hashtags: List[str] = []


# ---------- Spots ----------
SPOT_STATUSES = ("active", "closed")
SPOT_SORTS = ("rank", "new", "near")

APPRECIATION_BUDGET_PER_WEEK = 5
SPOTS_PER_DAY = 5
PHOTOS_PER_DAY = 20
COLD_START_BELOW = 5

# Metres, and a 0-1 similarity ratio. Two spots inside both thresholds are
# offered as "add your photo to that one instead" rather than blocked.
DUPLICATE_RADIUS_M = 60.0
DUPLICATE_NAME_SIMILARITY = 0.6

# Descending, so `tier_for` returns on the first match. The count these compare
# against is distinct spots you found that somebody else actually went to — not
# spots created, which would reward posting volume.
TIERS = (
    ("keeper", "Keeper of the City", 40),
    ("local", "Local", 15),
    ("pathfinder", "Pathfinder", 8),
    ("scout", "Scout", 3),
    ("wanderer", "Wanderer", 1),
)

NOTIFICATION_TYPES = ("spot_appreciated", "spot_visited", "tier_reached")


def tier_for(count: int) -> Optional[dict]:
    """The tier at this credited-spot count, or None below the first rung.

    Below one there is no tier at all — not a zeroth tier. The client renders
    nothing rather than an empty badge.
    """
    for slug, label, threshold in TIERS:
        if count >= threshold:
            return {"tier": slug, "tier_label": label, "tier_threshold": threshold}
    return None


def next_tier_for(count: int) -> Optional[dict]:
    """The next rung up, or None once there is nothing above."""
    for slug, label, threshold in reversed(TIERS):
        if count < threshold:
            return {
                "next_tier": slug,
                "next_tier_label": label,
                "next_tier_threshold": threshold,
                "spots_to_next": threshold - count,
            }
    return None


_SPOT_PUNCT = re.compile(r"[^a-z0-9]+")
_SPOT_ARTICLE = re.compile(r"^(the|a|an)\s+")


def normalise_spot_name(value: str) -> str:
    """Canonical form for duplicate detection and name search.

    Accents are folded with `unicodedata` rather than Postgres' `unaccent`,
    which is available on the server but not installed. Creating an extension
    from a migration would risk startup on a role that may not have the
    privilege, for no benefit at this scale.
    """
    folded = unicodedata.normalize("NFKD", value.lower())
    folded = "".join(ch for ch in folded if not unicodedata.combining(ch))
    cleaned = _SPOT_PUNCT.sub(" ", folded).strip()
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    return _SPOT_ARTICLE.sub("", cleaned)


def name_similarity(a: str, b: str) -> float:
    """0.0-1.0 over two already-normalised names.

    Containment short-circuits to 1.0 because "Blue Bottle" and "Blue Bottle
    Coffee Downtown" are the same place, and a plain ratio would penalise the
    longer one for the words it added.
    """
    if not a or not b:
        return 0.0
    if a in b or b in a:
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


class Spot(BaseModel):
    spot_id: str
    region_id: str
    finder_user_id: str
    name: str
    blurb: str = ""
    best_time: Optional[str] = None
    category: Optional[str] = None
    address: Optional[str] = None
    lat: float
    lng: float
    is_quiet: bool = False
    status: str = "active"
    status_changed_at: Optional[datetime] = None
    created_at: datetime

    finder_name: Optional[str] = None
    finder_picture: Optional[str] = None
    # The finder's standing in THIS spot's region, so a row renders the chip
    # without a second call.
    finder_tier: Optional[str] = None
    finder_tier_label: Optional[str] = None

    hero_photo_url: Optional[str] = None
    photo_count: int = 0

    # Two different "how many went" numbers, and they are not interchangeable:
    # the total drives the "68 people went because of Ana" line, the 90-day one
    # is the score's first term.
    visits_attributed_total: int = 0
    visits_attributed_90d: int = 0
    # All-time and NOT trust-gated — this is the "counts for display" side of
    # the split. The score's appreciation term is gated separately.
    appreciation_count: int = 0
    confirmations_30d: int = 0
    score: float = 0.0

    # Null for guests rather than false, so the client can tell "not signed in"
    # from "signed in and hasn't".
    viewer_visited: Optional[bool] = None
    viewer_appreciated: Optional[bool] = None
    viewer_confirmed: Optional[bool] = None
    viewer_saved: Optional[bool] = None
    viewer_is_finder: Optional[bool] = None


class SpotPhoto(BaseModel):
    spot_photo_id: str
    spot_id: str
    user_id: str
    url: str
    caption: str = ""
    width: Optional[int] = None
    height: Optional[int] = None
    created_at: datetime
    author_name: Optional[str] = None
    author_picture: Optional[str] = None


class SpotCreate(BaseModel):
    region_id: str = Field(min_length=1)
    name: str = Field(min_length=3, max_length=80)
    blurb: str = Field(default="", max_length=1000)
    best_time: Optional[str] = Field(default=None, max_length=120)
    category: Optional[str] = Field(default=None, max_length=60)
    address: Optional[str] = Field(default=None, max_length=300)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    is_quiet: bool = False
    # Optional on purpose: a cold-start region needs the friction gone, and a
    # photo can be added the moment after.
    photos: List[str] = []
    # Set once the client has seen the duplicate candidates and chosen anyway.
    confirm_duplicate: bool = False

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v: str) -> str:
        cleaned = " ".join(v.split())
        if len(cleaned) < 3:
            raise ValueError("A spot name needs at least 3 characters")
        return cleaned

    @field_validator("photos")
    @classmethod
    def _cap_photos(cls, v: List[str]) -> List[str]:
        urls = [u.strip() for u in v if u and u.strip()]
        if len(urls) > 10:
            raise ValueError("You can add up to 10 photos when creating a spot")
        return urls


class SpotUpdate(BaseModel):
    """Exactly the three fields the permissions matrix lets a finder edit.

    Quiet, status and moderation each have their own endpoint, so none of them
    can be smuggled in through a general update.
    """

    name: Optional[str] = Field(default=None, min_length=3, max_length=80)
    blurb: Optional[str] = Field(default=None, max_length=1000)
    best_time: Optional[str] = Field(default=None, max_length=120)

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = " ".join(v.split())
        if len(cleaned) < 3:
            raise ValueError("A spot name needs at least 3 characters")
        return cleaned


class SpotStatusUpdate(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def _check_status(cls, v: str) -> str:
        if v not in SPOT_STATUSES:
            raise ValueError(f"status must be one of {', '.join(SPOT_STATUSES)}")
        return v


class SpotQuietUpdate(BaseModel):
    is_quiet: bool


class SpotHideRequest(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)


class SpotPhotoCreate(BaseModel):
    url: str = Field(min_length=1, max_length=2000)
    caption: str = Field(default="", max_length=300)
    width: Optional[int] = None
    height: Optional[int] = None


class DuplicateCandidate(BaseModel):
    spot_id: str
    name: str
    distance_m: float
    similarity: float
    hero_photo_url: Optional[str] = None
    finder_name: Optional[str] = None


class AppreciationBudget(BaseModel):
    limit: int = APPRECIATION_BUDGET_PER_WEEK
    used: int = 0
    remaining: int = APPRECIATION_BUDGET_PER_WEEK
    region_id: str
    week_start: datetime
    resets_at: datetime


class UserRegionRank(BaseModel):
    region_id: str
    region_name: Optional[str] = None
    # Distinct spots this person found that somebody else actually went to.
    credited_spots: int = 0
    spots_found: int = 0
    # Total attributable visits across their spots — "people sent".
    people_sent: int = 0
    appreciations_received: int = 0
    tier: Optional[str] = None
    tier_label: Optional[str] = None
    next_tier: Optional[str] = None
    next_tier_label: Optional[str] = None
    next_tier_threshold: Optional[int] = None
    spots_to_next: Optional[int] = None


class Notification(BaseModel):
    notification_id: str
    type: str
    region_id: Optional[str] = None
    actor_user_id: Optional[str] = None
    actor_name: Optional[str] = None
    actor_picture: Optional[str] = None
    target_type: Optional[str] = None
    target_id: Optional[str] = None
    data: dict = {}
    read_at: Optional[datetime] = None
    created_at: datetime
