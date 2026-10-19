"""Transactional email via AWS SES.

Two deliberate behaviours:
  * boto3 is synchronous, so every send is pushed to a worker thread — a slow
    SES call must not block the event loop.
  * A failed send never propagates. Signup succeeding and the welcome email
    failing are different problems, and the user should not see a 500 because
    SES is in sandbox mode or the identity is unverified.
"""

import asyncio
import logging
from typing import Optional
from urllib.parse import quote

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.config import settings

logger = logging.getLogger(__name__)

_client = None


def _ses_client():
    global _client
    if _client is None:
        _client = boto3.client(
            "ses",
            region_name=settings.aws_ses_region,
            aws_access_key_id=settings.aws_ses_access_key_id,
            aws_secret_access_key=settings.aws_ses_secret_access_key,
        )
    return _client


def _source() -> str:
    if settings.ses_from_name:
        return f"{settings.ses_from_name} <{settings.ses_from_email}>"
    return settings.ses_from_email


def _send_sync(to_email: str, subject: str, html: str, text: str) -> None:
    _ses_client().send_email(
        Source=_source(),
        Destination={"ToAddresses": [to_email]},
        Message={
            "Subject": {"Data": subject, "Charset": "UTF-8"},
            "Body": {
                "Text": {"Data": text, "Charset": "UTF-8"},
                "Html": {"Data": html, "Charset": "UTF-8"},
            },
        },
    )


async def _send(to_email: str, subject: str, html: str, text: str, *, link: str) -> bool:
    if not settings.ses_configured:
        if settings.email_dev_mode_log_links:
            logger.warning(
                "SES not configured — email to %s not sent. Subject: %s | Link: %s",
                to_email,
                subject,
                link,
            )
        return False

    try:
        await asyncio.to_thread(_send_sync, to_email, subject, html, text)
        logger.info("Sent '%s' to %s", subject, to_email)
        return True
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "Unknown")
        if code == "MessageRejected":
            # Classic SES sandbox symptom: recipient is not a verified identity.
            logger.error(
                "SES rejected mail to %s (%s). In sandbox mode every recipient "
                "must be verified — request production access. Link: %s",
                to_email,
                code,
                link,
            )
        else:
            logger.error("SES send failed for %s (%s): %s", to_email, code, e)
        return False
    except (BotoCoreError, OSError) as e:
        logger.error("SES transport error for %s: %s", to_email, e)
        return False


# ---------- link builders ----------
def verification_link(token: str) -> str:
    return f"{settings.public_api_url.rstrip('/')}/api/auth/verify-email?token={quote(token)}"


def reset_link(token: str) -> str:
    return f"{settings.public_app_url.rstrip('/')}/reset-password?token={quote(token)}"


# ---------- shared shell ----------
def _wrap(title: str, body_html: str, cta_label: str, cta_url: str) -> str:
    return f"""<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#FFF8F2;
               font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:#FFF8F2;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width:520px;background:#ffffff;border-radius:20px;
                      padding:36px 32px;box-shadow:0 6px 24px rgba(28,25,23,0.07);">
          <tr><td>
            <p style="margin:0 0 6px;font-size:11px;letter-spacing:2px;
                      font-weight:700;color:#E4784A;text-transform:uppercase;">
              Around You
            </p>
            <h1 style="margin:0 0 16px;font-size:26px;line-height:1.25;
                       color:#1C1917;font-weight:700;">{title}</h1>
            {body_html}
            <table role="presentation" cellpadding="0" cellspacing="0"
                   style="margin:28px 0 20px;">
              <tr><td style="border-radius:999px;background:#E4784A;">
                <a href="{cta_url}"
                   style="display:inline-block;padding:15px 30px;color:#ffffff;
                          font-size:15px;font-weight:700;text-decoration:none;
                          border-radius:999px;">{cta_label}</a>
              </td></tr>
            </table>
            <p style="margin:0 0 6px;font-size:12px;color:#78716C;">
              If the button does not work, paste this into your browser:
            </p>
            <p style="margin:0;font-size:12px;color:#A8A29E;word-break:break-all;">
              {cta_url}
            </p>
          </td></tr>
        </table>
        <p style="margin:20px 0 0;font-size:11px;color:#A8A29E;">
          Around You · Houston, TX
        </p>
      </td></tr>
    </table>
  </body>
</html>"""


def _wrap_code(title: str, body_html: str, code: str) -> str:
    """Shell for a code-based email.

    Separate from `_wrap` because that one is built around a call-to-action
    button, and an OTP mail has nothing to click — the code itself is the
    payload, so it needs to be the most prominent thing in the message and easy
    to select on a phone.
    """
    spaced = " ".join(code)
    return f"""<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#FFF8F2;
               font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:#FFF8F2;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width:520px;background:#ffffff;border-radius:20px;
                      padding:36px 32px;box-shadow:0 6px 24px rgba(28,25,23,0.07);">
          <tr><td>
            <p style="margin:0 0 6px;font-size:11px;letter-spacing:2px;
                      font-weight:700;color:#E4784A;text-transform:uppercase;">
              Around You
            </p>
            <h1 style="margin:0 0 16px;font-size:26px;line-height:1.25;
                       color:#1C1917;font-weight:700;">{title}</h1>
            {body_html}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="margin:26px 0 18px;">
              <tr><td align="center"
                      style="background:#FFF1E2;border-radius:16px;padding:22px 12px;">
                <span style="font-size:34px;letter-spacing:10px;font-weight:700;
                             color:#1C1917;font-family:'SF Mono',Menlo,Consolas,monospace;">
                  {code}
                </span>
              </td></tr>
            </table>
            <p style="margin:0;font-size:12px;color:#A8A29E;">
              If you did not ask for this code, you can ignore this email — nobody
              can sign in without it.
            </p>
          </td></tr>
        </table>
        <p style="margin:20px 0 0;font-size:11px;color:#A8A29E;">
          Around You · Houston, TX
        </p>
      </td></tr>
    </table>
  </body>
</html>"""


# ---------- messages ----------
async def send_login_code_email(
    to_email: str, code: str, *, is_signup: bool = False
) -> bool:
    """Sends a one-time sign-in code.

    No name: on sign-up there is no account yet, and addressing a stranger by a
    guessed name reads worse than not addressing them at all.
    """
    minutes = settings.otp_ttl_minutes
    title = "Your sign-up code" if is_signup else "Your sign-in code"
    lead = (
        "Welcome to Around You — the ground-level guide to what's happening in "
        "your city. Enter this code to create your account."
        if is_signup
        else "Enter this code to sign in to Around You."
    )
    html = _wrap_code(
        title,
        f"""<p style="margin:0;font-size:15px;line-height:1.6;color:#57534E;">
              {lead}
            </p>
            <p style="margin:14px 0 0;font-size:13px;color:#78716C;">
              It expires in {minutes} minutes and can only be used once.
            </p>""",
        code,
    )
    text = (
        f"{lead}\n\nYour code is: {code}\n\n"
        f"It expires in {minutes} minutes and can only be used once.\n\n"
        "If you did not ask for this code, you can ignore this email.\n"
    )
    subject = "Your Around You sign-up code" if is_signup else "Your Around You sign-in code"
    # `link` is only what gets logged when SES is unavailable, so the code goes
    # there — that log line is the dev-mode delivery channel.
    return await _send(to_email, subject, html, text, link=f"code={code}")


async def send_verification_email(to_email: str, name: str, token: str) -> bool:
    link = verification_link(token)
    hours = settings.email_token_ttl_hours
    html = _wrap(
        "Confirm your email",
        f"""<p style="margin:0;font-size:15px;line-height:1.6;color:#57534E;">
              Hi {name}, welcome to Around You — the ground-level guide to what is
              happening in your city. Confirm your email to finish setting up your
              account.
            </p>
            <p style="margin:14px 0 0;font-size:13px;color:#78716C;">
              This link expires in {hours} hours.
            </p>""",
        "Confirm email",
        link,
    )
    text = (
        f"Hi {name},\n\nWelcome to Around You. Confirm your email address:\n\n"
        f"{link}\n\nThis link expires in {hours} hours.\n"
    )
    return await _send(to_email, "Confirm your Around You email", html, text, link=link)


async def send_password_reset_email(to_email: str, name: str, token: str) -> bool:
    link = reset_link(token)
    hours = settings.reset_token_ttl_hours
    html = _wrap(
        "Reset your password",
        f"""<p style="margin:0;font-size:15px;line-height:1.6;color:#57534E;">
              Hi {name}, we got a request to reset your Around You password. Pick a
              new one using the button below.
            </p>
            <p style="margin:14px 0 0;font-size:13px;color:#78716C;">
              This link expires in {hours} hours. If you did not ask for this, you
              can ignore this email — your password stays as it is.
            </p>""",
        "Choose a new password",
        link,
    )
    text = (
        f"Hi {name},\n\nReset your Around You password:\n\n{link}\n\n"
        f"This link expires in {hours} hours. If you did not request it, ignore "
        "this email.\n"
    )
    return await _send(to_email, "Reset your Around You password", html, text, link=link)


async def send_password_changed_email(to_email: str, name: str) -> bool:
    link = settings.public_app_url
    html = _wrap(
        "Your password was changed",
        f"""<p style="margin:0;font-size:15px;line-height:1.6;color:#57534E;">
              Hi {name}, your Around You password was just changed and every signed-in
              device was logged out. If this was not you, reset your password
              immediately.
            </p>""",
        "Open Around You",
        link,
    )
    text = (
        f"Hi {name},\n\nYour Around You password was just changed and all devices "
        "were signed out. If this was not you, reset your password immediately.\n"
    )
    return await _send(to_email, "Your Around You password was changed", html, text, link=link)


def describe_delivery(sent: bool, email: Optional[str] = None) -> str:
    """Human-readable hint returned in dev so the client knows where to look."""
    if sent:
        return "sent"
    if not settings.ses_configured:
        return "not_configured_check_server_logs"
    return "send_failed_check_server_logs"
