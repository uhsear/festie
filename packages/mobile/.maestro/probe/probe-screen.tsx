import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
export default function Probe() {
  const [done, setDone] = useState(false);
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
      <Text testID="probe-text" style={{ color: '#fff', fontSize: 24 }}>Probe</Text>
      <Pressable testID="probe-btn" onPress={() => setDone(true)} style={{ padding: 20, backgroundColor: '#0aa', marginTop: 20 }}>
        <Text style={{ color: '#fff' }}>Tap me</Text>
      </Pressable>
      {done ? <Text testID="probe-done" style={{ color: '#fff', marginTop: 20 }}>Done</Text> : null}
    </View>
  );
}
