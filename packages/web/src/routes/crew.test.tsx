import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// CrewView reads tab badge counts via react-query, so renders need a client.
function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

// Mock dependencies
const mockNavigate = vi.fn().mockResolvedValue(undefined);
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => h.search,
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

// Shared mutable state object used by all store selectors
const storeState: Record<string, unknown> = {};

// Last props each PromptDialog received, keyed by title, plus the toast spy.
const h = vi.hoisted(() => ({
  prompts: {} as Record<string, { description?: string; placeholder?: string; maxLength?: number; parsePaste?: unknown; onConfirm: (v: string) => void }>,
  toast: vi.fn(),
  search: {} as Record<string, unknown>,
  confirms: {} as Record<string, { open: boolean; onConfirm: () => void }>,
  handOver: null as null | { open: boolean; candidates: { userId: string }[]; onConfirm: (id: string) => void },
  members: null as null | { onLeaveCrew?: () => void; onDeleteCrew?: () => void; onKick?: (m: unknown) => void },
}));

vi.mock('@festie/shared/stores', () => ({
  useCrewStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)),
  useAuthStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)),
  useFestivalStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)),
  useFestivalDataStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)),
}));

vi.mock('../components/crew/SosRaiseButton', () => ({ default: () => <div data-testid="sos-raise" /> }));

vi.mock('../components/features/CrewSelector', () => ({
  default: () => <div data-testid="crew-selector" />,
}));

// Guests get the in-place teaser instead of a redirect; stub it here.
vi.mock('../components/features/GuestTeaser', () => ({
  default: ({ mode }: { mode: string }) => <div data-testid="guest-teaser">{mode}</div>,
}));

vi.mock('../components/ui/EmptyState', () => ({
  default: ({
    title,
    description,
    cta,
    secondaryCta,
  }: {
    title: string;
    description?: string;
    cta?: { label: string; onClick: () => void };
    secondaryCta?: { label: string; onClick: () => void };
  }) => (
    <div data-testid="empty-state">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {cta && <button onClick={cta.onClick}>{cta.label}</button>}
      {secondaryCta && <button onClick={secondaryCta.onClick}>{secondaryCta.label}</button>}
    </div>
  ),
}));

vi.mock('../components/ui/Button', () => ({
  default: ({
    children,
    onClick,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    [k: string]: unknown;
  }) => (
    <button onClick={onClick} {...rest}>
      {children}
    </button>
  ),
}));

vi.mock('../components/crew/HomeBaseCard', () => ({
  default: () => <div data-testid="home-base-card" />,
}));

vi.mock('../components/crew/CrewTotemCard', () => ({
  default: ({ totemName }: { totemName: string | null }) => <div data-testid="crew-totem-card">{totemName}</div>,
}));

vi.mock('../components/features/FreshnessChip', () => ({
  default: () => <div data-testid="freshness-chip" />,
}));

vi.mock('../components/features/LastSyncedBadge', () => ({
  default: () => <div data-testid="last-synced-badge" />,
}));

vi.mock('../components/crew/CrewInviteBar', () => ({
  default: ({ inviteCode }: { inviteCode: string }) => <div data-testid="crew-invite-bar">{inviteCode}</div>,
}));

vi.mock('../components/crew/CrewTabBar', () => ({
  default: ({ activeTab, onTabChange }: { activeTab: string; onTabChange: (t: string) => void }) => (
    <div data-testid="crew-tab-bar" data-active={activeTab}>
      <button onClick={() => onTabChange('money')}>Money</button>
    </div>
  ),
}));

// CrewTabContent stays real; stub only the tab bodies it composes.
vi.mock('../components/crew/MembersTab', () => ({
  default: (props: NonNullable<typeof h.members>) => {
    h.members = props;
    return <div data-testid="MembersTab" />;
  },
}));
vi.mock('../components/crew/CreateCrewDialog', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="create-crew-dialog" /> : null),
}));
vi.mock('../components/crew/HandOverDialog', () => ({
  default: (props: NonNullable<typeof h.handOver>) => {
    h.handOver = props;
    return props.open ? <div data-testid="handover-dialog" /> : null;
  },
}));
vi.mock('../components/crew/MeetingPointsTab', () => ({ default: () => <div data-testid="MeetingPointsTab" /> }));
vi.mock('../components/crew/PollsTab', () => ({ default: () => <div data-testid="PollsTab" /> }));
vi.mock('../components/crew/PackingTab', () => ({ default: () => <div data-testid="PackingTab" /> }));
vi.mock('../components/crew/RidesTab', () => ({ default: () => <div data-testid="RidesTab" /> }));
vi.mock('../components/crew/ExpensesTab', () => ({ default: () => <div data-testid="ExpensesTab" /> }));
vi.mock('../components/crew/ActivityTab', () => ({ default: () => <div data-testid="ActivityTab" /> }));

vi.mock('../components/crew/ReformCrewButton', () => ({
  default: () => <div data-testid="reform-crew-button" />,
}));

vi.mock('../components/crew/useCrewAdmin', () => ({
  useCrewAdmin: vi.fn(() => ({
    isAdmin: false,
    adminOpen: false,
    setAdminOpen: vi.fn(),
    adminAddBusy: false,
    submitForceAdd: vi.fn(),
    handleForceAdd: vi.fn(),
  })),
}));

vi.mock('../lib/toastContext', () => ({
  useToast: vi.fn(() => ({ toast: h.toast, toastError: vi.fn() })),
}));


vi.mock('../components/ui/PromptDialog', () => ({
  default: (props: { open: boolean; title: string } & (typeof h.prompts)[string]) => {
    h.prompts[props.title] = props;
    return props.open ? <div data-testid="prompt-open">{props.title}</div> : null;
  },
}));

vi.mock('../components/crew/JoinCrewSheet', () => ({
  default: ({ code }: { code: string | null }) => (code ? <div data-testid="join-sheet">{code}</div> : null),
}));

vi.mock('../components/ui/ConfirmDialog', () => ({
  default: (props: { open: boolean; title: string; onConfirm: () => void }) => {
    h.confirms[props.title] = props;
    return null;
  },
}));

vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('lucide-react', () => ({
  Users: () => <span data-testid="users-icon" />,
  Pencil: () => <span data-testid="pencil-icon" />,
  Columns3: () => <span data-testid="columns-icon" />,
  CalendarClock: () => <span data-testid="calendar-clock-icon" />,
  ChevronRight: () => <span data-testid="chevron-right-icon" />,
  Trash2: () => <span data-testid="trash-icon" />,
  LogOut: () => <span data-testid="logout-icon" />,
  // CrewPhotosCard (M6 crew photo wall) icons.
  Images: () => <span data-testid="images-icon" />,
  X: () => <span data-testid="x-icon" />,
  ExternalLink: () => <span data-testid="external-link-icon" />,
}));

import CrewView from './crew';

function setStoreState(overrides: Record<string, unknown> = {}) {
  Object.keys(storeState).forEach((k) => delete storeState[k]);
  Object.assign(storeState, {
    user: { id: 'u1', username: 'testuser' },
    crews: [],
    activeCrew: null,
    selectCrew: vi.fn().mockResolvedValue(undefined),
    createCrew: vi.fn().mockResolvedValue(undefined),
    joinByCode: vi.fn().mockResolvedValue(undefined),
    reformCrew: vi.fn().mockResolvedValue(undefined),
    handOverAndLeave: vi.fn().mockResolvedValue('left'),
    kickMember: vi.fn().mockResolvedValue(undefined),
    updateCrew: vi.fn().mockResolvedValue(undefined),
    currentFestival: { id: 'f1', name: 'Bonnaroo' },
    // useFestivalDataStore selectors (ReformCrewButton)
    festivals: [],
    loadFestivals: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
}

describe('CrewView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.search = {};
    h.confirms = {};
    h.handOver = null;
    h.members = null;
    setStoreState();
  });

  it('renders the guest teaser when no user', () => {
    setStoreState({ user: null });
    render(<CrewView />);
    // Guests see <GuestTeaser mode="crew"/> in place of the crew UI.
    expect(screen.getByTestId('guest-teaser')).toHaveTextContent('crew');
  });

  it('renders empty state when no crews and no active crew', () => {
    setStoreState({ crews: [], activeCrew: null });
    render(<CrewView />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No crew yet')).toBeInTheDocument();
    expect(screen.getByText(/Make a crew, or join one with a code/)).toBeInTheDocument();
  });

  it('shows Create crew and Join with code inside the empty state and opens their prompts', () => {
    setStoreState({ crews: [], activeCrew: null });
    render(<CrewView />);
    const empty = screen.getByTestId('empty-state');
    fireEvent.click(within(empty).getByText('Create crew'));
    expect(screen.getByTestId('create-crew-dialog')).toBeInTheDocument();
    fireEvent.click(within(empty).getByText('Join with code'));
    expect(screen.getByText('Join crew')).toBeInTheDocument();
  });

  it('join-by-code prompt asks for a 6-character code and offers Paste', () => {
    render(<CrewView />);
    const join = h.prompts['Join crew']!;
    expect(join.description).toBe('Type the 6-character code, or paste the invite link.');
    expect(join.placeholder).toBe('K7XQ2M');
    expect(join.maxLength).toBe(64);
    expect(join.parsePaste).toBeTypeOf('function');
    expect(JSON.stringify(join)).not.toMatch(/6-letter|A1B2C3/);
  });

  it('a pasted invite link opens the join sheet for its code', () => {
    render(<CrewView />);
    act(() => h.prompts['Join crew']!.onConfirm('https://festie.us/join/k7xq2m'));
    expect(screen.getByTestId('join-sheet')).toHaveTextContent('K7XQ2M');
    expect(storeState.joinByCode).not.toHaveBeenCalled();
  });

  it('an unparseable code toasts an error and opens no sheet', () => {
    render(<CrewView />);
    act(() => h.prompts['Join crew']!.onConfirm('not a code'));
    expect(h.toast).toHaveBeenCalledWith("That code doesn't look right. Codes have 6 letters and numbers.", 'error');
    expect(screen.queryByTestId('join-sheet')).not.toBeInTheDocument();
  });

  it('renders crew content when active crew is set', () => {
    setStoreState({
      crews: [{ id: 'c1', name: 'Squad', owner: 'u1' }],
      activeCrew: {
        id: 'c1',
        name: 'Squad',
        inviteCode: 'ABC123',
        owner: 'u1',
        members: [{ userId: 'u1', role: 'owner', username: 'testuser' }],
      },
    });
    render(<CrewView />);
    expect(screen.getByTestId('home-base-card')).toBeInTheDocument();
    expect(screen.getByTestId('crew-invite-bar')).toBeInTheDocument();
    expect(screen.getByTestId('crew-tab-bar')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
  });

  it('renders crew selector when crews exist', () => {
    setStoreState({
      crews: [{ id: 'c1', name: 'Squad', owner: 'u1' }],
      activeCrew: {
        id: 'c1',
        name: 'Squad',
        owner: 'u1',
        members: [{ userId: 'u1', role: 'owner', username: 'testuser' }],
      },
    });
    render(<CrewView />);
    expect(screen.getByTestId('crew-selector')).toBeInTheDocument();
  });

  const crewWithActive = () =>
    setStoreState({
      crews: [{ id: 'c1', name: 'Squad', owner: 'u1' }],
      activeCrew: { id: 'c1', name: 'Squad', inviteCode: 'ABC123', owner: 'u1', members: [] },
    });

  it('selects Find when the URL has no tab', () => {
    crewWithActive();
    render(<CrewView />);
    expect(screen.getByTestId('crew-tab-bar')).toHaveAttribute('data-active', 'find');
    expect(screen.getByTestId('MeetingPointsTab')).toBeInTheDocument();
    expect(screen.queryByText('Crew plan')).not.toBeInTheDocument();
  });

  it('shows the plan links and Polls heading on the Plan tab, not in the setup footer', () => {
    h.search = { tab: 'plan' };
    crewWithActive();
    render(<CrewView />);
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('Crew plan')).toBeInTheDocument();
    expect(within(panel).getByText('Compare schedules')).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: 'Polls' })).toBeInTheDocument();
    const footer = document.querySelector('[aria-labelledby="crew-setup-heading"]') as HTMLElement;
    expect(within(footer).queryByText('Crew plan')).not.toBeInTheDocument();
    expect(within(footer).queryByText('Compare schedules')).not.toBeInTheDocument();
  });

  it('puts the tab in the URL when a tab is clicked', () => {
    crewWithActive();
    render(<CrewView />);
    fireEvent.click(screen.getByRole('button', { name: 'Money' }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/crew', search: { tab: 'money' }, replace: true });
  });

  it('an SOS link opens Find even when a tab is set', () => {
    h.search = { tab: 'money', sos: 'u2' };
    crewWithActive();
    render(<CrewView />);
    expect(screen.getByTestId('crew-tab-bar')).toHaveAttribute('data-active', 'find');
  });

  const ownerCrew = (members: Array<Record<string, unknown>>) =>
    setStoreState({
      crews: [{ id: 'c1', name: 'Squad', owner: 'u1' }],
      activeCrew: { id: 'c1', name: 'Squad', inviteCode: 'ABC123', owner: 'u1', members },
    });
  const me = { userId: 'u1', role: 'owner', username: 'testuser' };
  const bob = { userId: 'u2', role: 'member', username: 'bob', name: 'Bob' };

  it('owner leave with other members opens the hand-over dialog', () => {
    h.search = { tab: 'members' };
    ownerCrew([me, bob]);
    render(<CrewView />);
    act(() => h.members!.onLeaveCrew!());
    expect(screen.getByTestId('handover-dialog')).toBeInTheDocument();
    expect(h.handOver!.candidates.map((c) => c.userId)).toEqual(['u2']);
    expect(h.confirms['Leave crew']!.open).toBe(false);
  });

  it('solo owner leave opens the delete confirm', () => {
    h.search = { tab: 'members' };
    ownerCrew([me]);
    render(<CrewView />);
    act(() => h.members!.onLeaveCrew!());
    expect(screen.queryByTestId('handover-dialog')).not.toBeInTheDocument();
    expect(h.confirms['Delete crew']!.open).toBe(true);
  });

  it('a member leave opens the leave confirm', () => {
    h.search = { tab: 'members' };
    setStoreState({
      user: { id: 'u2', username: 'bob' },
      crews: [{ id: 'c1', name: 'Squad', owner: 'u1' }],
      activeCrew: { id: 'c1', name: 'Squad', owner: 'u1', members: [me, bob] },
    });
    render(<CrewView />);
    act(() => h.members!.onLeaveCrew!());
    expect(h.confirms['Leave crew']!.open).toBe(true);
  });

  it('hand-over confirm leaves and toasts the new owner', async () => {
    h.search = { tab: 'members' };
    ownerCrew([me, bob]);
    render(<CrewView />);
    await act(async () => h.handOver!.onConfirm('u2'));
    expect(storeState.handOverAndLeave).toHaveBeenCalledWith('c1', 'u2');
    expect(h.toast).toHaveBeenCalledWith('You left Squad. Bob owns it now.', 'success');
  });

  it('kick success shows the Removed toast', async () => {
    h.search = { tab: 'members' };
    ownerCrew([me, bob]);
    render(<CrewView />);
    act(() => h.members!.onKick!(bob));
    await act(async () => h.confirms['Remove member']!.onConfirm());
    expect(storeState.kickMember).toHaveBeenCalledWith('c1', 'u2');
    expect(h.toast).toHaveBeenCalledWith('Removed Bob', 'success');
  });

  it('shows the invite card for a one-member crew and hides it for two', () => {
    ownerCrew([me]);
    const { unmount } = render(<CrewView />);
    expect(screen.getByText('Invite your crew')).toBeInTheDocument();
    expect(screen.getAllByTestId('crew-invite-bar')).toHaveLength(1);
    unmount();
    ownerCrew([me, bob]);
    render(<CrewView />);
    expect(screen.queryByText('Invite your crew')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('crew-invite-bar')).toHaveLength(1);
  });
});
