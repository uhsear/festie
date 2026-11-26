import { useRouter } from 'expo-router';
import EmptyState from '../components/EmptyState';

/** Unknown routes and deep links land here; the copy matches web routes/not-found.tsx. */
export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <EmptyState
      headerless
      illustration="emptyList"
      title="Page not found"
      message="That link does not match anything in Festie. It may have moved, or the address has a typo."
      action={{ label: 'Back to the schedule', onPress: () => router.replace('/(tabs)') }}
    />
  );
}
