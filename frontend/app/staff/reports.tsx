/**
 * Staff reports queue — design panel `1l`.
 *
 * The operator surface that most looked like dev tooling. Three columns: the
 * queue on the left, the reported thing in the middle at full fidelity, the
 * decision on the right. Welfare reports sort to the top and swap the framing —
 * removal is not the first option when someone may be at risk.
 *
 * Below the desktop breakpoint the three columns stack, because a moderator on
 * a phone still needs to be able to clear a queue.
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { api, ApiError } from "@/src/api";
import { useAuth } from "@/src/auth";
import {
  Avatar,
  Banner,
  Loading,
  Mono,
  OrganicInput,
  PillButton,
  Screen,
  SectionHeading,
  Tag,
} from "@/src/components/organic";
import { fonts, radii, space, type } from "@/src/theme";
import { Theme, useTheme } from "@/src/theme-context";

/** Width at which the design's three columns fit side by side. */
const WIDE = 1080;

type QueueReport = {
  report_id: string;
  target_type: string;
  target_id: string;
  community_id?: string | null;
  community_name?: string | null;
  reporter_user_id: string;
  reporter_name?: string | null;
  reason: string;
  note?: string | null;
  status: string;
  created_at: string;
  /** Set once handled — the specific action, finer-grained than `status`. */
  resolution?: string | null;
};

type ReportDetail = QueueReport & {
  content?: {
    body?: string | null;
    created_at?: string | null;
    author_user_id?: string | null;
  };
  author?: {
    name?: string | null;
    created_at?: string | null;
    prior_actioned?: number;
    communities?: number;
    times_muted?: number;
  } | null;
};

const REASON_LABELS: Record<string, string> = {
  spam: "Spam",
  harassment: "Harassment",
  hate: "Hate",
  violence: "Violence",
  sexual_content: "Sexual content",
  self_harm: "Self-harm · handle first",
  misinformation: "Misinformation",
  other: "Other",
};

const TARGET_LABELS: Record<string, string> = {
  community_post: "Community post",
  comment: "Comment",
  post: "Discovery post",
  user: "Account",
  community: "Community",
  event: "Event",
};

export default function StaffReportsScreen() {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const router = useRouter();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;

  const [tab, setTab] = useState<"open" | "actioned" | "dismissed">("open");
  const [reports, setReports] = useState<QueueReport[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const isStaff =
    user?.platform_role === "staff" || user?.platform_role === "superadmin";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await api<{ reports: QueueReport[] }>(
        `/reports?report_status=${tab}`,
      );
      setReports(r.reports ?? []);
      setSelectedId((prev) =>
        prev && r.reports?.some((x) => x.report_id === prev)
          ? prev
          : (r.reports?.[0]?.report_id ?? null),
      );
    } catch (e) {
      setReports([]);
      setError(e instanceof ApiError ? e.message : "Could not load the queue.");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    if (isStaff) load();
  }, [isStaff, load]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setNote("");
    api<ReportDetail>(`/reports/${selectedId}`)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [selectedId]);

  const resolve = async (
    status: "actioned" | "dismissed",
    resolution: "hidden" | "no_action" | "warned" | "escalated",
  ) => {
    if (!selectedId || saving) return;
    setSaving(true);
    try {
      await api(`/reports/${selectedId}/resolve`, {
        method: "POST",
        body: { status, resolution, note: note.trim() || undefined },
      });
      setNote("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not resolve that.");
    } finally {
      setSaving(false);
    }
  };

  if (!isStaff) {
    return (
      <Screen>
        <View style={{ padding: 26, gap: 12, alignItems: "flex-start" }}>
          <Text style={s.h4}>Not available</Text>
          <Text style={s.body}>This queue is for staff.</Text>
          <PillButton label="Go back" variant="ghost" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  const welfare = detail?.reason === "self_harm";

  return (
    <Screen>
      <View style={s.topBar}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={20} color={t.text} />
        </Pressable>
        <Text style={s.h4}>Reports</Text>
        <Tag label="Platform-wide · staff" tone="accent" />
        <View style={{ flexDirection: "row", gap: 7, marginLeft: "auto" }}>
          {(["open", "actioned", "dismissed"] as const).map((k) => {
            const on = k === tab;
            return (
              <Pressable
                key={k}
                onPress={() => setTab(k)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[s.tab, on && { backgroundColor: t.text, borderColor: t.text }]}
              >
                <Text style={[s.tabText, on && { color: t.bg }]}>
                  {k === "open"
                    ? `Open ${reports.length && tab === "open" ? reports.length : ""}`.trim()
                    : k[0].toUpperCase() + k.slice(1)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {!!error && (
        <View style={{ paddingHorizontal: 20, paddingBottom: 10 }}>
          <Banner tone="accent" body={error} />
        </View>
      )}

      <View style={[s.columns, !wide && { flexDirection: "column" }]}>
        {/* Queue */}
        <View style={[s.queue, !wide && s.queueStacked]}>
          {loading ? (
            <Loading />
          ) : reports.length === 0 ? (
            <Text style={s.body}>Nothing {tab}.</Text>
          ) : (
            <ScrollView
              contentContainerStyle={{ gap: 9 }}
              showsVerticalScrollIndicator={false}
              horizontal={!wide}
            >
              {reports.map((r) => {
                const on = r.report_id === selectedId;
                const urgent = r.reason === "self_harm";
                return (
                  <Pressable
                    key={r.report_id}
                    onPress={() => setSelectedId(r.report_id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={[
                      s.queueCard,
                      !wide && { width: 260, marginRight: 9 },
                      urgent && s.queueCardUrgent,
                      on && !urgent && s.queueCardOn,
                    ]}
                  >
                    <View style={s.queueHead}>
                      <Text
                        style={[
                          s.queueReason,
                          urgent && { color: t.accent2Ramp[700] },
                        ]}
                        numberOfLines={1}
                      >
                        {REASON_LABELS[r.reason] ?? r.reason}
                      </Text>
                      <Mono style={{ marginLeft: "auto" }}>
                        {shortAgo(r.created_at)}
                      </Mono>
                    </View>
                    <Text style={s.queueTitle} numberOfLines={2}>
                      {TARGET_LABELS[r.target_type] ?? r.target_type}
                      {r.community_name ? ` in ${r.community_name}` : ""}
                    </Text>
                    <Mono numberOfLines={1}>
                      reported by {r.reporter_name ?? "someone"}
                    </Mono>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* The reported thing */}
        <ScrollView
          style={[s.middle, !wide && s.middleStacked]}
          contentContainerStyle={{ gap: 16, padding: wide ? 26 : 20 }}
          showsVerticalScrollIndicator={false}
        >
          {!detail ? (
            <Text style={s.body}>Select a report.</Text>
          ) : (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Tag
                  label={REASON_LABELS[detail.reason] ?? detail.reason}
                  tone={welfare ? "accent2" : "accent"}
                />
                <Text style={s.metaLine}>
                  Reported {shortAgo(detail.created_at)} ago ·{" "}
                  {detail.status === "open" ? "not yet actioned" : detail.status}
                </Text>
              </View>

              <View style={s.contentCard}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Avatar
                    name={detail.author?.name ?? "Unknown"}
                    size={36}
                    seed={detail.content?.author_user_id ?? detail.report_id}
                  />
                  <View style={{ gap: 2 }}>
                    <Text style={s.strong}>
                      {detail.author?.name ?? "Account not found"}
                    </Text>
                    <Mono>
                      {[
                        detail.community_name && `${detail.community_name}`,
                        detail.author?.created_at &&
                          `joined ${new Date(detail.author.created_at).toLocaleDateString(
                            undefined,
                            { month: "short", year: "numeric" },
                          )}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Mono>
                  </View>
                </View>

                <Text style={s.contentBody}>
                  {detail.content?.body ??
                    "This content is no longer available — it was removed or deleted after the report was filed."}
                </Text>

                {detail.content?.created_at ? (
                  <Mono>
                    Posted{" "}
                    {new Date(detail.content.created_at).toLocaleString(undefined, {
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </Mono>
                ) : null}
              </View>

              {detail.note ? (
                <View style={{ gap: 8, maxWidth: 620 }}>
                  <SectionHeading>Reporter&apos;s note</SectionHeading>
                  <Text style={s.quote}>“{detail.note}”</Text>
                </View>
              ) : null}

              <View style={{ gap: 8, maxWidth: 620 }}>
                <SectionHeading>Account history</SectionHeading>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
                  <Tag
                    label={
                      detail.author?.prior_actioned
                        ? `${detail.author.prior_actioned} prior actioned`
                        : "No prior reports"
                    }
                    tone="outline"
                  />
                  <Tag
                    label={`${detail.author?.communities ?? 0} communities`}
                    tone="outline"
                  />
                  <Tag
                    label={
                      detail.author?.times_muted
                        ? `Muted ${detail.author.times_muted}×`
                        : "Never muted"
                    }
                    tone="outline"
                  />
                </View>
              </View>
            </>
          )}
        </ScrollView>

        {/* Decision */}
        <ScrollView
          style={[s.right, !wide && s.rightStacked]}
          contentContainerStyle={{ padding: 22, gap: 13 }}
          showsVerticalScrollIndicator={false}
        >
          <SectionHeading>Resolve</SectionHeading>
          <Text style={s.resolveIntro}>
            {welfare
              ? "This is a welfare report, so removal is not the first option. Nothing is erased — removal hides content and keeps the record."
              : "Nothing is erased — removal hides content and keeps the record."}
          </Text>

          {detail?.status === "open" ? (
            <>
              <PillButton
                label="Hide the content"
                size="lg"
                block
                busy={saving}
                onPress={() => resolve("actioned", "hidden")}
              />
              <PillButton
                label="Warn the account"
                variant="ghost"
                size="lg"
                block
                busy={saving}
                onPress={() => resolve("actioned", "warned")}
              />
              <PillButton
                label="No action needed"
                variant="ghost"
                size="lg"
                block
                busy={saving}
                onPress={() => resolve("dismissed", "no_action")}
              />
            </>
          ) : (
            <Text style={s.body}>
              {detail
                ? `Handled — ${detail.resolution ?? detail.status}.`
                : "Nothing selected."}
            </Text>
          )}

          {welfare ? (
            <Banner
              tone="accent2"
              title="Not wired yet"
              body="Sending support resources and escalating to on-call aren't built — there's no support-mail template and no on-call route. Escalate by hand for now."
            />
          ) : null}

          <View style={{ gap: 6, marginTop: space[2] }}>
            <SectionHeading>Note for the log</SectionHeading>
            <OrganicInput
              value={note}
              onChangeText={setNote}
              placeholder="Every resolution is written to the log with your name."
              multiline
              maxLength={2000}
              editable={detail?.status === "open"}
              style={s.noteInput}
            />
          </View>
        </ScrollView>
      </View>
    </Screen>
  );
}

function shortAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      paddingHorizontal: 24,
      paddingTop: 12,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: t.divider,
    },
    h4: { fontFamily: fonts.heading, fontSize: 18, color: t.text },
    tab: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: t.divider,
    },
    tabText: { fontFamily: fonts.bodySemi, fontSize: 12, color: t.text },

    columns: { flex: 1, flexDirection: "row" },
    queue: {
      width: 320,
      padding: 14,
      borderRightWidth: 1,
      borderRightColor: t.divider,
    },
    queueStacked: {
      width: "100%",
      borderRightWidth: 0,
      borderBottomWidth: 1,
      borderBottomColor: t.divider,
    },
    queueCard: {
      backgroundColor: t.surface,
      borderRadius: radii.md,
      padding: 13,
      gap: 6,
      borderWidth: 1.5,
      borderColor: "transparent",
    },
    queueCardOn: { borderColor: t.accent },
    queueCardUrgent: {
      backgroundColor: t.accent2Ramp[100],
      borderColor: t.accent2Ramp[300],
    },
    queueHead: { flexDirection: "row", alignItems: "center", gap: 7 },
    queueReason: {
      fontFamily: fonts.bodyBold,
      fontSize: 10,
      letterSpacing: 0.8,
      textTransform: "uppercase",
      color: t.accentRamp[700],
      flexShrink: 1,
    },
    queueTitle: {
      fontFamily: fonts.bodyBold,
      fontSize: type.meta,
      lineHeight: 17,
      color: t.text,
    },

    middle: { flex: 1 },
    middleStacked: { flex: 1, minHeight: 260 },
    metaLine: { fontFamily: fonts.bodySemi, fontSize: 12, color: t.ink(58) },
    contentCard: {
      backgroundColor: t.surface,
      borderRadius: radii.card,
      padding: 18,
      gap: 11,
      maxWidth: 620,
    },
    contentBody: {
      fontFamily: fonts.body,
      fontSize: type.bodySm,
      lineHeight: 21,
      color: t.text,
    },
    strong: { fontFamily: fonts.bodyBold, fontSize: type.meta, color: t.text },
    quote: {
      fontFamily: fonts.body,
      fontSize: 13.5,
      lineHeight: 20,
      color: t.ink(70),
    },

    right: {
      width: 340,
      borderLeftWidth: 1,
      borderLeftColor: t.divider,
      backgroundColor: t.neutral[100],
    },
    rightStacked: {
      width: "100%",
      borderLeftWidth: 0,
      borderTopWidth: 1,
      borderTopColor: t.divider,
    },
    resolveIntro: {
      fontFamily: fonts.body,
      fontSize: 12.5,
      lineHeight: 19,
      color: t.ink(66),
    },
    noteInput: {
      minHeight: 74,
      borderRadius: radii.md,
      backgroundColor: t.bg,
      textAlignVertical: "top",
      paddingTop: 12,
      fontFamily: fonts.body,
    },

    body: {
      fontFamily: fonts.body,
      fontSize: type.bodySm,
      lineHeight: 21,
      color: t.ink(62),
    },
  });
}
