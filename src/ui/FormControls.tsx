import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

// Shared form controls for the Directory's editor and *Teach again* (P2-7). The enrollment panel still
// has its own copies from P1-5; moving it here is a refactor with no behaviour change, left for later.

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  numeric = false,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  numeric?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#7b8794"
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        autoCorrect={false}
        style={styles.input}
      />
    </View>
  );
}

export function Toggle({
  label,
  hint,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.toggle}>
      <View style={styles.flex}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ false: '#3a4655', true: '#2b6cb0' }}
        thumbColor={value ? '#ffd166' : '#e6eaef'}
      />
    </View>
  );
}

export function Button({
  label,
  onPress,
  disabled = false,
  tone = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'secondary' | 'danger';
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.button, styles[tone], disabled && styles.disabled]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  field: { gap: 4, flex: 1 },
  label: { color: '#e6eaef', fontSize: 12 },
  hint: { color: '#7b8794', fontSize: 12 },
  input: { backgroundColor: '#1b2430', color: '#ffffff', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 10, fontSize: 16 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  toggleLabel: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  button: { borderRadius: 8, minHeight: 52, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 },
  primary: { backgroundColor: '#2b6cb0' },
  secondary: { backgroundColor: '#1b2430' },
  danger: { backgroundColor: '#742a2a' },
  disabled: { opacity: 0.45 },
  buttonText: { color: '#ffffff', fontWeight: '700', fontSize: 16, textAlign: 'center' },
});
