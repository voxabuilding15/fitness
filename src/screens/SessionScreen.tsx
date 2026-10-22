import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppHeader, goBack } from '../components/AppHeader';
import { AppText } from '../components/AppText';
import { GlassCard } from '../components/GlassCard';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { SessionExerciseCard, fieldLabelKey, setSummary } from '../components/SessionExerciseCard';
import { Bar, CompactExerciseRow, ExerciseStrip, ProgressCard } from '../components/SessionNavigation';
import { useDatabase } from '../context/DatabaseContext';
import { errorMessageKey, type AppError } from '../domain/errors';
import type { Exercise, SessionExercise, WorkoutSessionDetail } from '../domain/models';
import { formatClock } from '../domain/restTimer';
import type { Result } from '../domain/result';
import { recoveryOf, shouldShowRecovery, splitMinutes, type Recovery } from '../domain/sessionRecovery';
import { exerciseProgress, firstOpenIndex, hasUnsavedInput, sessionProgress } from '../domain/sessionProgress';
import { nextDraft, planSet, summarizeSession, type SetDraft, type SetField, type SetIssues } from '../domain/setEntry';
import { summarizeTargets } from '../domain/templateSummary';
import { useExerciseName } from '../hooks/useExerciseLibrary';
import { useRecommendations } from '../hooks/useRecommendations';
import { useRestTimer } from '../hooks/useRestTimer';
import { announce } from '../services/accessibility';
import { colors, radius } from '../theme';

type Load =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'failed'; error: AppError }
  | { status: 'ready'; session: WorkoutSessionDetail; exercises: Exercise[] };

type Confirm = 'finish' | 'discard' | null;

/**
 * A persisted workout session. While it is in progress each exercise can have sets logged (saved the moment they are
 * logged, then read back from the database), a rest timer can be started from the exercise's recorded rest, and the
 * workout can be finished or discarded after a confirmation. Once it has ended it shows its summary, counted from the
 * saved sets. The template is never read: targets come from the snapshot taken when the session started.
 * Everything shown is what the database holds; the timer and the typed-but-unsaved values are local conveniences only.
 */
export default function SessionScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const sessionId = /^\d+$/.test(String(id ?? '')) ? Number(id) : null;
  const { state: db, retry } = useDatabase();
  const nameOf = useExerciseName();
  const recs = useRecommendations();
  const repos = db.status === 'ready' ? db.repos : null;
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [drafts, setDrafts] = useState<Record<number, SetDraft>>({});
  const [issues, setIssues] = useState<Record<number, SetIssues>>({});
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [focusId, setFocusId] = useState<number | null>(null); // the exercise shown in full; null = the first unfinished one
  const [leaveAsk, setLeaveAsk] = useState(false);
  const [recovery, setRecovery] = useState<Recovery | null>(null); // what the database says about a workout opened with sets already logged; read once per opening
  const [message, setMessage] = useState<{ text: string; problem: boolean } | null>(null);
  // one write at a time: set synchronously so two taps in one frame can't both reach the database
  const lock = useRef(false);
  const rest = useRestTimer();

  /** Reads the session back after a write. A failure here leaves what is on screen alone (the write itself already succeeded). */
  const fetchSession = useCallback(async (): Promise<boolean> => {
    if (!repos || sessionId === null) return false;
    const s = await repos.sessions.get(sessionId);
    if (!s.ok) return false;
    const ex = await repos.exercises.list({ includeArchived: true });
    if (!ex.ok) return false;
    setLoad({ status: 'ready', session: s.value, exercises: ex.value });
    return true;
  }, [repos, sessionId]);

  useFocusEffect(
    useCallback(() => {
      if (!repos || sessionId === null) return;
      void attempt;
      let cancelled = false;
      (async () => {
        const s = await repos.sessions.get(sessionId);
        if (cancelled) return;
        if (!s.ok) return setLoad(s.error.kind === 'not_found' ? { status: 'missing' } : { status: 'failed', error: s.error });
        const ex = await repos.exercises.list({ includeArchived: true });
        if (cancelled) return;
        if (!ex.ok) return setLoad({ status: 'failed', error: ex.error });
        setLoad({ status: 'ready', session: s.value, exercises: ex.value });
        const r = recoveryOf(s.value, Date.now());
        setRecovery(shouldShowRecovery(s.value, r) ? r : null);
      })();
      return () => {
        cancelled = true;
      };
    }, [repos, sessionId, attempt]),
  );

  const status = sessionId === null ? 'missing' : db.status === 'unavailable' ? 'unavailable' : db.status === 'loading' ? 'loading' : load.status;
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (previous.current === status) return;
    const before = previous.current;
    previous.current = status;
    if (status === 'missing') announce(t('liveSession.notFound'));
    else if (status === 'failed') announce(t('liveSession.readFailed'));
    else if (status === 'unavailable') announce(t('liveSession.unavailable'));
    else if (status === 'ready' && before !== null) announce(t('liveSession.loaded'));
  }, [status, t]);

  // the rest ending is spoken once
  const spokenDone = useRef(false);
  useEffect(() => {
    if (rest.timer.phase === 'done' && !spokenDone.current) announce(t('liveSession.restDone'));
    spokenDone.current = rest.timer.phase === 'done';
  }, [rest.timer.phase, t]);

  // Typed-but-not-logged numbers are the only thing leaving can lose (logged sets are already saved; the timer is only a guide)
  const dirtyInput = load.status === 'ready' && load.session.status === 'in_progress' && hasUnsavedInput(drafts, (rowId) => {
    const se = load.session.exercises.find((e) => e.id === rowId);
    if (!se) return null;
    const tracking = load.exercises.find((e) => e.id === se.exerciseId)?.trackingType ?? 'reps_only';
    return nextDraft(tracking, [...se.sets].reverse().find((s) => s.isCompleted));
  });
  useEffect(() => {
    if (!dirtyInput) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setLeaveAsk(true);
      announce(t('liveSession.leaveTitle'));
      return true; // stay on the screen and ask
    });
    return () => sub.remove();
  }, [dirtyInput, t]);

  if (status !== 'ready' || load.status !== 'ready') {
    const text = status === 'missing' ? t('liveSession.notFound') : status === 'unavailable' ? t('liveSession.unavailable') : status === 'failed' && load.status === 'failed' ? `${t('liveSession.readFailed')} ${t(errorMessageKey(load.error))}` : t('liveSession.loading');
    return (
      <Screen withNav={false}>
        <AppHeader title={t('liveSession.title')} />
        <GlassCard strong style={styles.card}>
          <View style={styles.row}>
            {status === 'loading' ? <ActivityIndicator color={colors.dark} /> : null}
            <AppText size={13} color={colors.ink}>{text}</AppText>
          </View>
          {status === 'unavailable' || status === 'failed' ? (
            <Pressable accessibilityRole="button" onPress={status === 'unavailable' ? retry : () => { setLoad({ status: 'loading' }); setAttempt((n) => n + 1); }} style={[styles.btn, styles.ghost]}>
              <AppText size={14} weight="medium" color={colors.dark} align="center">{t('liveSession.reload')}</AppText>
            </Pressable>
          ) : null}
        </GlassCard>
      </Screen>
    );
  }

  const { session, exercises } = load;
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const open = session.status === 'in_progress';
  const summary = summarizeSession(session);
  const anyPlan = session.exercises.some((e) => e.plan);

  const say = (text: string, problem = false) => {
    setMessage({ text, problem });
    announce(text);
  };
  const nameFor = (se: SessionExercise) => se.exerciseName ?? (byId.get(se.exerciseId) ? nameOf(byId.get(se.exerciseId)!) : '');
  const trackingOf = (se: SessionExercise) => byId.get(se.exerciseId)?.trackingType ?? 'reps_only';
  const draftFor = (se: SessionExercise): SetDraft => drafts[se.id] ?? nextDraft(trackingOf(se), [...se.sets].reverse().find((s) => s.isCompleted));

  /** Runs one write. A second request while one is running is ignored; afterwards the session is read back from the database. */
  async function write<T>(action: () => Promise<Result<T>>, onOk: (value: T) => void, onFail: (e: AppError) => void) {
    if (!repos || lock.current) return;
    lock.current = true;
    setSaving(true);
    try {
      const r = await action();
      if (!r.ok) {
        onFail(r.error);
        // another screen or a repeated action may have ended the workout: show what the database holds now
        if (r.error.kind === 'invalid_transition' || r.error.kind === 'immutable') await fetchSession();
        return;
      }
      onOk(r.value);
      if (!(await fetchSession())) say(t('liveSession.refreshFailed'), true);
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  const failed = (key: string) => (e: AppError) => say(e.kind === 'invalid_transition' || e.kind === 'immutable' ? t('liveSession.alreadyEnded') : `${t(key)} ${e.kind === 'validation' || e.kind === 'busy' ? t(errorMessageKey(e)) : ''}`.trim(), true);

  const logSet = (se: SessionExercise) => {
    const tracking = trackingOf(se);
    const plan = planSet(tracking, draftFor(se));
    if (!plan.ok) {
      const found = (plan.error.kind === 'validation' ? plan.error.issues : {}) as SetIssues;
      setIssues((cur) => ({ ...cur, [se.id]: found }));
      const fields = (Object.keys(found) as SetField[]).map((f) => t(fieldLabelKey(f))).join(', ');
      return announce(t('liveSession.needsAttention', { fields: `${nameFor(se)}: ${fields}` }));
    }
    setIssues((cur) => ({ ...cur, [se.id]: {} }));
    setFocusId(se.id); // stay on this exercise after logging, even when it was the last planned set (moving on is the person's choice)
    void write(
      () => repos!.sessions.addSet(se.id, plan.value),
      (set) => {
        setDrafts((cur) => { const { [se.id]: _gone, ...rest2 } = cur; return rest2; });
        setRecovery(null); // new activity: the "welcome back" note has done its job
        say(t('liveSession.setLogged', { n: set.setNumber, summary: setSummary(t, tracking, set) }));
      },
      failed('liveSession.logFailed'),
    );
  };
  const removeSet = (setId: number) => {
    setConfirmRemoveId(null);
    void write(() => repos!.sessions.deleteSet(setId), () => say(t('liveSession.setRemoved')), failed('liveSession.removeFailed'));
  };
  const finish = () => {
    setConfirm(null);
    void write(
      () => repos!.sessions.complete(session.id, {}),
      () => { rest.stop(); say(t('liveSession.finished')); },
      (e) => (e.kind === 'invalid_transition' && e.reason === 'no_completed_sets' ? say(t('liveSession.finishNeedsSet'), true) : failed('liveSession.finishFailed')(e)),
    );
  };
  const discard = () => {
    setConfirm(null);
    void write(
      () => repos!.sessions.discard(session.id),
      () => { rest.stop(); announce(t('liveSession.discarded')); goBack(); },
      failed('liveSession.discardFailed'),
    );
  };

  const timer = rest.timer;
  const restOwner = timer.phase === 'idle' ? null : session.exercises.find((e) => e.id === timer.exerciseKey);
  const progress = sessionProgress(session.exercises);
  const foundIdx = focusId === null ? -1 : session.exercises.findIndex((e) => e.id === focusId);
  const focusedIdx = open ? (foundIdx >= 0 ? foundIdx : firstOpenIndex(session.exercises)) : -1;
  const stripItems = session.exercises.map((e, i) => ({ id: e.id, position: e.position, name: nameFor(e), progress: exerciseProgress(e), active: i === focusedIdx }));
  const agoText = (minutes: number) => {
    const { h, m } = splitMinutes(minutes);
    return minutes < 1 ? t('liveSession.agoUnderMinute') : h > 0 ? t('liveSession.agoHours', { h, m }) : t('liveSession.agoMinutes', { m });
  };
  const goTo = (id: number) => {
    const i = session.exercises.findIndex((e) => e.id === id);
    if (i < 0) return;
    setFocusId(id);
    announce(t('liveSession.exerciseNav', { position: session.exercises[i].position, total: session.exercises.length, name: nameFor(session.exercises[i]) }));
  };
  const statusKey = session.status === 'in_progress' ? 'statusInProgress' : session.status === 'completed' ? 'statusCompleted' : 'statusDiscarded';

  return (
    <Screen withNav={false} avoidKeyboard>
      <AppHeader
        title={session.status === 'in_progress' ? t('liveSession.title') : session.name}
        onBack={dirtyInput ? () => { setLeaveAsk(true); announce(t('liveSession.leaveTitle')); } : undefined}
      />
      {open && leaveAsk && dirtyInput ? (
        <GlassCard strong style={styles.card}>
          <View role="group" accessibilityLabel={t('liveSession.leaveTitle')} style={styles.restBody}>
            <AppText size={14} weight="semibold" color={colors.ink} accessibilityRole="header">{t('liveSession.leaveTitle')}</AppText>
            <AppText size={12} color={colors.muted}>{t('liveSession.leaveBody')}</AppText>
            <View style={styles.row}>
              <Pressable accessibilityRole="button" onPress={goBack} style={[styles.btn, styles.dangerBtn, styles.flex]}>
                <AppText size={14} weight="medium" color={colors.white} align="center">{t('liveSession.leaveYes')}</AppText>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setLeaveAsk(false)} style={[styles.btn, styles.ghost, styles.flex]}>
                <AppText size={14} weight="medium" color={colors.dark} align="center">{t('liveSession.leaveStay')}</AppText>
              </Pressable>
            </View>
          </View>
        </GlassCard>
      ) : null}
      <GlassCard strong style={styles.card}>
        <AppText size={20} weight="semibold" color={colors.ink} accessibilityRole="header">{session.name}</AppText>
        <AppText size={12} color={colors.muted}>{`${t(`liveSession.${statusKey}`)} · ${t('liveSession.startedOn', { date: session.localDate })}`}</AppText>
        {!anyPlan ? <AppText size={11} color={colors.muted}>{t('liveSession.noPlan')}</AppText> : null}
      </GlassCard>

      {session.status === 'completed' ? (
        <GlassCard strong style={styles.card}>
          <AppText size={16} weight="semibold" color={colors.ink} accessibilityRole="header">{t('liveSession.summaryTitle')}</AppText>
          <AppText size={14} color={colors.ink}>{t('liveSession.summarySets', { count: summary.loggedSets })}</AppText>
          <AppText size={14} color={colors.ink}>{t('liveSession.summaryExercises', { done: summary.exercisesWithSets, total: summary.exerciseCount })}</AppText>
          {summary.totalReps > 0 ? <AppText size={14} color={colors.ink}>{t('liveSession.summaryReps', { count: summary.totalReps })}</AppText> : null}
          {summary.volumeKg > 0 ? <AppText size={14} color={colors.ink}>{t('liveSession.summaryVolume', { kg: summary.volumeKg })}</AppText> : null}
          {summary.durationMin !== null ? <AppText size={14} color={colors.ink}>{t('liveSession.summaryTime', { minutes: summary.durationMin })}</AppText> : null}
        </GlassCard>
      ) : null}
      {session.status === 'discarded' ? (
        <GlassCard strong style={styles.card}>
          <AppText size={13} color={colors.ink}>{t('liveSession.discardedNote')}</AppText>
        </GlassCard>
      ) : null}

      {open && recovery && rest.timer.phase === 'idle' ? (
        <GlassCard strong style={styles.card}>
          <View role="group" accessibilityLabel={t('liveSession.resumedTitle')} style={styles.restBody}>
            <AppText size={14} weight="semibold" color={colors.ink} accessibilityRole="header">{t('liveSession.resumedTitle')}</AppText>
            <AppText size={12} color={colors.muted}>{t('liveSession.resumedBody')}</AppText>
            {recovery.minutesSinceLastSet !== null ? (
              <AppText size={12} color={colors.muted}>{t('liveSession.resumedLast', { time: agoText(recovery.minutesSinceLastSet) })}</AppText>
            ) : null}
            <AppText size={12} color={colors.muted}>{t('liveSession.resumedTimer')}</AppText>
            <Pressable accessibilityRole="button" onPress={() => setRecovery(null)} style={[styles.btn, styles.ghost]}>
              <AppText size={14} weight="medium" color={colors.dark} align="center">{t('liveSession.resumedDismiss')}</AppText>
            </Pressable>
          </View>
        </GlassCard>
      ) : null}

      {open && rest.timer.phase !== 'idle' ? (
        <GlassCard strong style={styles.card}>
          <View role="group" accessibilityLabel={rest.timer.phase === 'done' ? t('liveSession.restOver') : t('liveSession.restRunning', { time: formatClock(rest.secondsLeft) })} style={styles.restBody}>
            <AppText size={13} color={colors.muted}>{restOwner ? t('liveSession.restFor', { name: nameFor(restOwner) }) : ''}</AppText>
            <AppText size={28} weight="semibold" color={colors.ink} accessibilityLabel={rest.timer.phase === 'done' ? t('liveSession.restOver') : t('liveSession.restRunning', { time: formatClock(rest.secondsLeft) })}>
              {rest.timer.phase === 'done' ? t('liveSession.restOver') : formatClock(rest.secondsLeft)}
            </AppText>
            <Bar ratio={rest.timer.phase === 'done' ? 1 : timer.phase === 'running' && timer.totalSec > 0 ? 1 - rest.secondsLeft / timer.totalSec : 0} tint={colors.accent} />
            <View style={styles.row}>
              {rest.timer.phase === 'running' ? (
                <>
                  <Pressable accessibilityRole="button" accessibilityLabel={t('liveSession.restAddLabel')} onPress={() => { rest.extend(15); announce(t('liveSession.restExtended', { time: formatClock(rest.secondsLeft + 15) })); }} style={[styles.btn, styles.ghost, styles.flex]}>
                    <AppText size={14} weight="medium" color={colors.dark} align="center">{t('liveSession.restAdd')}</AppText>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => { rest.stop(); announce(t('liveSession.restSkipped')); }} style={[styles.btn, styles.primary, styles.flex]}>
                    <AppText size={14} weight="medium" color={colors.white} align="center">{t('liveSession.restSkip')}</AppText>
                  </Pressable>
                </>
              ) : null}
              <Pressable accessibilityRole="button" onPress={() => { rest.stop(); announce(t('liveSession.restStopped')); }} style={[styles.btn, styles.ghost, styles.flex]}>
                <AppText size={14} weight="medium" color={colors.dark} align="center">{t('liveSession.restStop')}</AppText>
              </Pressable>
            </View>
            <AppText size={11} color={colors.muted}>{t('liveSession.restNote')}</AppText>
          </View>
        </GlassCard>
      ) : null}

      {open ? <ProgressCard progress={progress} /> : null}
      {open && session.exercises.length > 1 ? <ExerciseStrip items={stripItems} onSelect={goTo} /> : null}

      <AppText size={16} weight="semibold" color={colors.onGradient} accessibilityRole="header">{t('liveSession.exercises')}</AppText>
      {session.exercises.map((se, i) => {
        // while the workout is running only the current exercise is shown in full; the others are one line each (their logged sets and typed numbers are kept)
        if (open && i !== focusedIdx) return <CompactExerciseRow key={se.id} item={stripItems[i]} total={session.exercises.length} onSelect={goTo} />;
        const tracking = trackingOf(se);
        return (
          <React.Fragment key={se.id}>
            <SessionExerciseCard
              position={se.position}
              name={nameFor(se)}
              tracking={tracking}
              planned={se.plan ? summarizeTargets(t, se.plan) : null}
              hints={byId.get(se.exerciseId) ? recs.notesOf(recs.assess(byId.get(se.exerciseId)!), false) : []}
              sets={se.sets}
              entry={open ? {
                draft: draftFor(se), issues: issues[se.id] ?? {}, saving,
                onChange: (field, value) => { setDrafts((cur) => ({ ...cur, [se.id]: { ...draftFor(se), [field]: value } })); setIssues((cur) => ({ ...cur, [se.id]: { ...cur[se.id], [field]: undefined } })); },
                onLog: () => logSet(se),
                confirmRemoveId, onAskRemove: setConfirmRemoveId, onRemove: removeSet,
                restSec: se.plan && se.plan.restSec > 0 ? se.plan.restSec : null,
                onStartRest: () => { rest.start(se.plan!.restSec, se.id); announce(t('liveSession.restStarted', { seconds: se.plan!.restSec })); },
              } : null}
            />
            {open && exerciseProgress(se).done ? <AppText size={12} color={colors.onGradientMuted}>{t('liveSession.plannedDone')}</AppText> : null}
            {open && session.exercises.length > 1 ? (
              <View style={styles.row}>
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: i === 0 }} disabled={i === 0} onPress={() => goTo(session.exercises[i - 1].id)} style={[styles.btn, styles.ghost, styles.flex, i === 0 && styles.dim]}>
                  <AppText size={14} weight="medium" color={colors.dark} align="center">{t('liveSession.prevExercise')}</AppText>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: i === session.exercises.length - 1 }} disabled={i === session.exercises.length - 1} onPress={() => goTo(session.exercises[i + 1].id)} style={[styles.btn, styles.ghost, styles.flex, i === session.exercises.length - 1 && styles.dim]}>
                  <AppText size={14} weight="medium" color={colors.dark} align="center">{t('liveSession.nextExercise')}</AppText>
                </Pressable>
              </View>
            ) : null}
          </React.Fragment>
        );
      })}

      {message ? (
        <View style={styles.row}>
          <Icon name={message.problem ? 'information-circle-outline' : 'checkmark-circle'} size={16} color={colors.white} />
          <AppText size={12} color={colors.white} style={styles.flex}>{message.text}</AppText>
        </View>
      ) : null}

      {open ? (
        <View style={styles.actions}>
          {confirm === null ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: saving || summary.loggedSets === 0 }}
                disabled={saving || summary.loggedSets === 0}
                onPress={() => setConfirm('finish')}
                style={[styles.btn, styles.primary, (saving || summary.loggedSets === 0) && styles.dim]}
              >
                <AppText size={14} weight="medium" color={colors.white} align="center">{t('liveSession.finish')}</AppText>
              </Pressable>
              {summary.loggedSets === 0 ? <AppText size={11} color={colors.onGradientMuted}>{t('liveSession.finishNeedsSet')}</AppText> : null}
              <Pressable accessibilityRole="button" disabled={saving} onPress={() => setConfirm('discard')} style={[styles.btn, styles.ghost]}>
                <AppText size={14} weight="medium" color={colors.danger} align="center">{t('liveSession.discard')}</AppText>
              </Pressable>
            </>
          ) : (
            <GlassCard strong style={styles.card}>
              <AppText size={13} color={colors.ink} accessibilityRole="header">
                {confirm === 'finish'
                  ? t('liveSession.finishConfirm', { count: summary.loggedSets })
                  : summary.loggedSets > 0 ? t('liveSession.discardConfirm', { count: summary.loggedSets }) : t('liveSession.discardConfirmNone')}
              </AppText>
              <View style={styles.row}>
                <Pressable accessibilityRole="button" disabled={saving} onPress={confirm === 'finish' ? finish : discard} style={[styles.btn, confirm === 'finish' ? styles.primary : styles.dangerBtn, styles.flex, saving && styles.dim]}>
                  <AppText size={14} weight="medium" color={colors.white} align="center">{t(confirm === 'finish' ? 'liveSession.finishYes' : 'liveSession.discardYes')}</AppText>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => setConfirm(null)} style={[styles.btn, styles.ghost, styles.flex]}>
                  <AppText size={14} weight="medium" color={colors.dark} align="center">{t('liveSession.keepGoing')}</AppText>
                </Pressable>
              </View>
            </GlassCard>
          )}
        </View>
      ) : (
        <Pressable accessibilityRole="button" onPress={goBack} style={[styles.btn, styles.ghost]}>
          <AppText size={14} weight="medium" color={colors.dark} align="center">{t('liveSession.back')}</AppText>
        </Pressable>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: { padding: 16, gap: 10 },
  restBody: { gap: 8 },
  actions: { gap: 10 },
  btn: { minHeight: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  primary: { backgroundColor: colors.dark },
  ghost: { backgroundColor: 'rgba(255,255,255,0.8)' },
  dangerBtn: { backgroundColor: colors.danger },
  dim: { opacity: 0.5 },
});
