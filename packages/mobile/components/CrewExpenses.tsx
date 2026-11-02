import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Pressable, Alert, Linking, AccessibilityInfo } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useCrewStore, useUIStore } from '@festie/shared/stores';
import type { CrewExpense, CrewMember, CrewSettlement, CreateCrewExpenseRequest } from '@festie/shared/types';
import { mapErrorToUserMessage } from '@festie/shared/services';
import {
  formatBalance,
  formatAmount,
  formatCents,
  toCents,
  evenShares,
  sharesError,
  expenseShareCents,
  settlementSentence,
  balanceSentence,
  paymentsToConfirm,
  paymentStatusLine,
  expenseTrailLine,
  isSettlement,
  isPending,
  payOptionsFor,
  createSettleUpFlow,
  confirmPaidMessage,
  settlementPayments,
  describePayment,
  QUEUED_WRITE_MESSAGE,
  writeOutcomeMessage,
} from '@festie/shared/utils';
import { EXPENSE_CATEGORIES, CREW_CURRENCIES, expenseCategoryFor } from '@festie/shared/constants';
import {
  sanitizeAmountInput,
  canAddExpense,
  isAmountInvalid,
  actualExpenses as selectActualExpenses,
  plannedExpenses as selectPlannedExpenses,
  sumExpenseAmounts,
  visibleExpenses as selectVisibleExpenses,
  nonZeroBalances as selectNonZeroBalances,
  myBalance as selectMyBalance,
  myPayments as selectMyPayments,
  myReceipts as selectMyReceipts,
} from '../lib/expenseView';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { EXPENSE_IONICON } from '../lib/expenseIcon';
import Button from './Button';
import EmptyState from './EmptyState';
import CrewSyncMarker from './CrewSyncMarker';

interface CrewExpensesProps {
  crewId: string;
  members: CrewMember[];
  currentUserId: string;
}

/**
 * Crew expenses — track shared costs, view per-person balances, settle debts.
 * Mirrors the web ExpensesTab against the same endpoints, via the shared
 * crewStore actions (addExpense / removeExpense / settleExpense). The screen
 * owns the initial load.
 */
export default function CrewExpenses({ crewId, members, currentUserId }: CrewExpensesProps) {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const reduceMotion = useReduceMotion();

  const expenses = useCrewStore((s) => s.expenses);
  const balances = useCrewStore((s) => s.expenseBalances);
  const settlements = useCrewStore((s) => s.settlements);
  const addExpense = useCrewStore((s) => s.addExpense);
  const removeExpense = useCrewStore((s) => s.removeExpense);
  const settleExpense = useCrewStore((s) => s.settleExpense);
  const updateExpense = useCrewStore((s) => s.updateExpense);
  const confirmPayment = useCrewStore((s) => s.confirmPayment);
  const remindPayment = useCrewStore((s) => s.remindPayment);
  const setExpenseCurrency = useCrewStore((s) => s.setExpenseCurrency);
  const currency = useCrewStore((s) => s.expenseCurrency);
  const isOwner = useCrewStore((s) => s.activeCrew?.owner === currentUserId);

  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string>('other');
  const [planned, setPlanned] = useState(false);
  const [splitWith, setSplitWith] = useState<string[]>(() => members.map((m) => m.userId));
  const [editing, setEditing] = useState<CrewExpense | null>(null);
  const [paidBy, setPaidBy] = useState(currentUserId);
  // Editing someone else's row: only the payer, the adder or the owner may move who paid.
  const payerLocked =
    !!editing && editing.paid_by !== currentUserId && editing.created_by !== currentUserId && !isOwner;
  const [uneven, setUneven] = useState(false);
  const [shareText, setShareText] = useState<Record<string, string>>({});
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Planned-vs-actual filter. 'actual' = the real ledger (feeds settle-up);
  // 'planned' = the budget/forecast view; 'all' = both.
  const [view, setView] = useState<'all' | 'actual' | 'planned'>('actual');
  // Settle-up view. 'fewest' = the netted greedy min-cash-flow plan (fewest
  // transfers, never a stranger-to-pay); 'everyone' = every member's net balance.
  const [settleView, setSettleView] = useState<'fewest' | 'everyone'>('fewest');

  const reset = () => {
    setDescription('');
    setAmount('');
    setCategory('other');
    setPlanned(false);
    setSplitWith(members.map((m) => m.userId));
    setPaidBy(currentUserId);
    setUneven(false);
    setShareText({});
    setEditing(null);
    setShowForm(false);
  };

  const startEdit = (e: CrewExpense) => {
    setEditing(e);
    setDescription(e.description);
    setAmount(String(e.amount));
    setCategory(e.category);
    setPlanned(e.planned === true);
    // Former members cannot be picked or removed in the form and the server rejects them, so drop them here.
    const isMember = (id: string) => members.some((m) => m.userId === id);
    setSplitWith(e.split_with.filter(isMember));
    setPaidBy(isMember(e.paid_by) ? e.paid_by : currentUserId);
    const stored = e.split_amounts;
    setUneven(!!stored && Object.keys(stored).length > 0);
    setShareText(
      Object.fromEntries(Object.entries(stored ?? {}).map(([uid, cents]) => [uid, (cents / 100).toFixed(2)])),
    );
    setShowForm(true);
  };

  const startUneven = () => {
    setShareText(
      Object.fromEntries(evenShares(toCents(amount), splitWith).map((sh) => [sh.userId, (sh.cents / 100).toFixed(2)])),
    );
    setUneven(true);
  };

  const toggleMember = (uid: string) => {
    setSplitWith((prev) => (prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]));
  };

  const myBalance = selectMyBalance(balances, currentUserId);
  // Actual spend feeds the ledger; planned is the forecast/budget total. Keep
  // them separate so a budget row never inflates "total spent".
  const actualExpenses = selectActualExpenses(expenses);
  const plannedExpenses = selectPlannedExpenses(expenses);
  const totalSpent = sumExpenseAmounts(actualExpenses);
  const totalPlanned = sumExpenseAmounts(plannedExpenses);
  const visibleExpenses = selectVisibleExpenses(expenses, view);
  const payments = settlementPayments(expenses);
  const nameOf = (userId: string) => members.find((m) => m.userId === userId)?.name || undefined;
  const nonZeroBalances = selectNonZeroBalances(balances);
  // My net position from the netted plan, one actionable line per crew member:
  //   myPayments — "You owe {toName} ${amt}" (settle-able by me)
  //   myReceipts — "{fromName} owes you ${amt}" (they settle; read-only here)
  const myPayments = selectMyPayments(settlements, currentUserId);
  const myReceipts = selectMyReceipts(settlements, currentUserId);

  const amt = Number(amount);
  const memberIds = members.map((m) => m.userId);
  const shares = splitWith.map((userId) => ({ userId, cents: toCents(shareText[userId] ?? '') }));
  const shareProblem = uneven && amt > 0 ? sharesError(toCents(amt), shares, currency) : null;
  const sharesSum = shares.reduce((sum, sh) => sum + sh.cents, 0);
  const canAdd = canAddExpense(description, amt, splitWith.length) && !shareProblem;
  const toConfirm = paymentsToConfirm(expenses, currentUserId);
  // Inline-validation flag: amount typed but not a usable positive number.
  // (decimal-pad can still surface '-', '..', or trailing dots on some devices.)
  const amountInvalid = isAmountInvalid(amount, amt);

  const handleAmountChange = (next: string) => {
    setAmount(sanitizeAmountInput(next));
  };

  const handleAdd = async () => {
    if (!canAdd || busy) return;
    setBusy(true);
    try {
      const request: CreateCrewExpenseRequest = {
        description: description.trim(),
        amount: amt,
        splitWith,
        category,
        planned,
        ...(payerLocked ? {} : { paidBy }),
        ...(uneven ? { shares } : {}),
      };
      const outcome = editing ? await updateExpense(crewId, editing.id, request) : await addExpense(crewId, request);
      // Queued offline: the row shows "Not sent yet"; never celebrate it as sent.
      if (outcome === 'queued') AccessibilityInfo.announceForAccessibility(QUEUED_WRITE_MESSAGE);
      else haptics.success();
      reset();
    } catch {
      // Error surfaced via the crew store.
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = (expense: CrewExpense) => {
    // R20 destructive-confirmation haptic: warn before the irreversible prompt.
    haptics.warning();
    Alert.alert(
      'Remove expense',
      `Remove "${expense.description}" (${formatAmount(expense.amount, currency)})? Everyone's balance is recalculated without it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeExpense(crewId, expense.id).catch(() => {});
          },
        },
      ],
    );
  };

  const handleUndoPayment = (payment: CrewExpense) => {
    haptics.warning();
    Alert.alert(
      'Undo this payment?',
      `${describePayment(payment, currentUserId, nameOf, currency)}. Undo it only if it was recorded by mistake. Balances go back to what they were before.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Undo payment',
          style: 'destructive',
          onPress: () => {
            removeExpense(crewId, payment.id)
              .then((outcome) =>
                useUIStore.getState().showToast(writeOutcomeMessage(outcome, 'Payment undone'), {
                  kind: outcome === 'queued' ? 'info' : 'success',
                }),
              )
              .catch(() => {});
          },
        },
      ],
    );
  };

  // Settle-up is pay first, record second: the payee's links show above this
  // button, and the settlement (the exact netted plan amount) is recorded only
  // after the user confirms they paid.
  const handleConfirmPaid = (s: CrewSettlement) => {
    if (s.amount <= 0) return;
    Alert.alert('Record payment', confirmPaidMessage(s, formatAmount(s.amount, currency)), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Yes, I paid',
        onPress: () => {
          createSettleUpFlow(s, (req) => settleExpense(crewId, req), currency)
            .confirmPaid()
            .then((outcome) => {
              if (outcome === 'queued') Alert.alert('Not sent yet', QUEUED_WRITE_MESSAGE);
              else haptics.success();
            })
            .catch(() => {});
        },
      },
    ]);
  };

  const handleConfirmReceived = (p: CrewExpense, received: boolean) => {
    const payer = nameOf(p.paid_by) ?? p.paid_by_name ?? 'Your crewmate';
    confirmPayment(crewId, p.id, received)
      .then((outcome) => {
        const message =
          outcome === 'queued'
            ? QUEUED_WRITE_MESSAGE
            : received
              ? `Thanks. ${payer} can see you got it.`
              : `${payer} has been told it hasn't arrived.`;
        useUIStore.getState().showToast(message, { kind: outcome === 'queued' ? 'info' : 'success' });
      })
      .catch(() => {});
  };

  const handleRemind = (s: CrewSettlement) => {
    remindPayment(crewId, s.fromUserId)
      .then((outcome) => {
        if (outcome === 'queued') {
          AccessibilityInfo.announceForAccessibility(QUEUED_WRITE_MESSAGE);
          return;
        }
        AccessibilityInfo.announceForAccessibility(`Reminder sent to ${s.fromName}.`);
        haptics.success();
      })
      .catch((err) => Alert.alert('Reminder not sent', mapErrorToUserMessage(err, 'Try again.')));
  };

  // Open a payment app deep link (falls back to the https URL if the app isn't
  // installed / the scheme can't be opened).
  const openPayLink = async (links: { app: string; web: string } | null) => {
    if (!links) return;
    try {
      const supported = await Linking.canOpenURL(links.app);
      await Linking.openURL(supported ? links.app : links.web);
    } catch {
      Linking.openURL(links.web).catch(() => {});
    }
  };

  return (
    <View style={styles.container}>
      {isOwner ? (
        <View style={styles.ledger}>
          <TouchableOpacity
            style={styles.currencyRow}
            onPress={() => setCurrencyOpen((o) => !o)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ expanded: currencyOpen }}
            accessibilityLabel={`Currency, ${currency}`}
          >
            <Text style={styles.ledgerLabel}>Currency</Text>
            <Text style={styles.ledgerName}>{currency}</Text>
            <Ionicons
              name={currencyOpen ? 'chevron-up' : 'chevron-down'}
              size={t.iconSize.xs}
              color={t.colors.text.secondary}
            />
          </TouchableOpacity>
          {currencyOpen ? (
            <>
              <View style={styles.chipGrid}>
                {CREW_CURRENCIES.map((c) => {
                  const active = currency === c;
                  return (
                    <TouchableOpacity
                      key={c}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => {
                        if (!active) setExpenseCurrency(crewId, c).catch(() => {});
                        setCurrencyOpen(false);
                      }}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`Use ${c}`}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{c}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.splitHint}>Changing the currency does not convert amounts.</Text>
            </>
          ) : null}
        </View>
      ) : (
        <Text style={styles.splitHint}>Amounts in {currency}</Text>
      )}

      {expenses.length > 0 ? (
        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Total spent</Text>
            <Text style={[styles.statValue, styles.tabularNums]}>{formatAmount(totalSpent, currency)}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Your balance</Text>
            <Text
              style={[
                styles.statValue,
                styles.tabularNums,
                myBalance > 0.01 && styles.balancePositive,
                myBalance < -0.01 && styles.balanceNegative,
              ]}
            >
              {formatBalance(myBalance, currency)}
            </Text>
            {/* Directional plain-language gloss so the signed number is never
                ambiguous: positive = others owe you, negative = you owe. */}
            <Text
              style={[
                styles.statSub,
                myBalance > 0.01 && styles.balancePositive,
                myBalance < -0.01 && styles.balanceNegative,
              ]}
              numberOfLines={1}
            >
              {myBalance > 0.01 ? "you're owed" : myBalance < -0.01 ? 'you owe' : 'settled up'}
            </Text>
          </View>
        </View>
      ) : null}

      {totalPlanned > 0 ? (
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Planned (budget)</Text>
          <Text style={[styles.statValue, styles.balancePositive, styles.tabularNums]}>
            {formatAmount(totalPlanned, currency)}
          </Text>
        </View>
      ) : null}

      {expenses.length > 0 ? (
        <View style={styles.filterRow}>
          {(['actual', 'planned', 'all'] as const).map((v) => {
            const active = view === v;
            return (
              <TouchableOpacity
                key={v}
                style={[styles.filterTab, active && styles.filterTabActive]}
                onPress={() => {
                  if (!active) haptics.select();
                  setView(v);
                }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Show ${v} expenses`}
              >
                <Text
                  style={[styles.filterTabText, active && styles.filterTabTextActive]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                >
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {/* Payments to confirm — the payee answers "Got it" / "Not received". */}
      {toConfirm.length > 0 ? (
        <View style={styles.ledger}>
          <Text style={styles.ledgerLabel}>Payments to confirm</Text>
          {toConfirm.map((p) => (
            <View key={p.id} style={styles.settleGroup}>
              <Text style={[styles.ledgerName, styles.tabularNums]}>
                {nameOf(p.paid_by) ?? p.paid_by_name} marked {formatAmount(p.amount, currency)} paid to you.
              </Text>
              <View style={styles.payLinkRow}>
                <TouchableOpacity
                  style={styles.settleButton}
                  onPress={() => handleConfirmReceived(p, true)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`Got it. Confirm ${nameOf(p.paid_by) ?? p.paid_by_name} paid you`}
                >
                  <Text style={styles.settleButtonText}>Got it</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.payLink}
                  onPress={() => handleConfirmReceived(p, false)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`Not received from ${nameOf(p.paid_by) ?? p.paid_by_name}`}
                >
                  <Text style={styles.payLinkText}>Not received</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {/* Settle up — one card, toggle between the netted Fewest payments plan
          (never a stranger-to-pay) and Everyone's balance. Fewest payments
          surfaces one actionable net line per crew member: "You owe {name}"
          (settle-able) / "{name} owes you" (read-only, with a reminder). */}
      {settlements.length > 0 || nonZeroBalances.length > 0 ? (
        <View style={styles.ledger}>
          <View style={styles.ledgerHeader}>
            <Text style={styles.ledgerLabel}>Settle up</Text>
            <View style={styles.settleToggle}>
              {(['fewest', 'everyone'] as const).map((v) => {
                const active = settleView === v;
                return (
                  <TouchableOpacity
                    key={v}
                    style={[styles.settleToggleTab, active && styles.settleToggleTabActive]}
                    onPress={() => {
                      if (!active) haptics.select();
                      setSettleView(v);
                    }}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Show ${v === 'fewest' ? 'fewest payments' : "everyone's balance"}`}
                  >
                    <Text style={[styles.settleToggleText, active && styles.settleToggleTextActive]}>
                      {v === 'fewest' ? 'Fewest payments' : "Everyone's balance"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {settleView === 'fewest' ? (
            myPayments.length === 0 && myReceipts.length === 0 ? (
              <Text style={styles.ledgerName}>You're all settled up.</Text>
            ) : (
              <>
                {/* You owe {name} — settle-able net transfers. */}
                {myPayments.map((s) => {
                  const options = payOptionsFor(s, currency);
                  return (
                    <View key={`pay-${s.toUserId}`} style={styles.settleGroup}>
                      <Text style={[styles.ledgerName, styles.balanceNegative, styles.tabularNums]}>
                        {settlementSentence(s, currentUserId, currency)}
                      </Text>
                      {options.length > 0 ? (
                        <View style={styles.payLinkRow}>
                          {options.map((o) => (
                            <TouchableOpacity
                              key={o.label}
                              style={styles.payLink}
                              onPress={() => void openPayLink(o.link)}
                              activeOpacity={0.8}
                              accessibilityRole="button"
                              accessibilityLabel={`Pay ${s.toName} with ${o.label}`}
                            >
                              <Text style={styles.payLinkText}>{o.label}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.ledgerName}>
                          {s.toName} hasn't added a payment handle. Pay them directly, then confirm here.
                        </Text>
                      )}
                      <TouchableOpacity
                        style={styles.settleButton}
                        onPress={() => handleConfirmPaid(s)}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel={`I've paid ${s.toName}. Record the payment`}
                      >
                        <Ionicons name="cash-outline" size={14} color={t.colors.accent.aqua} />
                        <Text style={styles.settleButtonText}>I've paid {s.toName}</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
                {/* {name} owes you — read-only; the other person settles. */}
                {myReceipts.map((s) => (
                  <View key={`get-${s.fromUserId}`} style={styles.settleGroup}>
                    <Text style={[styles.ledgerName, styles.balancePositive, styles.tabularNums]}>
                      {settlementSentence(s, currentUserId, currency)}
                    </Text>
                    <TouchableOpacity
                      style={styles.settleButton}
                      onPress={() => handleRemind(s)}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={`Remind ${s.fromName} to pay you`}
                    >
                      <Ionicons name="notifications-outline" size={14} color={t.colors.accent.aqua} />
                      <Text style={styles.settleButtonText}>Remind {s.fromName}</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            )
          ) : nonZeroBalances.length > 0 ? (
            nonZeroBalances.map((b) => (
              <View key={b.userId} style={styles.ledgerRow}>
                <Text
                  style={[
                    styles.ledgerName,
                    b.balance > 0 ? styles.balancePositive : styles.balanceNegative,
                    styles.tabularNums,
                  ]}
                >
                  {balanceSentence(b, currentUserId, currency)}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.ledgerName}>Everyone's balance is zero.</Text>
          )}
        </View>
      ) : null}

      {showForm ? (
        <View style={styles.formBox}>
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>{editing ? 'Edit expense' : 'New expense'}</Text>
            <TouchableOpacity
              onPress={reset}
              style={styles.iconButton}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={editing ? 'Cancel editing expense' : 'Cancel new expense'}
            >
              <Ionicons name="close" size={t.iconSize.action} color={t.colors.text.secondary} />
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.input}
            placeholder="Dinner at the food truck"
            placeholderTextColor={t.colors.text.placeholder}
            value={description}
            onChangeText={setDescription}
            maxLength={200}
            accessibilityLabel="Expense description"
          />
          <TextInput
            style={styles.input}
            placeholder="Amount (0.00)"
            placeholderTextColor={t.colors.text.placeholder}
            value={amount}
            onChangeText={handleAmountChange}
            keyboardType="decimal-pad"
            accessibilityLabel="Expense amount"
          />
          {amountInvalid ? (
            <Text style={styles.errorText} accessibilityLiveRegion="polite">
              {`Enter an amount greater than ${formatAmount(0, currency)}`}
            </Text>
          ) : null}
          <View style={styles.chipGrid}>
            {EXPENSE_CATEGORIES.map((c) => {
              const active = category === c.id;
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setCategory(c.id)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`Category ${c.label}`}
                >
                  <Ionicons
                    name={EXPENSE_IONICON[c.icon]}
                    size={t.iconSize.xs}
                    color={active ? t.colors.accent.aqua : t.colors.text.secondary}
                  />
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.splitLabel}>Paid by</Text>
          <View style={styles.chipGrid}>
            {[
              ...members.filter((m) => m.userId === currentUserId),
              ...members.filter((m) => m.userId !== currentUserId),
            ].map((m) => {
              const active = paidBy === m.userId;
              return (
                <TouchableOpacity
                  key={m.userId}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setPaidBy(m.userId)}
                  disabled={payerLocked}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active, disabled: payerLocked }}
                  accessibilityLabel={`Paid by ${m.userId === currentUserId ? 'you' : m.name || 'member'}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {m.userId === currentUserId ? 'You' : m.name || 'Member'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {payerLocked ? (
            <Text style={styles.splitHint}>
              Only the payer, the person who added this, or the crew owner can change who paid.
            </Text>
          ) : null}
          <Text style={styles.splitLabel}>Split between</Text>
          <View style={styles.chipGrid}>
            {members.map((m) => {
              const active = splitWith.includes(m.userId);
              return (
                <TouchableOpacity
                  key={m.userId}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => toggleMember(m.userId)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`Split with ${m.name || 'member'}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{m.name || 'Member'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {!uneven && splitWith.length > 0 && amt > 0 ? (
            <Text style={[styles.splitHint, styles.tabularNums]}>
              {formatCents(evenShares(toCents(amt), splitWith)[0]?.cents ?? 0, currency)} each × {splitWith.length}
            </Text>
          ) : null}
          {uneven ? (
            <>
              {splitWith.map((uid) => (
                <View key={uid} style={styles.shareRow}>
                  <Text style={styles.shareName} numberOfLines={2}>
                    {uid === currentUserId ? 'You' : (nameOf(uid) ?? 'Member')}
                  </Text>
                  <TextInput
                    style={[styles.input, styles.shareInput]}
                    placeholder="0.00"
                    placeholderTextColor={t.colors.text.placeholder}
                    value={shareText[uid] ?? ''}
                    onChangeText={(next) => setShareText((prev) => ({ ...prev, [uid]: sanitizeAmountInput(next) }))}
                    keyboardType="decimal-pad"
                    accessibilityLabel={`Amount for ${uid === currentUserId ? 'you' : (nameOf(uid) ?? 'member')}`}
                  />
                </View>
              ))}
              {amt > 0 ? (
                <Text style={[styles.splitHint, styles.tabularNums]} accessibilityLiveRegion="polite">
                  {sharesSum === toCents(amt)
                    ? `Adds up to ${formatCents(sharesSum, currency)}`
                    : `Left to assign: ${formatCents(toCents(amt) - sharesSum, currency)}`}
                </Text>
              ) : null}
              {shareProblem ? (
                <Text style={styles.errorText} accessibilityLiveRegion="polite">
                  {shareProblem}
                </Text>
              ) : null}
            </>
          ) : null}
          <TouchableOpacity
            style={styles.textButton}
            onPress={() => (uneven ? setUneven(false) : startUneven())}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            <Text style={styles.textButtonText}>{uneven ? 'Split evenly' : 'Split unevenly'}</Text>
          </TouchableOpacity>
          {/* Planned = budget/forecast row. Excluded from balances + settle-up. */}
          <TouchableOpacity
            style={styles.plannedToggle}
            onPress={() => setPlanned((p) => !p)}
            activeOpacity={0.8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: planned }}
            accessibilityLabel="Mark as a planned (budget) expense"
          >
            <Ionicons
              name={planned ? 'checkbox' : 'square-outline'}
              size={20}
              color={planned ? t.colors.accent.aqua : t.colors.text.secondary}
            />
            <Text style={styles.plannedToggleText}>
              Planned expense <Text style={styles.splitHint}>(budget only — won't affect balances)</Text>
            </Text>
          </TouchableOpacity>
          <Button
            label={editing ? 'Save changes' : 'Add'}
            loading={busy}
            loadingLabel={editing ? 'Saving…' : 'Adding…'}
            disabled={!canAdd}
            onPress={handleAdd}
            accessibilityLabel={editing ? 'Save changes to expense' : 'Add expense'}
          />
        </View>
      ) : (
        <TouchableOpacity
          style={styles.toggle}
          onPress={() => {
            reset();
            setShowForm(true);
          }}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Add an expense"
        >
          <Ionicons name="cash-outline" size={16} color={t.colors.accent.aqua} />
          <Text style={styles.toggleText}>Add expense</Text>
          <Ionicons name="add" size={16} color={t.colors.accent.aqua} />
        </TouchableOpacity>
      )}

      {expenses.length === 0 ? (
        <EmptyState
          illustration="emptyList"
          title="No expenses yet"
          message="Add the first one, for example: Gas, $60, split 4 ways."
          action={{ label: 'Add expense', onPress: () => setShowForm(true) }}
        />
      ) : visibleExpenses.length === 0 ? (
        <Text style={styles.empty}>
          {view === 'planned'
            ? 'No planned expenses — add one to start a budget for this trip.'
            : 'No actual expenses yet.'}
        </Text>
      ) : (
        visibleExpenses.map((e, idx) => {
          const cat = expenseCategoryFor(e.category);
          // A queued create has no server id yet, so it cannot be removed.
          const queued = isPending(e);
          const canEdit = !isSettlement(e) && !queued;
          const canRemove =
            !queued &&
            (isSettlement(e)
              ? e.paid_by === currentUserId
              : e.paid_by === currentUserId || e.created_by === currentUserId || isOwner);
          const share = expenseShareCents(e, currentUserId, memberIds);
          const shareLine = e.planned
            ? null
            : share === null
              ? 'Not in your split'
              : `Your share ${formatCents(share, currency)}`;
          const trailLine = expenseTrailLine(e, members);
          const statusLine = paymentStatusLine(e, members, currentUserId);
          // R20 swipe-to-delete fallback: react-native-gesture-handler is absent
          // from the mobile deps, so the whole row is long-pressable (= delete
          // affordance) rather than a Gesture.Pan swipe. The trash button stays the
          // always-visible primary affordance; rows have no tap action, so
          // onLongPress can't collide with a row tap. Pressed coral dim is the
          // feedback (no transform/spring — reduce-motion-safe by construction).
          const RowContainer = canRemove ? Pressable : View;
          const rowProps = canRemove
            ? {
                onLongPress: () => handleRemove(e),
                delayLongPress: 350,
                accessibilityHint: 'Long press to remove this expense',
                style: ({ pressed }: { pressed: boolean }) => [styles.expenseRow, pressed && styles.expenseRowPressed],
              }
            : { style: styles.expenseRow };
          // R22: staggered entrance — cap at index 9 (400ms max), reduce-motion safe.
          const rowEntering = reduceMotion ? undefined : FadeInDown.delay(Math.min(idx, 9) * 40).duration(250);
          return (
            <Animated.View key={e.id} entering={rowEntering}>
              <RowContainer {...rowProps}>
                <Ionicons name={EXPENSE_IONICON[cat.icon]} size={t.iconSize.md} color={t.colors.text.secondary} />
                <View style={styles.expenseInfo}>
                  <View style={styles.expenseTitleRow}>
                    <Text style={styles.expenseDesc} numberOfLines={1}>
                      {e.description}
                    </Text>
                    {e.planned ? (
                      <View style={styles.plannedBadge}>
                        <Text style={styles.plannedBadgeText}>Planned</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.expenseMeta} numberOfLines={1}>
                    {e.planned ? 'planned' : `${e.paid_by === currentUserId ? 'You' : e.paid_by_name} paid`} · split{' '}
                    {e.split_with.length} {e.split_with.length === 1 ? 'way' : 'ways'}
                  </Text>
                  {shareLine ? <Text style={styles.expenseMeta}>{shareLine}</Text> : null}
                  {trailLine ? <Text style={styles.expenseMeta}>{trailLine}</Text> : null}
                  {statusLine ? <Text style={styles.expenseMeta}>{statusLine}</Text> : null}
                  <CrewSyncMarker item={e} />
                </View>
                <Text style={[styles.expenseAmount, styles.tabularNums]}>{formatAmount(e.amount, currency)}</Text>
                {canEdit ? (
                  <TouchableOpacity
                    onPress={() => startEdit(e)}
                    style={styles.iconButton}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit expense ${e.description}`}
                  >
                    <Ionicons name="pencil-outline" size={t.iconSize.action} color={t.colors.text.secondary} />
                  </TouchableOpacity>
                ) : null}
                {canRemove ? (
                  <TouchableOpacity
                    onPress={() => handleRemove(e)}
                    style={styles.iconButton}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove expense ${e.description}`}
                  >
                    <Ionicons name="trash-outline" size={t.iconSize.action} color={t.colors.text.danger} />
                  </TouchableOpacity>
                ) : null}
              </RowContainer>
            </Animated.View>
          );
        })
      )}

      {view !== 'planned' && payments.length > 0 ? (
        <View style={styles.ledger}>
          <Text style={styles.ledgerLabel}>Payments</Text>
          <Text style={styles.splitHint}>Settle-up payments. Not counted in Total spent.</Text>
          {payments.map((p) => (
            <View key={p.id} style={styles.ledgerRow}>
              <View style={styles.paymentInfo}>
                <Text style={[styles.ledgerName, styles.tabularNums]}>
                  {describePayment(p, currentUserId, nameOf, currency)}
                </Text>
                {paymentStatusLine(p, members, currentUserId) ? (
                  <Text style={styles.splitHint}>{paymentStatusLine(p, members, currentUserId)}</Text>
                ) : null}
              </View>
              {p.paid_by === currentUserId && !isPending(p) ? (
                <TouchableOpacity
                  onPress={() => handleUndoPayment(p)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Undo payment: ${describePayment(p, currentUserId, nameOf, currency)}`}
                >
                  <Text style={styles.undoText}>Undo payment</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    gap: t.spacing[3],
  },
  statsGrid: {
    flexDirection: 'row',
    gap: t.spacing[2],
  },
  statBox: {
    flex: 1,
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    gap: t.spacing[1],
  },
  statLabel: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
    textTransform: 'uppercase',
  },
  statValue: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  statSub: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
  balancePositive: {
    color: t.colors.accent.aqua,
  },
  balanceNegative: {
    color: t.colors.accent.coral,
  },
  filterRow: {
    flexDirection: 'row',
    gap: t.spacing[1],
    padding: t.spacing[1],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  filterTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
  },
  filterTabActive: {
    backgroundColor: t.colors.ring.aqua,
  },
  filterTabText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  filterTabTextActive: {
    color: t.colors.accent.aqua,
  },
  plannedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingVertical: t.spacing[1],
  },
  plannedToggleText: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  expenseTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  plannedBadge: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: 1,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
    flexShrink: 0,
  },
  plannedBadgeText: {
    ...typeStyle('micro'),
    color: t.colors.accent.aqua,
    textTransform: 'uppercase',
  },
  ledger: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  ledgerLabel: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
    textTransform: 'uppercase',
  },
  ledgerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing[2],
  },
  settleToggle: {
    flexDirection: 'row',
    gap: t.spacing[1],
    padding: 2,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
  },
  settleToggleTab: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.default,
  },
  settleToggleTabActive: {
    backgroundColor: t.colors.ring.aqua,
  },
  settleToggleText: {
    ...typeStyle('micro'),
    color: t.colors.text.secondary,
  },
  settleToggleTextActive: {
    color: t.colors.accent.aqua,
  },
  tabularNums: {
    fontVariant: ['tabular-nums'],
  },
  currencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    minHeight: 44,
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  shareName: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
    flex: 1,
  },
  shareInput: {
    width: 120,
    textAlign: 'right',
  },
  textButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  textButtonText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  paymentInfo: {
    flex: 1,
    gap: t.spacing[1],
  },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: t.spacing[2],
  },
  ledgerName: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  undoText: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
    paddingVertical: t.spacing[2],
  },
  settleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: 44,
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
  },
  settleButtonText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  settleGroup: {
    gap: t.spacing[2],
  },
  payLinkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  payLink: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
  },
  payLinkText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  toggleText: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
  },
  formBox: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  formTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
  },
  input: {
    backgroundColor: t.colors.bg.input,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
  },
  chipActive: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  chipText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  chipTextActive: {
    color: t.colors.accent.aqua,
  },
  splitLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
  },
  splitHint: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
  errorText: {
    ...typeStyle('micro'),
    color: t.colors.text.danger,
  },
  iconButton: {
    padding: t.spacing[1],
    // WCAG 2.5.5 / Apple HIG >=44pt touch target for these small (16-18px)
    // icon-only controls — padding alone can't reach it.
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    paddingHorizontal: t.spacing[2],
  },
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    // R2 hairline: neutral white 0.08 separator (was border.light 0.1).
    borderColor: t.colors.glass.border,
    backgroundColor: t.colors.bg.secondary,
  },
  // R20 long-press affordance: a coral-tinted dim surfaces the destructive
  // intent while the row is held (no transform/spring — reduce-motion-safe).
  expenseRowPressed: {
    backgroundColor: t.colors.ring.coral,
    borderColor: t.colors.accent.coral,
  },
  expenseInfo: {
    flex: 1,
    gap: t.spacing[1],
  },
  expenseDesc: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flexShrink: 1,
    minWidth: 0,
  },
  expenseMeta: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  expenseAmount: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
}));
