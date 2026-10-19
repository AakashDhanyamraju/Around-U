/**
 * Sign in — design panels `1n` (the two routes) and `1i` (code, and the
 * rate-limited state).
 *
 * One screen covers signing in and signing up, because entering a valid code
 * either finds your account or creates it. Nothing here may reveal which of
 * those happened, or whether an address is registered at all: the copy says
 * "if that address can receive mail", and every failure produces one message.
 * The backend holds the same line — see auth.py — so the two agree.
 */
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { LOGIN } from "@/constants/testIds";
import { ApiError } from "@/src/api";
import { useAuth } from "@/src/auth";
import { AuthEyebrow, AuthHeading, AuthShell } from "@/src/components/AuthKit";
import {
  Banner,
  Card,
  LabelledField,
  OrRule,
  PillButton,
} from "@/src/components/organic";
import { fonts, radii, space, type } from "@/src/theme";
import { Theme, useTheme } from "@/src/theme-context";

type Stage = "email" | "code";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CANCELLED = "Sign-in cancelled.";
const CODE_LENGTH = 6;

export default function LoginScreen() {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const router = useRouter();
  const { requestCode, verifyCode, signInWithGoogle, providers } = useAuth();

  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /** Set only on a 429 — the design gives that its own, calmer treatment. */
  const [throttled, setThrottled] = useState("");
  const [expiresIn, setExpiresIn] = useState(10);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const codeInput = useRef<TextInput>(null);

  // Cooldown before "resend" is offered, so nobody burns through the
  // per-address request throttle and locks themselves out for 15 minutes.
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const emailValid = EMAIL_RE.test(email.trim());
  const normalisedEmail = email.trim().toLowerCase();

  const sendCode = async (isResend = false) => {
    if (!emailValid || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    setThrottled("");
    try {
      const result = await requestCode(email);
      setStage("code");
      setSecondsLeft(30);
      setCode("");
      setExpiresIn(result.expires_in_minutes);
      // Outside production the server returns the code, so development does not
      // depend on SES — which is still sandboxed.
      setNotice(
        result.dev_code
          ? `Dev mode — your code is ${result.dev_code}`
          : isResend
            ? "New code sent."
            : "",
      );
      setTimeout(() => codeInput.current?.focus(), 250);
    } catch (e) {
      // A 429 is not a failure of the account, and the message already carries
      // the real wait from the server. Everything else is one generic line.
      if (e instanceof ApiError && e.status === 429) {
        setThrottled(e.message);
        setStage("code");
      } else {
        setError(
          e instanceof ApiError ? e.message : "Could not send a code. Please try again.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (code.length < 4 || busy) return;
    setBusy(true);
    setError("");
    try {
      await verifyCode(email, code);
      router.replace("/(tabs)");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That code did not work.");
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    if (googleBusy) return;
    setGoogleBusy(true);
    setError("");
    try {
      await signInWithGoogle();
      router.replace("/(tabs)");
    } catch (e) {
      // Backing out of the consent screen is a choice, not a failure.
      if (e instanceof ApiError && e.message === CANCELLED) {
        setError("");
      } else {
        setError(e instanceof ApiError ? e.message : "Google sign-in failed.");
      }
    } finally {
      setGoogleBusy(false);
    }
  };

  const backToEmail = () => {
    setStage("email");
    setCode("");
    setError("");
    setNotice("");
    setThrottled("");
  };

  const googleButton = providers?.google ? (
    <PillButton
      testID={LOGIN.googleButton}
      label="Continue with Google"
      variant="ghost"
      size="lg"
      block
      icon="logo-google"
      busy={googleBusy}
      onPress={google}
    />
  ) : null;

  // ── stage 1 — the two routes ────────────────────────────────────────────────
  if (stage === "email") {
    return (
      <AuthShell>
        <View style={{ paddingTop: 56, gap: 13 }}>
          <AuthEyebrow>Around You · {t.cityName}</AuthEyebrow>
          <AuthHeading
            title="Save it, follow them, join in."
            subtitle="Browsing needs nothing. Keeping things does."
          />
        </View>

        {!!error && <Banner tone="accent" body={error} />}

        <View style={{ paddingTop: 30, gap: 8 }}>
          <LabelledField label="Email">
            <View style={[s.inputWrap, emailValid && s.inputWrapActive]}>
              <TextInput
                testID={LOGIN.emailInput}
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  setError("");
                }}
                onSubmitEditing={() => sendCode()}
                placeholder="you@example.com"
                placeholderTextColor={t.ink(45)}
                style={s.input}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
                returnKeyType="go"
              />
            </View>
          </LabelledField>

          <PillButton
            testID={LOGIN.submitButton}
            label="Email me a code"
            size="lg"
            block
            disabled={!emailValid}
            busy={busy}
            onPress={() => sendCode()}
            style={{ marginTop: 6 }}
          />
        </View>

        {googleButton ? (
          <View style={{ paddingTop: 22, gap: 22 }}>
            <OrRule />
            {googleButton}
          </View>
        ) : null}

        <Card style={{ marginTop: 30 }}>
          <Text style={s.cardTitle}>There&apos;s no password to forget</Text>
          <Text style={s.cardBody}>
            A code proves the address is yours, so there&apos;s nothing else to set up
            and nothing to verify afterwards.
          </Text>
        </Card>

        <View style={{ flex: 1, minHeight: 24 }} />

        <Pressable
          testID={LOGIN.guestLink}
          onPress={() => router.replace("/(tabs)")}
          hitSlop={8}
          accessibilityRole="button"
          style={{ alignItems: "center", paddingVertical: 10 }}
        >
          <Text style={s.browse}>Just browse for now</Text>
        </Pressable>

        <Text style={s.legal}>
          By continuing you agree to the terms and privacy policy.
        </Text>
      </AuthShell>
    );
  }

  // ── stage 2 — the code, and the rate-limited state ──────────────────────────
  return (
    <AuthShell showBack onBack={backToEmail}>
      <View style={{ paddingTop: 44, gap: 12 }}>
        <AuthHeading
          title="Check your mail."
          subtitle={
            <Text>
              If <Text style={s.strong}>{normalisedEmail}</Text> can receive mail, a
              six-digit code is on its way. It expires in {expiresIn} minutes.
            </Text>
          }
        />
      </View>

      <CodeBoxes
        ref={codeInput}
        value={code}
        onChange={(v) => {
          setCode(v);
          setError("");
        }}
        onComplete={verify}
      />

      {!!error && <Banner tone="accent" body={error} />}
      {!error && !!notice && <Banner tone="accent2" body={notice} />}

      <View style={{ paddingTop: 18, gap: 11 }}>
        <PillButton
          testID={LOGIN.verifyButton}
          label="Continue"
          size="lg"
          block
          disabled={code.length < 4}
          busy={busy}
          onPress={verify}
        />
        {googleButton ? (
          <>
            <OrRule />
            {googleButton}
          </>
        ) : null}
      </View>

      {throttled ? (
        <View style={{ marginTop: 26 }}>
          <Banner
            tone="accent2"
            title="Rate-limited state"
            body={
              providers?.google
                ? `${throttled} Or use Google, which works right now.`
                : throttled
            }
            footnote="Nothing's wrong with your account."
          />
        </View>
      ) : null}

      <View style={{ flex: 1, minHeight: 20 }} />

      <Pressable
        testID={LOGIN.resendLink}
        onPress={() => sendCode(true)}
        disabled={secondsLeft > 0 || busy}
        hitSlop={8}
        accessibilityRole="button"
        style={{ alignItems: "center", paddingVertical: 10 }}
      >
        <Text style={[s.browse, secondsLeft > 0 && { color: t.ink(45) }]}>
          {secondsLeft > 0 ? `Send a new code in ${secondsLeft}s` : "Send a new code"}
        </Text>
      </Pressable>

      <Pressable
        testID={LOGIN.changeEmailLink}
        onPress={backToEmail}
        hitSlop={8}
        accessibilityRole="button"
        style={{ alignItems: "center", paddingVertical: 4 }}
      >
        <Text style={s.legal}>Use a different email</Text>
      </Pressable>

      <Text style={[s.legal, { marginTop: 14 }]}>
        Entering a valid code signs you in, or sets you up if you&apos;re new. Same
        screen either way.
      </Text>
    </AuthShell>
  );
}

/**
 * Six boxes over one hidden field. Splitting the input into six real inputs
 * fights autofill and paste — people paste "123 456" straight out of their mail
 * client — so this keeps a single field and draws the boxes.
 */
const CodeBoxes = React.forwardRef<
  TextInput,
  { value: string; onChange: (v: string) => void; onComplete: () => void }
>(function CodeBoxes({ value, onChange, onComplete }, ref) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const inner = useRef<TextInput>(null);
  React.useImperativeHandle(ref, () => inner.current as TextInput);

  return (
    <Pressable
      onPress={() => inner.current?.focus()}
      accessibilityRole="button"
      accessibilityLabel="Enter your six-digit code"
      style={s.codeRow}
    >
      {Array.from({ length: CODE_LENGTH }).map((_, i) => {
        const char = value[i];
        const isCursor = i === value.length;
        return (
          <View key={i} style={[s.codeBox, isCursor && s.codeBoxActive]}>
            {char ? (
              <Text style={s.codeChar}>{char}</Text>
            ) : isCursor ? (
              <View style={s.caret} />
            ) : null}
          </View>
        );
      })}

      <TextInput
        ref={inner}
        testID={LOGIN.codeInput}
        value={value}
        onChangeText={(v) => {
          const digits = v.replace(/\D/g, "").slice(0, CODE_LENGTH);
          onChange(digits);
          if (digits.length === CODE_LENGTH) onComplete();
        }}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={CODE_LENGTH}
        // Off-screen rather than display:none — a hidden input can't take focus
        // on web, and opacity:0 alone still captures taps meant for the boxes.
        style={s.hiddenInput}
        autoFocus={Platform.OS !== "web"}
      />
    </Pressable>
  );
});

function makeStyles(t: Theme) {
  return StyleSheet.create({
    inputWrap: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: t.bg,
      borderWidth: 2,
      borderColor: t.divider,
      borderRadius: radii.pill,
      paddingHorizontal: 20,
      paddingVertical: Platform.OS === "web" ? 14 : 15,
    },
    inputWrapActive: { borderColor: t.accent },
    input: {
      flex: 1,
      fontFamily: fonts.bodySemi,
      fontSize: type.body,
      color: t.text,
      paddingVertical: 0,
      // Removes the focus ring react-native-web adds on top of our own border.
      ...(Platform.OS === "web" ? { outlineStyle: "none" as never } : null),
    },

    codeRow: { flexDirection: "row", gap: 8, paddingTop: 26 },
    codeBox: {
      flex: 1,
      height: 62,
      borderRadius: radii.md,
      backgroundColor: t.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    codeBoxActive: {
      backgroundColor: t.bg,
      borderWidth: 2,
      borderColor: t.accent,
    },
    codeChar: { fontFamily: fonts.heading, fontSize: 26, color: t.text },
    caret: { width: 2, height: 26, backgroundColor: t.accent },
    hiddenInput: {
      position: "absolute",
      opacity: 0,
      left: 0,
      top: 0,
      width: "100%",
      height: 62,
      color: "transparent",
    },

    cardTitle: { fontFamily: fonts.bodyBold, fontSize: type.meta, color: t.text },
    cardBody: {
      fontFamily: fonts.body,
      fontSize: type.meta,
      lineHeight: 20,
      color: t.ink(66),
    },
    strong: { fontFamily: fonts.bodyBold, color: t.text },
    browse: { fontFamily: fonts.bodySemi, fontSize: type.bodySm, color: t.accentRamp[700] },
    legal: {
      fontFamily: fonts.body,
      fontSize: 11.5,
      lineHeight: 17,
      textAlign: "center",
      color: t.ink(50),
      paddingBottom: space[2],
    },
  });
}
