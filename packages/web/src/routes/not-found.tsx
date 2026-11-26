import { useNavigate } from '@tanstack/react-router';
import { Compass } from 'lucide-react';
import EmptyState from '../components/ui/EmptyState';

/** Rendered for unknown URLs. SubHeader hides itself on unknown paths, so no schedule controls sit above this. */
export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div data-testid="not-found">
      <EmptyState
        illustration="emptyList"
        icon={<Compass aria-hidden="true" />}
        headingLevel={1}
        title="Page not found"
        description="That link does not match anything in Festie. It may have moved, or the address has a typo."
        cta={{ label: 'Back to the schedule', onClick: () => void navigate({ to: '/' }) }}
        className="min-h-[320px] py-12"
      />
    </div>
  );
}
