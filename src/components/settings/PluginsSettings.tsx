import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Puzzle } from '../icons';
import { SettingsSection } from './settings-section';
import { spacing, radius, typography, type ThemePalette } from '../../theme/tokens';
import { useColors } from '../../theme/colors';
import { useLocaleStore } from '../../stores/locale-store';

/**
 * The webmail's plugin runtime (sandboxed iframes, marketplace, signing) has
 * no counterpart in the native app, so this pane only explains where plugins
 * live. The tab is hidden from the settings list; the component stays so a
 * deep link to `settings/plugins` still renders something sensible.
 */
export function PluginsSettings() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const t = useLocaleStore((s) => s.t);

  return (
    <SettingsSection
      title={t('settings.tabs.plugins', 'Plugins')}
      description={t(
        'settings.plugins.mobile_description',
        'Plugins run inside the webmail and extend it in the browser.',
      )}
    >
      <View style={styles.box}>
        <Puzzle size={20} color={c.mutedForeground} />
        <Text style={styles.text}>
          {t(
            'settings.plugins.mobile_explainer',
            'The mobile app has no plugin runtime. Install and manage plugins from the webmail under Settings → Plugins; themes and filters they provide are not applied here.',
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
