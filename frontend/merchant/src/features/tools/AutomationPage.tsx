import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { storeApi } from '../../api/endpoints';
import { automationApi, khataApi, type Task } from '../../api/ops';
import { errorMessage } from '../../api/client';
import { useActiveStore } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { ErrorState, Modal, NoStore, PageHeader, Spinner, formatDateTime } from '../../components/common/ui';
import { IconPlus } from '../../components/icons/Icons';
import './Tools.css';

/**
 * Routine work the shop no longer has to remember (roadmap §4 P4): recurring
 * reminders and reports delivered to the inbox, low-stock alerts and automatic
 * khata reminders. The jobs runner does the work; this page sets it up.
 */

const TASK_TYPES: Record<Task['taskType'] | string, string> = {
  reminder: 'Reminder to myself',
  low_stock_report: 'Low-stock report',
  expiry_report: 'Expiring-stock report',
  purchase_suggestions: 'What to reorder',
  khata_overdue_report: 'Overdue khata report',
};
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const schedule = (t: Task) =>
  t.frequency === 'daily' ? `Every day at ${t.timeOfDay}` : t.frequency === 'weekly' ? `Every ${DAYS[t.dayOfWeek ?? 0]} at ${t.timeOfDay}` : `On day ${t.dayOfMonth} of each month at ${t.timeOfDay}`;

export default function AutomationPage() {
  const { activeStoreId } = useActiveStore();
  if (!activeStoreId) return <NoStore title="Automation" />;
  return (
    <div className="stack">
      <PageHeader title="Automation" subtitle="Reports and reminders that arrive in your inbox on schedule." />
      <Tasks storeId={activeStoreId} />
      <LowStock storeId={activeStoreId} />
      <KhataReminders storeId={activeStoreId} />
    </div>
  );
}

function Tasks({ storeId }: { storeId: string }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const query = useQuery({ queryKey: ['tasks', storeId], queryFn: () => automationApi.tasks(storeId) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tasks', storeId] });
  const toggle = async (t: Task) => {
    try { await automationApi.updateTask(storeId, t.id, { isActive: !t.isActive }); refresh(); } catch (err) { showToast(errorMessage(err), 'error'); }
  };
  const remove = async (t: Task) => {
    if (!window.confirm(`Delete “${t.title}”?`)) return;
    try { await automationApi.deleteTask(storeId, t.id); refresh(); } catch (err) { showToast(errorMessage(err), 'error'); }
  };
  const tasks = query.data?.tasks ?? [];
  return (
    <section className="card">
      <div className="row-between"><h2 style={{ fontSize: 'var(--text-base)' }}>Scheduled tasks</h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCreating(true)}><IconPlus size={14} /> New task</button></div>
      {query.isLoading ? <Spinner /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : tasks.length === 0 ? (
        <p className="muted">No tasks yet. Try a weekly “What to reorder” report every Monday morning.</p>
      ) : (
        <table className="table">
          <thead><tr><th>Task</th><th>When</th><th>Next</th><th /></tr></thead>
          <tbody>{tasks.map((t) => (
            <tr key={t.id}>
              <td>{t.title}<div className="tiny">{TASK_TYPES[t.taskType] ?? t.taskType}</div></td>
              <td className="tiny">{schedule(t)}</td>
              <td className="tiny">{t.isActive ? formatDateTime(t.nextRunAt) : 'Paused'}{t.lastRunAt ? <div>last {formatDateTime(t.lastRunAt)}</div> : null}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle(t)}>{t.isActive ? 'Pause' : 'Resume'}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(t)}>Delete</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {creating && <TaskModal storeId={storeId} onClose={() => setCreating(false)} onDone={refresh} />}
    </section>
  );
}

function TaskModal({ storeId, onClose, onDone }: { storeId: string; onClose: () => void; onDone: () => void }) {
  const { showToast } = useToast();
  const [taskType, setTaskType] = useState('purchase_suggestions');
  const [title, setTitle] = useState(TASK_TYPES.purchase_suggestions);
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [timeOfDay, setTimeOfDay] = useState('09:00');
  const create = useMutation({
    mutationFn: () => automationApi.createTask(storeId, {
      title: title.trim(), taskType, frequency, timeOfDay,
      ...(frequency === 'weekly' ? { dayOfWeek } : frequency === 'monthly' ? { dayOfMonth } : {}),
    }),
    onSuccess: () => { showToast('Task scheduled', 'success'); onDone(); onClose(); },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  return (
    <Modal title="New scheduled task" onClose={onClose} busy={create.isPending}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="task-form" className="btn btn-primary" disabled={create.isPending}>Schedule</button></>}>
      <form id="task-form" className="form-grid" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <div className="input-wrapper"><label className="input-label" htmlFor="tk-type">What</label>
          <select id="tk-type" className="input-field" value={taskType} onChange={(e) => { setTaskType(e.target.value); setTitle(TASK_TYPES[e.target.value]); }}>
            {Object.entries(TASK_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div className="input-wrapper"><label className="input-label" htmlFor="tk-title">Title</label>
          <input id="tk-title" className="input-field" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="form-row">
          <div className="input-wrapper"><label className="input-label" htmlFor="tk-freq">How often</label>
            <select id="tk-freq" className="input-field" value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
              <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>
          {frequency === 'weekly' && <div className="input-wrapper"><label className="input-label" htmlFor="tk-dow">Day</label>
            <select id="tk-dow" className="input-field" value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></div>}
          {frequency === 'monthly' && <div className="input-wrapper"><label className="input-label" htmlFor="tk-dom">Day of month</label>
            <input id="tk-dom" type="number" min={1} max={28} className="input-field" value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))} /></div>}
          <div className="input-wrapper"><label className="input-label" htmlFor="tk-time">Time</label>
            <input id="tk-time" type="time" className="input-field" required value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} /></div>
        </div>
      </form>
    </Modal>
  );
}

function LowStock({ storeId }: { storeId: string }) {
  const query = useQuery({ queryKey: ['low-stock', storeId], queryFn: () => automationApi.lowStock(storeId) });
  const items = query.data?.items ?? [];
  return (
    <section className="card">
      <div className="row-between"><h2 style={{ fontSize: 'var(--text-base)' }}>Low stock right now</h2><Link to="/suggestions" className="btn btn-ghost btn-sm">What to reorder →</Link></div>
      <p className="tiny">You also get an inbox alert the moment an item drops to its threshold.</p>
      {query.isLoading ? <Spinner /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : items.length === 0 ? <p className="muted">Nothing is below its threshold.</p> : (
        <table className="table"><tbody>{items.map((i) => (
          <tr key={i.variantId}><td>{i.productName}{i.variantName && i.variantName !== 'Default' ? ` (${i.variantName})` : ''}</td><td>{i.availableQuantity} left</td><td className="tiny">alert at {i.lowStockThreshold}</td></tr>
        ))}</tbody></table>
      )}
    </section>
  );
}

function KhataReminders({ storeId }: { storeId: string }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const store = useQuery({ queryKey: ['store', storeId], queryFn: () => storeApi.get(storeId) });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => khataApi.autoReminders(storeId, enabled),
    onSuccess: (data) => { queryClient.invalidateQueries({ queryKey: ['store', storeId] }); showToast(data.khataAutoReminders ? 'Automatic reminders on' : 'Automatic reminders off', 'success'); },
    onError: (err) => showToast(errorMessage(err), 'error'),
  });
  const khata = store.data?.store.khata;
  return (
    <section className="card">
      <h2 style={{ fontSize: 'var(--text-base)' }}>Khata reminders</h2>
      {store.isLoading ? <Spinner /> : !khata?.enabled ? <p className="muted">Khata is off for this shop. Turn it on from <Link to="/khata">Khata</Link>.</p> : (
        <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
          <input type="checkbox" checked={!!khata.autoReminders} disabled={toggle.isPending} onChange={(e) => toggle.mutate(e.target.checked)} />
          <span>Remind customers automatically when a balance is overdue<div className="tiny">At most one reminder a week per overdue account, and never for an account where you turned reminders off.</div></span>
        </label>
      )}
    </section>
  );
}
