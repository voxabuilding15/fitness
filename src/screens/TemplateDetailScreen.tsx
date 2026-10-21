import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppHeader, goBack } from '../components/AppHeader';
import { AppText } from '../components/AppText';
import { GlassCard } from '../components/GlassCard';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { useDatabase } from '../context/DatabaseContext';
import { errorMessageKey, type AppError } from '../domain/errors';
import { canStartFromTemplate, startFailureKey } from '../domain/sessionStart';
import { targetSummary } from '../domain/templateSummary';
import { uniqueCopyName } from '../domain/templateBuilder';
import { useExerciseName } from '../hooks/useExerciseLibrary';
import { useActiveSession } from '../hooks/useActiveSession';
import { useTemplates } from '../hooks/useTemplates';
import { announce } from '../services/accessibility';
import { colors, radius } from '../theme';

export default function TemplateDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const templateId = /^\d+$/.test(String(id ?? '')) ? Number(id) : null;
  const { state: db } = useDatabase();
  const { state, retry, retryDatabase } = useTemplates();
  const nameOf = useExerciseName();
  const active = useActiveSession();
  const [starting, setStarting] = useState(false);
  // set synchronously, so two taps in the same frame can't both reach the database; released when the screen loses focus
  const startLock = useRef(false);
  // a workout we know is in progress (just started, or reported by the database), before the next focus re-read
  const [known, setKnown] = useState<{ id: number; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<{ text: string; problem: boolean } | null>(null);

  useFocusEffect(
    useCallback(() => () => {
      startLock.current = false;
      setStarting(false);
    }, []),
  );

  const template = state.status === 'ready' && templateId !== null ? state.templates.find((x) => x.id === templateId) ?? null : null;
  const status = templateId === null ? 'missing' : state.status === 'ready' && !template ? 'missing' : state.status;

  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (previous.current === status) return;
    previous.current = status;
    if (status === 'missing') announce(t('templates.notFound'));
    else if (status === 'failed') announce(t('templates.readFailed'));
    else if (status === 'unavailable') announce(t('templates.unavailable'));
  }, [status, t]);

  const say = (text: string, problem = false) => {
    setMessage({ text, problem });
    announce(text);
  };

  if (status !== 'ready' || state.status !== 'ready' || !template) {
    return (
      <Screen withNav={false}>
        <AppHeader title={t('templates.title')} />
        <GlassCard strong style={styles.card}>
          {status === 'loading' ? (
            <View style={styles.row}>
              <ActivityIndicator color={colors.dark} />
              <AppText size={13} color={colors.ink}>{t('templates.loading')}</AppText>
            </View>
          ) : (
            <AppText size={13} color={colors.ink}>
              {status === 'missing' ? t('templates.notFound') : status === 'unavailable' ? t('templates.unavailable') : `${t('templates.readFailed')} ${state.status === 'failed' ? t(errorMessageKey(state.error)) : ''}`}
            </AppText>
          )}
          {status === 'unavailable' || status === 'failed' ? (
            <Pressable accessibilityRole="button" onPress={status === 'unavailable' ? retryDatabase : retry} style={[styles.btn, styles.btnGhost]}>
              <AppText size={14} weight="medium" color={colors.dark} align="center">{t('templates.reload')}</AppText>
            </Pressable>
          ) : null}
        </GlassCard>
      </Screen>
    );
  }

  const byId = new Map(state.exercises.map((e) => [e.id, e]));
  const repos = db.status === 'ready' ? db.repos : null;
  const failure = (e: AppError) => say(t(errorMessageKey(e)), true);

  const inProgress = known ?? (active.status === 'ready' && active.active ? { id: active.active.id, name: active.active.name } : null);
  const openSession = (sessionId: number) => router.push({ pathname: '/session/[id]', params: { id: String(sessionId) } });
  const start = async () => {
    if (!repos || startLock.current || !canStartFromTemplate(template)) return;
    startLock.current = true;
    setStarting(true);
    const r = await repos.sessions.start({ templateId: template.id });
    if (!r.ok) {
      startLock.current = false;
      setStarting(false);
      if (r.error.kind === 'conflict') {
        const running = await repos.sessions.getActive();
        if (running.ok && running.value) setKnown({ id: running.value.id, name: running.value.name });
      }
      return say(t(startFailureKey(r.error)), true);
    }
    // the session exists from here on; the lock stays so a second tap can't ask for another
    setKnown({ id: r.value.id, name: r.value.name });
    try {
      announce(t('liveSession.started'));
      openSession(r.value.id);
    } catch {
      startLock.current = false;
      setStarting(false);
      say(t('liveSession.openFailed'), true);
    }
  };

  const duplicate = async () => {
    if (!repos || busy) return;
    setBusy(true);
    // the copy's name is chosen from a fresh read, so a list that is out of date can't produce a second workout with the same name
    const fresh = await repos.templates.list();
    const r = fresh.ok ? await repos.templates.duplicate(template.id, uniqueCopyName(template.name, fresh.value, t('templates.copySuffix'))) : fresh;
    setBusy(false);
    if (r.ok) {
      announce(t('templates.duplicated', { name: r.value.name }));
      router.replace({ pathname: '/templates/[id]', params: { id: String(r.value.id) } });
    } else failure(r.error);
  };
  const remove = async () => {
    if (!repos || busy) return;
    setBusy(true);
    const r = await repos.templates.delete(template.id);
    setBusy(false);
    setConfirmDelete(false);
    if (r.ok) {
      announce(t('templates.deleted'));
      goBack();
    } else failure(r.error);
  };

  return (
    <Screen withNav={false}>
      <AppHeader title={template.name} />
      <GlassCard strong style={styles.card}>
        <AppText size={20} weight="semibold" color={colors.ink} accessibilityRole="header">{template.name}</AppText>
        {template.notes ? <AppText size={13} color={colors.ink}>{template.notes}</AppText> : null}
        <AppText size={12} color={colors.muted}>{t('templates.exerciseCount', { count: template.exercises.length })}</AppText>
        {template.exercises.map((e) => {
          const ex = byId.get(e.exerciseId);
          const name = ex ? nameOf(ex) : '';
          return (
            <View key={e.id} style={styles.item} accessible accessibilityLabel={`${e.position}. ${name}, ${targetSummary(t, e)}`}>
              <AppText size={15} weight="medium" color={colors.ink}>{`${e.position}. ${name}`}</AppText>
              <AppText size={12} color={colors.muted}>{targetSummary(t, e)}</AppText>
            </View>
          );
        })}
      </GlassCard>

      <View style={styles.actions}>
        {inProgress ? (
          <Pressable accessibilityRole="button" accessibilityHint={t('liveSession.alreadyActive')} onPress={() => openSession(inProgress.id)} style={[styles.btn, styles.btnPrimary]}>
            <AppText size={14} weight="medium" color={colors.white} align="center">{t('liveSession.resumeNamed', { name: inProgress.name })}</AppText>
          </Pressable>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: starting || !canStartFromTemplate(template), busy: starting }}
              disabled={starting || !canStartFromTemplate(template)}
              onPress={() => void start()}
              style={[styles.btn, styles.btnPrimary, (starting || !canStartFromTemplate(template)) && styles.dim]}
            >
              <AppText size={14} weight="medium" color={colors.white} align="center">{t(starting ? 'liveSession.starting' : 'liveSession.start')}</AppText>
            </Pressable>
            {!canStartFromTemplate(template) ? <AppText size={11} color={colors.onGradientMuted}>{t('liveSession.startEmpty')}</AppText> : null}
          </>
        )}
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/templates/form', params: { id: String(template.id) } })} style={[styles.btn, styles.btnGhost]}>
          <AppText size={14} weight="medium" color={colors.dark} align="center">{t('templates.edit')}</AppText>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void duplicate()} style={[styles.btn, styles.btnGhost, busy && styles.dim]}>
          <AppText size={14} weight="medium" color={colors.dark} align="center">{t('templates.duplicate')}</AppText>
        </Pressable>
        {!confirmDelete ? (
          <Pressable accessibilityRole="button" onPress={() => setConfirmDelete(true)} style={[styles.btn, styles.btnGhost]}>
            <AppText size={14} weight="medium" color={colors.danger} align="center">{t('templates.delete')}</AppText>
          </Pressable>
        ) : (
          <GlassCard strong style={styles.card}>
            <AppText size={13} color={colors.ink}>{t('templates.deleteConfirm')}</AppText>
            <View style={styles.row}>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void remove()} style={[styles.btn, styles.btnDanger, styles.flex, busy && styles.dim]}>
                <AppText size={14} weight="medium" color={colors.white} align="center">{t('templates.deleteConfirmYes')}</AppText>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setConfirmDelete(false)} style={[styles.btn, styles.btnGhost, styles.flex]}>
                <AppText size={14} weight="medium" color={colors.dark} align="center">{t('templates.keep')}</AppText>
              </Pressable>
            </View>
          </GlassCard>
        )}
      </View>

      {message ? (
        <View style={styles.row}>
          <Icon name={message.problem ? 'information-circle-outline' : 'checkmark-circle'} size={16} color={colors.white} />
          <AppText size={12} color={colors.white} style={styles.flex}>{message.text}</AppText>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: { padding: 16, gap: 12 },
  item: { gap: 2, paddingVertical: 4 },
  actions: { gap: 10 },
  btn: { minHeight: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  btnPrimary: { backgroundColor: colors.dark },
  btnGhost: { backgroundColor: 'rgba(255,255,255,0.8)' },
  btnDanger: { backgroundColor: colors.danger },
  dim: { opacity: 0.5 },
});
