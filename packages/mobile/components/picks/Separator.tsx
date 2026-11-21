import { View } from 'react-native';
import { useStyles } from './styles';

export default function Separator() {
  const styles = useStyles();
  return <View style={styles.separator} />;
}
