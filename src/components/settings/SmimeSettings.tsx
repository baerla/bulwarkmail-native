import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { KeyRound } from '../icons';
import { SettingsSection } from './settings-section';
import { spacing, radius, typography, type ThemePalette } from '../../theme/tokens';
import { useColors } from '../../theme/colors';
import { useLocaleStore } from '../../stores/locale-store';

/**
 * S/MIME needs a native crypto path (key import into the keystore, CMS
 * sign/encrypt/decrypt) that the app does not have yet. The tab is marked
 * `implemented: false` in SettingsScreen; this explainer is what a deep link
 * lands on.
 */
export function SmimeSettings() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const t = useLocaleStore((s) => s.t);

  return (
    <SettingsSection
      title={t('settings.tabs.encryption', 'S/MIME Encryption')}
      description={t(
        'settings.smime.mobile_description',
        'Sign and encrypt mail with S/MIME certificates.',
      )}
    >
      <View style={styles.box}>
        <KeyRound size={20} color={c.mutedForeground} />
        <Text style={styles.text}>
          {t(
            'settings.smime.mobile_explainer',
            'S/MIME is not available in the mobile app yet. Manage keys and certificates in the webmail; signed messages are shown without verification here.',
          )}
        </Text>
      </View>
    </SettingsSection>
  );
}

function makeStyles(c: ThemePalette) {
  return StyleSheet.create({
    box: {
      flexDirection: 'row',
      gap: spacing.md,
      alignItems: 'flex-start',
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.muted,
    },
    text: { ...typography.body, color: c.mutedForeground, flex: 1 },
  });
}
