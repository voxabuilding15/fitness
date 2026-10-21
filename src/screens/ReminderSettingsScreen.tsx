import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '../components/AppHeader';
import { AppText } from '../components/AppText';
import { GlassCard } from '../components/GlassCard';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { useApp } from '../context/AppContext';
import { syncReminders, type ReminderResult } from '../services/reminderService';
import { playSound } from '../services/soundService';
import { colors, radius } from '../theme';
import type { ReminderSettings } from '../types/settings';

const DAY_ORDER = [6, 0, 1, 2, 3, 4, 5]; // Sat … Fri, matching the statistics week
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const pad = (n: number) => String(n).padStart(2, '0');

function Stepper({ label, value, onChange, max, step }: { label: string; value: number; onChange: (v: number) => void; max: number; step: number }) {
  const { t } = useTranslation();
  const wrap = (v: number) => (v + max + 1) % (max + 1);
  return (
    <View style={styles.stepper}>
      <AppText size={12} color={colors.muted} align="center">{label}</AppText>
      <View style={styles.stepRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${t('reminders.decrease')} ${label}`} onPress={() => onChange(wrap(value - step))} style={styles.stepBtn}>
          <Icon name="remove" size={18} color={colors.dark} />
        </Pressable>
        <AppText size={26} weight="semibold" color={colors.ink} align="center" style={styles.stepValue}>{pad(value)}</AppText>
        <Pressable accessibilityRole="button" accessibilityLabel={`${t('reminders.increase')} ${label}`} onPress={() => onChange(wrap(value + step))} style={styles.stepBtn}>
          <Icon name="add" size={18} color={colors.dark} />
        </Pressable>
      </View>
    </View>
  );
}

export default function ReminderSettingsScreen() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useApp();
  const r = settings.reminders;
  const [message, setMessage] = useState<ReminderResult | null>(null);

  const apply = async (patch: Partial<ReminderSettings>) => {
    const next = { ...r, ...patch };
    await updateSettings({ reminders: next });
    setMessage(await syncReminders(next, { title: t('reminders.notificationTitle'), body: t('reminders.notificationBody') }));
  };
  const toggleDay = (d: number) =>
    apply({ days: r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d].sort() });

  const messageKey: Record<ReminderResult, string> = {
    ok: 'reminders.scheduled', denied: 'reminders.denied', unsupported: 'reminders.unsupported', error: 'reminders.error',
  };

  return (
    <Screen withNav={false}>
      <AppHeader title={t('reminders.title')} />

      <GlassCard strong style={styles.card}>
        <View style={styles.toggleRow}>
          <View style={styles.bell}><Icon name="alarm-outline" size={20} color={colors.dark} /></View>
          <AppText size={15} weight="medium" color={colors.ink} style={styles.flex}>{t('reminders.enable')}</AppText>
          <Switch
            accessibilityLabel={t('reminders.enable')}
            value={r.enabled}
            onValueChange={(v) => apply({ enabled: v })}
            trackColor={{ false: '#9DB0AC', true: colors.dark }}
            thumbColor={colors.white}
          // @ts-expect-error react-native-web only: keeps the thumb white when on
          activeThumbColor={colors.white}
          />
        </View>
      </GlassCard>

      <GlassCard strong style={[styles.card, !r.enabled && styles.dim]}>
        <AppText size={14} weight="medium" color={colors.ink}>{t('reminders.time')}</AppText>
        <View style={styles.timeRow}>
          <Stepper label={t('reminders.hour')} value={r.hour} max={23} step={1} onChange={(hour) => r.enabled && apply({ hour })} />
          <AppText size={26} weight="semibold" color={colors.ink} align="center">:</AppText>
          <Stepper label={t('reminders.minute')} value={r.minute} max={59} step={5} onChange={(minute) => r.enabled && apply({ minute })} />
        </View>

        <AppText size={14} weight="medium" color={colors.ink}>{t('reminders.days')}</AppText>
        <View style={styles.days}>
          {DAY_ORDER.map((d) => {
            const active = r.days.includes(d);
            return (
              <Pressable
                key={d}
                disabled={!r.enabled}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active, disabled: !r.enabled }}
                onPress={() => {
                  playSound('tap');
                  toggleDay(d);
                }}
                style={[styles.day, active && styles.dayActive]}
              >
                <AppText size={11} weight={active ? 'semibold' : 'regular'} color={active ? colors.white : colors.ink} align="center" numberOfLines={1}>
                  {t(`days.${DAY_KEYS[d]}`)}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </GlassCard>

      {message ? (
        <View style={styles.msg}>
          <Icon name={message === 'ok' ? 'checkmark-circle' : 'information-circle-outline'} size={16} color={colors.white} />
          <AppText size={12} color={colors.white} style={styles.flex}>{t(messageKey[message])}</AppText>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { padding: 16, gap: 12 },
  dim: { opacity: 0.55 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bell: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  stepper: { gap: 6, alignItems: 'center' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 40 },
  days: { flexDirection: 'row', gap: 6 },
  day: { flex: 1, height: 40, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.8)', alignItems: 'center', justifyContent: 'center' },
  dayActive: { backgroundColor: colors.dark },
  msg: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
